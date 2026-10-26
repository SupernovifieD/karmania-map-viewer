//! Validation: checks a [`Dataset`] and reports what it finds as findings.
//!
//! Checks never panic on malformed data and never change the dataset. They run
//! in a fixed order in three groups (`structure`, `values`, `crs`), so the same
//! dataset always gives the same report. A dataset with any error finding is not
//! loadable.

mod crs_checks;
mod structure;
mod values;

use serde::Serialize;

use crate::dataset::Dataset;
use crate::findings::{Finding, Findings};

/// The findings of one group of related checks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CheckGroup {
    /// The group name: `structure`, `values` or `crs`.
    pub name: &'static str,
    /// What the group found, in order of first occurrence.
    pub findings: Findings,
}

/// The result of validating a dataset: one [`CheckGroup`] per group, in a fixed
/// order, even when a group found nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ValidationReport {
    groups: Vec<CheckGroup>,
}

impl ValidationReport {
    /// The check groups in order.
    #[must_use]
    pub fn groups(&self) -> &[CheckGroup] {
        &self.groups
    }

    /// Every finding, group by group, in order.
    pub fn findings(&self) -> impl Iterator<Item = &Finding> {
        self.groups.iter().flat_map(|g| g.findings.iter())
    }

    /// True when there are no error findings, so the dataset can be loaded.
    #[must_use]
    pub fn is_loadable(&self) -> bool {
        !self.groups.iter().any(|g| g.findings.has_errors())
    }
}

type Check = fn(&Dataset, &mut Findings);

/// The check groups in the order they run.
const GROUPS: [(&str, Check); 3] = [
    ("structure", structure::check),
    ("values", values::check),
    ("crs", crs_checks::check),
];

/// Validates `dataset` and returns the report. Deterministic: the same dataset
/// always gives the same findings in the same order.
#[must_use]
pub fn validate(dataset: &Dataset) -> ValidationReport {
    let groups = GROUPS
        .iter()
        .map(|&(name, check)| {
            let mut findings = Findings::new();
            check(dataset, &mut findings);
            CheckGroup { name, findings }
        })
        .collect();
    ValidationReport { groups }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codes::FindingCode;
    use crate::dataset::{DatasetId, Geometry};
    use crate::findings::Findings;
    use crate::positions::Positions;
    use crate::table::Table;

    fn points_dataset() -> Dataset {
        let p = Positions::from_xyz(&[1.0], &[2.0], None, &mut Findings::new()).unwrap();
        Dataset::new(DatasetId(1), "p", None, Geometry::Points(p), Table::empty())
    }

    fn group(name: &'static str, findings: Findings) -> CheckGroup {
        CheckGroup { name, findings }
    }

    #[test]
    fn the_report_has_the_three_groups_in_a_fixed_order() {
        let report = validate(&points_dataset());
        let names: Vec<_> = report.groups().iter().map(|g| g.name).collect();
        assert_eq!(names, ["structure", "values", "crs"]);
    }

    #[test]
    fn validating_twice_gives_the_same_report() {
        let d = points_dataset();
        assert_eq!(validate(&d), validate(&d));
    }

    #[test]
    fn a_report_is_loadable_only_without_errors() {
        let mut errors = Findings::new();
        errors.add(Finding::new(FindingCode::DatasetTooLarge, "m"));
        let bad = ValidationReport {
            groups: vec![group("structure", Findings::new()), group("values", errors)],
        };
        assert!(!bad.is_loadable());
        assert_eq!(bad.findings().count(), 1);
        let good = ValidationReport {
            groups: vec![group("structure", Findings::new())],
        };
        assert!(good.is_loadable() && good.findings().count() == 0);
    }

    #[test]
    fn a_report_serializes_as_named_groups_of_findings() {
        let report = ValidationReport {
            groups: vec![group("structure", Findings::new())],
        };
        let json = serde_json::to_string(&report).unwrap();
        assert_eq!(json, r#"{"groups":[{"name":"structure","findings":[]}]}"#);
    }
}
