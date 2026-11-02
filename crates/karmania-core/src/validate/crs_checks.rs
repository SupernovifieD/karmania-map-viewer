//! CRS checks: does the dataset say which coordinate reference system it uses?
//!
//! The core does not know what an EPSG code means, so it cannot judge whether the code
//! exists. It checks that a system has been named and, for a code it is told is a longitude
//! and latitude system (see [`CrsKinds`]), that the coordinates could be longitudes and
//! latitudes. Without being told more, that is EPSG:4326 alone.

use crate::codes::FindingCode;
use crate::crs::{CrsGeography, CrsKinds, CrsRef};
use crate::dataset::{Dataset, Kind};
use crate::findings::{Finding, Findings, Location};

/// Runs the CRS checks.
pub(super) fn check(dataset: &Dataset, kinds: &dyn CrsKinds, findings: &mut Findings) {
    check_present(dataset, findings);
    // A local grid or a missing system has no code to ask about.
    let Some(CrsRef::Epsg { code }) = dataset.crs else {
        return;
    };
    let geography = kinds.geography(code);
    check_known(code, geography, kinds, findings);
    if geography == CrsGeography::Geographic {
        check_geographic_range(dataset, findings);
    }
}

/// A code that is not in the definitions is a warning, so the data still loads (it can be
/// drawn on a map that uses the same code). Said only by something that has every code: for
/// the others, "unknown" is not a fault of the dataset.
fn check_known(code: u32, geography: CrsGeography, kinds: &dyn CrsKinds, findings: &mut Findings) {
    if geography != CrsGeography::Unknown || !kinds.knows_every_code() {
        return;
    }
    findings.add(
        Finding::new(
            FindingCode::CrsCodeUnknown,
            format!(
                "EPSG:{code} is not one of the coordinate systems Karmania knows, so its positions cannot be checked, and the data can only be drawn on a map that uses the same code."
            ),
        )
        .with_hint("Check the code, or choose another coordinate system in the coordinate step. If the code is right, the data still loads."),
    );
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

/// In a longitude and latitude system X is longitude and Y is latitude, so the
/// values must fit those ranges. A warning, so the data still loads. If the values
/// only fit with the axes swapped, say so instead.
fn check_geographic_range(dataset: &Dataset, findings: &mut Findings) {
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
    use crate::crs::{CrsRef, Units, Wgs84Only};

    /// The check as `validate` runs it: the core knows EPSG:4326 and nothing else.
    fn check(dataset: &Dataset, findings: &mut Findings) {
        super::check(dataset, &Wgs84Only, findings);
    }

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

    /// A `CrsKinds` that answers from a list, and counts how often it was asked.
    struct Told(&'static [(u32, CrsGeography)], std::cell::Cell<u32>);

    impl CrsKinds for Told {
        fn geography(&self, code: u32) -> CrsGeography {
            self.1.set(self.1.get() + 1);
            self.0
                .iter()
                .find(|(known, _)| *known == code)
                .map_or(CrsGeography::Unknown, |&(_, answer)| answer)
        }
    }

    fn told(answers: &'static [(u32, CrsGeography)]) -> Told {
        Told(answers, std::cell::Cell::new(0))
    }

    fn with_code(code: u32, xy: &[(f64, f64)]) -> Dataset {
        let mut d = geographic(xy);
        d.crs = Some(CrsRef::Epsg { code });
        d
    }

    fn found(kinds: &dyn CrsKinds, d: &Dataset) -> Vec<&'static str> {
        let mut f = Findings::new();
        super::check(d, kinds, &mut f);
        codes(&f)
    }

    #[test]
    fn a_code_that_the_hook_says_is_geographic_is_range_checked_and_so_are_swapped_axes() {
        let kinds = told(&[(4269, CrsGeography::Geographic)]);
        let projected_looking = with_code(4269, &[(500_000.0, 2_800_000.0)]);
        assert_eq!(
            found(&kinds, &projected_looking),
            ["crs.geographic.out_of_range"]
        );
        let swapped = with_code(4269, &[(25.2, 121.5), (-33.9, 151.2)]);
        assert_eq!(found(&kinds, &swapped), ["crs.geographic.axes_swapped"]);
        let fine = with_code(4269, &[(-100.0, 40.0)]);
        assert!(found(&kinds, &fine).is_empty());
        // The core alone does not know 4269, so it says nothing of the same dataset.
        assert!(found(&Wgs84Only, &projected_looking).is_empty());
    }

    #[test]
    fn a_code_that_the_hook_says_is_not_geographic_or_does_not_know_is_not_range_checked() {
        let numbers = [(500_000.0, 2_800_000.0)];
        for answer in [CrsGeography::NotGeographic, CrsGeography::Unknown] {
            let kinds = told(match answer {
                CrsGeography::NotGeographic => &[(4326, CrsGeography::NotGeographic)],
                _ => &[(4326, CrsGeography::Unknown)],
            });
            // Even 4326: the core takes the hook's word and not its own.
            assert!(
                found(&kinds, &with_code(4326, &numbers)).is_empty(),
                "{answer:?}"
            );
        }
    }

    #[test]
    fn the_hook_is_asked_about_an_epsg_code_and_about_nothing_else() {
        let kinds = told(&[]);
        let mut local = geographic(&[(500_000.0, 2_800_000.0)]);
        local.crs = Some(CrsRef::Local {
            units: Units::Metre,
        });
        let mut missing = geographic(&[(500_000.0, 2_800_000.0)]);
        missing.crs = None;
        found(&kinds, &local);
        found(&kinds, &missing);
        assert_eq!(kinds.1.get(), 0);
        found(&kinds, &with_code(32640, &[(1.0, 1.0)]));
        assert_eq!(kinds.1.get(), 1);
    }

    /// A `CrsKinds` that has the whole registry: what it does not list does not exist.
    struct Whole(&'static [(u32, CrsGeography)]);

    impl CrsKinds for Whole {
        fn geography(&self, code: u32) -> CrsGeography {
            self.0
                .iter()
                .find(|(known, _)| *known == code)
                .map_or(CrsGeography::Unknown, |&(_, answer)| answer)
        }

        fn knows_every_code(&self) -> bool {
            true
        }
    }

    const WHOLE: Whole = Whole(&[
        (4269, CrsGeography::Geographic),
        (32640, CrsGeography::NotGeographic),
    ]);

    fn findings_of(kinds: &dyn CrsKinds, d: &Dataset) -> Findings {
        let mut f = Findings::new();
        super::check(d, kinds, &mut f);
        f
    }

    #[test]
    fn a_code_that_is_not_in_the_definitions_is_a_warning_and_the_data_still_loads() {
        let d = with_code(99_999, &[(1.0, 1.0)]);
        let f = findings_of(&WHOLE, &d);
        assert_eq!(codes(&f), ["crs.code.unknown"]);
        let one = &f.as_slice()[0];
        assert_eq!(one.severity, crate::findings::Severity::Warning);
        assert_eq!(one.step, Some(crate::findings::WizardStep::Crs));
        assert!(
            one.message
                .starts_with("EPSG:99999 is not one of the coordinate systems")
        );
        assert!(!f.has_errors());
        assert!(crate::validate::validate_with(&d, &WHOLE).is_loadable());
    }

    #[test]
    fn something_that_does_not_have_every_code_says_nothing_of_one_it_does_not_know() {
        let d = with_code(99_999, &[(1.0, 1.0)]);
        // `Told` has no `knows_every_code`, and nor has the core alone.
        assert!(findings_of(&told(&[]), &d).is_empty());
        assert!(findings_of(&Wgs84Only, &d).is_empty());
        assert!(findings_of(&Wgs84Only, &with_code(4269, &[(1.0, 1.0)])).is_empty());
    }

    #[test]
    fn a_code_that_is_known_is_no_warning_whether_it_is_geographic_or_not() {
        for code in [4269, 32640] {
            let d = with_code(code, &[(1.0, 1.0)]);
            assert!(findings_of(&WHOLE, &d).is_empty(), "{code}");
        }
    }

    #[test]
    fn a_local_grid_and_a_missing_system_are_not_called_unknown() {
        let mut local = with_code(1, &[(1.0, 1.0)]);
        local.crs = Some(CrsRef::Local {
            units: Units::Metre,
        });
        assert!(findings_of(&WHOLE, &local).is_empty());
        let mut missing = with_code(1, &[(1.0, 1.0)]);
        missing.crs = None;
        assert_eq!(codes(&findings_of(&WHOLE, &missing)), ["crs.missing"]);
    }

    #[test]
    fn a_code_that_is_not_known_is_not_range_checked() {
        // Projected-looking numbers under a code that does not exist: only the warning.
        let d = with_code(99_999, &[(500_000.0, 2_800_000.0)]);
        assert_eq!(codes(&findings_of(&WHOLE, &d)), ["crs.code.unknown"]);
    }

    #[test]
    fn the_docs_example_of_the_unknown_code_warning_is_what_the_check_says() {
        const DOCS: &str = include_str!("../../../../docs/validation-codes.md");
        let f = findings_of(&WHOLE, &with_code(99_999, &[(1.0, 1.0)]));
        let one = &f.as_slice()[0];
        let section = DOCS
            .split("\n## `")
            .find(|section| section.starts_with("crs.code.unknown"))
            .expect("the code is in the docs");
        assert!(section.contains(&format!("- Example: {}", one.message)));
        assert!(section.contains(&format!(
            "- Hint: {}",
            one.hint.as_deref().unwrap_or_default()
        )));
    }
}
