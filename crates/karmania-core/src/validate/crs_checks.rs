//! CRS checks: is the coordinate reference system present and plausible?

use super::projected;
use crate::codes::FindingCode;
use crate::crs::CrsRef;
use crate::dataset::{Dataset, Kind};
use crate::epsg::{self, CrsKind};
use crate::findings::{Finding, Findings, Location};

/// Runs the CRS checks.
pub(super) fn check(dataset: &Dataset, findings: &mut Findings) {
    check_present(dataset, findings);
    check_epsg_code_known(dataset, findings);
    check_geographic_range(dataset, findings);
    projected::check(dataset, findings);
}

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

/// In a geographic system X is longitude and Y is latitude, so the values must
/// fit those ranges. If they only fit with the axes swapped, say so instead.
fn check_geographic_range(dataset: &Dataset, findings: &mut Findings) {
    let Some(CrsRef::Epsg { code }) = dataset.crs else {
        return;
    };
    if epsg::lookup(code).is_none_or(|info| info.kind != CrsKind::Geographic) {
        return;
    }
    let Some(bbox) = dataset.bbox() else {
        return;
    };
    let (min, max) = (bbox.min, bbox.max);
    if is_longitude(min[0]) && is_longitude(max[0]) && is_latitude(min[1]) && is_latitude(max[1]) {
        return;
    }
    let (min_x, max_x, min_y, max_y) = (min[0], max[0], min[1], max[1]);
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
    .with_hint("Check the coordinate system. Values this large usually belong to a projected system such as UTM.");
    outside.count = 0;
    match dataset.geometry.positions() {
        Some(positions) => {
            for (index, p) in positions.iter().enumerate() {
                let finite = p.iter().all(|c| c.is_finite());
                if finite && !(is_longitude(p[0]) && is_latitude(p[1])) {
                    outside.count += 1;
                    let at = Location::default();
                    let at = match dataset.kind() {
                        Kind::Points => at.with_element(index as u64),
                        _ => at.with_vertex(index as u64),
                    };
                    outside = outside.at(at);
                }
            }
        }
        None => outside.count = 1,
    }
    if outside.count > 0 {
        findings.add(outside);
    }
}

/// An EPSG code must be one the engine has a definition for.
fn check_epsg_code_known(dataset: &Dataset, findings: &mut Findings) {
    if let Some(CrsRef::Epsg { code }) = dataset.crs
        && epsg::lookup(code).is_none()
    {
        findings.add(
            Finding::new(
                FindingCode::CrsEpsgUnknown,
                format!(
                    "The EPSG code {code} is not in the list of coordinate systems this tool knows."
                ),
            )
            .with_hint(
                "Check the code. For example, 4326 is WGS 84 and 32640 is WGS 84 / UTM zone 40N.",
            ),
        );
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
            .with_hint("Choose an EPSG code, or choose a local grid and its units."),
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
            Some("Choose an EPSG code, or choose a local grid and its units.")
        );
    }

    #[test]
    fn a_local_grid_with_units_is_accepted() {
        for units in [Units::Metre, Units::Foot, Units::UsSurveyFoot] {
            assert!(run(check, &with_crs(Some(CrsRef::Local { units }))).is_empty());
        }
    }

    #[test]
    fn known_epsg_codes_are_accepted() {
        for code in [4326, 32640, 3857, 27700, 2227] {
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
    fn a_latitude_beyond_ninety_is_an_error_counted_per_position() {
        let f = run(
            check,
            &geographic(&[(10.0, 10.0), (20.0, 95.0), (30.0, -100.0), (400.0, 0.0)]),
        );
        assert_eq!(codes(&f), ["crs.geographic.out_of_range"]);
        let one = &f.as_slice()[0];
        assert_eq!(
            (one.count, one.severity),
            (3, crate::findings::Severity::Error)
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
    fn projected_looking_numbers_in_a_geographic_system_are_an_error() {
        let f = run(
            check,
            &geographic(&[(500_000.0, 2_800_000.0), (510_000.0, 2_810_000.0)]),
        );
        assert_eq!(codes(&f), ["crs.geographic.out_of_range"]);
        assert_eq!(f.as_slice()[0].count, 2);
    }

    #[test]
    fn swapped_axes_are_a_warning_instead_of_a_range_error() {
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
    fn only_geographic_systems_are_range_checked() {
        let mut projected = geographic(&[(500_000.0, 2_800_000.0)]);
        projected.crs = Some(CrsRef::Epsg { code: 32640 });
        assert!(run(check, &projected).is_empty());
        let mut local = geographic(&[(500_000.0, 2_800_000.0)]);
        local.crs = Some(CrsRef::Local {
            units: Units::Metre,
        });
        assert!(run(check, &local).is_empty());
        let mut unknown = geographic(&[(500_000.0, 2_800_000.0)]);
        unknown.crs = Some(CrsRef::Epsg { code: 99_999 });
        assert_eq!(codes(&run(check, &unknown)), ["crs.epsg.unknown"]);
    }

    #[test]
    fn non_finite_and_missing_positions_are_not_range_checked() {
        assert!(run(check, &geographic(&[(f64::NAN, 500.0)])).is_empty());
        assert!(run(check, &geographic(&[])).is_empty());
    }

    #[test]
    fn a_geographic_grid_is_checked_by_its_extent() {
        let mut d = super::super::testutil::grid([100, 100, 1]);
        d.crs = Some(CrsRef::Epsg { code: 4326 });
        // 100 cells of size 1 starting at the origin spans 0..100 in both axes.
        assert_eq!(codes(&run(check, &d)), ["crs.geographic.out_of_range"]);
        assert_eq!(run(check, &d).as_slice()[0].count, 1);
    }

    #[test]
    fn an_unknown_epsg_code_is_an_error_at_the_crs_step() {
        for code in [0, 1, 99_999, u32::MAX] {
            let f = run(check, &with_crs(Some(CrsRef::Epsg { code })));
            assert_eq!(codes(&f), ["crs.epsg.unknown"], "{code}");
            let one = &f.as_slice()[0];
            assert_eq!(one.step, Some(crate::findings::WizardStep::Crs));
            assert_eq!(
                one.message,
                format!(
                    "The EPSG code {code} is not in the list of coordinate systems this tool knows."
                )
            );
        }
    }
}
