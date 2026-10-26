//! Reading ESRI ASCII grid files (`.asc`).
//!
//! A grid file is a short header with one `name value` pair per line, followed by
//! the cell values, row by row, starting with the northernmost row. The header
//! gives the number of columns and rows (`ncols`, `nrows`), the position of the
//! lower-left cell (`xllcorner` and `yllcorner`, or `xllcenter` and `yllcenter`),
//! the cell size (`cellsize`, or `dx` and `dy`) and, optionally, the value that
//! means "no data" (`NODATA_value`). Names are not case sensitive.

use std::collections::{BTreeMap, BTreeSet};

use karmania_core::{Finding, FindingCode, Findings, Location};

use crate::numbers::{DecimalSeparator, parse_number};
use crate::output::join_and;

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
}
