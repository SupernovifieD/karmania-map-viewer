//! Timings for preparing large datasets for drawing, and for classifying them. Ignored by default.
//!
//! Run them in a release build, where the numbers mean something:
//! `cargo test -p karmania-prep --release --test timing -- --ignored --nocapture`
//! and record the output in `docs/perf.md`. The data are made from a fixed seed, so every run prepares the
//! same data; making them is not timed. A dataset is prepared the way the worker does it, a job stepped
//! 100,000 at a time, and the longest step is reported besides the whole time, because the worker can
//! hear a request to stop only between steps.
//!
//! The limits asserted are the targets of section 9.6 of the phase 2 brief, which are for loading a
//! file and drawing the first frame: preparing is only a part of that, so a time over its limit is a
//! miss, and the rest of the budget is for reading the file and drawing.

// Tests may panic and expect (clippy.toml allows them in tests); the helpers of this file are outside any
// `#[test]` function, which clippy does not count as tests.
#![allow(clippy::expect_used, clippy::panic)]

use std::time::Instant;

use karmania_core::{
    Blocks, Column, ColumnData, CrsRef, Dataset, DatasetId, Findings, Geometry, Grid, GridZ,
    Lattice, Positions, Table, Validity,
};
use karmania_prep::{
    ClassBreaks, Frame, FrameSource, Method, PrepareJob, PrepareResult, PrepareStep, class_index,
    classify,
};

/// How many positions, vertices or blocks a step of the job does, as the worker does.
const BUDGET: usize = 100_000;

const UTM40: CrsRef = CrsRef::Epsg { code: 32640 };
const GEOGRAPHIC: CrsRef = CrsRef::Epsg { code: 4326 };

/// The brief's targets for loading a file to the first frame, in seconds (section 9.6).
const POINTS_LIMIT: f64 = 1.5;
const GRID_LIMIT: f64 = 1.5;
const BLOCKS_LIMIT: f64 = 3.0;
/// The brief's target for new classes to be visible, in seconds.
const RESTYLE_LIMIT: f64 = 0.3;

/// A tiny deterministic generator.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
}

fn frame(crs: CrsRef, origin: [f64; 3]) -> Frame {
    Frame {
        map_crs: crs,
        origin,
        source: FrameSource::Auto,
    }
}

fn table(columns: Vec<Column>) -> Table {
    Table::from_columns(columns, &mut Findings::new()).expect("the columns have one length")
}

fn float_column(name: &str, values: Vec<f64>) -> Column {
    Column::without_nulls(name, ColumnData::Float64(values))
}

/// What preparing took: the whole time, the steps, and the longest step.
struct Timed {
    seconds: f64,
    steps: usize,
    longest_ms: f64,
    result: PrepareResult,
}

/// Prepares `dataset` as the worker does, a step at a time.
fn prepare(dataset: &Dataset, frame: Frame, max_texture: u32) -> Timed {
    let started = Instant::now();
    let mut job = PrepareJob::new(dataset, frame, max_texture);
    let (mut steps, mut longest) = (0, 0.0_f64);
    loop {
        let step_started = Instant::now();
        let step = job.step(dataset, BUDGET);
        longest = longest.max(step_started.elapsed().as_secs_f64());
        steps += 1;
        match step {
            PrepareStep::Progress { .. } => {}
            PrepareStep::Done(result) => {
                return Timed {
                    seconds: started.elapsed().as_secs_f64(),
                    steps,
                    longest_ms: longest * 1000.0,
                    result,
                };
            }
            PrepareStep::Cancelled => panic!("the job was cancelled"),
        }
    }
}

fn report(what: &str, timed: &Timed, elements: usize) -> String {
    format!(
        "{what}: {:.0} ms in {} steps (longest {:.0} ms) for {elements} elements",
        timed.seconds * 1000.0,
        timed.steps,
        timed.longest_ms
    )
}

fn drawn(timed: &Timed) -> &karmania_prep::RenderBuffers {
    match &timed.result {
        PrepareResult::Drawn { buffers, .. } => buffers,
        PrepareResult::NotDrawn { findings } => panic!("not drawn: {findings:?}"),
    }
}

/// `count` points in UTM 40 (as `points-1m.csv`: 100 km square, heights to 500), with one grade column.
fn points_in_utm(count: usize) -> Dataset {
    let mut rng = Lcg(42);
    let (mut x, mut y, mut z) = (Vec::new(), Vec::new(), Vec::new());
    for _ in 0..count {
        x.push((450_000 + rng.next() % 100_000) as f64);
        y.push((2_700_000 + rng.next() % 100_000) as f64);
        z.push((rng.next() % 500) as f64);
    }
    let grade = (0..count)
        .map(|_| (rng.next() % 10_000) as f64 / 100.0)
        .collect();
    let positions = Positions::from_xyz(&x, &y, Some(&z), &mut Findings::new()).expect("lengths");
    Dataset::new(
        DatasetId(1),
        "points",
        Some(UTM40),
        Geometry::Points(positions),
        table(vec![float_column("grade", grade)]),
    )
}

/// `count` points in longitude and latitude inside zone 40, to be converted.
fn points_in_degrees(count: usize) -> Dataset {
    let mut rng = Lcg(43);
    let (mut x, mut y) = (Vec::new(), Vec::new());
    for _ in 0..count {
        x.push(57.0 + (rng.next() % 1_000_000) as f64 / 1_000_000.0);
        y.push(25.0 + (rng.next() % 1_000_000) as f64 / 1_000_000.0);
    }
    let positions = Positions::from_xyz(&x, &y, None, &mut Findings::new()).expect("lengths");
    Dataset::new(
        DatasetId(2),
        "points in degrees",
        Some(GEOGRAPHIC),
        Geometry::Points(positions),
        Table::empty(),
    )
}

/// A grid of 2,000 x 2,000 cells (as `grid-4m.asc`) with a value for each, one in 97 with none.
fn grid_of_4m(crs: CrsRef, origin: [f64; 2], cell: f64, elevations: bool) -> Dataset {
    let (columns, rows) = (2_000_u32, 2_000_u32);
    let values: Vec<f64> = (0..u64::from(columns) * u64::from(rows))
        .map(|i| ((i % 2_000) * 13 % 1_000) as f64 / 10.0 + (i / 2_000 * 7 % 1_000) as f64 / 10.0)
        .collect();
    let flags = (1..=values.len()).map(|n| n % 97 != 0);
    let value_column = Column::new(
        "value",
        ColumnData::Float64(values.clone()),
        Validity::from_flags(flags),
    )
    .expect("one value for each cell");
    let mut table_columns = vec![value_column];
    let z = if elevations {
        table_columns.push(float_column("elevation", values));
        GridZ::FromColumn {
            name: "elevation".into(),
        }
    } else {
        GridZ::Flat { elevation: 0.0 }
    };
    let lattice = Lattice {
        origin: [origin[0], origin[1], 0.0],
        spacing: [cell, cell, 1.0],
        dims: [columns, rows, 1],
        rotation: 0.0,
    };
    Dataset::new(
        DatasetId(3),
        "grid",
        Some(crs),
        Geometry::Grid(Grid { lattice, z }),
        table(table_columns),
    )
}

/// A dense model of 100 x 100 x 100 blocks of 10 m (as `blocks-1m.csv`), with a density.
fn blocks_of_1m() -> Dataset {
    let mut rng = Lcg(7);
    let density = (0..1_000_000)
        .map(|_| 2.0 + (rng.next() % 1_000) as f64 / 1_000.0)
        .collect();
    let lattice = Lattice {
        origin: [500_000.0, 2_765_000.0, 0.0],
        spacing: [10.0; 3],
        dims: [100, 100, 100],
        rotation: 0.0,
    };
    Dataset::new(
        DatasetId(4),
        "blocks",
        Some(UTM40),
        Geometry::Blocks(Blocks { lattice, ijk: None }),
        table(vec![float_column("density", density)]),
    )
}

fn within(what: &str, seconds: f64, limit: f64) {
    assert!(
        seconds < limit,
        "{what} took {seconds:.2} s, over the {limit} s of the brief"
    );
}

#[test]
#[ignore = "timing; run in a release build with --ignored"]
fn one_million_points_in_the_map_system() {
    let dataset = points_in_utm(1_000_000);
    let timed = prepare(
        &dataset,
        frame(UTM40, [500_000.0, 2_750_000.0, 200.0]),
        4096,
    );
    println!(
        "{}",
        report("1,000,000 points, same system", &timed, 1_000_000)
    );
    assert_eq!(drawn_len(&timed), 3_000_000);
    within("preparing 1,000,000 points", timed.seconds, POINTS_LIMIT);
}

#[test]
#[ignore = "timing; run in a release build with --ignored"]
fn one_million_points_converted_from_longitude_and_latitude() {
    let dataset = points_in_degrees(1_000_000);
    let timed = prepare(&dataset, frame(UTM40, [500_000.0, 2_790_000.0, 0.0]), 4096);
    println!(
        "{}",
        report(
            "1,000,000 points, converted from degrees",
            &timed,
            1_000_000
        )
    );
    assert_eq!(drawn_len(&timed), 3_000_000);
    within(
        "converting and preparing 1,000,000 points",
        timed.seconds,
        POINTS_LIMIT,
    );
}

fn drawn_len(timed: &Timed) -> usize {
    match drawn(timed) {
        karmania_prep::RenderBuffers::Points(p) => p.positions.len(),
        other => panic!("not points: {other:?}"),
    }
}

#[test]
#[ignore = "timing; run in a release build with --ignored"]
fn four_million_cells_as_an_image_and_as_a_surface() {
    let flat = grid_of_4m(UTM40, [500_000.0, 2_765_000.0], 10.0, false);
    let timed = prepare(&flat, frame(UTM40, [510_000.0, 2_775_000.0, 0.0]), 4096);
    println!(
        "{}",
        report("4,000,000 cells, as an image", &timed, 4_000_000)
    );
    within("placing 4,000,000 cells", timed.seconds, GRID_LIMIT);

    // A grid in longitude and latitude on the map of a zone, warped, cut into 4,096-cell textures.
    // 0.002 degrees a cell: 4 by 4 degrees, far enough from a straight line for the mesh to be cut finer.
    let degrees = grid_of_4m(GEOGRAPHIC, [57.0, 25.0], 0.002, false);
    let timed = prepare(&degrees, frame(UTM40, [500_000.0, 2_900_000.0, 0.0]), 4096);
    println!(
        "{}",
        report("4,000,000 cells, warped from degrees", &timed, 4_000_000)
    );
    within("warping 4,000,000 cells", timed.seconds, GRID_LIMIT);

    // With elevations from a column: a surface of 4,000,000 vertices and about 8,000,000 triangles.
    let surface = grid_of_4m(UTM40, [500_000.0, 2_765_000.0], 10.0, true);
    let timed = prepare(&surface, frame(UTM40, [510_000.0, 2_775_000.0, 0.0]), 4096);
    println!(
        "{}",
        report("4,000,000 cells, as a surface", &timed, 4_000_000)
    );
    within(
        "making a surface of 4,000,000 cells",
        timed.seconds,
        GRID_LIMIT,
    );
}

#[test]
#[ignore = "timing; run in a release build with --ignored"]
fn one_million_blocks() {
    let dataset = blocks_of_1m();
    let timed = prepare(
        &dataset,
        frame(UTM40, [500_500.0, 2_765_500.0, 500.0]),
        4096,
    );
    println!("{}", report("1,000,000 blocks", &timed, 1_000_000));
    match drawn(&timed) {
        karmania_prep::RenderBuffers::Blocks(b) => assert_eq!(b.centres.len(), 3_000_000),
        other => panic!("not blocks: {other:?}"),
    }
    within("preparing 1,000,000 blocks", timed.seconds, BLOCKS_LIMIT);
}

/// New classes for a column of 4,000,000 values, and the class of every cell: what a restyle waits for.
#[test]
#[ignore = "timing; run in a release build with --ignored"]
fn new_classes_for_four_million_cells() {
    let dataset = grid_of_4m(UTM40, [500_000.0, 2_765_000.0], 10.0, false);
    let column = dataset
        .attributes
        .column("value")
        .expect("the column")
        .clone();
    let mut slowest = 0.0_f64;
    for (name, method) in [
        ("equal intervals", Method::Equal),
        ("quantiles", Method::Quantile),
        ("natural breaks", Method::Jenks),
        ("categories", Method::Categories),
    ] {
        let started = Instant::now();
        let breaks = classify(&column, method, 7);
        let classified = started.elapsed().as_secs_f64();
        let breaks = breaks.unwrap_or_else(|finding| panic!("{name}: {}", finding.message));
        let started = Instant::now();
        let index = class_index(&column, &breaks);
        let indexed = started.elapsed().as_secs_f64();
        assert_eq!(index.len(), 4_000_000);
        let classes = match &breaks {
            ClassBreaks::Ranges { counts, .. } | ClassBreaks::Categories { counts, .. } => {
                counts.len()
            }
        };
        println!(
            "new classes, 4,000,000 cells, {name}: {:.0} ms to classify ({classes} classes) and {:.0} ms for the class of every cell",
            classified * 1000.0,
            indexed * 1000.0
        );
        slowest = slowest.max(classified + indexed);
    }
    within("new classes for 4,000,000 cells", slowest, RESTYLE_LIMIT);
}
