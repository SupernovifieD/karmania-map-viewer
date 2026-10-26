//! Timings for the readers on large generated files. Ignored by default.
//!
//! Run them in a release build, where the numbers mean something:
//! `cargo test -p karmania-io --release --test timing -- --ignored --nocapture`
//! and record the output in `docs/perf.md`. The data are generated from a fixed
//! seed, so every run reads the same files; generating them is not timed.

use std::fmt::Write as _;
use std::time::Instant;

use karmania_core::{CrsRef, Kind, validate};
use karmania_io::ReadOutput;
use karmania_io::asc::read_asc;
use karmania_io::csv_import::{CsvOptions, read_csv};
use karmania_io::delimited::Delimiter;
use karmania_io::geojson::read_geojson;
use karmania_io::import_job::{ImportJob, Step};
use karmania_io::mapping::{ColumnMapping, EmptyCoordinates, ImportMapping, Nodata};
use karmania_io::numbers::DecimalSeparator;
use karmania_io::obj::read_obj;
use karmania_io::roles::Role;

const COMMA: CsvOptions = CsvOptions {
    delimiter: Delimiter::Comma,
    has_header: true,
};

/// The most any single read may take. The brief asks for under 5 s to import and
/// validate a million-row CSV; the other formats get the same limit.
const LIMIT_SECONDS: f64 = 5.0;

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

fn column(source: &str, role: Role) -> ColumnMapping {
    ColumnMapping {
        source: source.to_string(),
        role,
        column_type: None,
        rename: None,
    }
}

fn mapping(kind: Kind, mut columns: Vec<ColumnMapping>) -> ImportMapping {
    columns.extend((0..5).map(|i| column(&format!("a{i}"), Role::Attribute)));
    ImportMapping {
        dataset_name: "timing".into(),
        kind,
        columns,
        nodata: Nodata {
            tokens: vec![String::new()],
            numbers: vec![-999.0],
        },
        empty_coordinates: EmptyCoordinates::Error,
        block_size: (kind == Kind::Blocks).then_some([10.0, 10.0, 10.0]),
        decimal_separator: DecimalSeparator::Point,
        crs: Some(CrsRef::Epsg { code: 32640 }),
    }
}

/// One line about a timing, after checking it against the limit.
fn report(what: &str, megabytes: f64, seconds: f64, output: &ReadOutput) -> String {
    let elements: u64 = output
        .datasets
        .iter()
        .filter_map(|d| d.element_count())
        .sum();
    assert!(!output.datasets.is_empty(), "{what} produced nothing");
    assert!(seconds < LIMIT_SECONDS, "{what} took {seconds:.2} s");
    format!(
        "{what}: {:.0} ms for {megabytes:.1} MB, {elements} elements, {} finding(s)",
        seconds * 1000.0,
        output.findings.iter().count()
    )
}

fn megabytes(text: &str) -> f64 {
    text.len() as f64 / 1_048_576.0
}

/// A CSV with `rows` rows of X, Y, Z and five attributes.
fn points_csv(rows: usize) -> String {
    let mut rng = Lcg(42);
    let mut text = String::from("X,Y,Z,a0,a1,a2,a3,a4\n");
    for _ in 0..rows {
        let _ = writeln!(
            text,
            "{},{},{},{:.2},{:.2},{:.2},{:.2},{:.2}",
            450_000 + rng.next() % 100_000,
            2_700_000 + rng.next() % 100_000,
            rng.next() % 500,
            (rng.next() % 10_000) as f64 / 100.0,
            (rng.next() % 10_000) as f64 / 100.0,
            (rng.next() % 10_000) as f64 / 100.0,
            (rng.next() % 10_000) as f64 / 100.0,
            (rng.next() % 10_000) as f64 / 100.0,
        );
    }
    text
}

#[test]
#[ignore = "timing; run in a release build with --ignored"]
fn csv_one_million_points_import_and_validation() {
    let text = points_csv(1_000_000);
    let m = mapping(
        Kind::Points,
        vec![
            column("X", Role::X),
            column("Y", Role::Y),
            column("Z", Role::Z),
        ],
    );
    let start = Instant::now();
    let output = read_csv(&text, COMMA, &m, Some("big.csv"));
    let read = start.elapsed().as_secs_f64();
    println!(
        "{}",
        report(
            "csv points (1,000,000 rows) import",
            megabytes(&text),
            read,
            &output
        )
    );

    let start = Instant::now();
    let report_all = validate(&output.datasets[0]);
    let checked = start.elapsed().as_secs_f64();
    println!(
        "csv points validation: {:.0} ms; import plus validation {:.0} ms",
        checked * 1000.0,
        (read + checked) * 1000.0
    );
    assert!(report_all.is_loadable());
    assert!(
        read + checked < LIMIT_SECONDS,
        "the brief asks for under 5 s"
    );
}

#[test]
#[ignore = "timing; run in a release build with --ignored"]
fn csv_one_million_points_in_steps() {
    let text = points_csv(1_000_000);
    let size = megabytes(&text);
    let m = mapping(
        Kind::Points,
        vec![
            column("X", Role::X),
            column("Y", Role::Y),
            column("Z", Role::Z),
        ],
    );
    let start = Instant::now();
    let mut job = ImportJob::csv(text, COMMA, m, Some("big.csv"));
    let mut steps = 0;
    let output = loop {
        match job.step(50_000) {
            Step::Progress(_) => steps += 1,
            Step::Done(output) => break output,
        }
    };
    let seconds = start.elapsed().as_secs_f64();
    println!("{steps} progress steps of 50,000 rows");
    println!(
        "{}",
        report(
            "csv points (1,000,000 rows) in steps",
            size,
            seconds,
            &output
        )
    );
}

#[test]
#[ignore = "timing; run in a release build with --ignored"]
fn csv_one_million_line_vertices() {
    let mut rng = Lcg(7);
    let mut text = String::from("Line,X,Y,Z,a0,a1,a2,a3,a4\n");
    for i in 0..1_000_000 {
        let _ = writeln!(
            text,
            "L{},{},{},{},1,2,3,4,5",
            i / 100,
            450_000 + rng.next() % 100_000,
            2_700_000 + rng.next() % 100_000,
            rng.next() % 500
        );
    }
    let m = mapping(
        Kind::Lines,
        vec![
            column("Line", Role::LineId),
            column("X", Role::X),
            column("Y", Role::Y),
            column("Z", Role::Z),
        ],
    );
    let start = Instant::now();
    let output = read_csv(&text, COMMA, &m, None);
    println!(
        "{}",
        report(
            "csv lines (1,000,000 vertices, 10,000 lines)",
            megabytes(&text),
            start.elapsed().as_secs_f64(),
            &output,
        )
    );
}

#[test]
#[ignore = "timing; run in a release build with --ignored"]
fn csv_one_million_blocks() {
    let mut text = String::from("X,Y,Z,a0,a1,a2,a3,a4\n");
    // 100 x 100 x 100 blocks, listed in a scrambled order so that they need sorting.
    let mut order: Vec<u32> = (0..1_000_000).collect();
    let mut rng = Lcg(3);
    for i in (1..order.len()).rev() {
        order.swap(i, (rng.next() as usize) % (i + 1));
    }
    for n in order {
        let (i, j, k) = (n % 100, (n / 100) % 100, n / 10_000);
        let _ = writeln!(
            text,
            "{},{},{},1,2,3,4,5",
            500_005 + 10 * i,
            2_765_005 + 10 * j,
            95 + 10 * k
        );
    }
    let m = mapping(
        Kind::Blocks,
        vec![
            column("X", Role::X),
            column("Y", Role::Y),
            column("Z", Role::Z),
        ],
    );
    let start = Instant::now();
    let output = read_csv(&text, COMMA, &m, None);
    println!(
        "{}",
        report(
            "csv blocks (1,000,000 blocks, dense, scrambled)",
            megabytes(&text),
            start.elapsed().as_secs_f64(),
            &output,
        )
    );
}

#[test]
#[ignore = "timing; run in a release build with --ignored"]
fn geojson_two_hundred_thousand_points() {
    let mut rng = Lcg(11);
    let mut text = String::from("{\"type\":\"FeatureCollection\",\"features\":[");
    for i in 0..200_000 {
        if i > 0 {
            text.push(',');
        }
        let _ = write!(
            text,
            "{{\"type\":\"Feature\",\"properties\":{{\"id\":{i},\"grade\":{:.2},\"rock\":\"r{}\"}},\"geometry\":{{\"type\":\"Point\",\"coordinates\":[{:.5},{:.5},{}]}}}}",
            (rng.next() % 10_000) as f64 / 100.0,
            rng.next() % 5,
            54.0 + (rng.next() % 600_000) as f64 / 100_000.0,
            24.0 + (rng.next() % 600_000) as f64 / 100_000.0,
            rng.next() % 500
        );
    }
    text.push_str("]}");
    let start = Instant::now();
    let output = read_geojson(&text, Some("big.geojson"));
    println!(
        "{}",
        report(
            "geojson points (200,000 features)",
            megabytes(&text),
            start.elapsed().as_secs_f64(),
            &output,
        )
    );
}

#[test]
#[ignore = "timing; run in a release build with --ignored"]
fn ascii_grid_nine_million_cells() {
    let size = 3_000;
    let mut rng = Lcg(5);
    let mut text = format!(
        "ncols {size}\nnrows {size}\nxllcorner 450000\nyllcorner 2700000\ncellsize 10\nNODATA_value -9999\n"
    );
    for _ in 0..size {
        for _ in 0..size {
            let _ = write!(text, "{} ", rng.next() % 1_000);
        }
        text.push('\n');
    }
    let start = Instant::now();
    let output = read_asc(&text, Some("big.asc"));
    println!(
        "{}",
        report(
            "ascii grid (3,000 x 3,000 cells)",
            megabytes(&text),
            start.elapsed().as_secs_f64(),
            &output,
        )
    );
}

#[test]
#[ignore = "timing; run in a release build with --ignored"]
fn obj_half_a_million_vertices() {
    let mut rng = Lcg(9);
    let mut text = String::new();
    for _ in 0..500_000 {
        let _ = writeln!(
            text,
            "v {} {} {}",
            rng.next() % 100_000,
            rng.next() % 100_000,
            rng.next() % 500
        );
    }
    for _ in 0..1_000_000 {
        let _ = writeln!(
            text,
            "f {} {} {}",
            1 + rng.next() % 500_000,
            1 + rng.next() % 500_000,
            1 + rng.next() % 500_000
        );
    }
    let start = Instant::now();
    let output = read_obj(&text, Some("big.obj"));
    println!(
        "{}",
        report(
            "obj mesh (500,000 vertices, 1,000,000 triangles)",
            megabytes(&text),
            start.elapsed().as_secs_f64(),
            &output,
        )
    );
}
