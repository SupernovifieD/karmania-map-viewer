//! CRS checks: is the coordinate reference system present and plausible?

use crate::codes::FindingCode;
use crate::crs::CrsRef;
use crate::dataset::Dataset;
use crate::epsg;
use crate::findings::{Finding, Findings};

/// Runs the CRS checks.
pub(super) fn check(dataset: &Dataset, findings: &mut Findings) {
    check_present(dataset, findings);
    check_epsg_code_known(dataset, findings);
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
