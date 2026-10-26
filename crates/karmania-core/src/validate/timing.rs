//! A timing test for validating a large dataset. Ignored by default.
//!
//! Run it in a release build, where the numbers mean something:
//! `cargo test -p karmania-core --release -- --ignored --nocapture one_million_points`
//! and record the output in `docs/perf.md`.

use std::time::Instant;

use super::{GROUPS, validate};
use crate::column::{Column, ColumnData};
use crate::crs::CrsRef;
use crate::dataset::{Dataset, DatasetId, Geometry};
use crate::findings::Findings;
use crate::positions::Positions;
use crate::table::Table;

const POINTS: usize = 1_000_000;

/// A tiny deterministic generator, so every run validates the same data.
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

/// One million points in UTM zone 40N with 5 numeric attributes.
fn build_dataset() -> Dataset {
    let mut rng = Lcg(42);
    let mut xyz = Vec::with_capacity(POINTS * 3);
    for _ in 0..POINTS {
        xyz.push(450_000.0 + (rng.next() % 100_000) as f64);
        xyz.push(2_700_000.0 + (rng.next() % 100_000) as f64);
        xyz.push((rng.next() % 500) as f64);
    }
    let columns = (0..5)
        .map(|i| {
            let values = (0..POINTS)
                .map(|_| (rng.next() % 10_000) as f64 / 100.0)
                .collect();
            Column::without_nulls(format!("attribute_{i}"), ColumnData::Float64(values))
        })
        .collect();
    let attributes = Table::from_columns(columns, &mut Findings::new()).unwrap();
    let positions = Positions::from_interleaved(xyz, true);
    let mut dataset = Dataset::new(
        DatasetId(1),
        "timing",
        None,
        Geometry::Points(positions),
        attributes,
    );
    dataset.crs = Some(CrsRef::Epsg { code: 32640 });
    dataset
}

#[test]
#[ignore = "timing test: run with --release -- --ignored --nocapture"]
fn one_million_points() {
    let dataset = build_dataset();
    for (name, check) in GROUPS {
        let start = Instant::now();
        let mut findings = Findings::new();
        check(&dataset, &mut findings);
        println!(
            "TIMING group {name:9} {:>8.1} ms  ({} findings)",
            start.elapsed().as_secs_f64() * 1e3,
            findings.len()
        );
    }
    let start = Instant::now();
    let report = validate(&dataset);
    let total = start.elapsed();
    println!(
        "TIMING validate() total {:>8.1} ms  (loadable: {})",
        total.as_secs_f64() * 1e3,
        report.is_loadable()
    );
    // Fine data: nothing to report, in both the first and the second run.
    assert!(report.is_loadable());
    #[cfg(not(debug_assertions))]
    assert!(
        total.as_secs_f64() < 5.0,
        "validation took {total:?}, the whole import budget is 5 s"
    );
}
