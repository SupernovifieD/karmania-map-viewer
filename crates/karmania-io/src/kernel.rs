//! The state behind the engine: the loaded datasets and the imports in progress.
//!
//! A [`Kernel`] is what the WebAssembly bindings wrap. Several can exist at once and
//! share nothing. It starts imports, steps them, and when one finishes loads its
//! datasets into the [`Registry`]. Everything is plain Rust, so it is tested without
//! WebAssembly; the bindings only translate arguments and results.

use std::collections::BTreeMap;

use serde::Serialize;

use karmania_core::{Dataset, Findings};

use crate::build::{
    GridInput, LinesInput, MeshInput, PointsInput, PolygonsInput, build_grid, build_lines,
    build_mesh, build_points, build_polygons,
};
use crate::import_run::{ImportRun, Phase, RunStep};
use crate::mapping::ImportMapping;
use crate::registry::{LoadResult, Registry};

/// What an import step did. In JSON: `{ "status": "progress", "phase": "parsing",
/// "fraction": 0.4 }` or `{ "status": "done", "result": { ... } }`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum ImportStatus {
    /// The import has more to do.
    Progress {
        /// The stage under way.
        phase: Phase,
        /// How much of that stage is done, from 0 to 1.
        fraction: f64,
    },
    /// The import is over: its datasets were loaded, or the findings that blocked
    /// them are in the result.
    Done {
        /// What loading came to.
        result: LoadResult,
    },
}

/// The loaded datasets and the imports in progress.
#[derive(Default)]
pub struct Kernel {
    registry: Registry,
    imports: BTreeMap<u32, ImportRun>,
    /// The identifier the next import gets. Identifiers are never reused.
    next_import: u32,
}

impl Kernel {
    /// A kernel with nothing loaded.
    #[must_use]
    pub fn new() -> Self {
        Self {
            registry: Registry::new(),
            imports: BTreeMap::new(),
            next_import: 1,
        }
    }

    /// Starts importing a file. Nothing is read yet; call [`Kernel::step_import`]
    /// with the returned identifier. See [`ImportRun::new`] for how the mapping is
    /// used.
    pub fn start_import(&mut self, file_name: &str, bytes: &[u8], mapping: ImportMapping) -> u32 {
        let id = self.next_import;
        self.next_import += 1;
        self.imports
            .insert(id, ImportRun::new(file_name, bytes, mapping));
        id
    }

    /// Does the next step of an import: up to `budget_rows` rows of parsing, or the
    /// validation of one dataset. When the import is done it is forgotten, and its
    /// datasets are loaded into the registry unless an error blocks them. `None` if
    /// there is no import with that identifier (it never existed, it finished, or it
    /// was cancelled).
    pub fn step_import(&mut self, id: u32, budget_rows: usize) -> Option<ImportStatus> {
        let run = self.imports.get_mut(&id)?;
        match run.step(budget_rows) {
            RunStep::Progress(progress) => Some(ImportStatus::Progress {
                phase: progress.phase,
                fraction: progress.fraction,
            }),
            RunStep::Done(imported) => {
                self.imports.remove(&id);
                let result = self
                    .registry
                    .load_validated(imported.datasets, imported.findings);
                Some(ImportStatus::Done { result })
            }
        }
    }

    /// Stops an import and drops what it has read. Returns whether there was one
    /// under way with that identifier.
    pub fn cancel_import(&mut self, id: u32) -> bool {
        self.imports.remove(&id).is_some()
    }

    /// Loads points made from arrays. The dataset is validated like any other: if it
    /// has an error, or the arrays do not fit together, nothing is loaded and the
    /// findings say why.
    pub fn load_points(&mut self, input: PointsInput) -> LoadResult {
        self.load_built(|findings| build_points(input, findings))
    }

    /// Loads lines made from arrays; see [`Kernel::load_points`].
    pub fn load_lines(&mut self, input: LinesInput) -> LoadResult {
        self.load_built(|findings| build_lines(input, findings))
    }

    /// Loads polygons made from arrays; see [`Kernel::load_points`].
    pub fn load_polygons(&mut self, input: PolygonsInput) -> LoadResult {
        self.load_built(|findings| build_polygons(input, findings))
    }

    /// Loads a triangle mesh made from arrays; see [`Kernel::load_points`].
    pub fn load_mesh(&mut self, input: MeshInput) -> LoadResult {
        self.load_built(|findings| build_mesh(input, findings))
    }

    /// Loads a regular grid made from arrays; see [`Kernel::load_points`].
    pub fn load_grid(&mut self, input: GridInput) -> LoadResult {
        self.load_built(|findings| build_grid(input, findings))
    }

    /// Loads what `build` makes, or blocks with its findings if it makes nothing.
    fn load_built(&mut self, build: impl FnOnce(&mut Findings) -> Option<Dataset>) -> LoadResult {
        let mut findings = Findings::new();
        match build(&mut findings) {
            Some(dataset) => self.registry.load(vec![dataset], findings),
            None => LoadResult::Blocked { findings },
        }
    }

    /// How many imports are under way.
    #[must_use]
    pub fn imports_in_progress(&self) -> usize {
        self.imports.len()
    }

    /// The loaded datasets.
    #[must_use]
    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    /// The loaded datasets, for loading or removing some.
    pub fn registry_mut(&mut self) -> &mut Registry {
        &mut self.registry
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;
    use crate::mapping::{ColumnMapping, EmptyCoordinates, Nodata};
    use crate::numbers::DecimalSeparator;
    use crate::roles::Role;
    use karmania_core::{CrsRef, DatasetId, Kind};

    fn mapping(crs: Option<CrsRef>) -> ImportMapping {
        let column = |source: &str, role| ColumnMapping {
            source: source.into(),
            role,
            column_type: None,
            rename: None,
        };
        ImportMapping {
            dataset_name: "Collars".into(),
            kind: Kind::Points,
            columns: vec![
                column("Easting", Role::X),
                column("Northing", Role::Y),
                column("RL", Role::Z),
                column("Hole", Role::Attribute),
                column("Au_ppm", Role::Attribute),
            ],
            nodata: Nodata {
                tokens: vec![String::new()],
                numbers: vec![-999.0],
            },
            empty_coordinates: EmptyCoordinates::Error,
            block_size: None,
            decimal_separator: DecimalSeparator::Point,
            crs,
        }
    }

    fn utm40() -> Option<CrsRef> {
        Some(CrsRef::Epsg { code: 32640 })
    }

    /// Steps an import to the end; returns the progress seen and the final result.
    fn finish(kernel: &mut Kernel, id: u32, budget: usize) -> (Vec<ImportStatus>, LoadResult) {
        let mut seen = Vec::new();
        loop {
            match kernel.step_import(id, budget).expect("the import exists") {
                ImportStatus::Done { result } => return (seen, result),
                progress => seen.push(progress),
            }
        }
    }

    #[test]
    fn an_import_steps_to_a_loaded_dataset() {
        let mut kernel = Kernel::new();
        let id = kernel.start_import(
            "points.csv",
            &fixtures::bytes("points.csv"),
            mapping(utm40()),
        );
        assert_eq!(kernel.imports_in_progress(), 1);
        let (seen, result) = finish(&mut kernel, id, 3);
        assert!(matches!(
            seen[0],
            ImportStatus::Progress {
                phase: Phase::Parsing,
                ..
            }
        ));
        let LoadResult::Loaded { summaries } = result else {
            panic!("expected Loaded")
        };
        assert_eq!(summaries.len(), 1);
        assert_eq!(
            (
                summaries[0].id,
                summaries[0].name.as_str(),
                summaries[0].element_count
            ),
            (DatasetId(1), "Collars", 8)
        );
        assert_eq!(kernel.registry().len(), 1);
        // A finished import is forgotten.
        assert_eq!(kernel.imports_in_progress(), 0);
        assert!(kernel.step_import(id, 10).is_none());
    }

    #[test]
    fn an_import_with_an_error_is_blocked_and_loads_nothing() {
        let mut kernel = Kernel::new();
        // No coordinate system chosen for a CSV file.
        let id = kernel.start_import("points.csv", &fixtures::bytes("points.csv"), mapping(None));
        let (_, result) = finish(&mut kernel, id, 1_000);
        let LoadResult::Blocked { findings } = result else {
            panic!("expected Blocked")
        };
        assert!(findings.iter().any(|f| f.code.as_str() == "crs.missing"));
        assert!(kernel.registry().is_empty());
    }

    #[test]
    fn a_file_that_cannot_be_read_is_blocked_in_one_step() {
        let mut kernel = Kernel::new();
        let id = kernel.start_import("wells.shp", &[0, 0, 1], mapping(utm40()));
        let Some(ImportStatus::Done { result }) = kernel.step_import(id, 1) else {
            panic!("expected Done in the first step")
        };
        let LoadResult::Blocked { findings } = result else {
            panic!("expected Blocked")
        };
        assert_eq!(
            findings.as_slice()[0].code.as_str(),
            "file.format.unrecognized"
        );
    }

    #[test]
    fn imports_run_side_by_side_and_identifiers_are_not_reused() {
        let mut kernel = Kernel::new();
        let a = kernel.start_import(
            "points.csv",
            &fixtures::bytes("points.csv"),
            mapping(utm40()),
        );
        let b = kernel.start_import("grid.asc", &fixtures::bytes("grid.asc"), mapping(utm40()));
        assert_ne!(a, b);
        // Step them alternately.
        let mut done = 0;
        let mut results = BTreeMap::new();
        for _ in 0..100 {
            for id in [a, b] {
                if let Some(ImportStatus::Done { result }) = kernel.step_import(id, 2) {
                    results.insert(id, result);
                    done += 1;
                }
            }
            if done == 2 {
                break;
            }
        }
        assert_eq!(results.len(), 2);
        let names: Vec<_> = kernel
            .registry()
            .summaries()
            .iter()
            .map(|s| s.name.clone())
            .collect();
        assert_eq!(names, ["Collars", "Collars"]);
        let c = kernel.start_import("mesh.obj", &fixtures::bytes("mesh.obj"), mapping(utm40()));
        assert!(c > b);
    }

    #[test]
    fn cancelling_drops_the_import_and_loads_nothing() {
        let mut kernel = Kernel::new();
        let id = kernel.start_import(
            "points.csv",
            &fixtures::bytes("points.csv"),
            mapping(utm40()),
        );
        assert!(matches!(
            kernel.step_import(id, 2),
            Some(ImportStatus::Progress { .. })
        ));
        assert!(kernel.cancel_import(id));
        assert!(!kernel.cancel_import(id));
        assert!(!kernel.cancel_import(999));
        assert!(kernel.step_import(id, 2).is_none());
        assert!(kernel.registry().is_empty() && kernel.imports_in_progress() == 0);
    }

    #[test]
    fn two_kernels_share_nothing() {
        let mut one = Kernel::new();
        let two = Kernel::new();
        let id = one.start_import("grid.asc", &fixtures::bytes("grid.asc"), mapping(utm40()));
        let _ = finish(&mut one, id, 10);
        assert_eq!(one.registry().len(), 1);
        assert!(two.registry().is_empty());
        assert_eq!(two.imports_in_progress(), 0);
    }

    #[test]
    fn a_geojson_file_loads_several_datasets_at_once() {
        let mut kernel = Kernel::new();
        let id = kernel.start_import(
            "mixed.geojson",
            &fixtures::bytes("mixed.geojson"),
            mapping(None),
        );
        let (_, result) = finish(&mut kernel, id, 10);
        let LoadResult::Loaded { summaries } = result else {
            panic!("expected Loaded")
        };
        let kinds: Vec<_> = summaries.iter().map(|s| s.kind).collect();
        assert_eq!(kinds, [Kind::Points, Kind::Lines, Kind::Polygons]);
        let ids: Vec<_> = summaries.iter().map(|s| s.id.0).collect();
        assert_eq!(ids, [1, 2, 3]);
        // The reader's notes are on each dataset.
        assert!(summaries.iter().all(|s| {
            s.findings
                .iter()
                .any(|f| f.code.as_str() == "geojson.kinds.mixed")
        }));
    }

    #[test]
    fn the_status_json_has_a_status_and_its_details() {
        let progress = serde_json::to_value(ImportStatus::Progress {
            phase: Phase::Parsing,
            fraction: 0.25,
        })
        .unwrap();
        assert_eq!(
            progress,
            serde_json::json!({"status": "progress", "phase": "parsing", "fraction": 0.25})
        );
        let mut kernel = Kernel::new();
        let id = kernel.start_import("grid.asc", &fixtures::bytes("grid.asc"), mapping(utm40()));
        let (_, result) = finish(&mut kernel, id, 10);
        let done = serde_json::to_value(ImportStatus::Done { result }).unwrap();
        assert_eq!(done["status"], "done");
        assert_eq!(done["result"]["status"], "loaded");
        assert_eq!(done["result"]["summaries"][0]["kind"], "grid");
    }

    #[test]
    fn points_made_from_arrays_are_validated_and_loaded_like_any_other() {
        use crate::build::{ColumnInput, ColumnValues, PointsInput};
        let input = |crs: Option<CrsRef>, x: Vec<f64>| PointsInput {
            name: "Wells".into(),
            crs,
            x,
            y: vec![1.0, 2.0],
            z: None,
            columns: vec![ColumnInput {
                name: "au".into(),
                values: ColumnValues::Float(vec![0.1, 0.2]),
                nulls: None,
            }],
        };
        let mut kernel = Kernel::new();
        let LoadResult::Loaded { summaries } = kernel.load_points(input(utm40(), vec![1.0, 2.0]))
        else {
            panic!("expected Loaded")
        };
        assert_eq!(
            (summaries[0].id, summaries[0].element_count),
            (DatasetId(1), 2)
        );
        // Without a coordinate system validation blocks it.
        let LoadResult::Blocked { findings } = kernel.load_points(input(None, vec![1.0, 2.0]))
        else {
            panic!("expected Blocked")
        };
        assert_eq!(findings.as_slice()[0].code.as_str(), "crs.missing");
        // Arrays that do not fit together make no dataset at all.
        let LoadResult::Blocked { findings } = kernel.load_points(input(utm40(), vec![1.0])) else {
            panic!("expected Blocked")
        };
        assert_eq!(
            findings.as_slice()[0].code.as_str(),
            "dataset.coordinates.length_mismatch"
        );
        assert_eq!(kernel.registry().len(), 1);
    }
}
