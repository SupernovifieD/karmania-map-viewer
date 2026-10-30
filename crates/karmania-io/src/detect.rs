//! Working out what format a file is in, and what kind of data it probably holds.
//!
//! The file name's extension and the start of the content are both looked at, and
//! the content wins: a file called `data.csv` that is really a GeoJSON file is
//! read as GeoJSON, with an info finding saying so. Only the first
//! [`SNIFF_BYTES`] bytes are examined. Nothing here reads the whole file.

use karmania_core::{Finding, FindingCode, Findings, Kind};
use serde::{Deserialize, Serialize};

use crate::delimited::sniff;
use crate::infer::{detect_decimal_separator, infer_types};
use crate::numbers::{DecimalSeparator, parse_number};
use crate::roles::{Role, suggest_roles, suggests_block_centres};
use crate::text::decode;

/// How much of the start of a file is examined.
pub const SNIFF_BYTES: usize = 64 * 1024;

/// A file format this crate can read. In JSON: `csv`, `geojson`, `ascii_grid`,
/// `obj` or `prj`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DetectedFormat {
    /// Delimited text: comma, semicolon, tab or whitespace separated.
    #[serde(rename = "csv")]
    Csv,
    /// GeoJSON.
    #[serde(rename = "geojson")]
    GeoJson,
    /// An ESRI ASCII grid.
    #[serde(rename = "ascii_grid")]
    AsciiGrid,
    /// A Wavefront OBJ mesh.
    #[serde(rename = "obj")]
    Obj,
    /// A `.prj` file with a coordinate system.
    #[serde(rename = "prj")]
    Prj,
}

impl DetectedFormat {
    /// The name used in JSON: `csv`, `geojson`, `ascii_grid`, `obj` or `prj`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            DetectedFormat::Csv => "csv",
            DetectedFormat::GeoJson => "geojson",
            DetectedFormat::AsciiGrid => "ascii_grid",
            DetectedFormat::Obj => "obj",
            DetectedFormat::Prj => "prj",
        }
    }

    /// How the format is described to users in messages.
    const fn label(self) -> &'static str {
        match self {
            DetectedFormat::Csv => "a CSV file",
            DetectedFormat::GeoJson => "GeoJSON",
            DetectedFormat::AsciiGrid => "an ESRI ASCII grid",
            DetectedFormat::Obj => "an OBJ mesh",
            DetectedFormat::Prj => "a projection (.prj) file",
        }
    }
}

/// What detection found out about a file.
#[derive(Debug, Clone, PartialEq)]
pub struct Detection {
    /// The format, or `None` if the file is empty or not in a format this crate
    /// can read (there is an error finding then).
    pub format: Option<DetectedFormat>,
    /// The kind of dataset the file probably holds, as a starting point for the
    /// user: a grid for an ASCII grid, a mesh for an OBJ, lines, block model or
    /// points for a CSV file by its column names. `None` for GeoJSON, whose kinds
    /// come from its features, and for `.prj` files, which are not data.
    pub suggested_kind: Option<Kind>,
    /// Why the format is unknown, or that content and file name disagreed.
    pub findings: Findings,
}

/// Extensions of formats this crate cannot read, which are called out by name.
const UNSUPPORTED: [&str; 24] = [
    "shp", "shx", "dbf", "xlsx", "xls", "ods", "zip", "gz", "7z", "tar", "gpkg", "kml", "kmz",
    "las", "laz", "dxf", "dwg", "tif", "tiff", "png", "jpg", "jpeg", "pdf", "docx",
];

/// The format an extension stands for, if it names one. `.txt` and `.dat` do not:
/// they could hold anything.
fn format_of_extension(extension: &str) -> Option<DetectedFormat> {
    match extension {
        "csv" | "tsv" | "tab" => Some(DetectedFormat::Csv),
        "geojson" | "json" => Some(DetectedFormat::GeoJson),
        "asc" => Some(DetectedFormat::AsciiGrid),
        "obj" => Some(DetectedFormat::Obj),
        "prj" => Some(DetectedFormat::Prj),
        _ => None,
    }
}

/// The lowercase extension of a file name, without the dot.
fn extension_of(file_name: &str) -> Option<String> {
    let (stem, extension) = file_name.trim().rsplit_once('.')?;
    (!stem.is_empty() && !extension.is_empty() && extension.len() <= 10)
        .then(|| extension.to_ascii_lowercase())
}

fn unrecognized(message: String, hint: &str) -> Findings {
    let mut findings = Findings::new();
    findings.add(Finding::new(FindingCode::FileFormatUnrecognized, message).with_hint(hint));
    findings
}

/// Detects the format of a file from its name and its first bytes.
///
/// `bytes` may be the whole file or just its start; only the first
/// [`SNIFF_BYTES`] are used.
#[must_use]
pub fn detect_format(file_name: Option<&str>, bytes: &[u8]) -> Detection {
    let none = |findings| Detection {
        format: None,
        suggested_kind: None,
        findings,
    };
    let extension = file_name.and_then(extension_of);
    if let Some(extension) = extension.as_deref().filter(|e| UNSUPPORTED.contains(e)) {
        return none(unrecognized(
            format!("Karmania cannot read .{extension} files yet."),
            "Export the data as CSV or GeoJSON.",
        ));
    }
    let mut head = bytes.get(..SNIFF_BYTES).unwrap_or(bytes);
    // Do not cut a character in two: that would make valid UTF-8 look broken.
    if let Err(error) = std::str::from_utf8(head)
        && error.error_len().is_none()
    {
        head = head.get(..error.valid_up_to()).unwrap_or(head);
    }
    let utf16 = head.starts_with(&[0xFF, 0xFE]) || head.starts_with(&[0xFE, 0xFF]);
    if !utf16 && head.contains(&0) {
        return none(unrecognized(
            "The file is a binary file, not text.".to_string(),
            "Karmania reads CSV, GeoJSON, ESRI ASCII grid, OBJ and .prj files.",
        ));
    }
    let decoded = decode(head, &mut Findings::new());
    let text = decoded.text.as_ref();
    if text.trim().is_empty() {
        let mut findings = Findings::new();
        findings.add(
            Finding::new(FindingCode::FileEmpty, "The file has no data in it.")
                .with_hint("Check that you chose the right file."),
        );
        return none(findings);
    }

    let from_name = extension.as_deref().and_then(format_of_extension);
    let from_content = sniff_content(text);
    let Some(format) = from_content.or(from_name) else {
        return none(unrecognized(
            "The file is not in a format Karmania can read.".to_string(),
            "Karmania reads CSV, GeoJSON, ESRI ASCII grid, OBJ and .prj files.",
        ));
    };
    let mut findings = Findings::new();
    if let (Some(by_name), Some(by_content)) = (from_name, from_content)
        && by_name != by_content
    {
        findings.add(Finding::new(
            FindingCode::FileFormatMismatch,
            format!(
                "The file name ends in .{}, but the content looks like {}, so it was treated as {}.",
                extension.as_deref().unwrap_or_default(),
                format.label(),
                format.label()
            ),
        )
        .with_hint(
            "Nothing needs fixing. Give the file the ending that matches its content to avoid this note.",
        ));
    }
    let suggested_kind = match format {
        DetectedFormat::Csv => Some(suggest_csv_kind(text)),
        DetectedFormat::AsciiGrid => Some(Kind::Grid),
        DetectedFormat::Obj => Some(Kind::Mesh),
        DetectedFormat::GeoJson | DetectedFormat::Prj => None,
    };
    Detection {
        format: Some(format),
        suggested_kind,
        findings,
    }
}

/// The format the start of the content looks like, if it looks like one.
fn sniff_content(text: &str) -> Option<DetectedFormat> {
    let trimmed = text.trim_start();
    if looks_like_wkt(trimmed) {
        Some(DetectedFormat::Prj)
    } else if looks_like_geojson(trimmed) {
        Some(DetectedFormat::GeoJson)
    } else if looks_like_ascii_grid(trimmed) {
        Some(DetectedFormat::AsciiGrid)
    } else if looks_like_obj(trimmed) {
        Some(DetectedFormat::Obj)
    } else if looks_like_table(text) {
        Some(DetectedFormat::Csv)
    } else {
        None
    }
}

/// Whether the text is a table: at least two columns, a data row, and most rows
/// as wide as the header. Prose with a comma in it, JSON and XML are not.
fn looks_like_table(text: &str) -> bool {
    if text.trim_start().starts_with(['{', '[', '<']) {
        return false;
    }
    let Some(sniffed) = sniff(text, &mut Findings::new()) else {
        return false;
    };
    let width = sniffed.header.len();
    let same = sniffed.rows.iter().filter(|r| r.len() == width).count();
    width >= 2 && !sniffed.rows.is_empty() && same * 5 >= sniffed.rows.len() * 4
}

/// Root keywords of well-known text for coordinate systems.
const WKT_ROOTS: [&str; 14] = [
    "PROJCS",
    "GEOGCS",
    "GEOCCS",
    "COMPD_CS",
    "LOCAL_CS",
    "VERT_CS",
    "PROJCRS",
    "GEOGCRS",
    "GEODCRS",
    "COMPOUNDCRS",
    "VERTCRS",
    "ENGCRS",
    "BOUNDCRS",
    "PROJECTEDCRS",
];

fn looks_like_wkt(text: &str) -> bool {
    let word: String = text
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect::<String>()
        .to_ascii_uppercase();
    WKT_ROOTS.contains(&word.as_str())
        && text
            .get(word.len()..)
            .is_some_and(|rest| rest.trim_start().starts_with(['[', '(']))
}

fn looks_like_geojson(text: &str) -> bool {
    text.starts_with('{')
        && text.contains("\"type\"")
        && [
            "\"FeatureCollection\"",
            "\"Feature\"",
            "\"Point\"",
            "\"MultiPoint\"",
            "\"LineString\"",
            "\"MultiLineString\"",
            "\"Polygon\"",
            "\"MultiPolygon\"",
            "\"GeometryCollection\"",
        ]
        .iter()
        .any(|name| text.contains(name))
}

fn looks_like_ascii_grid(text: &str) -> bool {
    let mut tokens = text.split_ascii_whitespace();
    let name = tokens.next().map(str::to_ascii_lowercase);
    matches!(name.as_deref(), Some("ncols" | "nrows"))
        && tokens
            .next()
            .is_some_and(|value| parse_number(value, DecimalSeparator::Point).is_some())
}

/// Record types that start lines of an OBJ file.
const OBJ_RECORDS: [&str; 13] = [
    "v", "vt", "vn", "vp", "f", "o", "g", "s", "usemtl", "mtllib", "l", "p", "mg",
];

fn looks_like_obj(text: &str) -> bool {
    let mut first = true;
    let mut vertex = false;
    for line in text.lines().take(200) {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut tokens = line.split_ascii_whitespace();
        let kind = tokens.next().unwrap_or_default();
        if first && !OBJ_RECORDS.contains(&kind) {
            return false;
        }
        first = false;
        if kind == "v" {
            let numbers = tokens
                .take(3)
                .filter(|t| parse_number(t, DecimalSeparator::Point).is_some())
                .count();
            vertex |= numbers == 3;
        }
    }
    vertex
}

/// The kind of data a CSV file probably holds, from its column names.
fn suggest_csv_kind(text: &str) -> Kind {
    let Some(sniffed) = sniff(text, &mut Findings::new()) else {
        return Kind::Points;
    };
    let decimal = detect_decimal_separator(&sniffed.rows, sniffed.delimiter);
    let types = infer_types(&sniffed.rows, sniffed.header.len(), decimal);
    let roles = suggest_roles(&sniffed.header, &types);
    if roles
        .iter()
        .any(|r| r.role == Role::LineId && r.confidence >= 0.8)
    {
        Kind::Lines
    } else if suggests_block_centres(&sniffed.header) {
        Kind::Blocks
    } else {
        Kind::Points
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;

    fn detect(name: Option<&str>, text: &str) -> Detection {
        detect_format(name, text.as_bytes())
    }

    fn codes(d: &Detection) -> Vec<&'static str> {
        d.findings.iter().map(|f| f.code.as_str()).collect()
    }

    #[test]
    fn every_sample_file_is_recognized_with_its_kind() {
        let cases = [
            ("points.csv", DetectedFormat::Csv, Some(Kind::Points)),
            ("lines.csv", DetectedFormat::Csv, Some(Kind::Lines)),
            ("blocks.csv", DetectedFormat::Csv, Some(Kind::Blocks)),
            ("mixed.geojson", DetectedFormat::GeoJson, None),
            ("grid.asc", DetectedFormat::AsciiGrid, Some(Kind::Grid)),
            ("mesh.obj", DetectedFormat::Obj, Some(Kind::Mesh)),
            ("points.prj", DetectedFormat::Prj, None),
            ("esri.prj", DetectedFormat::Prj, None),
        ];
        for (name, format, kind) in cases {
            let d = detect_format(Some(name), &fixtures::bytes(name));
            assert_eq!(d.format, Some(format), "{name}");
            assert_eq!(d.suggested_kind, kind, "{name}");
            assert!(d.findings.is_empty(), "{name}: {:?}", codes(&d));
            // The content alone is enough.
            let anonymous = detect_format(None, &fixtures::bytes(name));
            assert_eq!(anonymous.format, Some(format), "{name} without a name");
        }
    }

    #[test]
    fn content_beats_the_extension_and_the_mismatch_is_reported() {
        let grid = fixtures::text("grid.asc");
        let d = detect(Some("survey.CSV"), &grid);
        assert_eq!(d.format, Some(DetectedFormat::AsciiGrid));
        assert_eq!(codes(&d), ["file.format.mismatch"]);
        assert_eq!(
            d.findings.as_slice()[0].message,
            "The file name ends in .csv, but the content looks like an ESRI ASCII grid, so it was treated as an ESRI ASCII grid."
        );
        // A general-purpose extension is not a claim about the format.
        for name in ["notes.txt", "export.dat", "export"] {
            let d = detect(Some(name), &fixtures::text("mesh.obj"));
            assert_eq!(d.format, Some(DetectedFormat::Obj), "{name}");
            assert!(d.findings.is_empty(), "{name}");
        }
    }

    #[test]
    fn the_extension_decides_when_the_content_says_nothing() {
        // JSON that is not GeoJSON is left for the GeoJSON reader to explain.
        let d = detect(Some("data.json"), "{\"name\": \"x\"}");
        assert_eq!(d.format, Some(DetectedFormat::GeoJson));
        assert!(d.findings.is_empty());
        // A single column has no delimiter to find, but the name says CSV.
        let d = detect(Some("ids.csv"), "id\n1\n2\n");
        assert_eq!(d.format, Some(DetectedFormat::Csv));
        // Without the name there is nothing to go on.
        let d = detect(None, "id\n1\n2\n");
        assert_eq!(d.format, None);
        assert_eq!(codes(&d), ["file.format.unrecognized"]);
    }

    #[test]
    fn unsupported_and_binary_files_are_refused_with_a_reason() {
        let d = detect_format(Some("wells.SHP"), &[0, 0, 0x27, 0x0A, 0, 0]);
        assert_eq!(d.format, None);
        assert_eq!(
            d.findings.as_slice()[0].message,
            "Karmania cannot read .shp files yet."
        );
        // Text-based unsupported formats are named too, whatever their content.
        let d = detect(
            Some("places.kml"),
            "<kml><Placemark>1,2,3</Placemark></kml>",
        );
        assert_eq!(
            d.findings.as_slice()[0].message,
            "Karmania cannot read .kml files yet."
        );
        // A binary file with a text extension.
        let d = detect_format(Some("data.csv"), b"a,b\n1,\x00\x00\x01");
        assert_eq!(d.format, None);
        assert_eq!(
            d.findings.as_slice()[0].message,
            "The file is a binary file, not text."
        );
        let d = detect(Some("readme"), "Hello, this is a letter.\nNothing here.\n");
        assert_eq!(
            d.findings.as_slice()[0].message,
            "The file is not in a format Karmania can read."
        );
    }

    #[test]
    fn empty_files_are_empty_whatever_they_are_called() {
        for (name, bytes) in [
            (Some("a.csv"), &b""[..]),
            (None, b"  \n\t "),
            (Some("a.geojson"), b"\xEF\xBB\xBF"),
        ] {
            let d = detect_format(name, bytes);
            assert_eq!(d.format, None);
            assert_eq!(codes(&d), ["file.empty"]);
        }
    }

    #[test]
    fn utf16_windows_1252_and_byte_order_marks_are_looked_through() {
        let csv = fixtures::text("points.csv");
        let mut utf16: Vec<u8> = vec![0xFF, 0xFE];
        for unit in csv.encode_utf16() {
            utf16.extend(unit.to_le_bytes());
        }
        assert_eq!(
            detect_format(Some("a.csv"), &utf16).format,
            Some(DetectedFormat::Csv)
        );
        let latin1 = b"Name;Depth\nCaf\xE9;12\nZo\xEB;14\n";
        assert_eq!(
            detect_format(None, latin1).format,
            Some(DetectedFormat::Csv)
        );
        let bom = format!("\u{feff}{}", fixtures::text("mixed.geojson"));
        assert_eq!(detect(None, &bom).format, Some(DetectedFormat::GeoJson));
    }

    #[test]
    fn only_the_start_of_a_big_file_is_examined_and_a_cut_character_is_harmless() {
        let mut big = String::from("name;depth\n");
        while big.len() < 3 * SNIFF_BYTES {
            big.push_str("Zoë;12,5\n");
        }
        let d = detect_format(Some("big.csv"), big.as_bytes());
        assert_eq!(d.format, Some(DetectedFormat::Csv));
        assert!(d.findings.is_empty());
        // The two-byte letter is cut in half by the end of the examined bytes when
        // `extra` is 3, and whole otherwise.
        for extra in 0..4 {
            let mut bytes = "a,b\n".repeat(SNIFF_BYTES / 4 - 1).into_bytes();
            bytes.extend(vec![b'x'; extra]);
            bytes.extend("ë\n".as_bytes());
            bytes.extend(b"more,more\n".repeat(100));
            let d = detect_format(Some("c.csv"), &bytes);
            assert_eq!(d.format, Some(DetectedFormat::Csv), "{extra}");
        }
    }

    #[test]
    fn lookalikes_are_not_mistaken_for_other_formats() {
        // A CSV with columns called v and f is not an OBJ file.
        assert_eq!(
            detect(None, "v,f\n1,2\n3,4\n").format,
            Some(DetectedFormat::Csv)
        );
        // Nor is one whose header starts with a grid keyword.
        assert_eq!(
            detect(None, "ncols,nrows\n4,3\n5,6\n").format,
            Some(DetectedFormat::Csv)
        );
        // A table that mentions features.
        assert_eq!(
            detect(None, "type,name\nFeature,A\nPoint,B\n").format,
            Some(DetectedFormat::Csv)
        );
        // OBJ-looking records with no vertices are not a mesh.
        assert_ne!(
            detect(None, "o thing\ng part\n").format,
            Some(DetectedFormat::Obj)
        );
        // Square brackets in a CSV header are not a coordinate system.
        assert_eq!(
            detect(None, "PROJCS,x\n1,2\n").format,
            Some(DetectedFormat::Csv)
        );
    }

    #[test]
    fn the_csv_kind_follows_the_column_names() {
        let kind = |text: &str| detect(Some("a.csv"), text).suggested_kind;
        assert_eq!(kind("Line,X,Y\nA,1,2\nA,3,4\n"), Some(Kind::Lines));
        assert_eq!(kind("xc,yc,zc,grade\n1,2,3,4\n"), Some(Kind::Blocks));
        assert_eq!(kind("Easting,Northing\n1,2\n3,4\n"), Some(Kind::Points));
        assert_eq!(kind("a,b,c\n1,2,3\n"), Some(Kind::Points));
    }

    #[test]
    fn format_names_are_stable_json() {
        for (format, name) in [
            (DetectedFormat::Csv, "csv"),
            (DetectedFormat::GeoJson, "geojson"),
            (DetectedFormat::AsciiGrid, "ascii_grid"),
            (DetectedFormat::Obj, "obj"),
            (DetectedFormat::Prj, "prj"),
        ] {
            assert_eq!(format.as_str(), name);
            assert_eq!(
                serde_json::to_string(&format).unwrap(),
                format!("\"{name}\"")
            );
            assert_eq!(
                serde_json::from_str::<DetectedFormat>(&format!("\"{name}\"")).unwrap(),
                format
            );
        }
    }

    #[test]
    fn extensions_are_read_from_the_end_of_the_name() {
        assert_eq!(extension_of("a.b.CSV"), Some("csv".to_string()));
        assert_eq!(extension_of("noext"), None);
        assert_eq!(extension_of(".hidden"), None);
        assert_eq!(extension_of("trailing."), None);
        assert_eq!(extension_of("x.verylongextension"), None);
        assert_eq!(extension_of("  x.obj "), Some("obj".to_string()));
    }

    #[test]
    fn a_table_needs_columns_data_and_mostly_even_rows() {
        assert!(looks_like_table("a,b,c\n1,2,3\n4,5,6\n"));
        // One data row is enough; a header alone is not a table.
        assert!(looks_like_table("a,b\n1,2\n"));
        assert!(!looks_like_table("a,b,c\n"));
        // Four rows in five as wide as the header is the least allowed.
        assert!(looks_like_table("a,b,c\n1,2,3\n1,2,3\n1,2,3\n1,2,3\n1,2\n"));
        assert!(!looks_like_table("a,b,c\n1,2,3\n1,2\n1,2\n1,2\n1,2\n"));
        // Prose, JSON and XML are not tables, however many commas they hold.
        assert!(!looks_like_table(
            "Hello, this is a letter.\nNothing here.\n"
        ));
        assert!(!looks_like_table("[1,2]\n[3,4]\n[5,6]\n"));
        assert!(!looks_like_table("{\"a\": 1,\n\"b\": 2,\n\"c\": 3}\n"));
        assert!(!looks_like_table("<a>1,2</a>\n<b>3,4</b>\n"));
        assert!(!looks_like_table(""));
    }
}
