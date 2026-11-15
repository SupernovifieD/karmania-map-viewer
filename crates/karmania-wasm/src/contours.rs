//! Making contour lines for the kernel: the steps of a job, and what the end of one does to the datasets.
//!
//! This is the joining of the kernel's two halves (the loaded datasets of `karmania-io` and the jobs of `karmania-prep`), which only this
//! crate sees; it is plain Rust with no JavaScript in it, so it is tested natively. `kernel.rs` turns its answers into JavaScript values.

use karmania_core::{ContourParams, DatasetId, Derivation, DerivedFrom, Finding, Findings};
use karmania_io::kernel::Kernel as CoreKernel;
use karmania_io::registry::LoadResult;
use karmania_prep::{
    ContourError, ContourStep, Contourer, Preparer, contours_name, default_params,
};
use serde::Serialize;

/// What a step of making contours did. In JSON: `{ status: "progress", fraction }`, `{ status: "cancelled" }` or `{ status: "done",
/// result }`, where `result` is what a load gives: `{ status: "loaded", summaries }` (one summary, of the new lines) or `{ status:
/// "blocked", findings }` (why there are none).
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum Stepped {
    /// More is to do.
    Progress {
        /// How much is done, from 0 to just under 1.
        fraction: f64,
    },
    /// The dataset was removed, so the job is over and nothing changed.
    Cancelled,
    /// The job is over and the datasets are as they are to be.
    Done {
        /// The new lines, or the findings that say why there are none.
        result: LoadResult,
    },
}

/// What `defaults` answers. In JSON: `{ status: "defaults", params }` or `{ status: "not_available", findings }`.
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum Defaulted {
    /// The settings a set of contours starts with.
    Defaults {
        /// The column (a grid's), the interval, the base and the index lines.
        params: ContourParams,
    },
    /// The dataset cannot be contoured, and why.
    NotAvailable {
        /// The reason.
        findings: Vec<Finding>,
    },
}

/// Starts making the contours of a loaded dataset. `None` if there is no such dataset.
pub(crate) fn start(
    kernel: &CoreKernel,
    contourer: &mut Contourer,
    dataset: DatasetId,
    params: &ContourParams,
) -> Option<u32> {
    let found = kernel.registry().dataset(dataset)?;
    Some(contourer.start(found, params))
}

/// Does the next part of a job. `None` if there is no such job (it never existed, or it is over). The step that finishes it replaces what
/// was made from the same dataset before, and so does one that fails: what is shown is never made with other settings than those asked for.
pub(crate) fn step(
    kernel: &mut CoreKernel,
    prep: &mut Preparer,
    contourer: &mut Contourer,
    job: u32,
    budget: usize,
) -> Option<Stepped> {
    let source = contourer.dataset_of(job)?;
    let params = contourer.params_of(job)?.clone();
    let stepped = contourer.step(job, kernel.registry().dataset(source), budget)?;
    Some(match stepped {
        ContourStep::Progress { fraction } => Stepped::Progress { fraction },
        ContourStep::Cancelled => Stepped::Cancelled,
        ContourStep::Done(result) => finish(kernel, prep, contourer, source, &params, result),
    })
}

/// The end of a job: out with the lines made before, and in with the new ones, or the finding that says why there are none.
fn finish(
    kernel: &mut CoreKernel,
    prep: &mut Preparer,
    contourer: &mut Contourer,
    source: DatasetId,
    params: &ContourParams,
    result: Result<karmania_prep::ContourLines, ContourError>,
) -> Stepped {
    let how = Derivation::Contours {
        params: params.clone(),
    };
    let removed = kernel.registry_mut().remove_derived(source, &how);
    forget(kernel, prep, contourer, &removed);
    let Some((name, crs)) = kernel
        .registry()
        .dataset(source)
        .map(|dataset| (contours_name(&dataset.name, params.interval), dataset.crs))
    else {
        return Stepped::Cancelled;
    };
    let made = result.and_then(|lines| lines.into_dataset(name, crs).ok_or(ContourError::NoLines));
    match made {
        Err(error) => {
            let mut findings = Findings::new();
            findings.add(error.finding());
            Stepped::Done {
                result: LoadResult::Blocked { findings },
            }
        }
        Ok(dataset) => match kernel.load_derived(dataset, DerivedFrom { id: source, how }) {
            Some(result) => Stepped::Done { result },
            None => Stepped::Cancelled,
        },
    }
}

/// Tells the preparer and the contourer that datasets are gone, so that their jobs stop.
fn forget(kernel: &CoreKernel, prep: &mut Preparer, contourer: &mut Contourer, gone: &[DatasetId]) {
    for dataset in gone {
        prep.removed(*dataset, kernel.registry().len());
        contourer.forget_dataset(*dataset);
    }
}

/// Unloads a dataset and what was made from it, and stops the jobs on all of them. Returns whether there was a dataset with that
/// identifier.
pub(crate) fn remove(
    kernel: &mut CoreKernel,
    prep: &mut Preparer,
    contourer: &mut Contourer,
    dataset: DatasetId,
) -> bool {
    let removed = kernel.registry_mut().remove_with_derived(dataset);
    forget(kernel, prep, contourer, &removed);
    !removed.is_empty()
}

/// The settings a set of contours of a dataset starts with, or why it cannot have any. `None` if there is no such dataset.
pub(crate) fn defaults(
    kernel: &CoreKernel,
    dataset: DatasetId,
    column: Option<&str>,
) -> Option<Defaulted> {
    let found = kernel.registry().dataset(dataset)?;
    Some(match default_params(found, column) {
        Ok(params) => Defaulted::Defaults { params },
        Err(error) => Defaulted::NotAvailable {
            findings: vec![error.finding()],
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use karmania_core::{CrsRef, Kind};
    use karmania_io::build::{
        ColumnInput, ColumnValues, GridInput, LatticeInput, MeshInput, PointsInput,
    };

    const CRS: CrsRef = CrsRef::Epsg { code: 32640 };

    struct World {
        kernel: CoreKernel,
        prep: Preparer,
        contourer: Contourer,
    }

    impl World {
        fn new() -> Self {
            Self {
                kernel: CoreKernel::new(),
                prep: Preparer::new(),
                contourer: Contourer::new(),
            }
        }

        fn id_of(result: LoadResult) -> DatasetId {
            let LoadResult::Loaded { summaries } = result else {
                panic!("expected the dataset to load")
            };
            summaries[0].id
        }

        /// A cone of 40 by 30 cells with a column `height` and a column `label` that is text.
        fn grid(&mut self) -> DatasetId {
            let value = |k: u32| {
                let (i, j) = (f64::from(k % 40), f64::from(k / 40));
                ((i - 20.0).powi(2) + (j - 15.0).powi(2)).sqrt()
            };
            Self::id_of(self.kernel.load_grid(GridInput {
                name: "Cone".into(),
                crs: Some(CRS),
                lattice: LatticeInput {
                    origin: [500_000.0, 4_000_000.0, 0.0],
                    spacing: [10.0, 10.0, 1.0],
                    dims: [40, 30, 1],
                    rotation: 0.0,
                },
                elevation: Some(0.0),
                elevation_column: None,
                columns: vec![
                    ColumnInput {
                        name: "label".into(),
                        values: ColumnValues::Text(vec!["a".into(); 1200]),
                        nulls: None,
                    },
                    ColumnInput {
                        name: "height".into(),
                        values: ColumnValues::Float((0..1200).map(value).collect()),
                        nulls: None,
                    },
                ],
            }))
        }

        fn mesh(&mut self) -> DatasetId {
            Self::id_of(self.kernel.load_mesh(MeshInput {
                name: "Pyramid".into(),
                crs: Some(CRS),
                x: vec![0.0, 10.0, 0.0, 10.0, 5.0],
                y: vec![0.0, 0.0, 10.0, 10.0, 5.0],
                z: vec![0.0, 0.0, 0.0, 0.0, 10.0],
                indices: vec![0, 1, 4, 1, 3, 4, 3, 2, 4, 2, 0, 4],
                columns: Vec::new(),
                vertex_columns: Vec::new(),
            }))
        }

        fn points(&mut self) -> DatasetId {
            Self::id_of(self.kernel.load_points(PointsInput {
                name: "Wells".into(),
                crs: Some(CRS),
                x: vec![500_000.0],
                y: vec![4_000_000.0],
                z: None,
                columns: Vec::new(),
            }))
        }

        fn params(interval: f64) -> ContourParams {
            ContourParams {
                column: None,
                interval,
                base: 0.0,
                index_every: 5,
            }
        }

        /// Makes contours to the end, with a small budget; the answer, and how many steps there were.
        fn contour(&mut self, source: DatasetId, params: &ContourParams) -> (Stepped, usize) {
            let job = start(&self.kernel, &mut self.contourer, source, params).unwrap();
            let mut steps = 0;
            loop {
                steps += 1;
                assert!(steps < 10_000, "the job does not end");
                match step(
                    &mut self.kernel,
                    &mut self.prep,
                    &mut self.contourer,
                    job,
                    100,
                )
                .unwrap()
                {
                    Stepped::Progress { .. } => {}
                    done => return (done, steps),
                }
            }
        }
    }

    fn loaded(stepped: Stepped) -> karmania_core::Summary {
        let Stepped::Done {
            result: LoadResult::Loaded { mut summaries },
        } = stepped
        else {
            panic!("expected lines, got {stepped:?}")
        };
        assert_eq!(summaries.len(), 1);
        summaries.remove(0)
    }

    fn blocked(stepped: Stepped) -> Vec<&'static str> {
        let Stepped::Done {
            result: LoadResult::Blocked { findings },
        } = stepped
        else {
            panic!("expected findings, got {stepped:?}")
        };
        findings.iter().map(|f| f.code.as_str()).collect()
    }

    #[test]
    fn the_contours_of_a_grid_are_a_dataset_of_lines_that_says_where_it_came_from() {
        let mut world = World::new();
        let source = world.grid();
        let (stepped, steps) = world.contour(source, &World::params(2.0));
        assert!(steps > 3, "made in parts, not in one go");
        let summary = loaded(stepped);
        assert_eq!(summary.name, "Contours of Cone (every 2)");
        assert_eq!((summary.kind, summary.crs), (Kind::Lines, Some(CRS)));
        let names: Vec<&str> = summary.columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["level", "index"]);
        // The summary says what it was made from, with the column that was taken (the first of numbers, `height`).
        let from = summary.derived_from.clone().unwrap();
        assert_eq!(from.id, source);
        let Derivation::Contours { params } = from.how;
        assert_eq!(
            params,
            ContourParams {
                column: Some("height".into()),
                ..World::params(2.0)
            }
        );
        // It is loaded, and the registry has it with the same summary.
        assert_eq!(world.kernel.registry().summary(summary.id), Some(&summary));
        assert_eq!(world.kernel.registry().len(), 2);
    }

    #[test]
    fn a_mesh_is_contoured_too_and_a_column_that_was_named_is_not_kept() {
        let mut world = World::new();
        let source = world.mesh();
        let params = ContourParams {
            column: Some("whatever".into()),
            ..World::params(2.5)
        };
        let summary = loaded(world.contour(source, &params).0);
        assert_eq!(summary.name, "Contours of Pyramid (every 2.5)");
        let Derivation::Contours { params } = summary.derived_from.unwrap().how;
        assert_eq!(params.column, None);
        assert!(summary.has_z, "the lines are at their height");
    }

    #[test]
    fn a_new_call_replaces_the_old_lines_of_the_same_dataset_and_no_others() {
        let mut world = World::new();
        let (grid, mesh) = (world.grid(), world.mesh());
        let first = loaded(world.contour(grid, &World::params(2.0)).0);
        let of_mesh = loaded(world.contour(mesh, &World::params(2.5)).0);
        let second = loaded(world.contour(grid, &World::params(5.0)).0);
        assert_ne!(first.id, second.id);
        let ids: Vec<DatasetId> = world
            .kernel
            .registry()
            .summaries()
            .iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(
            ids,
            [grid, mesh, of_mesh.id, second.id],
            "the first lines are gone, the mesh's are not"
        );
        assert_eq!(second.name, "Contours of Cone (every 5)");
    }

    #[test]
    fn a_call_that_fails_takes_the_old_lines_out_too_and_says_why() {
        let mut world = World::new();
        let source = world.grid();
        let first = loaded(world.contour(source, &World::params(2.0)).0);
        // Too many levels (the heights are 0 to 25).
        let (stepped, _) = world.contour(source, &World::params(0.001));
        assert_eq!(blocked(stepped), ["contours.levels.too_many"]);
        assert!(world.kernel.registry().summary(first.id).is_none());
        assert_eq!(world.kernel.registry().len(), 1);
        // A column that is not numbers, and one that is not there.
        let label = ContourParams {
            column: Some("label".into()),
            ..World::params(2.0)
        };
        assert_eq!(
            blocked(world.contour(source, &label).0),
            ["contours.column.not_numeric"]
        );
        let nope = ContourParams {
            column: Some("nope".into()),
            ..World::params(2.0)
        };
        assert_eq!(
            blocked(world.contour(source, &nope).0),
            ["contours.column.missing"]
        );
        // Another shape.
        let wells = world.points();
        assert_eq!(
            blocked(world.contour(wells, &World::params(2.0)).0),
            ["contours.kind.unsupported"]
        );
        assert_eq!(world.kernel.registry().len(), 2);
    }

    #[test]
    fn removing_the_dataset_takes_its_lines_with_it_and_stops_the_jobs_on_both() {
        let mut world = World::new();
        let source = world.grid();
        let lines = loaded(world.contour(source, &World::params(2.0)).0).id;
        // A job on the lines and a job on the source, both under way.
        let on_lines = start(
            &world.kernel,
            &mut world.contourer,
            lines,
            &World::params(1.0),
        )
        .unwrap();
        let on_source = start(
            &world.kernel,
            &mut world.contourer,
            source,
            &World::params(5.0),
        )
        .unwrap();
        let other = world.mesh();
        let on_other = start(
            &world.kernel,
            &mut world.contourer,
            other,
            &World::params(2.5),
        )
        .unwrap();
        assert!(remove(
            &mut world.kernel,
            &mut world.prep,
            &mut world.contourer,
            source
        ));
        assert_eq!(
            world
                .kernel
                .registry()
                .summaries()
                .iter()
                .map(|s| s.id)
                .collect::<Vec<_>>(),
            [other]
        );
        assert_eq!(world.contourer.jobs(), 1);
        assert_eq!(world.contourer.dataset_of(on_other), Some(other));
        // A step of a job that was stopped has nothing to step.
        for job in [on_lines, on_source] {
            assert!(
                step(
                    &mut world.kernel,
                    &mut world.prep,
                    &mut world.contourer,
                    job,
                    10
                )
                .is_none()
            );
        }
        assert!(!remove(
            &mut world.kernel,
            &mut world.prep,
            &mut world.contourer,
            source
        ));
    }

    #[test]
    fn a_dataset_removed_in_the_middle_cancels_the_job_and_changes_nothing() {
        let mut world = World::new();
        let (grid, mesh) = (world.grid(), world.mesh());
        let old = loaded(world.contour(grid, &World::params(2.0)).0);
        let job = start(
            &world.kernel,
            &mut world.contourer,
            grid,
            &World::params(5.0),
        )
        .unwrap();
        assert!(matches!(
            step(
                &mut world.kernel,
                &mut world.prep,
                &mut world.contourer,
                job,
                10
            ),
            Some(Stepped::Progress { .. })
        ));
        // The registry loses the dataset behind the job's back (the kernel's own `remove` would have stopped the job).
        world.kernel.registry_mut().remove(grid);
        assert!(matches!(
            step(
                &mut world.kernel,
                &mut world.prep,
                &mut world.contourer,
                job,
                10
            ),
            Some(Stepped::Cancelled)
        ));
        assert!(world.kernel.registry().summary(old.id).is_none());
        assert_eq!(world.kernel.registry().len(), 1);
        assert!(world.kernel.registry().dataset(mesh).is_some());
        // No such dataset, no such job.
        assert!(
            start(
                &world.kernel,
                &mut world.contourer,
                grid,
                &World::params(5.0)
            )
            .is_none()
        );
        assert!(
            step(
                &mut world.kernel,
                &mut world.prep,
                &mut world.contourer,
                job,
                10
            )
            .is_none()
        );
    }

    #[test]
    fn the_starting_settings_of_a_dataset_or_why_it_has_none() {
        let mut world = World::new();
        let (grid, mesh, wells) = (world.grid(), world.mesh(), world.points());
        let Some(Defaulted::Defaults { params }) = defaults(&world.kernel, grid, None) else {
            panic!("expected settings")
        };
        // The heights go from 0 to about 25: the largest nice interval that gives ten levels is 2.5.
        assert_eq!(
            params,
            ContourParams {
                column: Some("height".into()),
                interval: 2.5,
                base: 0.0,
                index_every: 5
            }
        );
        assert!(matches!(
            defaults(&world.kernel, mesh, None),
            Some(Defaulted::Defaults { params }) if params.column.is_none() && params.interval == 1.0
        ));
        for (dataset, column, code) in [
            (wells, None, "contours.kind.unsupported"),
            (grid, Some("label"), "contours.column.not_numeric"),
            (grid, Some("nope"), "contours.column.missing"),
        ] {
            let Some(Defaulted::NotAvailable { findings }) =
                defaults(&world.kernel, dataset, column)
            else {
                panic!("expected none for {code}")
            };
            assert_eq!(findings[0].code.as_str(), code);
        }
        assert!(defaults(&world.kernel, DatasetId(99), None).is_none());
    }

    #[test]
    fn the_json_of_a_step_has_a_status() {
        let json = |stepped: &Stepped| serde_json::to_value(stepped).unwrap();
        assert_eq!(
            json(&Stepped::Progress { fraction: 0.5 }),
            serde_json::json!({"status": "progress", "fraction": 0.5})
        );
        assert_eq!(
            json(&Stepped::Cancelled),
            serde_json::json!({"status": "cancelled"})
        );
        let done = Stepped::Done {
            result: LoadResult::Blocked {
                findings: Findings::new(),
            },
        };
        assert_eq!(
            json(&done),
            serde_json::json!({"status": "done", "result": {"status": "blocked", "findings": []}})
        );
    }
}
