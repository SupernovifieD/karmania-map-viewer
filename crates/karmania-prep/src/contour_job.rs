//! The making of contour lines in steps, so that the worker can answer other requests (and be told to stop) between them.
//!
//! A job scans the squares of a grid, or the triangles of a mesh, a part at a time, and then joins the pieces of one level after another,
//! and the step that finishes gives the same [`ContourLines`] that [`contours_of`] gives at once. It is started with the dataset and the
//! settings, which it checks then (a wrong one is the answer of the first step); the dataset is given again at every step, and if it is
//! gone the job is cancelled. Like [`crate::preparer::Preparer`], a [`Contourer`] keeps the jobs of one kernel and shares nothing.

use std::collections::BTreeMap;

use karmania_core::{ContourParams, Dataset, DatasetId, Geometry, Lattice};

use crate::contour_grid::{Contour, Scan};
use crate::contour_levels::Levels;
use crate::contour_mesh::{MeshScan, Surface};
use crate::contours::{ContourError, ContourLines, GridValues, grid_places, lines_of, surface_of};

/// How much of the work is the scan: the rest is joining the pieces of each level into lines.
const SCAN_SHARE: f64 = 0.8;

/// What a step of a job did.
#[derive(Debug, Clone, PartialEq)]
pub enum ContourStep {
    /// More is to do: how much is done, from 0 to just under 1.
    Progress {
        /// The part of the work that is done.
        fraction: f64,
    },
    /// The dataset is gone, so the job is over.
    Cancelled,
    /// A newer job was started on the same dataset, so this one is over and its answer would be out of date: whichever job were to
    /// finish last would otherwise decide which lines the dataset has.
    Superseded,
    /// The job is over: the lines, or why there are none.
    Done(Result<ContourLines, ContourError>),
}

/// A grid being contoured.
struct GridJob {
    input: GridValues,
    lattice: Lattice,
    levels: Levels,
    scan: Scan,
    /// The rows of squares that are scanned.
    rows_done: usize,
    /// The levels whose pieces are joined.
    levels_done: usize,
    contours: Vec<Contour>,
}

/// A mesh being contoured.
struct MeshJob {
    levels: Levels,
    scan: MeshScan,
    triangles_done: usize,
    levels_done: usize,
    contours: Vec<Contour>,
}

enum Work {
    /// The job could not start: the first step says why.
    Failed(ContourError),
    Grid(Box<GridJob>),
    Mesh(MeshJob),
}

/// One set of contours being made.
pub struct ContourJob {
    work: Work,
}

fn fraction(scanned: f64, joined: f64) -> f64 {
    SCAN_SHARE * scanned + (1.0 - SCAN_SHARE) * joined
}

/// The share of `total` that `done` is, 1 for nothing to do.
fn share(done: usize, total: usize) -> f64 {
    if total == 0 {
        1.0
    } else {
        #[allow(clippy::cast_precision_loss)]
        let share = done as f64 / total as f64;
        share
    }
}

impl ContourJob {
    /// The settings as the job uses them: a grid's column is the one it takes (the first of numbers if none was named), and a mesh has no
    /// column (it has one height, so a column that was named is not used and is not kept).
    fn used(&self, params: &ContourParams) -> ContourParams {
        ContourParams {
            column: match &self.work {
                Work::Grid(job) => Some(job.input.column.clone()),
                Work::Mesh(_) => None,
                Work::Failed(_) => params.column.clone(),
            },
            ..params.clone()
        }
    }

    /// A job for `dataset` with `params`. Whatever is wrong with them is the answer of the first step.
    #[must_use]
    pub fn new(dataset: &Dataset, params: &ContourParams) -> Self {
        Self {
            work: match start(dataset, params) {
                Ok(work) => work,
                Err(error) => Work::Failed(error),
            },
        }
    }

    /// Does the next part: up to `budget` squares or triangles of the scan (at least a row of squares, or one triangle), or the
    /// joining of some levels (until their lines have `budget` vertices, at least one level).
    pub fn step(&mut self, dataset: &Dataset, budget: usize) -> ContourStep {
        match &mut self.work {
            Work::Failed(error) => ContourStep::Done(Err(error.clone())),
            Work::Grid(job) => job.step(budget),
            Work::Mesh(job) => job.step(dataset, budget),
        }
    }
}

fn start(dataset: &Dataset, params: &ContourParams) -> Result<Work, ContourError> {
    match &dataset.geometry {
        Geometry::Grid(grid) => {
            let input = GridValues::of(dataset, params.column.as_deref())?;
            let (low, high) = input.range(&input.field()?)?;
            let levels = levels_of(low, high, params)?;
            Ok(Work::Grid(Box::new(GridJob {
                input,
                lattice: grid.lattice,
                scan: Scan::new(&levels),
                levels,
                rows_done: 0,
                levels_done: 0,
                contours: Vec::new(),
            })))
        }
        Geometry::Mesh(mesh) => {
            let (_, low, high) = surface_of(mesh)?;
            let levels = levels_of(low, high, params)?;
            Ok(Work::Mesh(MeshJob {
                scan: MeshScan::new(&levels),
                levels,
                triangles_done: 0,
                levels_done: 0,
                contours: Vec::new(),
            }))
        }
        other => Err(ContourError::Kind(other.kind())),
    }
}

fn levels_of(low: f64, high: f64, params: &ContourParams) -> Result<Levels, ContourError> {
    Levels::for_range(low, high, params.base, params.interval, params.index_every)
        .map_err(ContourError::Levels)
}

impl GridJob {
    fn step(&mut self, budget: usize) -> ContourStep {
        let field = match self.input.field() {
            Ok(field) => field,
            Err(error) => return ContourStep::Done(Err(error)),
        };
        let rows = field.ny().saturating_sub(1);
        if self.rows_done < rows {
            let end = (self.rows_done + (budget / field.nx().max(1)).max(1)).min(rows);
            self.scan
                .scan_rows(&field, &self.levels, self.rows_done..end);
            self.rows_done = end;
            return ContourStep::Progress {
                fraction: fraction(share(self.rows_done, rows), 0.0),
            };
        }
        let mut vertices = 0;
        // (At least one level, whatever the budget: a budget of 0 is a part of the work, and not none.)
        while self.levels_done < self.levels.len() && (vertices == 0 || vertices < budget) {
            let lines = self.scan.lines(&field, &self.levels, self.levels_done);
            vertices += lines
                .iter()
                .map(|line| line.vertices.len())
                .sum::<usize>()
                .max(1);
            self.contours.extend(lines);
            self.levels_done += 1;
        }
        if self.levels_done < self.levels.len() {
            return ContourStep::Progress {
                fraction: fraction(1.0, share(self.levels_done, self.levels.len())),
            };
        }
        let (has_heights, plane) = (self.input.heights.is_some(), self.input.plane);
        ContourStep::Done(lines_of(
            &self.contours,
            &self.levels,
            has_heights || plane != 0.0,
            grid_places(&self.lattice, has_heights, plane),
        ))
    }
}

impl MeshJob {
    fn step(&mut self, dataset: &Dataset, budget: usize) -> ContourStep {
        let Geometry::Mesh(mesh) = &dataset.geometry else {
            return ContourStep::Done(Err(ContourError::Kind(dataset.kind())));
        };
        let Some(surface) = Surface::new(mesh.positions.as_slice(), &mesh.indices) else {
            return ContourStep::Done(Err(ContourError::NoLines));
        };
        let triangles = surface.triangle_count();
        if self.triangles_done < triangles {
            let end = self
                .triangles_done
                .saturating_add(budget.max(1))
                .min(triangles);
            self.scan
                .scan_triangles(&surface, &self.levels, self.triangles_done..end);
            self.triangles_done = end;
            return ContourStep::Progress {
                fraction: fraction(share(self.triangles_done, triangles), 0.0),
            };
        }
        let mut vertices = 0;
        // (At least one level, whatever the budget: a budget of 0 is a part of the work, and not none.)
        while self.levels_done < self.levels.len() && (vertices == 0 || vertices < budget) {
            let lines = self.scan.lines(&surface, &self.levels, self.levels_done);
            vertices += lines
                .iter()
                .map(|line| line.vertices.len())
                .sum::<usize>()
                .max(1);
            self.contours.extend(lines);
            self.levels_done += 1;
        }
        if self.levels_done < self.levels.len() {
            return ContourStep::Progress {
                fraction: fraction(1.0, share(self.levels_done, self.levels.len())),
            };
        }
        ContourStep::Done(lines_of(&self.contours, &self.levels, true, |vertex| {
            [vertex.x, vertex.y, vertex.z]
        }))
    }
}

/// A job of a [`Contourer`].
struct Running {
    /// The dataset it makes contours of.
    dataset: DatasetId,
    /// The settings it uses.
    params: ContourParams,
    job: ContourJob,
    /// Whether a newer job was started on the same dataset since: this one is then not to be finished.
    superseded: bool,
}

/// The contour jobs of a kernel, by number. They share nothing, like the kernels that hold them.
#[derive(Default)]
pub struct Contourer {
    jobs: BTreeMap<u32, Running>,
    /// The identifier the next job gets. Identifiers are never reused.
    next: u32,
}

impl Contourer {
    /// A contourer with no job.
    #[must_use]
    pub fn new() -> Self {
        Self {
            jobs: BTreeMap::new(),
            next: 1,
        }
    }

    /// Starts making contours of `dataset` with `params` and returns the job's identifier. Nothing more is done until
    /// [`Contourer::step`]. A job that is under way on the same dataset is superseded: its next step says so.
    pub fn start(&mut self, dataset: &Dataset, params: &ContourParams) -> u32 {
        let id = self.next;
        self.next += 1;
        let job = ContourJob::new(dataset, params);
        let used = job.used(params);
        for older in self.jobs.values_mut() {
            older.superseded |= older.dataset == dataset.id;
        }
        self.jobs.insert(
            id,
            Running {
                dataset: dataset.id,
                params: used,
                job,
                superseded: false,
            },
        );
        id
    }

    /// Does the next part of a job. `dataset` is the one it was started on, or `None` if that dataset is gone, which cancels the job.
    /// A job that is done, cancelled or superseded is forgotten with the step that says so. `None` if there is no job with that
    /// identifier (it never existed, or it is over).
    pub fn step(
        &mut self,
        job: u32,
        dataset: Option<&Dataset>,
        budget: usize,
    ) -> Option<ContourStep> {
        let running = self.jobs.get_mut(&job)?;
        let step = if running.superseded {
            ContourStep::Superseded
        } else {
            match dataset {
                Some(dataset) => running.job.step(dataset, budget),
                None => ContourStep::Cancelled,
            }
        };
        if !matches!(step, ContourStep::Progress { .. }) {
            self.jobs.remove(&job);
        }
        Some(step)
    }

    /// The dataset a job is making contours of, or `None` if there is no such job.
    #[must_use]
    pub fn dataset_of(&self, job: u32) -> Option<DatasetId> {
        self.jobs.get(&job).map(|running| running.dataset)
    }

    /// The settings a job uses (see [`ContourJob`]: the column is the one a grid takes), or `None` if there is no such job. They are
    /// what the dataset that comes of it says it was made with.
    #[must_use]
    pub fn params_of(&self, job: u32) -> Option<&ContourParams> {
        self.jobs.get(&job).map(|running| &running.params)
    }

    /// Stops a job and drops what it has made. Returns whether there was one.
    pub fn cancel(&mut self, job: u32) -> bool {
        self.jobs.remove(&job).is_some()
    }

    /// Stops the jobs that are making contours of `dataset`, which is being removed.
    pub fn forget_dataset(&mut self, dataset: DatasetId) {
        self.jobs.retain(|_, running| running.dataset != dataset);
    }

    /// How many jobs are under way.
    #[must_use]
    pub fn jobs(&self) -> usize {
        self.jobs.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contours::{contours_of, default_params};
    use karmania_core::{
        Column, ColumnData, CrsRef, Findings, Grid, GridZ, Mesh, Positions, Table, Validity,
    };

    fn lattice(nx: u32, ny: u32, rotation: f64) -> Lattice {
        Lattice {
            origin: [1000.0, 2000.0, 0.0],
            spacing: [10.0, 5.0, 1.0],
            dims: [nx, ny, 1],
            rotation,
        }
    }

    /// A grid of a cone with a few cells with no value, an elevation column, and a turn.
    fn grid(nx: u32, ny: u32, rotation: f64) -> Dataset {
        let cells = (nx * ny) as usize;
        let value = |k: usize| {
            let (i, j) = ((k as u32 % nx) as f64, (k as u32 / nx) as f64);
            ((i - f64::from(nx) / 2.0).powi(2) + (j - f64::from(ny) / 2.0).powi(2)).sqrt()
        };
        let data: Vec<f64> = (0..cells).map(value).collect();
        let flags: Vec<bool> = (0..cells).map(|k| k % 37 != 5).collect();
        let columns = vec![
            Column::new(
                "value",
                ColumnData::Float64(data.clone()),
                Validity::from_flags(flags),
            )
            .unwrap(),
            Column::without_nulls(
                "z",
                ColumnData::Float64(data.iter().map(|v| 3.0 * v).collect()),
            ),
        ];
        Dataset::new(
            DatasetId(4),
            "Cone",
            Some(CrsRef::Epsg { code: 32640 }),
            Geometry::Grid(Grid {
                lattice: lattice(nx, ny, rotation),
                z: GridZ::FromColumn {
                    name: "z".to_string(),
                },
            }),
            Table::from_columns(columns, &mut Findings::new()).unwrap(),
        )
    }

    fn mesh(nx: usize, ny: usize) -> Dataset {
        let mut xyz = Vec::new();
        for j in 0..ny {
            for i in 0..nx {
                let (x, y) = (i as f64, j as f64);
                xyz.extend([
                    x * 10.0,
                    y * 10.0,
                    ((x * 0.4).sin() + (y * 0.3).cos()) * 20.0,
                ]);
            }
        }
        let at = |i: usize, j: usize| u32::try_from(j * nx + i).unwrap();
        let mut indices = Vec::new();
        for j in 0..ny - 1 {
            for i in 0..nx - 1 {
                indices.extend([at(i, j), at(i + 1, j), at(i + 1, j + 1)]);
                indices.extend([at(i, j), at(i + 1, j + 1), at(i, j + 1)]);
            }
        }
        Dataset::new(
            DatasetId(5),
            "Hills",
            Some(CrsRef::Epsg { code: 32640 }),
            Geometry::Mesh(Mesh {
                positions: Positions::from_interleaved(xyz, true),
                indices,
            }),
            Table::empty(),
        )
    }

    /// Runs a job to its end with `budget` and gives the steps' fractions and the answer.
    fn run(
        dataset: &Dataset,
        params: &ContourParams,
        budget: usize,
    ) -> (Vec<f64>, Result<ContourLines, ContourError>) {
        let mut contourer = Contourer::new();
        let job = contourer.start(dataset, params);
        let mut fractions = Vec::new();
        loop {
            let step = contourer.step(job, Some(dataset), budget).unwrap();
            match step {
                ContourStep::Progress { fraction } => {
                    fractions.push(fraction);
                    // A job that makes no progress must fail the test, not hang it.
                    assert!(fractions.len() < 200_000, "the job does not end");
                }
                ContourStep::Done(result) => {
                    assert_eq!(contourer.jobs(), 0, "a job that is over is forgotten");
                    return (fractions, result);
                }
                ContourStep::Cancelled | ContourStep::Superseded => panic!("{step:?}"),
            }
        }
    }

    #[test]
    fn steps_of_any_size_give_what_making_the_contours_at_once_gives() {
        for dataset in [grid(40, 30, 0.0), grid(33, 21, 25.0), mesh(30, 25)] {
            let params = default_params(&dataset, None).unwrap();
            let whole = contours_of(&dataset, &params);
            assert!(whole.is_ok(), "{:?}", whole);
            for budget in [0, 1, 7, 100, 1_000, usize::MAX] {
                let (_, stepped) = run(&dataset, &params, budget);
                assert_eq!(stepped, whole, "{} with a budget of {budget}", dataset.name);
            }
        }
    }

    #[test]
    fn a_small_budget_takes_many_steps_whose_progress_only_grows_and_stays_under_one() {
        for dataset in [grid(40, 30, 0.0), mesh(30, 25)] {
            let params = default_params(&dataset, None).unwrap();
            let (fractions, result) = run(&dataset, &params, 50);
            assert!(result.is_ok());
            assert!(
                fractions.len() > 10,
                "{} steps for {}",
                fractions.len(),
                dataset.name
            );
            assert!(fractions.windows(2).all(|w| w[0] <= w[1]), "{fractions:?}");
            assert!(fractions.iter().all(|f| (0.0..1.0).contains(f)));
            // It does advance, in the scan and not only after it: many different values.
            let mut distinct = fractions.clone();
            distinct.dedup();
            assert!(distinct.len() > 8, "{fractions:?}");
            assert!(
                distinct.iter().filter(|f| **f < 0.79).count() > 5,
                "{fractions:?}"
            );
            // And from the first part of the scan to the end of it at least.
            assert!(fractions.first().is_some_and(|f| *f < 0.1), "{fractions:?}");
            assert!(fractions.last().is_some_and(|f| *f > 0.7), "{fractions:?}");
            // A budget that takes everything is done in a step or two.
            assert!(run(&dataset, &params, usize::MAX).0.len() <= 2);
        }
    }

    #[test]
    fn a_dataset_that_is_gone_cancels_the_job_and_a_job_can_be_stopped() {
        let dataset = grid(40, 30, 0.0);
        let params = default_params(&dataset, None).unwrap();
        let mut contourer = Contourer::new();
        let job = contourer.start(&dataset, &params);
        assert_eq!(contourer.dataset_of(job), Some(DatasetId(4)));
        assert!(matches!(
            contourer.step(job, Some(&dataset), 50),
            Some(ContourStep::Progress { .. })
        ));
        assert_eq!(contourer.step(job, None, 50), Some(ContourStep::Cancelled));
        assert_eq!((contourer.jobs(), contourer.dataset_of(job)), (0, None));
        assert_eq!(contourer.step(job, Some(&dataset), 50), None, "it is over");
        let again = contourer.start(&dataset, &params);
        assert_ne!(again, job, "identifiers are not reused");
        assert!(contourer.cancel(again));
        assert!(!contourer.cancel(again));
        assert_eq!(contourer.step(again, Some(&dataset), 50), None);
        // Removing the dataset stops its jobs and no one else's.
        let other = mesh(30, 25);
        let params_other = default_params(&other, None).unwrap();
        let (a, b) = (
            contourer.start(&dataset, &params),
            contourer.start(&other, &params_other),
        );
        contourer.forget_dataset(DatasetId(4));
        assert_eq!(
            (contourer.dataset_of(a), contourer.dataset_of(b)),
            (None, Some(DatasetId(5)))
        );
        assert_eq!(contourer.jobs(), 1);
    }

    #[test]
    fn a_job_says_the_settings_it_uses_the_column_a_grid_takes_and_none_for_a_mesh() {
        let dataset = grid(40, 30, 0.0);
        let named = default_params(&dataset, None).unwrap();
        let none = ContourParams {
            column: None,
            ..named.clone()
        };
        let mut contourer = Contourer::new();
        let (a, b) = (
            contourer.start(&dataset, &none),
            contourer.start(&dataset, &named),
        );
        // A column that was not named is the first of numbers, which is `value`.
        assert_eq!(contourer.params_of(a), Some(&named));
        assert_eq!(contourer.params_of(b), Some(&named));
        assert_eq!(named.column.as_deref(), Some("value"));
        // A mesh has none, even if one was given.
        let hills = mesh(30, 25);
        let given = ContourParams {
            column: Some("z".into()),
            ..default_params(&hills, None).unwrap()
        };
        let job = contourer.start(&hills, &given);
        assert_eq!(contourer.params_of(job).unwrap().column, None);
        assert_eq!(contourer.params_of(job).unwrap().interval, given.interval);
        // A job that cannot start keeps what it was given, and none is known once it is over.
        let bad = ContourParams {
            column: Some("nope".into()),
            ..named
        };
        let failed = contourer.start(&dataset, &bad);
        assert_eq!(contourer.params_of(failed), Some(&bad));
        assert!(contourer.cancel(failed));
        assert_eq!(contourer.params_of(failed), None);
    }

    #[test]
    fn what_is_wrong_is_the_answer_of_the_first_step_and_the_job_is_over_with_it() {
        let dataset = grid(40, 30, 0.0);
        let good = default_params(&dataset, None).unwrap();
        let cases: [(ContourParams, ContourError); 3] = [
            (
                ContourParams {
                    column: Some("nope".into()),
                    ..good.clone()
                },
                ContourError::ColumnMissing("nope".into()),
            ),
            (
                ContourParams {
                    interval: 0.0,
                    ..good.clone()
                },
                ContourError::Levels(crate::contour_levels::LevelsError::Invalid),
            ),
            (
                ContourParams {
                    interval: 1e-9,
                    ..good.clone()
                },
                ContourError::Levels(crate::contour_levels::LevelsError::TooMany { count: 0 }),
            ),
        ];
        for (params, expected) in cases {
            let mut contourer = Contourer::new();
            let job = contourer.start(&dataset, &params);
            let Some(ContourStep::Done(Err(error))) = contourer.step(job, Some(&dataset), 100)
            else {
                panic!("expected an error at the first step");
            };
            // (The count of "too many" is not the point here.)
            assert_eq!(
                std::mem::discriminant(&error),
                std::mem::discriminant(&expected),
                "{error:?}"
            );
            assert_eq!(contourer.jobs(), 0);
        }
        // Another shape, and a mesh with no heights.
        let points = crate::testutil::points(Some(CrsRef::Epsg { code: 32640 }), &[(0.0, 0.0)]);
        assert_eq!(
            run(&points, &good, 10).1,
            Err(ContourError::Kind(karmania_core::Kind::Points))
        );
        let mut flat = mesh(5, 5);
        if let Geometry::Mesh(m) = &mut flat.geometry {
            m.positions = Positions::from_interleaved(m.positions.as_slice().to_vec(), false);
        }
        assert_eq!(run(&flat, &good, 10).1, Err(ContourError::NoHeights));
        // A job on a dataset that no level crosses (the one level, 0, is the lowest value: every value is at or above it) gives no lines.
        let one_level = ContourParams {
            interval: 1.0e6,
            base: 0.0,
            ..good
        };
        assert_eq!(run(&dataset, &one_level, 100).1, Err(ContourError::NoLines));
    }
    #[test]
    fn a_newer_job_on_a_dataset_supersedes_the_older_whichever_ends_first() {
        let (a, b) = (grid(40, 30, 0.0), mesh(30, 25));
        let (params_a, params_b) = (
            default_params(&a, None).unwrap(),
            default_params(&b, None).unwrap(),
        );
        let other = ContourParams {
            interval: params_a.interval * 2.0,
            ..params_a.clone()
        };
        let mut contourer = Contourer::new();
        let old = contourer.start(&a, &params_a);
        let on_b = contourer.start(&b, &params_b);
        let new = contourer.start(&a, &other);
        // The older job has made a little progress when the newer starts: its next step is the end of it, with no lines.
        assert_eq!(contourer.jobs(), 3);
        assert_eq!(
            contourer.step(old, Some(&a), usize::MAX),
            Some(ContourStep::Superseded)
        );
        assert_eq!(
            contourer.jobs(),
            2,
            "a superseded job is forgotten with the step that says so"
        );
        assert_eq!(contourer.step(old, Some(&a), 10), None);
        // A job on another dataset is not touched, and the newer one gives what it would have given alone.
        assert!(matches!(
            contourer.step(on_b, Some(&b), 10),
            Some(ContourStep::Progress { .. })
        ));
        let mut done = None;
        for _ in 0..10_000 {
            match contourer.step(new, Some(&a), 100) {
                Some(ContourStep::Progress { .. }) => {}
                other => {
                    done = other;
                    break;
                }
            }
        }
        assert_eq!(done, Some(ContourStep::Done(contours_of(&a, &other))));
        assert_eq!(contourer.jobs(), 1);
    }

    #[test]
    fn an_older_job_stays_superseded_after_the_newer_one_is_over_and_a_later_job_is_not() {
        let dataset = grid(40, 30, 0.0);
        let params = default_params(&dataset, None).unwrap();
        let mut contourer = Contourer::new();
        let (old, new) = (
            contourer.start(&dataset, &params),
            contourer.start(&dataset, &params),
        );
        // The newer one ends (here, cancelled): the older one is still not the one that counts.
        assert!(contourer.cancel(new));
        assert_eq!(
            contourer.step(old, Some(&dataset), 10),
            Some(ContourStep::Superseded)
        );
        // Nothing is left over from them: a job started now is the newest, and runs to its end.
        let (_, lines) = run(&dataset, &params, 100);
        assert_eq!(lines, contours_of(&dataset, &params));
        let again = contourer.start(&dataset, &params);
        assert!(matches!(
            contourer.step(again, Some(&dataset), 10),
            Some(ContourStep::Progress { .. })
        ));
        // The dataset is removed: its jobs go, and the record of the newest with them.
        contourer.forget_dataset(dataset.id);
        assert_eq!(contourer.jobs(), 0);
        let after = contourer.start(&dataset, &params);
        assert!(matches!(
            contourer.step(after, Some(&dataset), 10),
            Some(ContourStep::Progress { .. })
        ));
    }
}
