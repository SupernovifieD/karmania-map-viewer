//! Whether a dataset can be drawn in the map's coordinate system, and why not.
//!
//! The rules of section 9.2 of the brief, in this order, for a dataset in `D` and a map in `M`:
//!
//! 1. `D` is `M`: drawn as it is.
//! 2. A block model in any other system: not drawn (blocks are not warped in phase 2).
//! 3. Two local grids in other units: drawn, scaled by the units, with an info finding that the two are
//!    taken to be the same grid.
//! 4. A local grid and an EPSG system: not drawn.
//! 5. Two EPSG systems that the definitions can convert between: drawn, reprojected (a grid is drawn
//!    as a warped image); otherwise (a code that is not in the definitions, or one that cannot be
//!    built): not drawn.
//!
//! A dataset that is not drawn stays loaded; the reason is a finding with a hint. Reprojected lines
//! and polygon edges are straight between their reprojected vertices: long edges are not densified.

use karmania_core::{CrsRef, Dataset, Finding, FindingCode, Kind, Units};
use karmania_crs::Transformer;
use serde::Serialize;

/// Whether a dataset is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawStatus {
    /// Drawn in the map's coordinate system.
    Drawn,
    /// Loaded but not drawn; the findings say why.
    NotDrawn,
}

/// What [`drawable`] says of one dataset.
///
/// JSON form: `{"status":"drawn","reprojected":true,"findings":[...]}`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Drawability {
    /// Drawn or not.
    pub status: DrawStatus,
    /// Whether its positions are converted: reprojected, or scaled from other units. Never true for
    /// a dataset that is not drawn.
    pub reprojected: bool,
    /// The reason it is not drawn, or what was assumed to draw it. No finding means drawn as it is.
    pub findings: Vec<Finding>,
}

impl Drawability {
    fn drawn(reprojected: bool, findings: Vec<Finding>) -> Self {
        Self {
            status: DrawStatus::Drawn,
            reprojected,
            findings,
        }
    }

    fn not_drawn(finding: Finding) -> Self {
        Self {
            status: DrawStatus::NotDrawn,
            reprojected: false,
            findings: vec![finding],
        }
    }
}

/// Whether `dataset` can be drawn in a map in `map_crs`.
#[must_use]
pub fn drawable(map_crs: CrsRef, dataset: &Dataset) -> Drawability {
    let Some(own) = dataset.crs else {
        return Drawability::not_drawn(missing());
    };
    if dataset.bbox().is_none() {
        return Drawability::not_drawn(no_extent());
    }
    if own == map_crs {
        return Drawability::drawn(false, Vec::new());
    }
    if dataset.kind() == Kind::Blocks {
        return Drawability::not_drawn(blocks_other_crs(own, map_crs));
    }
    if let (CrsRef::Local { units: from }, CrsRef::Local { units: to }) = (own, map_crs) {
        return Drawability::drawn(true, vec![local_grids_assumed(from, to)]);
    }
    match Transformer::new(own, map_crs) {
        Ok(_) => Drawability::drawn(true, Vec::new()),
        Err(cause) => Drawability::not_drawn(not_convertible(&cause)),
    }
}

/// A system in a few words: `EPSG:32640`, or `a local grid in metres`.
fn name(crs: CrsRef) -> String {
    match crs {
        CrsRef::Epsg { code } => format!("EPSG:{code}"),
        CrsRef::Local { units } => format!("a local grid in {}", units_word(units)),
    }
}

fn units_word(units: Units) -> &'static str {
    match units {
        Units::Metre => "metres",
        Units::Foot => "feet",
        Units::UsSurveyFoot => "US survey feet",
    }
}

const CHANGE_THE_MAP: &str = "Change the map's coordinate system to the one this dataset is in.";

fn missing() -> Finding {
    Finding::new(
        FindingCode::CrsMissing,
        "The coordinate reference system is missing, so the positions have no meaning on the Earth.",
    )
    .with_hint("Choose a coordinate system by its EPSG code (a number such as 32640), or choose a local grid and its units.")
}

fn no_extent() -> Finding {
    Finding::new(
        FindingCode::DisplayExtentNone,
        "Not drawn: none of the positions of this dataset can be placed on the map.",
    )
    .with_hint("Check the positions and the coordinate system of the data.")
}

fn blocks_other_crs(own: CrsRef, map_crs: CrsRef) -> Finding {
    Finding::new(
        FindingCode::DisplayBlocksOtherCrs,
        format!(
            "Not drawn: a block model is drawn only in the map's own coordinate system, and this one is in {} while the map is in {}.",
            name(own),
            name(map_crs)
        ),
    )
    .with_hint(CHANGE_THE_MAP)
}

fn local_grids_assumed(from: Units, to: Units) -> Finding {
    Finding::new(
        FindingCode::DisplayCrsLocalGridsAssumed,
        format!(
            "Local grids have no place on the Earth, so this one is taken to be the same grid as the map's, and its positions are scaled from {} to {}.",
            units_word(from),
            units_word(to)
        ),
    )
    .with_hint("If they are different grids, their positions will not line up.")
}

/// The reason the transformer gave, as the reason the dataset is not drawn.
fn not_convertible(cause: &Finding) -> Finding {
    Finding::new(
        FindingCode::DisplayCrsNotConvertible,
        format!("Not drawn: {}", cause.message),
    )
    .with_hint(CHANGE_THE_MAP)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{blocks, grid, points};

    fn epsg(code: u32) -> CrsRef {
        CrsRef::Epsg { code }
    }

    fn local(units: Units) -> CrsRef {
        CrsRef::Local { units }
    }

    const ONE: [(f64, f64); 1] = [(500_000.0, 4_000_000.0)];

    fn codes(d: &Drawability) -> Vec<&'static str> {
        d.findings.iter().map(|f| f.code.as_str()).collect()
    }

    #[test]
    fn the_same_system_is_drawn_as_it_is_for_every_kind() {
        for system in [epsg(32640), local(Units::Foot), epsg(99_999)] {
            for dataset in [
                points(Some(system), &ONE),
                grid(Some(system)),
                blocks(Some(system)),
            ] {
                let d = drawable(system, &dataset);
                assert_eq!(d, Drawability::drawn(false, Vec::new()), "{system:?}");
            }
        }
    }

    #[test]
    fn an_epsg_system_that_can_be_converted_is_drawn_reprojected_and_so_is_a_grid() {
        // Geographic data on a UTM map, and a grid in one zone on the map of another.
        let d = drawable(epsg(32640), &points(Some(epsg(4326)), &[(57.3, 25.2)]));
        assert_eq!(d, Drawability::drawn(true, Vec::new()));
        let d = drawable(epsg(32641), &grid(Some(epsg(32640))));
        assert_eq!(d, Drawability::drawn(true, Vec::new()));
    }

    #[test]
    fn a_code_that_is_not_known_or_cannot_be_built_is_not_drawn_with_the_reason() {
        let unknown = drawable(epsg(32640), &points(Some(epsg(99_999)), &ONE));
        assert_eq!(unknown.status, DrawStatus::NotDrawn);
        assert!(!unknown.reprojected);
        assert_eq!(codes(&unknown), ["display.crs.not_convertible"]);
        assert_eq!(
            unknown.findings[0].message,
            "Not drawn: EPSG:99999 is not one of the coordinate systems Karmania knows, so positions cannot be converted to or from it."
        );
        assert_eq!(unknown.findings[0].hint.as_deref(), Some(CHANGE_THE_MAP));
        // The map in an unknown code (the first dataset was in it): another dataset is not drawn.
        let on_unknown = drawable(epsg(99_999), &points(Some(epsg(32640)), &ONE));
        assert_eq!(codes(&on_unknown), ["display.crs.not_convertible"]);
        // A system that needs datum files (EPSG:2085, which proj4rs cannot build).
        let needs_files = drawable(epsg(32640), &points(Some(epsg(2085)), &ONE));
        assert_eq!(needs_files.status, DrawStatus::NotDrawn);
        assert!(
            needs_files.findings[0]
                .message
                .contains("EPSG:2085: it needs files")
        );
    }

    #[test]
    fn a_local_grid_and_an_epsg_system_are_not_drawn_together_either_way() {
        for (map, own) in [
            (epsg(32640), local(Units::Metre)),
            (local(Units::Metre), epsg(32640)),
        ] {
            let d = drawable(map, &points(Some(own), &ONE));
            assert_eq!(d.status, DrawStatus::NotDrawn);
            assert_eq!(codes(&d), ["display.crs.not_convertible"]);
            assert!(
                d.findings[0]
                    .message
                    .contains("A local grid has no known place on the Earth")
            );
        }
    }

    #[test]
    fn local_grids_in_other_units_are_drawn_scaled_and_the_assumption_is_said() {
        let d = drawable(local(Units::Metre), &points(Some(local(Units::Foot)), &ONE));
        assert_eq!(d.status, DrawStatus::Drawn);
        assert!(d.reprojected);
        assert_eq!(codes(&d), ["display.crs.local_grids_assumed"]);
        assert_eq!(
            d.findings[0].message,
            "Local grids have no place on the Earth, so this one is taken to be the same grid as the map's, and its positions are scaled from feet to metres."
        );
    }

    #[test]
    fn a_block_model_is_drawn_only_in_the_map_system() {
        let cases = [
            (
                epsg(32641),
                epsg(32640),
                "EPSG:32640 while the map is in EPSG:32641",
            ),
            (
                local(Units::Metre),
                local(Units::Foot),
                "a local grid in feet while the map is in a local grid in metres",
            ),
        ];
        for (map, own, words) in cases {
            let d = drawable(map, &blocks(Some(own)));
            assert_eq!(d.status, DrawStatus::NotDrawn);
            assert_eq!(codes(&d), ["display.blocks.other_crs"]);
            assert!(
                d.findings[0].message.ends_with(&format!("{words}.")),
                "{}",
                d.findings[0].message
            );
        }
    }

    #[test]
    fn a_dataset_with_no_crs_or_no_position_is_not_drawn() {
        let d = drawable(epsg(32640), &points(None, &ONE));
        assert_eq!(codes(&d), ["crs.missing"]);
        let d = drawable(epsg(32640), &points(Some(epsg(32640)), &[(f64::NAN, 1.0)]));
        assert_eq!(codes(&d), ["display.extent.none"]);
        let d = drawable(epsg(32640), &points(Some(epsg(32640)), &[]));
        assert_eq!(codes(&d), ["display.extent.none"]);
    }

    #[test]
    fn the_json_form_names_the_status_in_snake_case() {
        let d = drawable(epsg(32640), &points(Some(epsg(99_999)), &ONE));
        let json = serde_json::to_value(&d).unwrap();
        assert_eq!(json["status"], "not_drawn");
        assert_eq!(json["reprojected"], false);
        assert_eq!(json["findings"][0]["code"], "display.crs.not_convertible");
    }
}
