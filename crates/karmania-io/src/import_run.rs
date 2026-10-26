//! A whole file import, in stages: reading and parsing, then validating.
//!
//! An [`ImportRun`] wraps an [`ImportJob`] and adds what happens after the file is
//! parsed: the name and coordinate system the user chose are applied to the
//! datasets, and each dataset is validated, one per step. Every step does a bounded
//! amount of work, so a caller can show the stage and how far it has got and stay
//! responsive. The run does not decide whether the datasets are loaded; it hands
//! them over with their validation reports, and the [`Registry`](crate::registry::Registry)
//! decides.

use std::collections::VecDeque;

use karmania_core::{CrsRef, Dataset, Findings, ValidationReport, validate};
use serde::Serialize;

use crate::import_job::{ImportJob, Step};
use crate::mapping::ImportMapping;

/// The stage of an import. In JSON: `parsing` or `validating`. (Reading the file
/// from disk happens before the kernel sees it, in the caller.)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    /// Turning the file's text into datasets.
    Parsing,
    /// Checking the datasets, one per step.
    Validating,
}

/// How far an import has got.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct RunProgress {
    /// The stage under way.
    pub phase: Phase,
    /// How much of that stage is done, from 0 to 1.
    pub fraction: f64,
}

/// What an import produced: the datasets with their validation reports, and the
/// findings about reading the file. If reading failed there are no datasets and
/// the findings say why.
#[derive(Debug, Clone, PartialEq)]
pub struct Imported {
    /// The datasets, in the order the reader made them, each with its report.
    pub datasets: Vec<(Dataset, ValidationReport)>,
    /// What was found while reading the file.
    pub findings: Findings,
}

/// What a step did.
#[derive(Debug, Clone, PartialEq)]
pub enum RunStep {
    /// There is more to do.
    Progress(RunProgress),
    /// The import is finished. This is returned once.
    Done(Imported),
}

enum Stage {
    Reading(ImportJob),
    Validating {
        pending: VecDeque<Dataset>,
        done: Vec<(Dataset, ValidationReport)>,
        total: usize,
        findings: Findings,
    },
    Finished,
}

/// An import in progress. Drop it to cancel.
pub struct ImportRun {
    stage: Stage,
    name: String,
    crs: Option<CrsRef>,
}

impl ImportRun {
    /// Starts importing a file given as bytes (see [`ImportJob::file`]). The
    /// mapping's dataset name and coordinate system are applied to the datasets
    /// that come out, whatever the format: a blank name keeps the reader's, and no
    /// coordinate system keeps the one the file named (if any).
    #[must_use]
    pub fn new(file_name: &str, bytes: &[u8], mapping: ImportMapping) -> Self {
        let name = mapping.dataset_name.trim().to_string();
        let crs = mapping.crs;
        Self {
            stage: Stage::Reading(ImportJob::file(file_name, bytes, mapping)),
            name,
            crs,
        }
    }

    /// Does up to `budget_rows` rows of parsing, or validates one dataset.
    pub fn step(&mut self, budget_rows: usize) -> RunStep {
        match &mut self.stage {
            Stage::Reading(job) => match job.step(budget_rows) {
                Step::Progress(progress) => RunStep::Progress(RunProgress {
                    phase: Phase::Parsing,
                    fraction: progress.fraction(),
                }),
                Step::Done(output) => {
                    let mut datasets = output.datasets;
                    if datasets.is_empty() {
                        self.stage = Stage::Finished;
                        return RunStep::Done(Imported {
                            datasets: Vec::new(),
                            findings: output.findings,
                        });
                    }
                    apply_choices(&mut datasets, &self.name, self.crs);
                    let total = datasets.len();
                    self.stage = Stage::Validating {
                        pending: datasets.into(),
                        done: Vec::with_capacity(total),
                        total,
                        findings: output.findings,
                    };
                    RunStep::Progress(RunProgress {
                        phase: Phase::Validating,
                        fraction: 0.0,
                    })
                }
            },
            Stage::Validating {
                pending,
                done,
                total,
                findings,
            } => {
                if let Some(dataset) = pending.pop_front() {
                    let report = validate(&dataset);
                    done.push((dataset, report));
                }
                if pending.is_empty() {
                    let imported = Imported {
                        datasets: std::mem::take(done),
                        findings: std::mem::take(findings),
                    };
                    self.stage = Stage::Finished;
                    RunStep::Done(imported)
                } else {
                    RunStep::Progress(RunProgress {
                        phase: Phase::Validating,
                        fraction: (done.len() as f64 / (*total).max(1) as f64).clamp(0.0, 1.0),
                    })
                }
            }
            Stage::Finished => RunStep::Done(Imported {
                datasets: Vec::new(),
                findings: Findings::new(),
            }),
        }
    }

    /// Whether the run has finished, so that [`ImportRun::step`] has nothing left.
    #[must_use]
    pub fn is_finished(&self) -> bool {
        matches!(self.stage, Stage::Finished)
    }
}

/// Gives the datasets the name and coordinate system the user chose. One dataset
/// takes the name as it is; several (a GeoJSON file with several kinds of shape)
/// take it with their kind added.
fn apply_choices(datasets: &mut [Dataset], name: &str, crs: Option<CrsRef>) {
    let several = datasets.len() > 1;
    for dataset in datasets {
        if !name.is_empty() {
            dataset.name = if several {
                format!("{name} ({})", dataset.kind().as_str())
            } else {
                name.to_string()
            };
        }
        if crs.is_some() {
            dataset.crs = crs;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;
    use crate::mapping::{ColumnMapping, EmptyCoordinates, Nodata};
    use crate::numbers::DecimalSeparator;
    use crate::roles::Role;
    use karmania_core::Kind;

    fn collars(name: &str, crs: Option<CrsRef>) -> ImportMapping {
        let column = |source: &str, role| ColumnMapping {
            source: source.into(),
            role,
            column_type: None,
            rename: None,
        };
        ImportMapping {
            dataset_name: name.into(),
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

    /// Runs to the end, collecting every progress report.
    fn run(mut run: ImportRun, budget: usize) -> (Vec<RunProgress>, Imported) {
        let mut seen = Vec::new();
        loop {
            match run.step(budget) {
                RunStep::Progress(p) => seen.push(p),
                RunStep::Done(imported) => return (seen, imported),
            }
        }
    }

    fn epsg(code: u32) -> Option<CrsRef> {
        Some(CrsRef::Epsg { code })
    }

    #[test]
    fn a_csv_file_is_parsed_in_chunks_then_validated() {
        let r = ImportRun::new(
            "points.csv",
            &fixtures::bytes("points.csv"),
            collars("Collars", epsg(32640)),
        );
        let (seen, imported) = run(r, 3);
        let phases: Vec<_> = seen.iter().map(|p| p.phase).collect();
        assert_eq!(phases, [Phase::Parsing, Phase::Parsing, Phase::Validating]);
        let fractions: Vec<_> = seen.iter().map(|p| p.fraction).collect();
        assert_eq!(fractions, [3.0 / 8.0, 6.0 / 8.0, 0.0]);
        assert_eq!(imported.datasets.len(), 1);
        let (dataset, report) = &imported.datasets[0];
        assert_eq!(
            (dataset.name.as_str(), dataset.crs),
            ("Collars", epsg(32640))
        );
        assert!(report.is_loadable());
        assert!(imported.findings.is_empty());
    }

    #[test]
    fn several_datasets_are_validated_one_per_step() {
        let r = ImportRun::new(
            "mixed.geojson",
            &fixtures::bytes("mixed.geojson"),
            collars("", None),
        );
        let (seen, imported) = run(r, 1_000);
        let validating: Vec<_> = seen
            .iter()
            .filter(|p| p.phase == Phase::Validating)
            .map(|p| p.fraction)
            .collect();
        assert_eq!(validating, [0.0, 1.0 / 3.0, 2.0 / 3.0]);
        assert_eq!(imported.datasets.len(), 3);
        // The reader's notes are kept.
        let codes: Vec<_> = imported.findings.iter().map(|f| f.code.as_str()).collect();
        assert_eq!(
            codes,
            [
                "geojson.z.partial",
                "geojson.kinds.mixed",
                "geojson.crs.assumed"
            ]
        );
    }

    #[test]
    fn the_chosen_name_and_crs_are_applied_to_any_format() {
        let bytes = fixtures::bytes("mixed.geojson");
        // A name and a coordinate system override the reader's.
        let (_, imported) = run(
            ImportRun::new("mixed.geojson", &bytes, collars("Survey", epsg(32640))),
            1_000,
        );
        let names: Vec<_> = imported
            .datasets
            .iter()
            .map(|(d, _)| d.name.as_str())
            .collect();
        assert_eq!(
            names,
            ["Survey (points)", "Survey (lines)", "Survey (polygons)"]
        );
        assert!(imported.datasets.iter().all(|(d, _)| d.crs == epsg(32640)));

        // A blank name and no coordinate system keep what the reader made.
        let (_, imported) = run(
            ImportRun::new("mixed.geojson", &bytes, collars("  ", None)),
            1_000,
        );
        assert_eq!(imported.datasets[0].0.name, "mixed.geojson (points)");
        assert_eq!(imported.datasets[0].0.crs, epsg(4326));

        // One dataset takes the name as it is.
        let (_, imported) = run(
            ImportRun::new(
                "grid.asc",
                &fixtures::bytes("grid.asc"),
                collars(" Topography ", epsg(32640)),
            ),
            1_000,
        );
        let (grid, report) = &imported.datasets[0];
        assert_eq!((grid.name.as_str(), grid.crs), ("Topography", epsg(32640)));
        assert!(report.is_loadable());
    }

    #[test]
    fn a_dataset_that_fails_validation_is_handed_over_with_its_report() {
        // No coordinate system: the grid reads fine but validation says what is missing.
        let r = ImportRun::new("grid.asc", &fixtures::bytes("grid.asc"), collars("", None));
        let (_, imported) = run(r, 1_000);
        let (_, report) = &imported.datasets[0];
        assert!(!report.is_loadable());
        assert!(report.findings().any(|f| f.code.as_str() == "crs.missing"));
    }

    #[test]
    fn a_file_that_cannot_be_read_ends_in_the_first_step_with_the_reason() {
        for (name, bytes) in [
            ("a.shp", &[0u8, 0, 1][..]),
            ("empty.csv", &b""[..]),
            ("bad.asc", &b"ncols 4\\nnrows 3\\n1 2 3\\n"[..]),
        ] {
            let mut r = ImportRun::new(name, bytes, collars("x", None));
            let RunStep::Done(imported) = r.step(10) else {
                panic!("{name}: expected Done")
            };
            assert!(imported.datasets.is_empty(), "{name}");
            assert!(imported.findings.has_errors(), "{name}");
            assert!(r.is_finished());
        }
    }

    #[test]
    fn a_mapping_that_does_not_fit_the_csv_stops_the_import_with_findings() {
        let mut m = collars("x", None);
        m.columns[0].source = "Nope".into();
        let mut r = ImportRun::new("points.csv", &fixtures::bytes("points.csv"), m);
        let RunStep::Done(imported) = r.step(10) else {
            panic!("expected Done")
        };
        assert!(imported.datasets.is_empty());
        assert!(
            imported
                .findings
                .iter()
                .any(|f| f.code.as_str() == "mapping.source.unknown")
        );
    }

    #[test]
    fn a_spent_run_gives_nothing_and_a_zero_budget_still_moves() {
        let mut r = ImportRun::new(
            "grid.asc",
            &fixtures::bytes("grid.asc"),
            collars("", epsg(32640)),
        );
        while let RunStep::Progress(_) = r.step(0) {}
        assert!(r.is_finished());
        let RunStep::Done(again) = r.step(0) else {
            panic!("expected Done")
        };
        assert!(again.datasets.is_empty() && again.findings.is_empty());
    }

    #[test]
    fn progress_stays_within_zero_and_one_and_never_goes_back_within_a_phase() {
        let r = ImportRun::new(
            "points.csv",
            &fixtures::bytes("points.csv"),
            collars("", epsg(32640)),
        );
        let (seen, _) = run(r, 1);
        for phase in [Phase::Parsing, Phase::Validating] {
            let mut last = -1.0;
            for p in seen.iter().filter(|p| p.phase == phase) {
                assert!((0.0..=1.0).contains(&p.fraction));
                assert!(p.fraction > last);
                last = p.fraction;
            }
        }
    }

    #[test]
    fn the_progress_json_names_the_phase_and_the_fraction() {
        let v = serde_json::to_value(RunProgress {
            phase: Phase::Validating,
            fraction: 0.5,
        })
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({"phase": "validating", "fraction": 0.5})
        );
    }
}
