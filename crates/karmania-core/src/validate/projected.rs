//! Plausibility check for projected coordinate systems.
//!
//! A few sample coordinates are converted back to longitude and latitude. If
//! they come out as impossible positions, the data probably is not in the
//! coordinate system the dataset names (wrong UTM zone, swapped easting and
//! northing, local grid labelled as UTM, and so on).

use proj4rs::proj::Proj;

use crate::codes::FindingCode;
use crate::crs::CrsRef;
use crate::dataset::{Dataset, Kind};
use crate::epsg::{self, CrsKind};
use crate::findings::{Finding, Findings, Location};

/// How many data positions are tried besides the four corners of the box.
const MAX_SAMPLES: usize = 1_000;
/// The target of the conversion: longitude and latitude, in radians.
const LONGLAT: &str = "+proj=longlat +datum=WGS84 +no_defs";
/// Slack for values that land a hair outside the limits (0.0000001 degrees).
const EPSILON: f64 = 1e-7;
/// How far a round trip may drift, in the projection's own units (about a metre
/// for metric systems), plus a relative part of one part in a billion.
const ROUND_TRIP_TOLERANCE: f64 = 1.0;

/// One coordinate to try, and where it came from if it is a data position.
struct Sample {
    xy: [f64; 2],
    element: Option<usize>,
}

/// Checks a projected EPSG system against a few sample coordinates.
pub(super) fn check(dataset: &Dataset, findings: &mut Findings) {
    let Some(CrsRef::Epsg { code }) = dataset.crs else {
        return;
    };
    let Some(info) = epsg::lookup(code).filter(|i| i.kind == CrsKind::Projected) else {
        return;
    };
    let samples = samples(dataset);
    if samples.is_empty() {
        return;
    }
    let from = epsg::proj4(code).and_then(|text| Proj::from_proj_string(text).ok());
    let (Some(from), Ok(to)) = (from, Proj::from_proj_string(LONGLAT)) else {
        findings.add(Finding::new(
            FindingCode::CrsProjectedUnchecked,
            format!(
                "The coordinates could not be checked against EPSG:{code} ({}) because this tool cannot calculate that projection.",
                info.name
            ),
        ));
        return;
    };
    let mut bad = Finding::new(
        FindingCode::CrsProjectedImplausible,
        format!(
            "Some coordinates do not fit EPSG:{code} ({}): they cannot be converted to valid longitudes and latitudes.",
            info.name
        ),
    )
    .with_hint("Check that you chose the right coordinate system, for example the right UTM zone and hemisphere, and that X is the easting and Y the northing.");
    bad.count = 0;
    for sample in samples {
        if converts_to_a_valid_position(&from, &to, sample.xy) {
            continue;
        }
        bad.count += 1;
        if let Some(index) = sample.element {
            let at = Location::default();
            let at = match dataset.kind() {
                Kind::Points => at.with_element(index as u64),
                _ => at.with_vertex(index as u64),
            };
            bad = bad.at(at);
        }
    }
    if bad.count > 0 {
        findings.add(bad);
    }
}

/// The four corners of the bounding box, then up to [`MAX_SAMPLES`] evenly
/// spaced data positions. Positions with a non-finite coordinate are skipped.
fn samples(dataset: &Dataset) -> Vec<Sample> {
    let Some(bbox) = dataset.bbox() else {
        return Vec::new();
    };
    let (min, max) = (bbox.min, bbox.max);
    let mut samples: Vec<Sample> = [
        [min[0], min[1]],
        [max[0], min[1]],
        [min[0], max[1]],
        [max[0], max[1]],
    ]
    .into_iter()
    .map(|xy| Sample { xy, element: None })
    .collect();
    if let Some(positions) = dataset.geometry.positions() {
        let count = positions.len();
        let wanted = count.min(MAX_SAMPLES);
        for k in 0..wanted {
            // Evenly spaced, always including the first and the last position.
            let index = if wanted > 1 {
                (k as u128 * (count as u128 - 1) / (wanted as u128 - 1)) as usize
            } else {
                0
            };
            if let Some([x, y, z]) = positions.get(index)
                && [x, y, z].iter().all(|c| c.is_finite())
            {
                samples.push(Sample {
                    xy: [x, y],
                    element: Some(index),
                });
            }
        }
    }
    samples
}

/// Converts one coordinate to longitude and latitude and checks the answer.
///
/// The answer must be a real position (finite, within the range of longitude
/// and latitude), and converting it back must give the coordinate we started
/// with. The second test catches coordinates a projection can only wrap around
/// the globe, such as a northing beyond the pole, which still come out as
/// plausible-looking numbers. A failed conversion counts as not valid.
fn converts_to_a_valid_position(from: &Proj, to: &Proj, xy: [f64; 2]) -> bool {
    let mut point = (xy[0], xy[1], 0.0);
    if proj4rs::transform::transform(from, to, &mut point).is_err() {
        return false;
    }
    let (lon, lat) = (point.0.to_degrees(), point.1.to_degrees());
    let real_position = lon.is_finite()
        && lat.is_finite()
        && lat.abs() <= 90.0 + EPSILON
        && (-180.0 - EPSILON..=360.0 + EPSILON).contains(&lon);
    if !real_position {
        return false;
    }
    let mut back = point;
    if proj4rs::transform::transform(to, from, &mut back).is_err() {
        return false;
    }
    let close =
        |got: f64, wanted: f64| (got - wanted).abs() <= ROUND_TRIP_TOLERANCE + 1e-9 * wanted.abs();
    close(back.0, xy[0]) && close(back.1, xy[1])
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{codes, dataset, run};
    use super::*;
    use crate::dataset::Geometry;
    use crate::positions::Positions;

    fn utm40(points: &[(f64, f64)]) -> Dataset {
        let xyz: Vec<f64> = points.iter().flat_map(|&(x, y)| [x, y, 0.0]).collect();
        let mut d = dataset(Geometry::Points(Positions::from_interleaved(xyz, false)));
        d.crs = Some(CrsRef::Epsg { code: 32640 });
        d
    }

    #[test]
    fn real_utm_coordinates_in_the_right_zone_pass() {
        // Around 57 E, 25 N: easting near 500000, northing near 2.77 million.
        let d = utm40(&[
            (500_000.0, 2_765_000.0),
            (520_000.0, 2_780_000.0),
            (480_000.0, 2_750_000.0),
        ]);
        assert!(run(check, &d).is_empty());
    }

    #[test]
    fn a_northing_beyond_the_pole_wraps_around_and_is_flagged() {
        // 20,000 km and -30,000 km north are past the pole; the projection
        // returns a position on the other side of the Earth, which does not
        // convert back to the same coordinate.
        let d = utm40(&[
            (500_000.0, 2_765_000.0),
            (500_000.0, 2e7),
            (500_000.0, -3e7),
        ]);
        let f = run(check, &d);
        assert_eq!(codes(&f), ["crs.projected.implausible"]);
        let one = &f.as_slice()[0];
        assert_eq!(one.severity, crate::findings::Severity::Warning);
        assert_eq!(one.step, Some(crate::findings::WizardStep::Crs));
        assert!(
            one.message
                .starts_with("Some coordinates do not fit EPSG:32640 (WGS 84 / UTM zone 40N)")
        );
        let at: Vec<_> = one.examples.iter().map(|l| l.element).collect();
        assert!(at.contains(&Some(1)) && at.contains(&Some(2)) && !at.contains(&Some(0)));
    }

    #[test]
    fn coordinates_that_are_absurd_for_the_zone_but_convert_cleanly_are_not_flagged() {
        // Known limit: without the area each system is meant for, an easting of
        // 2.7 million in a UTM zone still converts to a valid position 20
        // degrees from the zone, so nothing can be said about it.
        let d = utm40(&[(2_765_000.0, 500_000.0), (5_000_000.0, 2_765_000.0)]);
        assert!(run(check, &d).is_empty());
    }

    #[test]
    fn a_conversion_that_fails_or_overflows_is_flagged() {
        let d = utm40(&[(5e7, 0.0), (1e15, 1e15)]);
        assert_eq!(codes(&run(check, &d)), ["crs.projected.implausible"]);
    }

    #[test]
    fn only_projected_epsg_systems_are_checked() {
        let mut geographic = utm40(&[(2e7, 2e7)]);
        geographic.crs = Some(CrsRef::Epsg { code: 4326 });
        assert!(run(check, &geographic).is_empty());
        let mut local = utm40(&[(2e7, 2e7)]);
        local.crs = Some(CrsRef::Local {
            units: crate::crs::Units::Metre,
        });
        assert!(run(check, &local).is_empty());
        let mut unknown = utm40(&[(2e7, 2e7)]);
        unknown.crs = Some(CrsRef::Epsg { code: 99_999 });
        assert!(run(check, &unknown).is_empty());
        let mut missing = utm40(&[(2e7, 2e7)]);
        missing.crs = None;
        assert!(run(check, &missing).is_empty());
    }

    #[test]
    fn no_finite_positions_means_nothing_to_check() {
        assert!(run(check, &utm40(&[(f64::NAN, 1.0)])).is_empty());
        assert!(run(check, &utm40(&[])).is_empty());
    }

    #[test]
    fn large_datasets_are_sampled_evenly_including_the_first_and_last_position() {
        let points: Vec<(f64, f64)> = (0..5_000)
            .map(|i| (500_000.0 + f64::from(i), 2_765_000.0))
            .collect();
        let d = utm40(&points);
        let all = samples(&d);
        // 4 corners + 1,000 data samples.
        assert_eq!(all.len(), 1_004);
        let indices: Vec<usize> = all.iter().filter_map(|s| s.element).collect();
        assert_eq!(
            (indices.first().copied(), indices.last().copied()),
            (Some(0), Some(4_999))
        );
        assert!(indices.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn small_datasets_are_checked_in_full_and_a_single_point_works() {
        let one = samples(&utm40(&[(500_000.0, 2_765_000.0)]));
        assert_eq!(one.len(), 5);
        let three = samples(&utm40(&[(1.0, 1.0), (2.0, 2.0), (3.0, 3.0)]));
        let idx: Vec<_> = three.iter().filter_map(|s| s.element).collect();
        assert_eq!(idx, [0, 1, 2]);
    }

    #[test]
    fn a_projected_grid_is_checked_by_the_corners_of_its_extent() {
        let mut d = super::super::testutil::grid([10, 10, 1]);
        d.crs = Some(CrsRef::Epsg { code: 32640 });
        // The unit-sized grid sits at the origin of the UTM zone: easting 0..10,
        // northing 0..10 is valid (far from the central meridian but not impossible).
        let f = run(check, &d);
        assert!(
            f.iter()
                .all(|f| f.code.as_str() != "crs.projected.unchecked")
        );
    }

    #[test]
    fn a_projection_the_engine_cannot_calculate_is_reported_not_skipped() {
        let mut d = utm40(&[(1.0, 1.0)]);
        d.crs = Some(CrsRef::Epsg { code: 2085 });
        let f = run(check, &d);
        assert_eq!(codes(&f), ["crs.projected.unchecked"]);
        let one = &f.as_slice()[0];
        assert_eq!(one.severity, crate::findings::Severity::Info);
        assert!(
            one.message
                .starts_with("The coordinates could not be checked against EPSG:2085 (")
        );
        assert!(!f.has_errors());
    }

    #[test]
    fn most_projected_codes_can_be_built_and_the_rest_are_a_known_minority() {
        let (mut total, mut failing) = (0, 0);
        for code in 0..=u16::MAX {
            let Some(info) = epsg::lookup(u32::from(code)).filter(|i| i.kind == CrsKind::Projected)
            else {
                continue;
            };
            total += 1;
            let built = epsg::proj4(info.code).is_some_and(|s| Proj::from_proj_string(s).is_ok());
            failing += usize::from(!built);
        }
        // About 6% (305 of 5,217 with proj4rs 0.2.1) are not supported.
        assert!(
            total > 5_000 && failing * 10 < total,
            "{failing} of {total}"
        );
    }
}
