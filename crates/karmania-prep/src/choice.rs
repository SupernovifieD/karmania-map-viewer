//! Choosing the frame for the datasets that are loaded, and saying which of them are drawn.

use karmania_core::{BBox, CrsRef, Dataset, DatasetId, Finding};
use karmania_crs::Transformer;
use serde::Serialize;

use crate::drawable::{DrawStatus, Drawability, drawable, not_placeable, unusable};
use crate::frame::map_crs_for;
use crate::origin::{Frame, FrameSource};

/// Where in the extent of a dataset positions are converted to find its extent in another system:
/// a 3 x 3 grid of points (the corners, the middles of the sides and the centre).
const SAMPLES: [f64; 3] = [0.0, 0.5, 1.0];

/// What [`drawable`] says of one dataset, with the dataset's id.
///
/// JSON form: `{"id":1,"status":"drawn","reprojected":false,"findings":[]}`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DrawableEntry {
    /// The dataset.
    pub id: DatasetId,
    /// Drawn or not.
    pub status: DrawStatus,
    /// Whether its positions are converted.
    pub reprojected: bool,
    /// The reason it is not drawn, or what was assumed to draw it.
    pub findings: Vec<Finding>,
}

/// The frame, and which datasets are drawn in it.
///
/// JSON form: `{"frame":{...}|null,"drawable":[...],"findings":[...]}`. The brief's contract has the
/// first two; `findings` is the map's own (the UTM zone that was chosen, once, when it was chosen).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FrameChoice {
    /// The frame, or `None` when no dataset is loaded or none has a coordinate system and a position.
    pub frame: Option<Frame>,
    /// One entry per dataset, in the order they were given.
    pub drawable: Vec<DrawableEntry>,
    /// Info findings about the choice of the map's system; empty when the frame was kept.
    pub findings: Vec<Finding>,
}

/// Chooses the frame for `datasets` (in the order they were loaded), and says which are drawn.
///
/// - `preferred` is a system the person chose: the map is drawn in it (source `user`). If it is the map's
///   system already, the origin stays; otherwise the origin is worked out again from the first dataset
///   that is drawn in it.
/// - Without one, `previous` is kept for as long as any dataset is loaded: the map's system changes
///   only when the person changes it, or after the last dataset was removed (no datasets: no frame).
/// - With neither, the first dataset that has a system and a position gives the map's system
///   ([`map_crs_for`], with a finding for a UTM zone) and the origin is the centre of its extent in it.
///
/// The origin of a map in which nothing is drawn is 0, and is worked out again by a later call when a
/// dataset can be drawn in it: see [`choose_frame_tracking`], which a caller that keeps the frame uses.
#[must_use]
pub fn choose_frame(
    previous: Option<&Frame>,
    preferred: Option<CrsRef>,
    datasets: &[&Dataset],
) -> FrameChoice {
    choose_frame_tracking(previous, preferred, datasets, false).0
}

/// [`choose_frame`] for a caller that keeps the frame between calls. `origin_waiting` says that `previous` was
/// made when no dataset could be drawn in it, so that its origin (0) was not made from a dataset: the origin
/// of the section 9.1 rule is the centre of the extent of the first drawable dataset, and when one comes
/// the origin is made from it, once. Returns the choice, and whether the origin is still waiting.
#[must_use]
pub fn choose_frame_tracking(
    previous: Option<&Frame>,
    preferred: Option<CrsRef>,
    datasets: &[&Dataset],
    origin_waiting: bool,
) -> (FrameChoice, bool) {
    let mut findings = Vec::new();
    let mut waiting = false;
    let mut made = |(frame, found): (Frame, bool)| {
        waiting = !found;
        frame
    };
    let frame = if datasets.is_empty() {
        None
    } else {
        match (preferred, previous) {
            (Some(crs), Some(kept)) if kept.map_crs == crs && !origin_waiting => Some(Frame {
                source: FrameSource::User,
                ..*kept
            }),
            (Some(crs), _) => Some(made(frame_in(crs, datasets, FrameSource::User))),
            (None, Some(kept)) if !origin_waiting => Some(*kept),
            (None, Some(kept)) => Some(made(frame_in(kept.map_crs, datasets, kept.source))),
            (None, None) => datasets
                .iter()
                .filter(|dataset| unusable(dataset).is_none())
                .find_map(|dataset| {
                    let choice = map_crs_for(dataset.crs?, &dataset.bbox()?)?;
                    findings.extend(choice.finding);
                    Some(made(frame_in(choice.crs, datasets, FrameSource::Auto)))
                }),
        }
    };
    let drawable = datasets
        .iter()
        .map(|dataset| {
            let Drawability {
                status,
                reprojected,
                findings,
            } = match &frame {
                Some(frame) => drawable(frame.map_crs, dataset),
                None => unusable(dataset).unwrap_or_else(not_placeable),
            };
            DrawableEntry {
                id: dataset.id,
                status,
                reprojected,
                findings,
            }
        })
        .collect();
    (
        FrameChoice {
            frame,
            drawable,
            findings,
        },
        waiting,
    )
}

/// The frame of a map in `crs`: the origin is the centre of the extent of the first dataset drawn in it (0
/// if none is, and then the second answer is `false`).
fn frame_in(crs: CrsRef, datasets: &[&Dataset], source: FrameSource) -> (Frame, bool) {
    let centre = datasets
        .iter()
        .filter(|dataset| drawable(crs, dataset).status == DrawStatus::Drawn)
        .find_map(|dataset| extent_in(crs, dataset))
        .map(|extent| {
            let [x, y, z] = std::array::from_fn(|axis| (extent.min[axis] + extent.max[axis]) / 2.0);
            [x, y, z]
        });
    (
        Frame::new(crs, centre.unwrap_or([0.0; 3]), source),
        centre.is_some(),
    )
}

/// The extent of `dataset` in `crs`: its own extent if it is in `crs`, otherwise the extent of the
/// 3 x 3 points of its own extent, converted (z is not converted). `None` if it has no extent or the
/// conversion fails for every point.
fn extent_in(crs: CrsRef, dataset: &Dataset) -> Option<BBox> {
    let extent = dataset.bbox()?;
    let own = dataset.crs?;
    if own == crs {
        return Some(extent);
    }
    let transformer = Transformer::new(own, crs).ok()?;
    let points = SAMPLES.iter().flat_map(|&fx| {
        SAMPLES.iter().map(move |&fy| {
            let x = extent.min[0] + fx * (extent.max[0] - extent.min[0]);
            let y = extent.min[1] + fy * (extent.max[1] - extent.min[1]);
            (x, y)
        })
    });
    BBox::from_points(points.map(|(x, y)| {
        let [cx, cy] = transformer.convert(x, y);
        [cx, cy, extent.min[2]]
    }))
    .map(|b| BBox {
        min: [b.min[0], b.min[1], extent.min[2]],
        max: [b.max[0], b.max[1], extent.max[2]],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{blocks, grid, points};
    use karmania_core::Units;

    fn epsg(code: u32) -> CrsRef {
        CrsRef::Epsg { code }
    }

    fn with_id(mut dataset: Dataset, id: u64) -> Dataset {
        dataset.id = DatasetId(id);
        dataset
    }

    const UTM: [(f64, f64); 2] = [(512_000.0, 4_012_000.0), (513_000.0, 4_013_000.0)];

    fn statuses(choice: &FrameChoice) -> Vec<(u64, DrawStatus, bool)> {
        choice
            .drawable
            .iter()
            .map(|e| (e.id.0, e.status, e.reprojected))
            .collect()
    }

    #[test]
    fn no_datasets_no_frame() {
        let choice = choose_frame(None, None, &[]);
        assert_eq!(
            choice,
            FrameChoice {
                frame: None,
                drawable: vec![],
                findings: vec![]
            }
        );
        // The last dataset was removed: the frame goes, whatever it was.
        let kept = Frame::new(epsg(32640), [0.0; 3], FrameSource::User);
        assert_eq!(choose_frame(Some(&kept), None, &[]).frame, None);
    }

    #[test]
    fn the_first_dataset_gives_its_own_system_and_the_origin_is_its_centre() {
        let a = with_id(points(Some(epsg(32640)), &UTM), 1);
        let choice = choose_frame(None, None, &[&a]);
        let frame = choice.frame.unwrap();
        assert_eq!(frame.map_crs, epsg(32640));
        assert_eq!(
            (frame.origin, frame.source),
            ([513_000.0, 4_013_000.0, 0.0], FrameSource::Auto)
        );
        assert!(choice.findings.is_empty());
        assert_eq!(statuses(&choice), [(1, DrawStatus::Drawn, false)]);
    }

    #[test]
    fn geographic_data_gives_a_utm_zone_with_a_finding_and_the_origin_is_in_it() {
        let a = with_id(points(Some(epsg(4326)), &[(57.0, 25.0), (57.6, 25.4)]), 1);
        let choice = choose_frame(None, None, &[&a]);
        let frame = choice.frame.unwrap();
        assert_eq!(frame.map_crs, epsg(32640));
        // The centre, 57.3 E 25.2 N, is 0.3 degrees east of the central meridian of zone 40 (57 E), about
        // 30 km at this latitude, so an easting near 530,000; the northing of 25.2 N is near 2,790,000.
        let [x, y, _] = frame.origin;
        assert!((529_000.0..=531_000.0).contains(&x), "{x}");
        assert!((2_780_000.0..=2_800_000.0).contains(&y), "{y}");
        assert_eq!(frame.origin[0] % 1_000.0, 0.0);
        assert_eq!(choice.findings.len(), 1);
        assert_eq!(choice.findings[0].code.as_str(), "display.frame.utm_chosen");
        assert_eq!(statuses(&choice), [(1, DrawStatus::Drawn, true)]);
    }

    #[test]
    fn the_frame_is_kept_while_datasets_remain_even_if_the_first_is_gone() {
        let a = with_id(points(Some(epsg(32640)), &UTM), 1);
        let b = with_id(points(Some(epsg(32641)), &[(300_000.0, 4_000_000.0)]), 2);
        let first = choose_frame(None, None, &[&a, &b]).frame.unwrap();
        assert_eq!(first.map_crs, epsg(32640));
        // The first dataset is removed: the map stays in 32640, and b is drawn reprojected.
        let again = choose_frame(Some(&first), None, &[&b]);
        assert_eq!(again.frame, Some(first));
        assert!(again.findings.is_empty());
        assert_eq!(statuses(&again), [(2, DrawStatus::Drawn, true)]);
    }

    #[test]
    fn a_preferred_system_is_a_user_choice_and_moves_the_origin_only_if_the_system_changes() {
        let a = with_id(points(Some(epsg(32640)), &UTM), 1);
        let auto = choose_frame(None, None, &[&a]).frame.unwrap();
        let same = choose_frame(Some(&auto), Some(epsg(32640)), &[&a])
            .frame
            .unwrap();
        assert_eq!((same.origin, same.source), (auto.origin, FrameSource::User));
        let other = choose_frame(Some(&auto), Some(epsg(32641)), &[&a]);
        let frame = other.frame.unwrap();
        assert_eq!(
            (frame.map_crs, frame.source),
            (epsg(32641), FrameSource::User)
        );
        assert_ne!(frame.origin, auto.origin);
        assert_eq!(statuses(&other), [(1, DrawStatus::Drawn, true)]);
        // A system that nothing is drawn in has the origin 0.
        let none = choose_frame(
            None,
            Some(CrsRef::Local {
                units: Units::Metre,
            }),
            &[&a],
        );
        assert_eq!(none.frame.unwrap().origin, [0.0; 3]);
        assert_eq!(statuses(&none), [(1, DrawStatus::NotDrawn, false)]);
    }

    #[test]
    fn a_grid_and_blocks_and_an_unconvertible_dataset_are_listed_with_their_reasons() {
        let a = with_id(points(Some(epsg(32640)), &UTM), 1);
        let g = with_id(grid(Some(epsg(32641))), 2);
        let bl = with_id(blocks(Some(epsg(32641))), 3);
        let x = with_id(points(Some(epsg(99_999)), &UTM), 4);
        let choice = choose_frame(None, None, &[&a, &g, &bl, &x]);
        assert_eq!(
            statuses(&choice),
            [
                (1, DrawStatus::Drawn, false),
                (2, DrawStatus::Drawn, true),
                (3, DrawStatus::NotDrawn, false),
                (4, DrawStatus::NotDrawn, false),
            ]
        );
        assert_eq!(
            choice.drawable[2].findings[0].code.as_str(),
            "display.blocks.other_crs"
        );
        assert_eq!(
            choice.drawable[3].findings[0].code.as_str(),
            "display.crs.not_convertible"
        );
    }

    #[test]
    fn datasets_with_no_system_or_position_are_skipped_for_the_frame() {
        let none = with_id(points(None, &UTM), 1);
        let empty = with_id(points(Some(epsg(32640)), &[]), 2);
        let b = with_id(points(Some(epsg(32641)), &[(300_000.0, 4_000_000.0)]), 3);
        let choice = choose_frame(None, None, &[&none, &empty, &b]);
        assert_eq!(choice.frame.unwrap().map_crs, epsg(32641));
        assert_eq!(choice.drawable[0].findings[0].code.as_str(), "crs.missing");
        assert_eq!(
            choice.drawable[1].findings[0].code.as_str(),
            "display.extent.none"
        );
        // Only such datasets: no frame, and each says why.
        let choice = choose_frame(None, None, &[&none, &empty]);
        assert_eq!(choice.frame, None);
        assert_eq!(
            statuses(&choice),
            [
                (1, DrawStatus::NotDrawn, false),
                (2, DrawStatus::NotDrawn, false)
            ]
        );
    }

    #[test]
    fn the_extent_of_a_dataset_in_another_system_is_that_of_its_converted_points() {
        let g = grid(Some(epsg(32640)));
        let own = extent_in(epsg(32640), &g).unwrap();
        assert_eq!(own, g.bbox().unwrap());
        let moved = extent_in(epsg(32641), &g).unwrap();
        // Zone 40 is west of the central meridian of zone 41, by about 540 km at this latitude.
        assert!(moved.min[0] < own.min[0] - 400_000.0, "{moved:?}");
        assert_eq!((moved.min[2], moved.max[2]), (own.min[2], own.max[2]));
        assert_eq!(extent_in(epsg(99_999), &g), None);
    }
}
