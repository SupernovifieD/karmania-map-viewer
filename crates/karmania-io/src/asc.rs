//! Reading ESRI ASCII grid files (`.asc`).
//!
//! A grid file is a short header with one `name value` pair per line, followed by
//! the cell values, row by row, starting with the northernmost row. The header
//! gives the number of columns and rows (`ncols`, `nrows`), the position of the
//! lower-left cell (`xllcorner` and `yllcorner`, or `xllcenter` and `yllcenter`),
//! the cell size (`cellsize`, or `dx` and `dy`) and, optionally, the value that
//! means "no data" (`NODATA_value`). Names are not case sensitive.

use std::collections::{BTreeMap, BTreeSet};

use karmania_core::text::format_count;
use karmania_core::{
    Column, ColumnData, Dataset, DatasetId, Finding, FindingCode, Findings, Geometry, Grid, GridZ,
    Lattice, Location, Provenance, Table, Validity, check_size,
};

use crate::numbers::{DecimalSeparator, is_missing_token, parse_number};
use crate::output::{ReadOutput, Tally, join_and};

/// The header of an ESRI ASCII grid.
#[derive(Debug, Clone, PartialEq)]
pub struct AscHeader {
    /// Cells from west to east.
    pub columns: u32,
    /// Cells from south to north.
    pub rows: u32,
    /// The outer corner of the lower-left (south-west) cell, in CRS units.
    pub origin: [f64; 2],
    /// Cell width (west to east) and height (south to north), in CRS units.
    pub cell_size: [f64; 2],
    /// The value that means "no data", if the header gives one.
    pub nodata: Option<f64>,
    /// How many lines the header takes, blank ones included: the cell values start
    /// on the line after (counting from 0, at this index).
    pub header_lines: usize,
}

/// The names that can start a header line.
const KEYS: [&str; 10] = [
    "ncols",
    "nrows",
    "xllcorner",
    "xllcenter",
    "yllcorner",
    "yllcenter",
    "cellsize",
    "dx",
    "dy",
    "nodata_value",
];

/// Pairs of names that cannot both be given.
const CONFLICTS: [(&str, &str); 4] = [
    ("xllcorner", "xllcenter"),
    ("yllcorner", "yllcenter"),
    ("cellsize", "dx"),
    ("cellsize", "dy"),
];

fn invalid(findings: &mut Findings, line: Option<u64>, message: String) {
    let finding = Finding::new(FindingCode::AscHeaderInvalid, message)
        .with_hint("Each header line is a name and a number, for example \"ncols 4\".");
    findings.add(match line {
        Some(line) => finding.at(Location::default().with_line(line)),
        None => finding,
    });
}

/// At most 60 characters of `text`, for messages.
fn shorten(text: &str) -> String {
    text.chars().take(60).collect()
}

/// Reads the header of an ASCII grid.
///
/// Returns `None`, with errors in `findings`, if the text is empty, a header line
/// is not understood, a number is unusable, or something that is needed is
/// missing. Every problem found is reported, not just the first.
pub fn read_header(text: &str, findings: &mut Findings) -> Option<AscHeader> {
    let text = text.trim_start_matches('\u{feff}');
    if text.trim().is_empty() {
        findings.add(
            Finding::new(FindingCode::FileEmpty, "The file has no data in it.")
                .with_hint("Check that you chose the right file."),
        );
        return None;
    }
    let mut values: BTreeMap<&'static str, f64> = BTreeMap::new();
    // Names that appeared, even with an unusable value, so they are not also
    // reported as missing.
    let mut present: BTreeSet<&'static str> = BTreeSet::new();
    let mut ok = true;
    let mut header_lines = text.lines().count();
    for (index, line) in text.lines().enumerate() {
        let number = index as u64 + 1;
        let mut tokens = line.split_ascii_whitespace();
        let Some(first) = tokens.next() else { continue };
        if parse_number(first, DecimalSeparator::Point).is_some() {
            header_lines = index;
            break;
        }
        let word = first.to_ascii_lowercase();
        let Some(key) = KEYS.iter().copied().find(|k| *k == word) else {
            ok = false;
            invalid(
                findings,
                Some(number),
                format!(
                    "The grid header has a line that is not understood: \"{}\".",
                    shorten(line.trim())
                ),
            );
            continue;
        };
        present.insert(key);
        let (value, extra) = (tokens.next(), tokens.next());
        match value.and_then(|t| parse_number(t, DecimalSeparator::Point)) {
            Some(v) if extra.is_none() => {
                if values.insert(key, v).is_some() {
                    ok = false;
                    invalid(
                        findings,
                        Some(number),
                        format!("The grid header gives {key} more than once."),
                    );
                }
            }
            _ => {
                ok = false;
                invalid(
                    findings,
                    Some(number),
                    format!(
                        "The grid header has no usable number for {key}: \"{}\".",
                        shorten(line.trim().get(first.len()..).unwrap_or("").trim())
                    ),
                );
            }
        }
    }

    for (a, b) in CONFLICTS {
        if values.contains_key(a) && values.contains_key(b) {
            ok = false;
            invalid(
                findings,
                None,
                format!("The grid header gives both {a} and {b}; it should give only one."),
            );
        }
    }
    let has = |key: &str| present.contains(key);
    let mut missing: Vec<&str> = Vec::new();
    for (needed, name) in [(has("ncols"), "ncols"), (has("nrows"), "nrows")] {
        if !needed {
            missing.push(name);
        }
    }
    if !has("xllcorner") && !has("xllcenter") {
        missing.push("xllcorner or xllcenter");
    }
    if !has("yllcorner") && !has("yllcenter") {
        missing.push("yllcorner or yllcenter");
    }
    if !has("cellsize") && !(has("dx") && has("dy")) {
        missing.push("cellsize (or dx and dy)");
    }
    if !missing.is_empty() {
        ok = false;
        findings.add(
            Finding::new(
                FindingCode::AscHeaderMissing,
                format!("The grid header is missing {}.", join_and(&missing)),
            )
            .with_hint(
                "A grid file starts with ncols, nrows, xllcorner (or xllcenter), yllcorner (or yllcenter) and cellsize.",
            ),
        );
    }

    let mut count = |key: &str| -> Option<u32> {
        let v = *values.get(key)?;
        if v.fract() == 0.0 && (1.0..=f64::from(u32::MAX)).contains(&v) {
            Some(v as u32)
        } else {
            ok = false;
            invalid(
                findings,
                None,
                format!(
                    "The grid header gives {key} as {v}; it should be a whole number of 1 or more."
                ),
            );
            None
        }
    };
    let columns = count("ncols");
    let rows = count("nrows");
    let mut size = |key: &str| -> Option<f64> {
        let v = *values.get(key)?;
        if v > 0.0 {
            Some(v)
        } else {
            ok = false;
            invalid(
                findings,
                None,
                format!("The grid header gives {key} as {v}; it should be greater than 0."),
            );
            None
        }
    };
    let cell = match values.get("cellsize") {
        Some(_) => size("cellsize").map(|s| [s, s]),
        None => size("dx").zip(size("dy")).map(|(dx, dy)| [dx, dy]),
    };
    if !ok {
        return None;
    }
    let (columns, rows, cell_size) = (columns?, rows?, cell?);
    // A "center" position is the middle of the lower-left cell.
    let corner = |corner: &str, center: &str, half: f64| {
        values
            .get(corner)
            .copied()
            .or_else(|| values.get(center).map(|c| c - half))
    };
    let origin = [
        corner("xllcorner", "xllcenter", cell_size[0] / 2.0)?,
        corner("yllcorner", "yllcenter", cell_size[1] / 2.0)?,
    ];
    Some(AscHeader {
        columns,
        rows,
        origin,
        cell_size,
        nodata: values.get("nodata_value").copied(),
        header_lines,
    })
}

/// The name of the column that holds the cell values.
const VALUE_COLUMN: &str = "value";

/// Whether `value` is the header's "no data" value. Values written with fewer
/// digits than a huge nodata value (-3.4e38 for single precision floats) still
/// count.
fn is_nodata(value: f64, nodata: Option<f64>) -> bool {
    nodata.is_some_and(|nodata| {
        value == nodata || (nodata.abs() > 1e30 && (value - nodata).abs() <= nodata.abs() * 1e-6)
    })
}

/// Reads an ESRI ASCII grid into a grid dataset.
///
/// The cell values go into one column, `value`, in lattice order: the first row
/// of the file is the northernmost, so the rows are put in south-to-north order.
/// Cells with the header's nodata value, or a word such as `NaN`, are null and
/// counted; values that are not numbers are null and counted separately. The
/// number of values must be `ncols` times `nrows`. The coordinate system is left
/// unset (a `.prj` file next to the grid may give it), and the cell elevations
/// are flat at 0 until the user says the values are elevations.
#[must_use]
pub fn read_asc(text: &str, file_name: Option<&str>) -> ReadOutput {
    let mut findings = Findings::new();
    let dataset = read(text, file_name, &mut findings);
    ReadOutput {
        datasets: if findings.has_errors() {
            Vec::new()
        } else {
            dataset.into_iter().collect()
        },
        findings,
    }
}

fn read(text: &str, file_name: Option<&str>, findings: &mut Findings) -> Option<Dataset> {
    let header = read_header(text, findings)?;
    let (columns, rows) = (header.columns as usize, header.rows as usize);
    let expected = u64::from(header.columns) * u64::from(header.rows);
    if !check_size(Some(expected), "cells", findings) {
        return None;
    }
    let expected = expected as usize;
    let mut values = vec![0.0f64; expected];
    let mut valid = vec![true; expected];
    let mut no_data = Tally::new(Finding::new(
        FindingCode::AscValuesNodata,
        "Some cells have no data, so they were left empty.",
    ));
    let mut unreadable = Tally::new(
        Finding::new(
            FindingCode::AscValuesUnreadable,
            "Some cells could not be read as numbers, so they were left empty.",
        )
        .with_hint("Check the file for stray text among the values."),
    );
    let mut seen = 0usize;
    for (index, line) in text.lines().enumerate().skip(header.header_lines) {
        for token in line.split_ascii_whitespace() {
            let n = seen;
            seen += 1;
            if n >= expected {
                continue;
            }
            // The file lists the northernmost row first; the lattice starts in the south.
            let (row, column) = (n / columns, n % columns);
            let south_row = rows - 1 - row;
            let slot = south_row * columns + column;
            let at = Location::default().with_line(index as u64 + 1).with_cell([
                column as u32,
                south_row as u32,
                0,
            ]);
            match parse_number(token, DecimalSeparator::Point) {
                Some(v) if !is_nodata(v, header.nodata) => values[slot] = v,
                Some(_) => {
                    valid[slot] = false;
                    no_data.hit(at);
                }
                None if is_missing_token(token) => {
                    valid[slot] = false;
                    no_data.hit(at);
                }
                None => {
                    valid[slot] = false;
                    unreadable.hit(at);
                }
            }
        }
    }
    if seen != expected {
        findings.add(
            Finding::new(
                FindingCode::AscValuesCount,
                format!(
                    "The grid has {} values, but its header says {} x {} = {}.",
                    format_count(seen as u64),
                    format_count(u64::from(header.columns)),
                    format_count(u64::from(header.rows)),
                    format_count(expected as u64),
                ),
            )
            .with_hint("Check that ncols and nrows in the header match the values."),
        );
        return None;
    }
    for tally in [unreadable, no_data] {
        if let Some(finding) = tally.into_finding() {
            findings.add(finding);
        }
    }
    let column = Column::new(
        VALUE_COLUMN,
        ColumnData::Float64(values),
        Validity::from_flags(valid),
    )
    .ok()?;
    let attributes = Table::from_columns(vec![column], findings)?;
    let grid = Grid {
        lattice: Lattice {
            origin: [header.origin[0], header.origin[1], 0.0],
            spacing: [header.cell_size[0], header.cell_size[1], 1.0],
            dims: [header.columns, header.rows, 1],
            rotation: 0.0,
        },
        z: GridZ::Flat { elevation: 0.0 },
    };
    let name = file_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or("grid")
        .to_string();
    let mut dataset = Dataset::new(DatasetId(0), name, None, Geometry::Grid(grid), attributes);
    dataset.provenance = Provenance {
        source_file_name: file_name.map(str::to_string),
    };
    Some(dataset)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;

    fn header(text: &str) -> (Option<AscHeader>, Findings) {
        let mut findings = Findings::new();
        (read_header(text, &mut findings), findings)
    }

    fn codes(findings: &Findings) -> Vec<&'static str> {
        findings.iter().map(|f| f.code.as_str()).collect()
    }

    fn messages(findings: &Findings) -> Vec<&str> {
        findings.iter().map(|f| f.message.as_str()).collect()
    }

    #[test]
    fn the_sample_header_is_read() {
        let (h, findings) = header(&fixtures::text("grid.asc"));
        assert!(findings.is_empty());
        assert_eq!(
            h.unwrap(),
            AscHeader {
                columns: 4,
                rows: 3,
                origin: [500_000.0, 2_765_000.0],
                cell_size: [10.0, 10.0],
                nodata: Some(-9999.0),
                header_lines: 6,
            }
        );
    }

    #[test]
    fn a_centre_position_is_moved_to_the_corner_of_the_cell() {
        let text = "ncols 2\nnrows 2\nxllcenter 505\nyllcorner 7\ncellsize 10\n1 2\n3 4\n";
        let h = header(text).0.unwrap();
        assert_eq!(h.origin, [500.0, 7.0]);
        let text = "ncols 2\nnrows 2\nxllcenter 505\nyllcenter 2.5\ndx 10\ndy 5\n";
        let h = header(text).0.unwrap();
        assert_eq!((h.origin, h.cell_size), ([500.0, 0.0], [10.0, 5.0]));
    }

    #[test]
    fn names_are_not_case_sensitive_and_spacing_and_line_endings_do_not_matter() {
        let text = "\u{feff}NCOLS\t3\r\n\r\nNrows   2\r\nXLLCORNER -1.5e2\r\nyllCorner 0\r\nCellSize 1E1\r\nnodata_VALUE -3.4028234663852886e+38\r\n1 2 3\r\n4 5 6\r\n";
        let (h, findings) = header(text);
        assert!(findings.is_empty());
        let h = h.unwrap();
        assert_eq!(
            (h.columns, h.rows, h.origin, h.cell_size),
            (3, 2, [-150.0, 0.0], [10.0, 10.0])
        );
        assert_eq!(h.nodata, Some(-3.402_823_466_385_288_6e38));
        // The blank line is part of the header: the values start on line index 7.
        assert_eq!(h.header_lines, 7);
    }

    #[test]
    fn without_a_nodata_line_there_is_no_nodata_value() {
        let h = header("ncols 1\nnrows 1\nxllcorner 0\nyllcorner 0\ncellsize 1\n5\n").0;
        assert_eq!(h.unwrap().nodata, None);
    }

    #[test]
    fn a_file_with_only_a_header_has_a_header_and_no_values() {
        let h = header("ncols 1\nnrows 1\nxllcorner 0\nyllcorner 0\ncellsize 1")
            .0
            .unwrap();
        assert_eq!(h.header_lines, 5);
    }

    #[test]
    fn everything_missing_is_reported_in_one_message() {
        let (h, findings) = header("1 2 3\n4 5 6\n");
        assert!(h.is_none());
        assert_eq!(codes(&findings), ["asc.header.missing"]);
        assert_eq!(
            messages(&findings),
            [
                "The grid header is missing ncols, nrows, xllcorner or xllcenter, yllcorner or yllcenter and cellsize (or dx and dy)."
            ]
        );
        let (_, findings) = header("ncols 2\nnrows 2\nxllcorner 0\nyllcenter 0\ndx 5\n");
        assert_eq!(
            messages(&findings),
            ["The grid header is missing cellsize (or dx and dy)."]
        );
    }

    #[test]
    fn empty_text_is_an_empty_file() {
        for text in ["", "  \n \n", "\u{feff}"] {
            let (h, findings) = header(text);
            assert!(h.is_none());
            assert_eq!(codes(&findings), ["file.empty"], "{text:?}");
        }
    }

    #[test]
    fn unusable_lines_are_reported_with_their_line_and_all_at_once() {
        let text =
            "ncols 4.5\nnrows\nxllcorner abc\nyllcorner 0 1\ncellsize 0\nBYTEORDER LSBFIRST\n";
        let (h, findings) = header(text);
        assert!(h.is_none());
        let lines: Vec<_> = findings
            .iter()
            .map(|f| f.examples.first().and_then(|l| l.line))
            .collect();
        assert_eq!(
            messages(&findings),
            [
                "The grid header has no usable number for nrows: \"\".",
                "The grid header has no usable number for xllcorner: \"abc\".",
                "The grid header has no usable number for yllcorner: \"0 1\".",
                "The grid header has a line that is not understood: \"BYTEORDER LSBFIRST\".",
                "The grid header gives ncols as 4.5; it should be a whole number of 1 or more.",
                "The grid header gives cellsize as 0; it should be greater than 0.",
            ]
        );
        assert_eq!(lines, [Some(2), Some(3), Some(4), Some(6), None, None]);
        assert!(codes(&findings).iter().all(|c| *c == "asc.header.invalid"));
    }

    #[test]
    fn a_name_given_twice_is_reported_at_its_second_line() {
        let text = "ncols 2\nncols 3\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\n";
        let (h, findings) = header(text);
        assert!(h.is_none());
        assert_eq!(
            messages(&findings),
            ["The grid header gives ncols more than once."]
        );
        assert_eq!(findings.as_slice()[0].examples[0].line, Some(2));
    }

    #[test]
    fn counts_and_sizes_that_make_no_sense_are_rejected() {
        for (key, value) in [
            ("ncols", "0"),
            ("ncols", "-3"),
            ("ncols", "2.5"),
            ("ncols", "99999999999"),
            ("nrows", "0"),
            ("cellsize", "-1"),
            ("cellsize", "0"),
        ] {
            let text = [
                ("ncols", "2"),
                ("nrows", "2"),
                ("xllcorner", "0"),
                ("yllcorner", "0"),
                ("cellsize", "1"),
            ]
            .map(|(k, v)| format!("{k} {}", if k == key { value } else { v }))
            .join("\n");
            let (h, findings) = header(&text);
            assert!(h.is_none(), "{key} {value}");
            assert_eq!(codes(&findings), ["asc.header.invalid"], "{key} {value}");
        }
    }

    #[test]
    fn giving_both_a_corner_and_a_centre_or_a_cell_size_and_dx_is_a_conflict() {
        let base = "ncols 2\nnrows 2\nyllcorner 0\n";
        for extra in [
            "xllcorner 0\nxllcenter 0\ncellsize 1",
            "xllcorner 0\ncellsize 1\ndx 1",
            "xllcorner 0\ncellsize 1\ndy 1",
        ] {
            let (h, findings) = header(&format!("{base}{extra}\n"));
            assert!(h.is_none(), "{extra}");
            assert_eq!(codes(&findings), ["asc.header.invalid"], "{extra}");
            assert!(findings.as_slice()[0].message.contains("both"));
        }
    }

    #[test]
    fn long_lines_are_cut_in_messages_and_odd_numbers_do_not_panic() {
        let long = "x".repeat(10_000);
        let (h, findings) = header(&format!("{long}\n"));
        assert!(h.is_none());
        assert!(findings.as_slice()[0].message.len() < 200);
        let (h, _) =
            header("ncols 1e308\nnrows 1\nxllcorner 1e308\nyllcorner -1e308\ncellsize 1e-320\n");
        assert!(h.is_none());
        let h = header("ncols 1\nnrows 1\nxllcorner 1e308\nyllcorner -1e308\ncellsize 1e-320\n").0;
        assert_eq!(h.unwrap().cell_size, [1e-320, 1e-320]);
    }

    use karmania_core::{Kind, Value as Cell};

    /// A grid file with the given size, extra header lines and body.
    fn grid_file(columns: u32, rows: u32, extra_header: &str, body: &str) -> String {
        format!(
            "ncols {columns}\nnrows {rows}\nxllcorner 100\nyllcorner 200\ncellsize 5\n{extra_header}{body}\n"
        )
    }

    fn values(d: &Dataset) -> Vec<Option<f64>> {
        let column = d.attributes.column("value").unwrap();
        (0..column.len())
            .map(|i| match column.get(i) {
                Some(Cell::Float64(v)) => Some(v),
                None => None,
                other => panic!("unexpected {other:?}"),
            })
            .collect()
    }

    fn grid_of(d: &Dataset) -> &Grid {
        let Geometry::Grid(g) = &d.geometry else {
            panic!("not a grid")
        };
        g
    }

    #[test]
    fn the_sample_becomes_a_grid_with_the_southern_row_first() {
        let out = read_asc(&fixtures::text("grid.asc"), Some("grid.asc"));
        let d = &out.datasets[0];
        assert_eq!(
            (d.name.as_str(), d.kind(), d.has_z(), d.element_count()),
            ("grid.asc", Kind::Grid, false, Some(12))
        );
        assert_eq!(d.crs, None);
        assert_eq!(d.provenance.source_file_name.as_deref(), Some("grid.asc"));
        let g = grid_of(d);
        assert_eq!(g.lattice.dims, [4, 3, 1]);
        assert_eq!(g.lattice.origin, [500_000.0, 2_765_000.0, 0.0]);
        assert_eq!(g.lattice.spacing, [10.0, 10.0, 1.0]);
        assert_eq!(g.z, GridZ::Flat { elevation: 0.0 });
        // The last row of the file is the first row of the grid.
        assert_eq!(
            values(d),
            [
                Some(30.0),
                Some(31.0),
                Some(32.0),
                Some(33.0),
                Some(20.0),
                Some(21.0),
                None,
                Some(23.0),
                Some(10.0),
                Some(11.0),
                Some(12.0),
                Some(13.0),
            ]
        );
        assert_eq!(codes(&out.findings), ["asc.values.nodata"]);
        // The one nodata cell is on file line 8, column 3 of 4, in the middle row.
        let f = &out.findings.as_slice()[0];
        assert_eq!(
            (f.count, f.examples[0].line, f.examples[0].cell),
            (1, Some(8), Some([2, 1, 0]))
        );
        // The grid is otherwise valid; the coordinate system comes from the wizard
        // or a .prj file.
        let report = karmania_core::validate(d);
        let problems: Vec<_> = report.findings().map(|f| f.code.as_str()).collect();
        assert_eq!(problems, ["crs.missing"]);
    }

    #[test]
    fn a_centre_registered_grid_is_moved_to_the_corner() {
        let text = "ncols 2\nnrows 1\nxllcenter 105\nyllcenter 202.5\ncellsize 5\n1 2\n";
        let out = read_asc(text, None);
        assert_eq!(
            grid_of(&out.datasets[0]).lattice.origin,
            [102.5, 200.0, 0.0]
        );
        assert_eq!(out.datasets[0].name, "grid");
    }

    #[test]
    fn values_may_be_split_across_lines_any_way_and_lines_end_any_way() {
        let text = "ncols 3\r\nnrows 2\r\nxllcorner 0\r\nyllcorner 0\r\ncellsize 1\r\n1 2\r\n3\t4  5   \r\n\r\n6\r\n\r\n";
        let out = read_asc(text, None);
        assert!(out.findings.is_empty());
        // Rows 1 2 3 and 4 5 6 from the north, so the grid starts with 4 5 6.
        assert_eq!(
            values(&out.datasets[0]),
            [4.0, 5.0, 6.0, 1.0, 2.0, 3.0].map(Some)
        );
    }

    #[test]
    fn the_wrong_number_of_values_is_an_error_with_both_numbers() {
        let cases = [
            (grid_file(3, 2, "", "1 2 3\n4 5"), "5", "3 x 2 = 6"),
            (grid_file(2, 2, "", "1 2\n3 4\n5"), "5", "2 x 2 = 4"),
            (grid_file(2, 2, "", ""), "0", "2 x 2 = 4"),
        ];
        for (text, seen, expected) in cases {
            let out = read_asc(&text, None);
            assert!(out.datasets.is_empty(), "{text}");
            assert_eq!(codes(&out.findings), ["asc.values.count"], "{text}");
            assert_eq!(
                out.findings.as_slice()[0].message,
                format!("The grid has {seen} values, but its header says {expected}.")
            );
        }
        // The header with no values at all (not even a trailing newline).
        let out = read_asc(
            "ncols 1\nnrows 1\nxllcorner 0\nyllcorner 0\ncellsize 1",
            None,
        );
        assert_eq!(codes(&out.findings), ["asc.values.count"]);
    }

    #[test]
    fn words_for_no_data_and_unreadable_values_are_counted_apart() {
        let out = read_asc(
            &grid_file(3, 3, "", "1 abc 1,5\n1e999 0x10 NaN\nnan NA -"),
            None,
        );
        assert_eq!(
            codes(&out.findings),
            ["asc.values.unreadable", "asc.values.nodata"]
        );
        let counts: Vec<_> = out.findings.iter().map(|f| f.count).collect();
        assert_eq!(counts, [4, 4]);
        // Only the 1 is a number; it is in the northernmost row, so the last row of the grid.
        let v = values(&out.datasets[0]);
        assert_eq!(v.iter().flatten().count(), 1);
        assert_eq!(v[6], Some(1.0));
        let lines: Vec<_> = out.findings.as_slice()[0]
            .examples
            .iter()
            .map(|l| l.line)
            .collect();
        assert_eq!(lines, [Some(6), Some(6), Some(7), Some(7)]);
    }

    #[test]
    fn the_nodata_value_matches_however_it_is_written() {
        let out = read_asc(
            &grid_file(
                4,
                1,
                "NODATA_value -9999\n",
                "-9999 -9999.0 -9999.5 -9.999e3",
            ),
            None,
        );
        assert_eq!(values(&out.datasets[0]), [None, None, Some(-9999.5), None]);

        // A huge nodata value written with fewer digits still matches.
        let out = read_asc(
            &grid_file(
                3,
                1,
                "NODATA_value -3.4028234663852886e+38\n",
                "-3.4028235e+38 5 -3.4e38",
            ),
            None,
        );
        assert_eq!(values(&out.datasets[0]), [None, Some(5.0), Some(-3.4e38)]);
    }

    #[test]
    fn without_a_nodata_line_every_number_is_a_value() {
        let out = read_asc(&grid_file(2, 1, "", "-9999 7"), None);
        assert!(out.findings.is_empty());
        assert_eq!(values(&out.datasets[0]), [Some(-9999.0), Some(7.0)]);
    }

    #[test]
    fn extreme_values_are_kept() {
        let out = read_asc(&grid_file(3, 1, "", "1e300 -1e-300 5e-324"), None);
        assert_eq!(
            values(&out.datasets[0]),
            [Some(1e300), Some(-1e-300), Some(5e-324)]
        );
    }

    #[test]
    fn a_grid_that_is_too_big_is_refused_before_anything_is_allocated() {
        for (columns, rows) in [(20_000, 20_000), (u32::MAX, u32::MAX)] {
            let out = read_asc(&grid_file(columns, rows, "", "1 2 3"), None);
            assert!(out.datasets.is_empty());
            assert_eq!(
                codes(&out.findings),
                ["dataset.too_large"],
                "{columns} x {rows}"
            );
        }
    }

    #[test]
    fn a_header_problem_gives_no_dataset_and_no_value_findings() {
        let out = read_asc("ncols 2\nnrows 2\n1 2\n3 4\n", None);
        assert!(out.datasets.is_empty());
        assert_eq!(codes(&out.findings), ["asc.header.missing"]);
    }

    #[test]
    fn reading_twice_gives_the_same_result() {
        let text = fixtures::text("grid.asc");
        assert_eq!(
            read_asc(&text, Some("g.asc")),
            read_asc(&text, Some("g.asc"))
        );
    }
}
