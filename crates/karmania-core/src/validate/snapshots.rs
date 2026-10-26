//! Snapshot tests: one complete validation report per kind of dataset.
//!
//! Each fixture is built to trip checks in the structure and values groups; the
//! crs group has one check, tripped by the fixtures that name no coordinate
//! system. The report is written as pretty JSON and compared with a committed
//! file in `snapshots/`, so any change to a finding's code, wording, count,
//! example or order shows up as a diff. After an intended change, regenerate the
//! files with `KARMANIA_UPDATE_SNAPSHOTS=1 cargo test -p karmania-core snapshots`
//! and read the diff before committing it.

use std::path::PathBuf;

use super::testutil::{dataset, positions};
use super::{ValidationReport, validate};
use crate::blocks::Blocks;
use crate::column::{Column, ColumnData};
use crate::crs::{CrsRef, Units};
use crate::dataset::{Dataset, Geometry};
use crate::findings::Findings;
use crate::grid::{Grid, GridZ};
use crate::lattice::Lattice;
use crate::lines::Lines;
use crate::mesh::Mesh;
use crate::polygons::Polygons;
use crate::positions::Positions;
use crate::table::Table;
use crate::validity::Validity;

fn snapshot_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/validate/snapshots")
        .join(format!("{name}.json"))
}

/// Compares the report with the committed snapshot, or rewrites the snapshot
/// when `KARMANIA_UPDATE_SNAPSHOTS` is set.
fn assert_snapshot(name: &str, report: &ValidationReport) {
    let actual = format!("{}\n", serde_json::to_string_pretty(report).unwrap());
    let path = snapshot_path(name);
    if std::env::var_os("KARMANIA_UPDATE_SNAPSHOTS").is_some() {
        std::fs::write(&path, &actual).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("missing snapshot {}: {e}", path.display()));
    assert_eq!(
        actual, expected,
        "snapshot {name} changed; if intended, regenerate with KARMANIA_UPDATE_SNAPSHOTS=1"
    );
    // The report must also be the same every time it is made.
    assert_eq!(
        serde_json::to_string_pretty(&validate_again(name)).unwrap() + "\n",
        expected
    );
}

fn validate_again(name: &str) -> ValidationReport {
    validate(&fixture(name))
}

fn table(columns: Vec<Column>) -> Table {
    Table::from_columns(columns, &mut Findings::new()).unwrap()
}

fn all_null(name: &str, rows: usize) -> Column {
    let validity = Validity::from_flags(std::iter::repeat_n(false, rows));
    Column::new(name, ColumnData::Float64(vec![0.0; rows]), validity).unwrap()
}

fn lattice(spacing: [f64; 3], dims: [u32; 3]) -> Lattice {
    Lattice {
        origin: [0.0; 3],
        spacing,
        dims,
        rotation: 0.0,
    }
}

fn fixture(name: &str) -> Dataset {
    match name {
        "points" => {
            let nan = f64::NAN;
            let xyz = vec![
                55.0, 25.0, 0.0, //
                55.0, 25.0, 0.0, //
                nan, 1.0, 0.0, //
                10.0, 95.0, 0.0, //
                2e8, 1.0, 0.0, //
                60.0, 30.0, 0.0,
            ];
            let mut d = dataset(Geometry::Points(Positions::from_interleaved(xyz, false)));
            d.crs = Some(CrsRef::Epsg { code: 4326 });
            d.attributes = table(vec![all_null("au", 5)]);
            d
        }
        "lines" => {
            let mut d = dataset(Geometry::Lines(Lines {
                positions: positions(5),
                offsets: vec![0, 1, 4, 3, 5],
            }));
            d.vertex_attributes = Some(table(vec![all_null("depth", 4)]));
            d
        }
        "polygons" => {
            let xyz = vec![
                500_000.0,
                2_765_000.0,
                0.0, //
                500_100.0,
                2_765_000.0,
                0.0, //
                500_100.0,
                2_765_100.0,
                0.0, //
                500_000.0,
                2_765_100.0,
                0.0, //
                500_050.0,
                2_765_050.0,
                0.0, //
                500_000.0,
                2e7,
                0.0, //
                500_200.0,
                2_765_000.0,
                0.0,
            ];
            dataset(Geometry::Polygons(Polygons {
                positions: Positions::from_interleaved(xyz, false),
                ring_offsets: vec![0, 2, 5, 7],
                polygon_offsets: vec![0, 2, 2, 3],
            }))
        }
        "mesh" => {
            let mut d = dataset(Geometry::Mesh(Mesh {
                positions: positions(5),
                indices: vec![0, 1, 2, 1, 1, 2, 2, 3, 9, 3],
            }));
            d.crs = Some(CrsRef::Local {
                units: Units::Metre,
            });
            d
        }
        "grid" => {
            let grid = Grid {
                lattice: lattice([10.0, 0.0, 10.0], [4, 3, 1]),
                z: GridZ::Flat { elevation: 100.0 },
            };
            let mut d = dataset(Geometry::Grid(grid));
            let column = Column::without_nulls("elev", ColumnData::Float64(vec![1.0; 11]));
            d.attributes = table(vec![column]);
            d
        }
        "blocks" => {
            let blocks = Blocks {
                lattice: lattice([5.0; 3], [2, 2, 2]),
                ijk: Some(vec![0, 0, 0, 1, 1, 1, 0, 0, 0, 5, 5, 5, 1, 1]),
            };
            let mut d = dataset(Geometry::Blocks(blocks));
            d.crs = Some(CrsRef::Local { units: Units::Foot });
            let column = Column::without_nulls("grade", ColumnData::Float64(vec![0.5; 3]));
            d.attributes = table(vec![column]);
            d
        }
        "clean" => {
            let mut d = dataset(Geometry::Points(Positions::from_interleaved(
                vec![500_000.0, 2_765_000.0, 10.0, 500_100.0, 2_765_100.0, 12.0],
                true,
            )));
            d.crs = Some(CrsRef::Epsg { code: 32640 });
            d.attributes = table(vec![Column::without_nulls(
                "au",
                ColumnData::Float64(vec![0.1, 0.2]),
            )]);
            d
        }
        other => panic!("no fixture called {other}"),
    }
}

#[test]
fn every_kind_has_a_stable_full_report() {
    for name in [
        "points", "lines", "polygons", "mesh", "grid", "blocks", "clean",
    ] {
        assert_snapshot(name, &validate(&fixture(name)));
    }
}

#[test]
fn the_fixtures_between_them_trip_every_group() {
    let mut groups_with_findings = [false; 3];
    for name in ["points", "lines", "polygons", "mesh", "grid", "blocks"] {
        for (i, group) in validate(&fixture(name)).groups().iter().enumerate() {
            groups_with_findings[i] |= !group.findings.is_empty();
        }
    }
    assert_eq!(groups_with_findings, [true, true, true]);
}

#[test]
fn the_clean_fixture_has_no_findings_and_is_loadable() {
    let report = validate(&fixture("clean"));
    assert!(report.is_loadable() && report.findings().count() == 0);
}
