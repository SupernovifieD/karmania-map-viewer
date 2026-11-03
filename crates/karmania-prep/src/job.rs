//! Preparing a dataset for drawing as a job that does a little at a time and can be stopped.
//!
//! The renderer's buffers of a large dataset take long to make (a million points to convert, four million
//! cells to cut into triangles), and the worker that makes them has to hear a request to stop and to say how
//! far it is. A [`PrepareJob`] does one stage of the work, or a part of one, in each call to
//! [`PrepareJob::step`], and a job that is dropped or cancelled has stopped: nothing else runs.

use karmania_core::{Dataset, Finding, Findings, Geometry, GridZ, Kind};
use karmania_crs::Transformer;

use crate::blocks::{BlocksBuffers, BlocksBuilder};
use crate::drawable::{DrawStatus, drawable, not_convertible};
use crate::grid::{GridBuffers, Tile, WarpBuilder, grid_image, tiles};
use crate::lines::{LinesBuffers, lines_segments};
use crate::mesh::{MeshBuffers, mesh_triangles};
use crate::origin::Frame;
use crate::points::PointsBuffers;
use crate::polygons::{PolygonsBuffers, PolygonsFill};
use crate::project::Projector;
use crate::surface::{SurfaceBuffers, surface_positions, surface_triangles};
use crate::warp::warp_tile;

use karmania_core::{Column, FindingCode, Positions};

/// The buffers of a dataset, by kind.
#[derive(Debug, Clone, PartialEq)]
pub enum RenderBuffers {
    /// Points.
    Points(PointsBuffers),
    /// Lines.
    Lines(LinesBuffers),
    /// Polygons.
    Polygons(PolygonsBuffers),
    /// A triangle mesh.
    Mesh(MeshBuffers),
    /// A flat grid, as an image or a warped image.
    Grid(GridBuffers),
    /// A grid with elevations from a column.
    Surface(SurfaceBuffers),
    /// A block model.
    Blocks(BlocksBuffers),
}

/// What preparing a dataset came to.
#[derive(Debug, Clone, PartialEq)]
pub enum PrepareResult {
    /// The buffers, and the findings made on the way (positions that could not be converted, polygons that
    /// could only be outlined, and the like).
    Drawn {
        /// The buffers.
        buffers: RenderBuffers,
        /// The findings.
        findings: Findings,
    },
    /// The dataset cannot be drawn in this frame; the findings say why.
    NotDrawn {
        /// The reasons.
        findings: Findings,
    },
}

/// What a step did.
#[derive(Debug, Clone, PartialEq)]
pub enum PrepareStep {
    /// There is more to do, and this much is done: a number from 0 to 1 that never goes down.
    Progress {
        /// The fraction done.
        fraction: f64,
    },
    /// The job is finished. This is returned once.
    Done(PrepareResult),
    /// The job was cancelled, is finished already, or was given a dataset that is not the one it was
    /// started on: there is nothing more to do, and nothing is kept.
    Cancelled,
}

/// The stage of the work.
enum Work {
    Start,
    /// Points, lines or mesh: converting the positions.
    Positions {
        projector: Projector,
        findings: Findings,
    },
    Polygons {
        fill: Box<PolygonsFill>,
        findings: Findings,
    },
    Warp {
        transformer: Transformer,
        tiles: Vec<Tile>,
        elevation: f64,
        builder: WarpBuilder,
    },
    SurfacePositions {
        centres: Positions,
        projector: Projector,
        findings: Findings,
    },
    Blocks {
        builder: BlocksBuilder,
    },
    Spent,
}

/// A dataset being prepared for drawing in a frame. Make one with [`PrepareJob::new`], call
/// [`PrepareJob::step`] until it says [`PrepareStep::Done`] (or [`PrepareJob::cancel`], or drop it).
///
/// The job does not keep the dataset: every step is given the same one. A dataset that changes in between
/// is not noticed except by its kind.
pub struct PrepareJob {
    frame: Frame,
    max_texture_size: u32,
    kind: Kind,
    work: Work,
}

impl PrepareJob {
    /// A job that prepares `dataset` for drawing in `frame`, with textures of at most `max_texture_size`
    /// cells on a side (for a grid). Nothing is done yet.
    #[must_use]
    pub fn new(dataset: &Dataset, frame: Frame, max_texture_size: u32) -> Self {
        Self {
            frame,
            max_texture_size,
            kind: dataset.kind(),
            work: Work::Start,
        }
    }

    /// Stops the job and gives back what it holds: every later step is [`PrepareStep::Cancelled`].
    pub fn cancel(&mut self) {
        self.work = Work::Spent;
    }

    /// How many numbers the job holds, in the buffers it has made so far: 0 once it is spent.
    #[must_use]
    pub fn held(&self) -> usize {
        match &self.work {
            Work::Start | Work::Spent => 0,
            Work::Positions { projector, .. } | Work::SurfacePositions { projector, .. } => {
                projector.done() * 3
            }
            Work::Polygons { .. } | Work::Warp { .. } | Work::Blocks { .. } => 1,
        }
    }

    /// Does the next part of the work: up to `budget` positions, polygon vertices, cells or blocks (at
    /// least one), or one tile of a warped grid. `dataset` has to be the one the job was made for.
    pub fn step(&mut self, dataset: &Dataset, budget: usize) -> PrepareStep {
        if dataset.kind() != self.kind {
            self.work = Work::Spent;
            return PrepareStep::Cancelled;
        }
        let work = std::mem::replace(&mut self.work, Work::Spent);
        match work {
            Work::Spent => PrepareStep::Cancelled,
            Work::Start => match self.start(dataset) {
                Ok(Started::Done(result)) => PrepareStep::Done(result),
                Ok(Started::Work(next)) => {
                    self.work = next;
                    self.step(dataset, budget)
                }
                Err(finding) => not_drawn(finding),
            },
            Work::Positions {
                mut projector,
                mut findings,
            } => {
                let Some(positions) = dataset.geometry.positions() else {
                    return PrepareStep::Cancelled;
                };
                if !projector.advance(positions, &self.frame, budget, &mut findings) {
                    let fraction = ratio(projector.done(), positions.len()) * POSITIONS_SHARE;
                    self.work = Work::Positions {
                        projector,
                        findings,
                    };
                    return PrepareStep::Progress { fraction };
                }
                self.finish_positions(dataset, projector, findings)
            }
            Work::Polygons {
                mut fill,
                mut findings,
            } => {
                let Geometry::Polygons(polygons) = &dataset.geometry else {
                    return PrepareStep::Cancelled;
                };
                if !fill.advance(polygons, budget) {
                    let fraction =
                        POSITIONS_SHARE + (1.0 - POSITIONS_SHARE) * fill.fraction(polygons);
                    self.work = Work::Polygons { fill, findings };
                    return PrepareStep::Progress { fraction };
                }
                let buffers = fill.finish(&mut findings);
                drawn(RenderBuffers::Polygons(buffers), findings)
            }
            Work::Warp {
                transformer,
                tiles,
                elevation,
                mut builder,
            } => {
                let Geometry::Grid(grid) = &dataset.geometry else {
                    return PrepareStep::Cancelled;
                };
                let next = builder.added();
                let Some(tile) = tiles.get(next) else {
                    return PrepareStep::Cancelled;
                };
                builder.add(warp_tile(
                    &grid.lattice,
                    *tile,
                    elevation,
                    &transformer,
                    &self.frame,
                ));
                if builder.added() < tiles.len() {
                    let fraction = ratio(builder.added(), tiles.len());
                    self.work = Work::Warp {
                        transformer,
                        tiles,
                        elevation,
                        builder,
                    };
                    return PrepareStep::Progress { fraction };
                }
                let prepared = builder.finish(&grid.lattice, tiles);
                drawn(RenderBuffers::Grid(prepared.buffers), prepared.findings)
            }
            Work::SurfacePositions {
                centres,
                mut projector,
                mut findings,
            } => {
                if !projector.advance(&centres, &self.frame, budget, &mut findings) {
                    let fraction = ratio(projector.done(), centres.len()) * POSITIONS_SHARE;
                    self.work = Work::SurfacePositions {
                        centres,
                        projector,
                        findings,
                    };
                    return PrepareStep::Progress { fraction };
                }
                let Geometry::Grid(grid) = &dataset.geometry else {
                    return PrepareStep::Cancelled;
                };
                let positions = projector.finish();
                let (triangles, triangle_cell) = surface_triangles(&grid.lattice, &positions);
                drawn(
                    RenderBuffers::Surface(SurfaceBuffers {
                        positions,
                        triangles,
                        triangle_cell,
                    }),
                    findings,
                )
            }
            Work::Blocks { mut builder } => {
                let Geometry::Blocks(blocks) = &dataset.geometry else {
                    return PrepareStep::Cancelled;
                };
                if !builder.advance(blocks, &self.frame, budget) {
                    let fraction = builder.fraction();
                    self.work = Work::Blocks { builder };
                    return PrepareStep::Progress { fraction };
                }
                drawn(
                    RenderBuffers::Blocks(builder.finish(blocks)),
                    Findings::new(),
                )
            }
        }
    }
}

/// The share of the progress that converting the positions is, for the kinds that have more to do after it.
const POSITIONS_SHARE: f64 = 0.8;

/// How the job began.
enum Started {
    /// There was nothing to step through: the result.
    Done(PrepareResult),
    /// The work to step through.
    Work(Work),
}

/// `done` of `total` as a fraction from 0 to 1 (1 for nothing to do).
fn ratio(done: usize, total: usize) -> f64 {
    if total == 0 {
        1.0
    } else {
        (done as f64 / total as f64).min(1.0)
    }
}

fn drawn(buffers: RenderBuffers, findings: Findings) -> PrepareStep {
    PrepareStep::Done(PrepareResult::Drawn { buffers, findings })
}

fn not_drawn(finding: Finding) -> PrepareStep {
    let mut findings = Findings::new();
    findings.add(finding);
    PrepareStep::Done(PrepareResult::NotDrawn { findings })
}

impl PrepareJob {
    /// Decides whether the dataset is drawn, and begins.
    fn start(&self, dataset: &Dataset) -> Result<Started, Finding> {
        let says = drawable(self.frame.map_crs, dataset);
        let mut findings = Findings::new();
        for finding in says.findings {
            findings.add(finding);
        }
        let Some(own) = dataset.crs.filter(|_| says.status == DrawStatus::Drawn) else {
            return Ok(Started::Done(PrepareResult::NotDrawn { findings }));
        };
        let projector = || Projector::new(own, &self.frame);
        Ok(match &dataset.geometry {
            Geometry::Points(_)
            | Geometry::Lines(_)
            | Geometry::Polygons(_)
            | Geometry::Mesh(_) => Started::Work(Work::Positions {
                projector: projector()?,
                findings,
            }),
            Geometry::Blocks(blocks) => Started::Work(Work::Blocks {
                builder: BlocksBuilder::new(blocks),
            }),
            Geometry::Grid(grid) => match &grid.z {
                GridZ::Flat { elevation } => {
                    let image = grid_image(
                        &grid.lattice,
                        *elevation,
                        own,
                        &self.frame,
                        self.max_texture_size,
                    );
                    match image {
                        Some(prepared) => {
                            findings.extend(prepared.findings);
                            Started::Done(PrepareResult::Drawn {
                                buffers: RenderBuffers::Grid(prepared.buffers),
                                findings,
                            })
                        }
                        None => {
                            let transformer = Transformer::new(own, self.frame.map_crs)
                                .map_err(|cause| not_convertible(&cause))?;
                            let [nx, ny, _] = grid.lattice.dims;
                            Started::Work(Work::Warp {
                                transformer,
                                tiles: tiles(nx, ny, self.max_texture_size),
                                elevation: *elevation,
                                builder: WarpBuilder::new(),
                            })
                        }
                    }
                }
                GridZ::FromColumn { name } => {
                    let column: &Column = dataset
                        .attributes
                        .column(name)
                        .ok_or_else(|| elevation_column_missing(name))?;
                    findings.extend(crate::grid::layers_hidden(grid.lattice.dims[2]));
                    Started::Work(Work::SurfacePositions {
                        centres: surface_positions(&grid.lattice, column),
                        projector: projector()?,
                        findings,
                    })
                }
            },
        })
    }

    /// The positions are converted: finishes the kinds that have nothing more to do but one pass, and
    /// goes on to the polygons' triangles for the kind that has.
    fn finish_positions(
        &mut self,
        dataset: &Dataset,
        projector: Projector,
        mut findings: Findings,
    ) -> PrepareStep {
        let positions = projector.finish();
        match &dataset.geometry {
            Geometry::Points(_) => {
                drawn(RenderBuffers::Points(PointsBuffers { positions }), findings)
            }
            Geometry::Lines(lines) => {
                let (segments, segment_line) = lines_segments(lines, &positions);
                drawn(
                    RenderBuffers::Lines(LinesBuffers {
                        positions,
                        segments,
                        segment_line,
                    }),
                    findings,
                )
            }
            Geometry::Mesh(mesh) => {
                let triangles = mesh_triangles(mesh, &positions);
                drawn(
                    RenderBuffers::Mesh(MeshBuffers {
                        positions,
                        triangles,
                    }),
                    findings,
                )
            }
            Geometry::Polygons(_) => {
                self.work = Work::Polygons {
                    fill: Box::new(PolygonsFill::new(positions)),
                    findings: std::mem::take(&mut findings),
                };
                PrepareStep::Progress {
                    fraction: POSITIONS_SHARE,
                }
            }
            Geometry::Grid(_) | Geometry::Blocks(_) => PrepareStep::Cancelled,
        }
    }
}

fn elevation_column_missing(name: &str) -> Finding {
    Finding::new(
        FindingCode::GridElevationColumnMissing,
        format!(
            "The grid takes its elevations from the column {name}, which the dataset does not have."
        ),
    )
    .with_hint("Choose a column of the dataset for the elevations, or draw the grid flat.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blocks::blocks_buffers;
    use crate::grid::grid_buffers;
    use crate::lines::lines_buffers;
    use crate::mesh::mesh_buffers;
    use crate::origin::FrameSource;
    use crate::points::points_buffers;
    use crate::polygons::polygons_buffers;
    use crate::surface::surface_buffers;
    use karmania_core::{
        Blocks, ColumnData, CrsRef, DatasetId, Grid, Lattice, Lines, Mesh, Polygons, Table, Units,
    };

    const UTM40: CrsRef = CrsRef::Epsg { code: 32640 };
    const GEOGRAPHIC: CrsRef = CrsRef::Epsg { code: 4326 };

    fn frame() -> Frame {
        Frame {
            map_crs: UTM40,
            origin: [530_000.0, 2_790_000.0, 0.0],
            source: FrameSource::Auto,
        }
    }

    fn dataset(crs: CrsRef, geometry: Geometry, attributes: Table) -> Dataset {
        Dataset::new(DatasetId(1), "d", Some(crs), geometry, attributes)
    }

    /// Positions in longitude and latitude near 57.3 E, 25.2 N: `n` of them, every 9th off the Earth.
    fn geographic(n: usize) -> Positions {
        let xyz: Vec<f64> = (0..n)
            .flat_map(|i| {
                let lat = if i % 9 == 4 {
                    95.0
                } else {
                    25.0 + i as f64 * 0.005
                };
                [57.0 + i as f64 * 0.01, lat, i as f64]
            })
            .collect();
        Positions::from_interleaved(xyz, true)
    }

    fn square(x: f64, y: f64) -> [(f64, f64); 4] {
        [(x, y), (x + 0.1, y), (x + 0.1, y + 0.1), (x, y + 0.1)]
    }

    /// Polygons in longitude and latitude: `n` small squares, and a bow tie that cannot be filled.
    fn polygons(n: usize) -> Polygons {
        let (mut x, mut y, mut rings) = (Vec::new(), Vec::new(), vec![0_u32]);
        for i in 0..n {
            for (px, py) in square(57.0 + i as f64 * 0.2, 25.0) {
                x.push(px);
                y.push(py);
            }
            rings.push(x.len() as u32);
        }
        for (px, py) in [(57.0, 26.0), (57.1, 26.1), (57.1, 26.0), (57.0, 26.1)] {
            x.push(px);
            y.push(py);
        }
        rings.push(x.len() as u32);
        let polygon_offsets = (0..=rings.len() as u32 - 1).collect();
        Polygons {
            positions: Positions::from_xyz(&x, &y, None, &mut Findings::new()).unwrap(),
            ring_offsets: rings,
            polygon_offsets,
        }
    }

    fn column(name: &str, values: Vec<f64>) -> Table {
        let column = Column::without_nulls(name, ColumnData::Float64(values));
        Table::from_columns(vec![column], &mut Findings::new()).unwrap()
    }

    /// One dataset of each kind, in longitude and latitude (blocks, in the map's own system), with what
    /// the one-shot function gives for it.
    fn cases() -> Vec<(&'static str, Dataset, PrepareResult)> {
        let f = frame();
        let ok =
            |buffers: RenderBuffers, findings: Findings| PrepareResult::Drawn { buffers, findings };
        let mut cases = Vec::new();
        let points = geographic(40);
        let p = points_buffers(&points, GEOGRAPHIC, &f).unwrap();
        cases.push((
            "points",
            dataset(GEOGRAPHIC, Geometry::Points(points), Table::empty()),
            ok(RenderBuffers::Points(p.buffers), p.findings),
        ));
        let lines = Lines {
            positions: geographic(20),
            offsets: vec![0, 5, 12, 20],
        };
        let l = lines_buffers(&lines, GEOGRAPHIC, &f).unwrap();
        cases.push((
            "lines",
            dataset(GEOGRAPHIC, Geometry::Lines(lines), Table::empty()),
            ok(RenderBuffers::Lines(l.buffers), l.findings),
        ));
        let polys = polygons(6);
        let g = polygons_buffers(&polys, GEOGRAPHIC, &f).unwrap();
        cases.push((
            "polygons",
            dataset(GEOGRAPHIC, Geometry::Polygons(polys), Table::empty()),
            ok(RenderBuffers::Polygons(g.buffers), g.findings),
        ));
        let mesh = Mesh {
            positions: geographic(8),
            indices: vec![0, 1, 2, 2, 3, 5, 5, 6, 7],
        };
        let m = mesh_buffers(&mesh, GEOGRAPHIC, &f).unwrap();
        cases.push((
            "mesh",
            dataset(GEOGRAPHIC, Geometry::Mesh(mesh), Table::empty()),
            ok(RenderBuffers::Mesh(m.buffers), m.findings),
        ));
        let lattice = Lattice {
            origin: [57.0, 25.0, 0.0],
            spacing: [0.01, 0.01, 1.0],
            dims: [90, 40, 2],
            rotation: 0.0,
        };
        let warp = grid_buffers(&lattice, 5.0, GEOGRAPHIC, &f, 32).unwrap();
        let flat = Grid {
            lattice,
            z: GridZ::Flat { elevation: 5.0 },
        };
        cases.push((
            "warped grid",
            dataset(GEOGRAPHIC, Geometry::Grid(flat), Table::empty()),
            ok(RenderBuffers::Grid(warp.buffers), warp.findings),
        ));
        let surface_lattice = Lattice {
            origin: [57.0, 25.0, 0.0],
            spacing: [0.01, 0.01, 1.0],
            dims: [12, 9, 1],
            rotation: 0.0,
        };
        let z: Vec<f64> = (0..108)
            .map(|i| if i % 17 == 3 { f64::NAN } else { f64::from(i) })
            .collect();
        let table = column("z", z);
        let s =
            surface_buffers(&surface_lattice, table.column("z").unwrap(), GEOGRAPHIC, &f).unwrap();
        let grid = Grid {
            lattice: surface_lattice,
            z: GridZ::FromColumn { name: "z".into() },
        };
        cases.push((
            "surface",
            dataset(GEOGRAPHIC, Geometry::Grid(grid), table),
            ok(RenderBuffers::Surface(s.buffers), s.findings),
        ));
        let block_lattice = Lattice {
            origin: [530_000.0, 2_790_000.0, 0.0],
            spacing: [10.0, 10.0, 5.0],
            dims: [6, 5, 4],
            rotation: 20.0,
        };
        let blocks = Blocks {
            lattice: block_lattice,
            ijk: None,
        };
        let b = blocks_buffers(&blocks, UTM40, &f).unwrap();
        cases.push((
            "blocks",
            dataset(UTM40, Geometry::Blocks(blocks), Table::empty()),
            ok(RenderBuffers::Blocks(b.buffers), b.findings),
        ));
        cases
    }

    /// Steps a job to the end, and checks that the progress it reports is a number from 0 to 1 that never
    /// goes down.
    fn run(dataset: &Dataset, budget: usize) -> (PrepareResult, usize) {
        let mut job = PrepareJob::new(dataset, frame(), 32);
        let (mut last, mut steps) = (0.0_f64, 0);
        loop {
            steps += 1;
            assert!(steps < 100_000, "a budget of {budget} must move forward");
            match job.step(dataset, budget) {
                PrepareStep::Progress { fraction } => {
                    assert!(
                        (0.0..=1.0).contains(&fraction) && fraction >= last,
                        "{fraction} after {last}"
                    );
                    last = fraction;
                }
                PrepareStep::Done(result) => return (result, steps),
                PrepareStep::Cancelled => panic!("cancelled"),
            }
        }
    }

    #[test]
    fn every_kind_in_steps_of_any_size_gives_what_the_one_shot_function_gives() {
        for (name, dataset, expected) in cases() {
            for budget in [0, 1, 3, 17, 1_000_000] {
                let (result, _) = run(&dataset, budget);
                // Compared by their printed form: it gives every float so that it reads back the same, and
                // two buffers with a NaN in the same place (a position that could not be converted) are not
                // `==`, since NaN is not equal to itself.
                assert_eq!(
                    format!("{result:?}"),
                    format!("{expected:?}"),
                    "{name}, budget {budget}"
                );
            }
        }
    }

    #[test]
    fn a_small_budget_takes_more_steps_and_a_warped_grid_takes_a_step_for_each_tile() {
        let all = cases();
        let steps = |name: &str, budget| {
            let (_, dataset, _) = all.iter().find(|c| c.0 == name).unwrap();
            run(dataset, budget).1
        };
        assert!(steps("points", 5) >= 8, "40 points, 5 at a time");
        assert_eq!(steps("points", 1_000_000), 1, "one step does it all");
        assert!(steps("blocks", 7) >= 17, "120 blocks, 7 at a time");
        // 90 by 40 cells in tiles of 32: 3 columns and 2 rows.
        assert_eq!(steps("warped grid", 1), 6);
    }

    #[test]
    fn a_dataset_that_cannot_be_drawn_is_done_at_once_with_the_reason() {
        let lattice = Lattice {
            origin: [0.0; 3],
            spacing: [1.0; 3],
            dims: [2, 2, 2],
            rotation: 0.0,
        };
        let in_another_zone = dataset(
            CrsRef::Epsg { code: 32641 },
            Geometry::Blocks(Blocks { lattice, ijk: None }),
            Table::empty(),
        );
        let unknown = dataset(
            CrsRef::Epsg { code: 99_999 },
            Geometry::Points(geographic(3)),
            Table::empty(),
        );
        let local = dataset(
            CrsRef::Local {
                units: Units::Metre,
            },
            Geometry::Points(geographic(3)),
            Table::empty(),
        );
        let mut no_system = dataset(UTM40, Geometry::Points(geographic(3)), Table::empty());
        no_system.crs = None;
        for (d, code) in [
            (&in_another_zone, "display.blocks.other_crs"),
            (&unknown, "display.crs.not_convertible"),
            (&local, "display.crs.not_convertible"),
            (&no_system, "crs.missing"),
        ] {
            let mut job = PrepareJob::new(d, frame(), 4096);
            let PrepareStep::Done(PrepareResult::NotDrawn { findings }) = job.step(d, 10) else {
                panic!("{code}: not done at once");
            };
            assert_eq!(findings.as_slice()[0].code.as_str(), code);
            assert_eq!(job.step(d, 10), PrepareStep::Cancelled, "spent");
        }
    }

    #[test]
    fn the_findings_of_drawability_come_with_the_buffers() {
        let feet = CrsRef::Local { units: Units::Foot };
        let metres = CrsRef::Local {
            units: Units::Metre,
        };
        let d = dataset(
            feet,
            Geometry::Points(Positions::from_interleaved(vec![10.0, 20.0, 0.0], false)),
            Table::empty(),
        );
        let on_metres = Frame {
            map_crs: metres,
            origin: [0.0; 3],
            source: FrameSource::User,
        };
        let mut job = PrepareJob::new(&d, on_metres, 4096);
        let PrepareStep::Done(PrepareResult::Drawn { buffers, findings }) = job.step(&d, 10) else {
            panic!("not drawn");
        };
        assert_eq!(
            findings.as_slice()[0].code.as_str(),
            "display.crs.local_grids_assumed"
        );
        assert_eq!(
            buffers,
            RenderBuffers::Points(PointsBuffers {
                positions: vec![3.048, 6.096, 0.0]
            })
        );
    }

    #[test]
    fn a_grid_whose_elevation_column_is_gone_is_not_drawn() {
        let lattice = Lattice {
            origin: [0.0; 3],
            spacing: [1.0; 3],
            dims: [2, 2, 1],
            rotation: 0.0,
        };
        let grid = Grid {
            lattice,
            z: GridZ::FromColumn { name: "z".into() },
        };
        let d = dataset(UTM40, Geometry::Grid(grid), Table::empty());
        let PrepareStep::Done(PrepareResult::NotDrawn { findings }) =
            PrepareJob::new(&d, frame(), 4096).step(&d, 10)
        else {
            panic!("not stopped");
        };
        assert_eq!(
            findings.as_slice()[0].code.as_str(),
            "grid.elevation_column.missing"
        );
    }

    #[test]
    fn cancelling_stops_the_work_and_gives_back_what_was_made() {
        let all = cases();
        let (_, points, _) = all.iter().find(|c| c.0 == "points").unwrap();
        let mut job = PrepareJob::new(points, frame(), 4096);
        assert!(matches!(job.step(points, 10), PrepareStep::Progress { .. }));
        assert!(job.held() > 0, "ten positions are made");
        job.cancel();
        assert_eq!(job.held(), 0);
        assert_eq!(job.step(points, 10), PrepareStep::Cancelled);
        // A job that is finished has nothing more to give either.
        let mut done = PrepareJob::new(points, frame(), 4096);
        assert!(matches!(done.step(points, 1_000), PrepareStep::Done(_)));
        assert_eq!(done.step(points, 1_000), PrepareStep::Cancelled);
        // So does one given a dataset of another kind.
        let (_, grid, _) = all.iter().find(|c| c.0 == "warped grid").unwrap();
        let mut wrong = PrepareJob::new(points, frame(), 4096);
        assert_eq!(wrong.step(grid, 10), PrepareStep::Cancelled);
    }
}
