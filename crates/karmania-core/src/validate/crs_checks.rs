//! CRS checks: does the dataset say which coordinate reference system it uses?
//!
//! The core does not know what an EPSG code means, so it cannot judge whether the
//! code exists or whether the coordinates fit it. It only checks that a system has
//! been named.

use crate::codes::FindingCode;
use crate::dataset::Dataset;
use crate::findings::{Finding, Findings};

/// Runs the CRS checks.
pub(super) fn check(dataset: &Dataset, findings: &mut Findings) {
    check_present(dataset, findings);
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
    fn any_epsg_code_is_accepted_because_the_core_does_not_know_what_codes_mean() {
        for code in [4326, 32640, 3857, 27700, 2227, 99_999, u32::MAX] {
            assert!(
                run(check, &with_crs(Some(CrsRef::Epsg { code }))).is_empty(),
                "{code}"
            );
        }
    }

    #[test]
    fn coordinates_are_not_judged_against_the_system() {
        // Values that cannot be longitudes and latitudes, in a system that is
        // longitude and latitude: this crate leaves that to whoever knows the system.
        let mut d = points(3);
        d.crs = Some(CrsRef::Epsg { code: 4326 });
        assert!(run(check, &d).is_empty());
    }
}
