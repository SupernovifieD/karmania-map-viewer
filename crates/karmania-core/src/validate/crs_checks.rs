//! CRS checks: does the dataset say which coordinate reference system it uses?
//!
//! The core does not know what an EPSG code means, so it cannot judge whether the
//! code exists or whether the coordinates fit it. It checks that a system has been
//! named, and, for the one code it can recognise without a table (EPSG:4326), that
//! the coordinates could be longitudes and latitudes.

use crate::codes::FindingCode;
use crate::crs::CrsRef;
use crate::dataset::{Dataset, Kind};
use crate::findings::{Finding, Findings, Location};

/// Runs the CRS checks.
pub(super) fn check(dataset: &Dataset, findings: &mut Findings) {
    check_present(dataset, findings);
    check_geographic_range(dataset, findings);
}

/// The only EPSG code the core treats as a longitude and latitude system: WGS 84.
///
/// This is a stand-in for a definitions lookup, which the core does not have (see
/// `docs/decisions.md`, step 4.16). Other geographic codes (NAD83, ETRS89, ...) are
/// not recognised and are not checked. When EPSG definitions return, replace this
/// constant with a question to them: is this code a longitude and latitude system?
const GEOGRAPHIC_EPSG_CODE: u32 = 4326;

/// Longitude may be written from -180 or from 0 (so up to 360); latitude is
/// always within 90 degrees of the equator.
const LONGITUDE_RANGE: (f64, f64) = (-180.0, 360.0);
const LATITUDE_LIMIT: f64 = 90.0;

fn is_longitude(x: f64) -> bool {
    (LONGITUDE_RANGE.0..=LONGITUDE_RANGE.1).contains(&x)
}

fn is_latitude(y: f64) -> bool {
    y.abs() <= LATITUDE_LIMIT
}

/// In a longitude and latitude system X is longitude and Y is latitude, so the
/// values must fit those ranges. A warning, so the data still loads. If the values
/// only fit with the axes swapped, say so instead.
fn check_geographic_range(dataset: &Dataset, findings: &mut Findings) {
    if dataset.crs
        != Some(CrsRef::Epsg {
            code: GEOGRAPHIC_EPSG_CODE,
        })
    {
        return;
    }
    let Some(bbox) = dataset.bbox() else {
        return;
    };
    let (min_x, max_x, min_y, max_y) = (bbox.min[0], bbox.max[0], bbox.min[1], bbox.max[1]);
    if is_longitude(min_x) && is_longitude(max_x) && is_latitude(min_y) && is_latitude(max_y) {
        return;
    }
    let swapped = is_latitude(min_x)
        && is_latitude(max_x)
        && (-180.0..=180.0).contains(&min_y)
        && (-180.0..=180.0).contains(&max_y);
    if swapped {
        findings.add(
            Finding::new(
                FindingCode::CrsGeographicAxesSwapped,
                format!(
                    "X and Y may be swapped: X runs from {min_x} to {max_x}, which fits latitude, and Y runs from {min_y} to {max_y}, which does not."
                ),
            )
            .with_hint("In a longitude and latitude system, X is longitude and Y is latitude. Swap the two columns in the mapping step."),
        );
        return;
    }
    let mut outside = Finding::new(
        FindingCode::CrsGeographicOutOfRange,
        format!(
            "Some coordinates are not valid longitudes and latitudes: X runs from {min_x} to {max_x} and Y from {min_y} to {max_y}, but longitude must be between -180 and 360 and latitude between -90 and 90."
        ),
    )
    .with_hint("Check the coordinate system. Values this large are usually in metres, as in UTM, and not in degrees.");
    // A grid or a block model has no positions to count; it is judged by its extent
    // alone, as one occurrence.
    if let Some(positions) = dataset.geometry.positions() {
        outside.count = 0;
        for (index, p) in positions.iter().enumerate() {
            let finite = p.iter().all(|c| c.is_finite());
            if finite && !(is_longitude(p[0]) && is_latitude(p[1])) {
                outside.count += 1;
                let at = Location::default();
                outside.add_example(match dataset.kind() {
                    Kind::Points => at.with_element(index as u64),
                    _ => at.with_vertex(index as u64),
                });
            }
        }
    }
    if outside.count > 0 {
        findings.add(outside);
    }
}

/// A dataset must say which coordinate reference system it uses. A local grid
/// with explicit units counts: it is a deliberate choice, not a missing one.
fn check_present(dataset: &Dataset, findings: &mut Findings) {
    if dataset.crs.is_none() {
        findings.add(
            Finding::new(
                FindingCode::CrsMissing,
                "The coordinate reference system is missing, so the positions have no meaning on the Earth.",
            )
            .with_hint("Choose a coordinate system by its EPSG code (a number such as 32640), or choose a local grid and its units."),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{codes, points, run};
    use super::*;
    use crate::crs::{CrsRef, Units};

    fn with_crs(crs: Option<CrsRef>) -> Dataset {
        let mut d = points(2);
        d.crs = crs;
        d
    }

    #[test]
    fn a_missing_crs_is_an_error_that_points_at_the_crs_step() {
        let f = run(check, &with_crs(None));
        assert_eq!(codes(&f), ["crs.missing"]);
        let one = &f.as_slice()[0];
        assert_eq!(one.step, Some(crate::findings::WizardStep::Crs));
        assert_eq!(one.severity, crate::findings::Severity::Error);
        assert_eq!(
            one.hint.as_deref(),
            Some(
                "Choose a coordinate system by its EPSG code (a number such as 32640), or choose a local grid and its units."
            )
        );
    }

    #[test]
    fn a_local_grid_with_units_is_accepted() {
        for units in [Units::Metre, Units::Foot, Units::UsSurveyFoot] {
            assert!(run(check, &with_crs(Some(CrsRef::Local { units }))).is_empty());
        }
    }

    #[test]
    fn any_epsg_code_is_accepted_because_the_core_does_not_know_what_codes_mean() {
        // These positions are small numbers, which also fit a longitude and latitude.
        for code in [4326, 32640, 3857, 27700, 2227, 99_999, u32::MAX] {
            assert!(
                run(check, &with_crs(Some(CrsRef::Epsg { code }))).is_empty(),
                "{code}"
            );
        }
    }

    fn geographic(xy: &[(f64, f64)]) -> Dataset {
        use crate::dataset::Geometry;
        use crate::positions::Positions;
        let flat: Vec<f64> = xy.iter().flat_map(|&(x, y)| [x, y, 0.0]).collect();
        let mut d = super::super::testutil::dataset(Geometry::Points(Positions::from_interleaved(
            flat, false,
        )));
        d.crs = Some(CrsRef::Epsg { code: 4326 });
        d
    }

    #[test]
    fn valid_longitudes_and_latitudes_pass_including_zero_to_360_longitudes() {
        assert!(
            run(
                check,
                &geographic(&[(55.5, 25.2), (-122.4, 37.8), (-180.0, -90.0), (180.0, 90.0)])
            )
            .is_empty()
        );
        assert!(
            run(
                check,
                &geographic(&[(0.0, 0.0), (350.0, 10.0), (360.0, -10.0)])
            )
            .is_empty()
        );
    }

    #[test]
    fn a_latitude_beyond_ninety_is_a_warning_counted_per_position() {
        let f = run(
            check,
            &geographic(&[(10.0, 10.0), (20.0, 95.0), (30.0, -100.0), (400.0, 0.0)]),
        );
        assert_eq!(codes(&f), ["crs.geographic.out_of_range"]);
        let one = &f.as_slice()[0];
        assert_eq!(
            (one.count, one.severity),
            (3, crate::findings::Severity::Warning)
        );
        assert_eq!(one.step, Some(crate::findings::WizardStep::Crs));
        let at: Vec<_> = one.examples.iter().map(|l| l.element).collect();
        assert_eq!(at, [Some(1), Some(2), Some(3)]);
        assert!(
            one.message
                .contains("X runs from 10 to 400 and Y from -100 to 95")
        );
    }

    #[test]
    fn projected_looking_numbers_in_wgs_84_are_a_warning() {
        let f = run(
            check,
            &geographic(&[(500_000.0, 2_800_000.0), (510_000.0, 2_810_000.0)]),
        );
        assert_eq!(codes(&f), ["crs.geographic.out_of_range"]);
        assert_eq!(f.as_slice()[0].count, 2);
    }

    #[test]
    fn swapped_axes_get_their_own_warning_instead_of_the_range_warning() {
        // Latitudes in X, longitudes (some above 90) in Y.
        let f = run(check, &geographic(&[(25.2, 121.5), (-33.9, 151.2)]));
        assert_eq!(codes(&f), ["crs.geographic.axes_swapped"]);
        let one = &f.as_slice()[0];
        assert_eq!(one.severity, crate::findings::Severity::Warning);
        assert_eq!(one.step, Some(crate::findings::WizardStep::Crs));
        assert!(
            one.message
                .starts_with("X and Y may be swapped: X runs from -33.9 to 25.2")
        );
        // Ambiguous data (both axes within 90) says nothing.
        assert!(run(check, &geographic(&[(35.7, 51.4), (30.0, 60.0)])).is_empty());
    }

    #[test]
    fn only_epsg_4326_is_range_checked() {
        // Any other code is accepted as given, geographic or not: the core cannot
        // tell the two apart without definitions. 4269 (NAD83) is geographic too.
        for code in [4269, 4258, 32640, 3857, 99_999] {
            let mut d = geographic(&[(500_000.0, 2_800_000.0)]);
            d.crs = Some(CrsRef::Epsg { code });
            assert!(run(check, &d).is_empty(), "{code}");
        }
        let mut local = geographic(&[(500_000.0, 2_800_000.0)]);
        local.crs = Some(CrsRef::Local {
            units: Units::Metre,
        });
        assert!(run(check, &local).is_empty());
        let mut missing = geographic(&[(500_000.0, 2_800_000.0)]);
        missing.crs = None;
        assert_eq!(codes(&run(check, &missing)), ["crs.missing"]);
    }

    #[test]
    fn non_finite_and_missing_positions_are_not_range_checked() {
        assert!(run(check, &geographic(&[(f64::NAN, 500.0)])).is_empty());
        assert!(run(check, &geographic(&[])).is_empty());
    }

    #[test]
    fn vertices_of_other_shapes_are_located_by_vertex() {
        let mut d = super::super::testutil::lines(15, &[0, 15]);
        d.crs = Some(CrsRef::Epsg { code: 4326 });
        // The vertices are (i, i * i). Y passes 90 from the vertex 10 on and 180 at
        // the vertex 14, which also rules out swapped axes.
        let f = run(check, &d);
        assert_eq!(codes(&f), ["crs.geographic.out_of_range"]);
        let one = &f.as_slice()[0];
        assert_eq!(one.count, 5);
        let at: Vec<_> = one.examples.iter().map(|l| (l.vertex, l.element)).collect();
        assert_eq!(at, [10, 11, 12, 13, 14].map(|v| (Some(v), None)));
    }

    #[test]
    fn a_geographic_grid_is_checked_by_its_extent() {
        let mut d = super::super::testutil::grid([100, 100, 1]);
        d.crs = Some(CrsRef::Epsg { code: 4326 });
        // 100 cells of size 1 starting at the origin span 0..100 in both axes.
        assert_eq!(codes(&run(check, &d)), ["crs.geographic.out_of_range"]);
        assert_eq!(run(check, &d).as_slice()[0].count, 1);
    }
}
