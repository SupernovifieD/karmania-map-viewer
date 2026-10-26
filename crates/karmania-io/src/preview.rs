//! Looking at a file before importing it.
//!
//! [`preview`] reads only as much as the import wizard needs to show a file and
//! suggest how to import it: the format and likely kind, how the text is encoded,
//! for a delimited file its delimiter, header, first rows and suggestions for
//! types, roles and "no data" values, and where the coordinate system comes from.
//! Nothing here reads a whole file row by row, so it stays fast on a big file.
//! Problems that are already visible become findings, as they would on import.

use karmania_core::{ColumnType, CrsRef, Findings, Kind};
use serde::Serialize;

use crate::asc::read_header;
use crate::delimited::{Delimiter, sniff};
use crate::detect::{DetectedFormat, detect_format};
use crate::geojson::{crs_unrecognized, parse};
use crate::geojson_crs::{FileCrs, file_crs};
use crate::infer::{detect_decimal_separator, infer_types};
use crate::nodata::{NodataSuggestions, suggest_nodata};
use crate::numbers::DecimalSeparator;
use crate::prj::read_prj;
use crate::roles::{RoleSuggestion, suggest_roles};
use crate::text::decode;

/// A file that goes with the main one, such as a `.prj` next to a data file.
#[derive(Debug, Clone, Copy)]
pub struct Sidecar<'a> {
    /// The file's name, which says what it is by its extension.
    pub file_name: &'a str,
    /// The file's bytes.
    pub bytes: &'a [u8],
}

/// Where a detected coordinate system comes from. In JSON: `prj_file`,
/// `geojson_default` or `geojson_crs_member`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CrsSource {
    /// A `.prj` file, next to the data file or the file itself.
    PrjFile,
    /// The file is GeoJSON without a coordinate system, so WGS 84 longitude and
    /// latitude, as the GeoJSON standard says.
    GeojsonDefault,
    /// The `crs` member of a GeoJSON file.
    GeojsonCrsMember,
}

/// A coordinate system found in or beside the file, and where it came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct DetectedCrs {
    /// The coordinate system.
    pub crs: CrsRef,
    /// Where it was found.
    pub source: CrsSource,
}

/// What a delimited text file looks like.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TablePreview {
    /// The detected delimiter.
    pub delimiter: Delimiter,
    /// Whether the first row holds column names.
    pub has_header: bool,
    /// Column names: the header row, or `Column 1`, `Column 2`, ... without one.
    pub header: Vec<String>,
    /// The first 200 data rows, as written in the file.
    pub rows: Vec<Vec<String>>,
    /// About how many data rows there are, counted by lines.
    pub estimated_rows: u64,
    /// How decimal numbers are written.
    pub decimal_separator: DecimalSeparator,
    /// A suggested type for each column, in column order.
    pub column_types: Vec<ColumnType>,
    /// A suggested role for each column, in column order, with a confidence.
    pub roles: Vec<RoleSuggestion>,
    /// Values that look like "no data" in the numeric columns.
    pub nodata: NodataSuggestions,
}

/// What a file is and how to import it, found without importing it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// The file's name, as given.
    pub file_name: String,
    /// The detected format, or absent if the file cannot be read (a finding says why).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<DetectedFormat>,
    /// The kind of dataset the file probably holds, where that can be told.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_kind: Option<Kind>,
    /// How the text is encoded: `UTF-8`, `UTF-16 LE`, `UTF-16 BE` or `Windows-1252`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<&'static str>,
    /// The layout of a delimited text file; absent for other formats.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<TablePreview>,
    /// The coordinate system found, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crs: Option<DetectedCrs>,
    /// Problems visible already: an unreadable or empty file, a mismatch between
    /// the name and the content, an encoding fallback, a bad grid header, a
    /// coordinate system that cannot be used.
    pub findings: Findings,
}

/// Looks at a file. `sidecars` are the other files chosen with it; only a `.prj`
/// is used, for the coordinate system.
#[must_use]
pub fn preview(file_name: &str, bytes: &[u8], sidecars: &[Sidecar<'_>]) -> Preview {
    let detection = detect_format(Some(file_name), bytes);
    let mut findings = detection.findings;
    let Some(format) = detection.format else {
        return Preview {
            file_name: file_name.to_string(),
            format: None,
            suggested_kind: None,
            encoding: None,
            table: None,
            crs: None,
            findings,
        };
    };
    let decoded = decode(bytes, &mut findings);
    let text: &str = &decoded.text;

    let mut table = None;
    let mut crs = None;
    match format {
        DetectedFormat::Csv => table = table_preview(text, &mut findings),
        DetectedFormat::AsciiGrid => {
            // Only the header is read; its problems are the ones worth knowing early.
            let _ = read_header(text, &mut findings);
        }
        DetectedFormat::Obj => {}
        DetectedFormat::Prj => crs = prj_crs(text, &mut findings),
        DetectedFormat::GeoJson => match geojson_declared(text, &mut findings) {
            Declared::Member(declared) => {
                crs = Some(DetectedCrs {
                    crs: declared,
                    source: CrsSource::GeojsonCrsMember,
                });
            }
            Declared::Unusable => {}
            Declared::Nothing => {
                crs = sidecar_crs(sidecars, &mut findings).or(Some(DetectedCrs {
                    crs: CrsRef::Epsg { code: 4326 },
                    source: CrsSource::GeojsonDefault,
                }));
            }
        },
    }
    if crs.is_none()
        && matches!(
            format,
            DetectedFormat::Csv | DetectedFormat::AsciiGrid | DetectedFormat::Obj
        )
    {
        crs = sidecar_crs(sidecars, &mut findings);
    }
    Preview {
        file_name: file_name.to_string(),
        format: Some(format),
        suggested_kind: detection.suggested_kind,
        encoding: Some(decoded.encoding.as_str()),
        table,
        crs,
        findings,
    }
}

fn table_preview(text: &str, findings: &mut Findings) -> Option<TablePreview> {
    let sniffed = sniff(text, findings)?;
    let decimal = detect_decimal_separator(&sniffed.rows, sniffed.delimiter);
    let column_types = infer_types(&sniffed.rows, sniffed.header.len(), decimal);
    let roles = suggest_roles(&sniffed.header, &column_types);
    let nodata = suggest_nodata(&sniffed.rows, &column_types, decimal);
    Some(TablePreview {
        delimiter: sniffed.delimiter,
        has_header: sniffed.has_header,
        header: sniffed.header,
        rows: sniffed.rows,
        estimated_rows: sniffed.estimated_rows,
        decimal_separator: decimal,
        column_types,
        roles,
        nodata,
    })
}

/// What a GeoJSON file says about its coordinate system.
enum Declared {
    /// A usable `crs` member.
    Member(CrsRef),
    /// A `crs` member that cannot be used (the finding is already added).
    Unusable,
    /// No `crs` member.
    Nothing,
}

/// Reads the `crs` member without parsing a file that has none: the whole document
/// is only parsed if the text mentions a `"crs"` at all.
fn geojson_declared(text: &str, findings: &mut Findings) -> Declared {
    if !text.contains("\"crs\"") {
        return Declared::Nothing;
    }
    let Some(root) = parse(text, findings) else {
        return Declared::Unusable;
    };
    match file_crs(&root) {
        FileCrs::Missing => Declared::Nothing,
        FileCrs::Epsg(code) => Declared::Member(CrsRef::Epsg { code }),
        FileCrs::Unrecognized(name) => {
            findings.add(crs_unrecognized(name));
            Declared::Unusable
        }
    }
}

/// The coordinate system of the first `.prj` among the sidecars.
fn sidecar_crs(sidecars: &[Sidecar<'_>], findings: &mut Findings) -> Option<DetectedCrs> {
    let sidecar = sidecars.iter().find(|s| {
        s.file_name
            .rsplit_once('.')
            .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("prj"))
    })?;
    let decoded = decode(sidecar.bytes, &mut Findings::new());
    prj_crs(&decoded.text, findings)
}

fn prj_crs(text: &str, findings: &mut Findings) -> Option<DetectedCrs> {
    let read = read_prj(text);
    for finding in read.findings.iter() {
        findings.add(finding.clone());
    }
    read.crs.map(|crs| DetectedCrs {
        crs,
        source: CrsSource::PrjFile,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;
    use serde_json::json;

    fn of(name: &str) -> Preview {
        preview(name, &fixtures::bytes(name), &[])
    }

    fn codes(p: &Preview) -> Vec<&'static str> {
        p.findings.iter().map(|f| f.code.as_str()).collect()
    }

    fn table(p: &Preview) -> &TablePreview {
        p.table.as_ref().expect("a table")
    }

    #[test]
    fn the_points_sample_is_previewed_with_suggestions() {
        let p = of("points.csv");
        assert!(p.findings.is_empty(), "{:?}", codes(&p));
        assert_eq!(
            (p.format, p.suggested_kind, p.encoding),
            (Some(DetectedFormat::Csv), Some(Kind::Points), Some("UTF-8"))
        );
        let t = table(&p);
        assert_eq!((t.delimiter, t.has_header), (Delimiter::Comma, true));
        assert_eq!(
            t.header,
            ["Easting", "Northing", "RL", "Hole", "Au_ppm", "Rock"]
        );
        assert_eq!((t.rows.len(), t.estimated_rows), (8, 8));
        assert_eq!(t.rows[0][3], "DH001");
        assert_eq!(t.decimal_separator, DecimalSeparator::Point);
        assert_eq!(
            t.column_types,
            [
                ColumnType::Float64,
                ColumnType::Float64,
                ColumnType::Float64,
                ColumnType::Categorical,
                ColumnType::Float64,
                ColumnType::Categorical
            ]
        );
        let roles: Vec<_> = t.roles.iter().map(|r| r.role.as_str()).collect();
        assert_eq!(
            roles,
            ["x", "y", "z", "attribute", "attribute", "attribute"]
        );
        assert!(t.roles[0].confidence > 0.9);
        // The sample has an empty Au_ppm cell and a -999.
        assert!(
            t.nodata
                .tokens
                .iter()
                .any(|n| n.token.is_empty() && n.count == 1)
        );
        assert!(
            t.nodata
                .numbers
                .iter()
                .any(|n| n.value == -999.0 && n.count == 1)
        );
        assert_eq!(p.crs, None);
    }

    #[test]
    fn the_other_csv_samples_suggest_their_own_kinds() {
        assert_eq!(of("lines.csv").suggested_kind, Some(Kind::Lines));
        assert_eq!(of("blocks.csv").suggested_kind, Some(Kind::Blocks));
        assert_eq!(table(&of("lines.csv")).header, ["Line", "X", "Y", "Z"]);
    }

    #[test]
    fn only_the_first_two_hundred_rows_are_sent_but_the_whole_file_is_counted() {
        let mut text = String::from("X,Y\n");
        for i in 0..5_000 {
            text.push_str(&format!("{i},{}\n", i * 2));
        }
        let p = preview("big.csv", text.as_bytes(), &[]);
        let t = table(&p);
        assert_eq!((t.rows.len(), t.estimated_rows), (200, 5_000));
    }

    #[test]
    fn a_semicolon_file_with_decimal_commas_and_a_latin_1_name_is_understood() {
        let bytes = b"Name;X;Y\nCaf\xE9;1,5;2,5\nZo\xEB;3,5;4,5\n";
        let p = preview("data.csv", bytes, &[]);
        assert_eq!(p.encoding, Some("Windows-1252"));
        assert_eq!(codes(&p), ["file.encoding.fallback"]);
        let t = table(&p);
        assert_eq!(t.delimiter, Delimiter::Semicolon);
        assert_eq!(t.decimal_separator, DecimalSeparator::Comma);
        assert_eq!(t.rows[0][0], "Café");
    }

    #[test]
    fn utf16_files_report_their_encoding() {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "a,b\n1,2\n3,4\n".encode_utf16() {
            bytes.extend(unit.to_le_bytes());
        }
        let p = preview("u.csv", &bytes, &[]);
        assert_eq!(p.encoding, Some("UTF-16 LE"));
        assert_eq!(table(&p).header, ["a", "b"]);
    }

    #[test]
    fn geojson_without_a_crs_member_is_wgs84_by_default() {
        let p = of("mixed.geojson");
        assert!(p.findings.is_empty());
        assert_eq!(p.format, Some(DetectedFormat::GeoJson));
        assert_eq!(p.suggested_kind, None);
        assert!(p.table.is_none());
        assert_eq!(
            p.crs,
            Some(DetectedCrs {
                crs: CrsRef::Epsg { code: 4326 },
                source: CrsSource::GeojsonDefault
            })
        );
    }

    #[test]
    fn a_crs_member_wins_over_a_sidecar_and_over_the_default() {
        let file = json!({
            "type": "Point", "coordinates": [1, 2],
            "crs": {"type": "name", "properties": {"name": "EPSG:32640"}}
        })
        .to_string();
        let prj = fixtures::bytes("points.prj");
        let sidecar = [Sidecar {
            file_name: "a.prj",
            bytes: &prj,
        }];
        for sidecars in [&[][..], &sidecar[..]] {
            let p = preview("a.geojson", file.as_bytes(), sidecars);
            assert_eq!(
                p.crs,
                Some(DetectedCrs {
                    crs: CrsRef::Epsg { code: 32640 },
                    source: CrsSource::GeojsonCrsMember
                })
            );
            assert!(p.findings.is_empty());
        }
    }

    #[test]
    fn a_crs_member_that_cannot_be_used_gives_no_crs_and_a_warning_even_with_a_sidecar() {
        let file = json!({
            "type": "Point", "coordinates": [1, 2],
            "crs": {"type": "name", "properties": {"name": "My mine grid"}}
        })
        .to_string();
        let prj = fixtures::bytes("points.prj");
        let sidecar = [Sidecar {
            file_name: "a.prj",
            bytes: &prj,
        }];
        let p = preview("a.geojson", file.as_bytes(), &sidecar);
        assert_eq!(p.crs, None);
        assert_eq!(codes(&p), ["geojson.crs.unrecognized"]);
    }

    #[test]
    fn a_prj_sidecar_gives_the_crs_of_a_data_file_and_beats_the_geojson_default() {
        let prj = fixtures::bytes("points.prj");
        let sidecars = [
            Sidecar {
                file_name: "points.shx",
                bytes: b"ignored",
            },
            Sidecar {
                file_name: "POINTS.PRJ",
                bytes: &prj,
            },
        ];
        let expected = Some(DetectedCrs {
            crs: CrsRef::Epsg { code: 32640 },
            source: CrsSource::PrjFile,
        });
        for name in ["points.csv", "grid.asc", "mesh.obj", "mixed.geojson"] {
            let p = preview(name, &fixtures::bytes(name), &sidecars);
            assert_eq!(p.crs, expected, "{name}");
        }
    }

    #[test]
    fn a_prj_sidecar_without_an_epsg_code_is_a_warning_and_no_crs() {
        let prj = fixtures::bytes("esri.prj");
        let sidecars = [Sidecar {
            file_name: "points.prj",
            bytes: &prj,
        }];
        let p = preview("points.csv", &fixtures::bytes("points.csv"), &sidecars);
        assert_eq!(p.crs, None);
        assert_eq!(codes(&p), ["prj.unrecognized"]);
    }

    #[test]
    fn a_prj_file_on_its_own_is_previewed_as_its_crs() {
        let p = of("points.prj");
        assert_eq!(p.format, Some(DetectedFormat::Prj));
        assert_eq!(p.crs.map(|c| c.source), Some(CrsSource::PrjFile));
        assert_eq!(of("esri.prj").crs, None);
        assert_eq!(codes(&of("esri.prj")), ["prj.unrecognized"]);
    }

    #[test]
    fn a_grid_and_a_mesh_are_previewed_with_their_kinds_and_a_grid_header_is_checked() {
        let grid = of("grid.asc");
        assert_eq!(
            (grid.format, grid.suggested_kind),
            (Some(DetectedFormat::AsciiGrid), Some(Kind::Grid))
        );
        assert!(grid.findings.is_empty());
        let mesh = of("mesh.obj");
        assert_eq!(
            (mesh.format, mesh.suggested_kind),
            (Some(DetectedFormat::Obj), Some(Kind::Mesh))
        );
        let broken = preview("g.asc", b"ncols 4\nnrows 3\n1 2 3\n", &[]);
        assert_eq!(broken.format, Some(DetectedFormat::AsciiGrid));
        assert_eq!(codes(&broken), ["asc.header.missing"]);
    }

    #[test]
    fn files_that_cannot_be_read_say_why_and_give_nothing_else() {
        for (name, bytes, expected) in [
            ("a.shp", &[0u8, 0, 1][..], "file.format.unrecognized"),
            ("empty.csv", &b""[..], "file.empty"),
            (
                "blob",
                &b"Hello, this is a letter.\nNothing here.\n"[..],
                "file.format.unrecognized",
            ),
        ] {
            let p = preview(name, bytes, &[]);
            assert_eq!(p.format, None, "{name}");
            assert_eq!(codes(&p), [expected], "{name}");
            assert!(p.table.is_none() && p.crs.is_none() && p.encoding.is_none());
            assert_eq!(p.file_name, name);
        }
    }

    #[test]
    fn a_file_named_for_one_format_but_holding_another_is_treated_as_what_it_holds() {
        let p = preview("data.csv", &fixtures::bytes("grid.asc"), &[]);
        assert_eq!(p.format, Some(DetectedFormat::AsciiGrid));
        assert_eq!(codes(&p), ["file.format.mismatch"]);
    }

    #[test]
    fn the_json_shape_leaves_out_what_is_absent_and_uses_the_agreed_names() {
        let p = of("points.csv");
        let v = serde_json::to_value(&p).unwrap();
        let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            [
                "encoding",
                "fileName",
                "findings",
                "format",
                "suggestedKind",
                "table"
            ]
        );
        assert_eq!(v["format"], "csv");
        assert_eq!(v["suggestedKind"], "points");
        let t = v["table"].as_object().unwrap();
        let mut table_keys: Vec<&str> = t.keys().map(String::as_str).collect();
        table_keys.sort_unstable();
        assert_eq!(
            table_keys,
            [
                "columnTypes",
                "decimalSeparator",
                "delimiter",
                "estimatedRows",
                "hasHeader",
                "header",
                "nodata",
                "roles",
                "rows"
            ]
        );
        assert_eq!(v["table"]["delimiter"], "comma");
        assert_eq!(v["table"]["decimalSeparator"], ".");
        assert_eq!(v["table"]["columnTypes"][3], "category");
        assert_eq!(v["table"]["roles"][0]["role"], "x");

        let g = serde_json::to_value(of("mixed.geojson")).unwrap();
        assert_eq!(g["format"], "geojson");
        assert_eq!(g["crs"]["crs"], json!({"kind": "epsg", "code": 4326}));
        assert_eq!(g["crs"]["source"], "geojson_default");
        assert!(g.get("table").is_none() && g.get("suggestedKind").is_none());
        let grid = serde_json::to_value(of("grid.asc")).unwrap();
        assert_eq!(grid["format"], "ascii_grid");
    }

    #[test]
    fn previewing_twice_gives_the_same_preview() {
        assert_eq!(of("points.csv"), of("points.csv"));
    }
}
