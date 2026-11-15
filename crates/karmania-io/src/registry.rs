//! The datasets that have been loaded, and the findings about each.
//!
//! Anything that makes datasets (a file import, a builder called from code) hands
//! them to [`Registry::load`], which validates them. If any has an error, none is
//! loaded and the findings come back instead; otherwise they are stored, each
//! under a new identifier, and their summaries come back.

use std::collections::BTreeMap;

use karmania_core::{
    CrsKinds, Dataset, DatasetId, Derivation, DerivedFrom, Findings, Severity, Summary,
    ValidationReport, Wgs84Only, validate_with,
};
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
    /// reading problems, for example); it is attached to every dataset loaded. The
    /// core alone knows which EPSG codes are longitude and latitude (EPSG:4326 only);
    /// use [`Registry::load_with`] to say more.
    pub fn load(&mut self, datasets: Vec<Dataset>, context: Findings) -> LoadResult {
        self.load_with(datasets, context, &Wgs84Only)
    }

    /// Like [`Registry::load`], with `kinds` telling validation which EPSG codes are
    /// longitude and latitude systems.
    pub fn load_with(
        &mut self,
        datasets: Vec<Dataset>,
        context: Findings,
        kinds: &dyn CrsKinds,
    ) -> LoadResult {
        let validated = datasets
            .into_iter()
            .map(|dataset| {
                let report = validate_with(&dataset, kinds);
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

    /// Loads a dataset that was made from another one that is loaded (contour lines), under a new identifier. It is validated like any
    /// other, and its summary says what it was made from (`derived_from`). Datasets that were made from the same source in the same way
    /// are not touched: [`Registry::remove_derived`] takes them out first when the new one replaces them. `None` if the source is not
    /// loaded (it was removed while the dataset was being made): nothing is loaded.
    pub fn load_derived(
        &mut self,
        dataset: Dataset,
        from: DerivedFrom,
        kinds: &dyn CrsKinds,
    ) -> Option<LoadResult> {
        if !self.loaded.contains_key(&from.id.0) {
            return None;
        }
        let report = validate_with(&dataset, kinds);
        Some(
            match self.load_validated(vec![(dataset, report)], Findings::new()) {
                LoadResult::Loaded { mut summaries } => {
                    for summary in &mut summaries {
                        summary.derived_from = Some(from.clone());
                        if let Some(loaded) = self.loaded.get_mut(&summary.id.0) {
                            loaded.summary.derived_from = Some(from.clone());
                        }
                    }
                    LoadResult::Loaded { summaries }
                }
                blocked @ LoadResult::Blocked { .. } => blocked,
            },
        )
    }

    /// The datasets that were made from `source` in the way `like` says (the same kind of derivation, whatever its settings), in the
    /// order they were loaded.
    #[must_use]
    pub fn derived_of(&self, source: DatasetId, like: &Derivation) -> Vec<DatasetId> {
        self.loaded
            .values()
            .filter(|loaded| {
                loaded.summary.derived_from.as_ref().is_some_and(|from| {
                    from.id == source
                        && std::mem::discriminant(&from.how) == std::mem::discriminant(like)
                })
            })
            .map(|loaded| loaded.summary.id)
            .collect()
    }

    /// Unloads the datasets that were made from `source` in the way `like` says, and returns their identifiers. A new call that makes
    /// one for the same source in the same way replaces the old one, and so does a call that fails: what is shown is never made with
    /// settings other than those asked for.
    pub fn remove_derived(&mut self, source: DatasetId, like: &Derivation) -> Vec<DatasetId> {
        let found = self.derived_of(source, like);
        for id in &found {
            self.loaded.remove(&id.0);
        }
        found
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

    /// Every loaded dataset, in the order they were loaded (identifiers only ever grow).
    #[must_use]
    pub fn datasets(&self) -> Vec<&Dataset> {
        self.loaded.values().map(|l| &l.dataset).collect()
    }

    /// Unloads a dataset, and the datasets that were made from it. Returns whether there was one with that identifier.
    pub fn remove(&mut self, id: DatasetId) -> bool {
        !self.remove_with_derived(id).is_empty()
    }

    /// Unloads a dataset and every dataset that was made from it (and from those), and returns their identifiers, the dataset's first:
    /// none if there is no dataset with that identifier.
    pub fn remove_with_derived(&mut self, id: DatasetId) -> Vec<DatasetId> {
        if !self.loaded.contains_key(&id.0) {
            return Vec::new();
        }
        // A dataset is made after its source, so its identifier is higher and no dataset is its own source: each one is found once.
        let mut removed = vec![id];
        let mut at = 0;
        while let Some(&parent) = removed.get(at) {
            let children: Vec<DatasetId> = self
                .loaded
                .values()
                .filter(|loaded| {
                    loaded
                        .summary
                        .derived_from
                        .as_ref()
                        .is_some_and(|from| from.id == parent)
                })
                .map(|loaded| loaded.summary.id)
                .collect();
            removed.extend(children);
            at += 1;
        }
        for gone in &removed {
            self.loaded.remove(&gone.0);
        }
        removed
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
        findings.add(Finding::new(FindingCode::CsvRowsSkipped, message).with_hint("A hint."));
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
        findings.add(Finding::new(FindingCode::FileEmpty, "Nothing in it.").with_hint("A hint."));
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

    #[test]
    fn the_datasets_come_in_the_order_they_were_loaded_and_without_the_removed() {
        let mut registry = Registry::new();
        let named = |name: &str| {
            let mut findings = Findings::new();
            let positions = Positions::from_xyz(&[1.0], &[2.0], None, &mut findings).unwrap();
            Dataset::new(
                DatasetId(0),
                name,
                Some(CrsRef::Local {
                    units: Units::Metre,
                }),
                Geometry::Points(positions),
                Table::empty(),
            )
        };
        registry.load(vec![named("a"), named("b"), named("c")], Findings::new());
        let names = |r: &Registry| {
            r.datasets()
                .iter()
                .map(|d| d.name.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(names(&registry), ["a", "b", "c"]);
        registry.remove(registry.datasets()[1].id);
        assert_eq!(names(&registry), ["a", "c"]);
    }

    fn from(source: u64, interval: f64) -> DerivedFrom {
        DerivedFrom {
            id: DatasetId(source),
            how: Derivation::Contours {
                params: karmania_core::ContourParams {
                    column: None,
                    interval,
                    base: 0.0,
                    index_every: 5,
                },
            },
        }
    }

    fn contours() -> Derivation {
        from(0, 1.0).how
    }

    fn load_derived(registry: &mut Registry, name: &str, from: DerivedFrom) -> Option<LoadResult> {
        registry.load_derived(good(name), from, &Wgs84Only)
    }

    fn one_id(result: Option<LoadResult>) -> DatasetId {
        let Some(LoadResult::Loaded { summaries }) = result else {
            panic!("expected Loaded")
        };
        summaries[0].id
    }

    #[test]
    fn a_derived_dataset_is_loaded_under_a_new_identifier_and_its_summary_says_what_it_came_from() {
        let mut registry = Registry::new();
        let source = one_id(Some(registry.load(vec![good("Surface")], Findings::new())));
        let Some(LoadResult::Loaded { summaries }) =
            load_derived(&mut registry, "Contours", from(source.0, 2.5))
        else {
            panic!("expected Loaded")
        };
        assert_eq!(
            (summaries[0].id, summaries[0].name.as_str()),
            (DatasetId(2), "Contours")
        );
        assert_eq!(summaries[0].derived_from, Some(from(1, 2.5)));
        // What is stored says it too, and the source does not.
        assert_eq!(registry.summary(DatasetId(2)), Some(&summaries[0]));
        assert_eq!(registry.summary(source).unwrap().derived_from, None);
        assert_eq!(registry.dataset(DatasetId(2)).unwrap().id, DatasetId(2));
        assert_eq!(registry.derived_of(source, &contours()), [DatasetId(2)]);
    }

    #[test]
    fn a_derived_dataset_of_a_source_that_is_not_loaded_is_not_loaded_and_one_with_an_error_is_blocked()
     {
        let mut registry = Registry::new();
        assert_eq!(load_derived(&mut registry, "Orphan", from(7, 1.0)), None);
        assert!(registry.is_empty());
        let source = one_id(Some(registry.load(vec![good("Surface")], Findings::new())));
        let bad = points("No CRS", &[(1.0, 2.0)], None);
        let blocked = registry.load_derived(bad, from(source.0, 1.0), &Wgs84Only);
        let Some(LoadResult::Blocked { findings }) = blocked else {
            panic!("expected Blocked")
        };
        assert_eq!(codes(&findings), ["crs.missing"]);
        assert_eq!(registry.len(), 1, "nothing was stored");
        // No identifier was used up by either.
        assert_eq!(
            one_id(load_derived(&mut registry, "Fine", from(source.0, 1.0))),
            DatasetId(2)
        );
    }

    #[test]
    fn removing_a_source_removes_what_was_made_from_it_and_removing_the_derived_one_leaves_the_source()
     {
        let mut registry = Registry::new();
        let a = one_id(Some(registry.load(vec![good("A")], Findings::new())));
        let b = one_id(Some(registry.load(vec![good("B")], Findings::new())));
        let of_a = one_id(load_derived(&mut registry, "A's lines", from(a.0, 1.0)));
        let of_b = one_id(load_derived(&mut registry, "B's lines", from(b.0, 1.0)));
        // Lines of lines (a later kind of derivation) go with their source's source.
        let of_of_a = one_id(load_derived(
            &mut registry,
            "Lines of A's lines",
            from(of_a.0, 1.0),
        ));
        assert_eq!(registry.remove_with_derived(DatasetId(99)), []);
        assert!(!registry.remove(DatasetId(99)));
        assert_eq!(registry.remove_with_derived(of_of_a), [of_of_a]);
        let of_of_a = one_id(load_derived(&mut registry, "Again", from(of_a.0, 1.0)));
        assert_eq!(registry.remove_with_derived(a), [a, of_a, of_of_a]);
        let names: Vec<String> = registry
            .summaries()
            .iter()
            .map(|s| s.name.clone())
            .collect();
        assert_eq!(names, ["B", "B's lines"]);
        assert!(registry.remove(of_b));
        assert_eq!(
            registry
                .summaries()
                .iter()
                .map(|s| s.id)
                .collect::<Vec<_>>(),
            [b]
        );
        // Identifiers are not reused.
        assert_eq!(
            one_id(load_derived(&mut registry, "New", from(b.0, 1.0))).0,
            of_of_a.0 + 1
        );
        // `remove`, which the engine calls, takes what was made from the dataset with it, and says so.
        assert!(registry.remove(b));
        assert!(registry.is_empty());
    }

    #[test]
    fn a_new_set_of_contours_replaces_the_old_one_of_the_same_source_and_no_other() {
        let mut registry = Registry::new();
        let a = one_id(Some(registry.load(vec![good("A")], Findings::new())));
        let b = one_id(Some(registry.load(vec![good("B")], Findings::new())));
        let old_a = one_id(load_derived(&mut registry, "Old", from(a.0, 1.0)));
        let of_b = one_id(load_derived(&mut registry, "Of B", from(b.0, 1.0)));
        assert_eq!(registry.remove_derived(a, &contours()), [old_a]);
        let new_a = one_id(load_derived(&mut registry, "New", from(a.0, 5.0)));
        assert_eq!(registry.derived_of(a, &contours()), [new_a]);
        assert_eq!(
            registry.summary(new_a).unwrap().derived_from,
            Some(from(a.0, 5.0))
        );
        // The others are as they were, and removing what is not there removes nothing.
        let ids: Vec<DatasetId> = registry.summaries().iter().map(|s| s.id).collect();
        assert_eq!(ids, [a, b, of_b, new_a]);
        assert_eq!(registry.remove_derived(a, &contours()), [new_a]);
        assert_eq!(registry.remove_derived(a, &contours()), []);
    }
}
