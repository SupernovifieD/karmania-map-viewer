//! The datasets that have been loaded, and the findings about each.
//!
//! Anything that makes datasets (a file import, a builder called from code) hands
//! them to [`Registry::load`], which validates them. If any has an error, none is
//! loaded and the findings come back instead; otherwise they are stored, each
//! under a new identifier, and their summaries come back.

use std::collections::BTreeMap;

use karmania_core::{Dataset, DatasetId, Findings, Severity, Summary, ValidationReport, validate};
use serde::Serialize;

/// What loading datasets came to. In JSON: `{ "status": "loaded", "summaries": [...] }`
/// or `{ "status": "blocked", "findings": [...] }`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum LoadResult {
    /// The datasets were loaded; one summary for each, in the order given.
    Loaded {
        /// What was loaded.
        summaries: Vec<Summary>,
    },
    /// At least one error stopped the load, so nothing was loaded.
    Blocked {
        /// Everything found: the findings that came with the datasets, then the
        /// validation findings of each dataset.
        findings: Findings,
    },
}

/// A loaded dataset with its summary, which is worked out once because the dataset
/// never changes.
#[derive(Debug)]
struct Loaded {
    dataset: Dataset,
    summary: Summary,
}

/// The loaded datasets.
#[derive(Debug, Default)]
pub struct Registry {
    /// The identifier the next dataset gets. Identifiers are never reused.
    next: u64,
    loaded: BTreeMap<u64, Loaded>,
}

impl Registry {
    /// An empty registry.
    #[must_use]
    pub fn new() -> Self {
        Self {
            next: 1,
            loaded: BTreeMap::new(),
        }
    }

    /// Validates `datasets`, which came from one source, and loads them if none has
    /// an error. `context` holds the findings about how they were made (a file's
    /// reading problems, for example); it is attached to every dataset loaded.
    pub fn load(&mut self, datasets: Vec<Dataset>, context: Findings) -> LoadResult {
        let validated = datasets
            .into_iter()
            .map(|dataset| {
                let report = validate(&dataset);
                (dataset, report)
            })
            .collect();
        self.load_validated(validated, context)
    }

    /// Like [`Registry::load`] for datasets that have already been validated.
    pub fn load_validated(
        &mut self,
        datasets: Vec<(Dataset, ValidationReport)>,
        context: Findings,
    ) -> LoadResult {
        let mut everything = context.clone();
        for (_, report) in &datasets {
            for finding in report.findings() {
                everything.add(finding.clone());
            }
        }
        if everything.iter().any(|f| f.severity == Severity::Error) {
            return LoadResult::Blocked {
                findings: everything,
            };
        }
        let mut summaries = Vec::with_capacity(datasets.len());
        for (mut dataset, report) in datasets {
            let id = DatasetId(self.next);
            self.next += 1;
            dataset.id = id;
            let mut findings = context.clone();
            for finding in report.findings() {
                findings.add(finding.clone());
            }
            let summary = dataset.summary(findings);
            summaries.push(summary.clone());
            self.loaded.insert(id.0, Loaded { dataset, summary });
        }
        LoadResult::Loaded { summaries }
    }

    /// The summaries of every loaded dataset, in the order they were loaded.
    #[must_use]
    pub fn summaries(&self) -> Vec<Summary> {
        self.loaded.values().map(|l| l.summary.clone()).collect()
    }

    /// The summary of one dataset, if it is loaded.
    #[must_use]
    pub fn summary(&self, id: DatasetId) -> Option<&Summary> {
        self.loaded.get(&id.0).map(|l| &l.summary)
    }

    /// A loaded dataset.
    #[must_use]
    pub fn dataset(&self, id: DatasetId) -> Option<&Dataset> {
        self.loaded.get(&id.0).map(|l| &l.dataset)
    }

    /// Unloads a dataset. Returns whether there was one with that identifier.
    pub fn remove(&mut self, id: DatasetId) -> bool {
        self.loaded.remove(&id.0).is_some()
    }

    /// How many datasets are loaded.
    #[must_use]
    pub fn len(&self) -> usize {
        self.loaded.len()
    }

    /// Whether no dataset is loaded.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.loaded.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use karmania_core::{CrsRef, Finding, FindingCode, Geometry, Kind, Positions, Table, Units};

    /// A points dataset: valid when it has a CRS and distinct points.
    fn points(name: &str, xy: &[(f64, f64)], crs: Option<CrsRef>) -> Dataset {
        let x: Vec<f64> = xy.iter().map(|p| p.0).collect();
        let y: Vec<f64> = xy.iter().map(|p| p.1).collect();
        let positions = Positions::from_xyz(&x, &y, None, &mut Findings::new()).unwrap();
        Dataset::new(
            DatasetId(0),
            name,
            crs,
            Geometry::Points(positions),
            Table::empty(),
        )
    }

    fn good(name: &str) -> Dataset {
        points(
            name,
            &[(1.0, 2.0), (3.0, 4.0)],
            Some(CrsRef::Local {
                units: Units::Metre,
            }),
        )
    }

    fn context(message: &str) -> Findings {
        let mut findings = Findings::new();
        findings.add(Finding::new(FindingCode::CsvRowsSkipped, message));
        findings
    }

    fn codes(findings: &Findings) -> Vec<&'static str> {
        findings.iter().map(|f| f.code.as_str()).collect()
    }

    #[test]
    fn a_valid_dataset_is_loaded_under_a_new_identifier() {
        let mut registry = Registry::new();
        let LoadResult::Loaded { summaries } = registry.load(vec![good("A")], Findings::new())
        else {
            panic!("expected Loaded")
        };
        assert_eq!(summaries.len(), 1);
        assert_eq!(
            (summaries[0].id, summaries[0].name.as_str()),
            (DatasetId(1), "A")
        );
        assert_eq!(summaries[0].kind, Kind::Points);
        let stored = registry.dataset(DatasetId(1)).unwrap();
        assert_eq!(stored.id, DatasetId(1));
        assert_eq!(registry.summary(DatasetId(1)), Some(&summaries[0]));
        assert_eq!(registry.len(), 1);
    }

    #[test]
    fn warnings_and_the_context_come_with_the_dataset_and_do_not_block_it() {
        let mut registry = Registry::new();
        // Two identical points make a duplicate-points warning.
        let d = points(
            "Dup",
            &[(1.0, 2.0), (1.0, 2.0)],
            Some(CrsRef::Epsg { code: 32640 }),
        );
        let LoadResult::Loaded { summaries } = registry.load(vec![d], context("2 rows skipped."))
        else {
            panic!("expected Loaded")
        };
        let found = codes(&summaries[0].findings);
        assert_eq!(found, ["csv.rows.skipped", "values.points.duplicate"]);
    }

    #[test]
    fn an_error_blocks_the_load_and_nothing_is_stored_or_numbered() {
        let mut registry = Registry::new();
        let result = registry.load(vec![points("No CRS", &[(1.0, 2.0)], None)], Findings::new());
        let LoadResult::Blocked { findings } = result else {
            panic!("expected Blocked")
        };
        assert_eq!(codes(&findings), ["crs.missing"]);
        assert!(registry.is_empty());
        // The failed load did not use up an identifier.
        let LoadResult::Loaded { summaries } = registry.load(vec![good("A")], Findings::new())
        else {
            panic!("expected Loaded")
        };
        assert_eq!(summaries[0].id, DatasetId(1));
    }

    #[test]
    fn if_one_dataset_of_several_has_an_error_none_is_loaded() {
        let mut registry = Registry::new();
        let result = registry.load(
            vec![good("Fine"), points("Bad", &[(1.0, 2.0)], None)],
            context("Read with notes."),
        );
        let LoadResult::Blocked { findings } = result else {
            panic!("expected Blocked")
        };
        // The context first, then what validation found.
        assert_eq!(codes(&findings), ["csv.rows.skipped", "crs.missing"]);
        assert!(registry.is_empty());
    }

    #[test]
    fn an_error_in_the_context_blocks_even_a_valid_dataset() {
        let mut registry = Registry::new();
        let mut findings = Findings::new();
        findings.add(Finding::new(FindingCode::FileEmpty, "Nothing in it."));
        let result = registry.load(vec![good("A")], findings);
        assert!(matches!(result, LoadResult::Blocked { .. }));
        assert!(registry.is_empty());
    }

    #[test]
    fn several_datasets_load_together_in_order_and_identifiers_are_not_reused() {
        let mut registry = Registry::new();
        let LoadResult::Loaded { summaries } =
            registry.load(vec![good("A"), good("B")], Findings::new())
        else {
            panic!("expected Loaded")
        };
        let ids: Vec<_> = summaries.iter().map(|s| s.id.0).collect();
        assert_eq!(ids, [1, 2]);
        assert!(registry.remove(DatasetId(1)));
        assert!(!registry.remove(DatasetId(1)));
        assert!(!registry.remove(DatasetId(99)));
        assert!(
            registry.summary(DatasetId(1)).is_none() && registry.dataset(DatasetId(1)).is_none()
        );
        let LoadResult::Loaded { summaries } = registry.load(vec![good("C")], Findings::new())
        else {
            panic!("expected Loaded")
        };
        assert_eq!(summaries[0].id, DatasetId(3));
        let names: Vec<_> = registry
            .summaries()
            .iter()
            .map(|s| s.name.clone())
            .collect();
        assert_eq!(names, ["B", "C"]);
    }

    #[test]
    fn loading_nothing_loads_nothing() {
        let mut registry = Registry::new();
        let LoadResult::Loaded { summaries } = registry.load(Vec::new(), Findings::new()) else {
            panic!("expected Loaded")
        };
        assert!(summaries.is_empty() && registry.is_empty());
    }

    #[test]
    fn the_json_has_a_status_and_the_summaries_or_the_findings() {
        let mut registry = Registry::new();
        let loaded = registry.load(vec![good("A")], Findings::new());
        let v = serde_json::to_value(&loaded).unwrap();
        assert_eq!(v["status"], "loaded");
        assert_eq!(v["summaries"][0]["name"], "A");
        assert_eq!(v.as_object().unwrap().len(), 2);

        let blocked = registry.load(vec![points("B", &[(1.0, 2.0)], None)], Findings::new());
        let v = serde_json::to_value(&blocked).unwrap();
        assert_eq!(v["status"], "blocked");
        assert_eq!(v["findings"][0]["code"], "crs.missing");
        assert_eq!(v.as_object().unwrap().len(), 2);
    }
}
