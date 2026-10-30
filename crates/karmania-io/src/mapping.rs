//! The import mapping: the contract between the import wizard and the readers.
//!
//! It says what each column of a file is for, which values mean "no data", how
//! numbers are written and which coordinate reference system the data is in. It is
//! sent as JSON (camelCase field names) and unknown fields are rejected, so a typo
//! in a client is an error instead of a silently ignored setting.

use karmania_core::{ColumnType, CrsRef, Finding, FindingCode, Findings, Kind, Location};
use serde::{Deserialize, Serialize};

use crate::numbers::DecimalSeparator;
use crate::roles::Role;

/// How one column of the file is imported.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColumnMapping {
    /// The column's name in the file's header (or `Column N` without a header).
    pub source: String,
    /// What the column is for.
    pub role: Role,
    /// The type to read an attribute as; guessed from the data when absent.
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub column_type: Option<ColumnType>,
    /// The name the attribute gets in the dataset; the source name when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rename: Option<String>,
}

/// Which values mean "no data" and become nulls.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Nodata {
    /// Words, compared ignoring case and surrounding spaces; the empty string
    /// stands for an empty cell.
    pub tokens: Vec<String>,
    /// Numbers, compared exactly after reading.
    pub numbers: Vec<f64>,
}

/// What to do with a row that has an empty coordinate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EmptyCoordinates {
    /// Stop with an error finding.
    Error,
    /// Leave the row out and report how many were skipped.
    Skip,
}

/// Everything the readers need to know about how to import a file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportMapping {
    /// The name of the dataset to create.
    pub dataset_name: String,
    /// The shape to build.
    pub kind: Kind,
    /// How each column is imported, in file order.
    pub columns: Vec<ColumnMapping>,
    /// Which values mean "no data".
    pub nodata: Nodata,
    /// What to do with rows that have an empty coordinate.
    pub empty_coordinates: EmptyCoordinates,
    /// The size of a block along X, Y and Z, for block models.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_size: Option<[f64; 3]>,
    /// How decimal numbers are written in the file.
    pub decimal_separator: DecimalSeparator,
    /// The coordinate reference system, or `null` if not chosen yet.
    pub crs: Option<CrsRef>,
}

/// Checks that a mapping for a CSV file is complete and consistent with the file's
/// `header`, adding findings for the wizard's mapping step.
///
/// It reports: a kind CSV cannot produce; columns that are not in the file or are
/// mapped twice; a role (X, Y, Z or line identifier) given to several columns;
/// missing X and Y (and Z for block models); coordinates typed as non-numbers; a
/// missing line identifier for lines; a missing or unusable block size. Types and
/// values in the data are not looked at here.
pub fn validate_mapping(mapping: &ImportMapping, header: &[String], findings: &mut Findings) {
    if !matches!(mapping.kind, Kind::Points | Kind::Lines | Kind::Blocks) {
        findings.add(
            Finding::new(
                FindingCode::MappingKindUnsupported,
                format!(
                    "A CSV file can be imported as points, lines or a block model, not as {}.",
                    mapping.kind.as_str()
                ),
            )
            .with_hint("Choose points, lines or a block model."),
        );
        return;
    }
    check_sources(mapping, header, findings);
    check_roles(mapping, findings);
    check_block_size(mapping, findings);
}

fn check_sources(mapping: &ImportMapping, header: &[String], findings: &mut Findings) {
    let mut seen: Vec<&str> = Vec::new();
    for column in &mapping.columns {
        let name = column.source.as_str();
        if !header.iter().any(|h| h == name) {
            findings.add(
                Finding::new(
                    FindingCode::MappingSourceUnknown,
                    format!("The mapping refers to a column that is not in the file: \"{name}\"."),
                )
                .with_hint("Check the column names, or map the columns again.")
                .at(Location::default().with_column(name)),
            );
        }
        if seen.contains(&name) {
            findings.add(
                Finding::new(
                    FindingCode::MappingSourceDuplicate,
                    format!("The column \"{name}\" is mapped more than once."),
                )
                .with_hint("Give each column of the file one role.")
                .at(Location::default().with_column(name)),
            );
        } else {
            seen.push(name);
        }
    }
}

/// The words for a role in messages.
const fn role_words(role: Role) -> &'static str {
    match role {
        Role::X => "X (easting or longitude)",
        Role::Y => "Y (northing or latitude)",
        Role::Z => "Z (elevation)",
        Role::LineId => "the line identifier",
        Role::Attribute => "an attribute",
        Role::Ignore => "ignored",
    }
}

fn check_roles(mapping: &ImportMapping, findings: &mut Findings) {
    for role in [Role::X, Role::Y, Role::Z, Role::LineId] {
        let holders: Vec<&ColumnMapping> =
            mapping.columns.iter().filter(|c| c.role == role).collect();
        if holders.len() > 1 {
            findings.add(
                Finding::new(
                    FindingCode::MappingRoleDuplicate,
                    format!("More than one column is set as {}.", role_words(role)),
                )
                .with_hint(
                    "Keep one column for this role and set the others to attribute or ignore.",
                ),
            );
        }
        let required = match role {
            Role::X | Role::Y => true,
            Role::Z => mapping.kind == Kind::Blocks,
            Role::LineId => mapping.kind == Kind::Lines,
            Role::Attribute | Role::Ignore => false,
        };
        if holders.is_empty() && required {
            if role == Role::LineId {
                findings.add(
                    Finding::new(
                        FindingCode::MappingLineIdMissing,
                        "No column is set as the line identifier, so rows cannot be grouped into lines.",
                    )
                    .with_hint("Choose the column that says which line each row belongs to."),
                );
            } else {
                findings.add(
                    Finding::new(
                        FindingCode::MappingCoordinateMissing,
                        format!("No column is set as {}.", role_words(role)),
                    )
                    .with_hint("Choose the column that holds this coordinate."),
                );
            }
        }
        if !matches!(role, Role::X | Role::Y | Role::Z) {
            continue;
        }
        for column in holders {
            if let Some(t) = column.column_type
                && !matches!(t, ColumnType::Float64 | ColumnType::Int64)
            {
                findings.add(
                    Finding::new(
                        FindingCode::MappingCoordinateNotNumeric,
                        format!(
                            "The column \"{}\" is set as {} but its type is {}; coordinates must be numbers.",
                            column.source,
                            role_words(role),
                            t.as_str()
                        ),
                    )
                    .with_hint("Set the column's type to Float or Integer, or choose another column.")
                    .at(Location::default().with_column(&column.source)),
                );
            }
        }
    }
}

fn check_block_size(mapping: &ImportMapping, findings: &mut Findings) {
    if mapping.kind != Kind::Blocks {
        return;
    }
    match mapping.block_size {
        None => findings.add(
            Finding::new(
                FindingCode::MappingBlockSizeMissing,
                "The block size is missing.",
            )
            .with_hint("Enter the size of a block along X, Y and Z."),
        ),
        Some([dx, dy, dz]) if ![dx, dy, dz].iter().all(|s| s.is_finite() && *s > 0.0) => {
            findings.add(
                Finding::new(
                    FindingCode::MappingBlockSizeInvalid,
                    format!(
                        "The block size must be greater than 0 in all three directions, but it is {dx} x {dy} x {dz}."
                    ),
                )
                .with_hint("Use positive numbers, such as 10 for 10-metre blocks."),
            );
        }
        Some(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use karmania_core::Units;
    use serde_json::{Value, json};

    fn names(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    fn check(mapping: &ImportMapping, header: &[&str]) -> Findings {
        let mut findings = Findings::new();
        validate_mapping(mapping, &names(header), &mut findings);
        findings
    }

    fn codes(findings: &Findings) -> Vec<&'static str> {
        findings.iter().map(|f| f.code.as_str()).collect()
    }

    fn mapping(kind: Kind, roles: &[(&str, Role)]) -> ImportMapping {
        ImportMapping {
            dataset_name: "d".into(),
            kind,
            columns: roles
                .iter()
                .map(|&(source, role)| ColumnMapping {
                    source: source.into(),
                    role,
                    column_type: None,
                    rename: None,
                })
                .collect(),
            nodata: Nodata::default(),
            empty_coordinates: EmptyCoordinates::Error,
            block_size: (kind == Kind::Blocks).then_some([10.0, 10.0, 5.0]),
            decimal_separator: DecimalSeparator::Point,
            crs: None,
        }
    }

    const POINTS: [(&str, Role); 4] = [
        ("E", Role::X),
        ("N", Role::Y),
        ("RL", Role::Z),
        ("Au", Role::Attribute),
    ];

    #[test]
    fn complete_mappings_have_no_findings() {
        let header = ["E", "N", "RL", "Au"];
        assert!(check(&mapping(Kind::Points, &POINTS), &header).is_empty());
        // Z is optional for points and lines; a line identifier is needed for lines.
        assert!(check(&mapping(Kind::Points, &POINTS[..2]), &header).is_empty());
        let lines = mapping(
            Kind::Lines,
            &[("L", Role::LineId), ("E", Role::X), ("N", Role::Y)],
        );
        assert!(check(&lines, &["L", "E", "N"]).is_empty());
        assert!(check(&mapping(Kind::Blocks, &POINTS[..3]), &header).is_empty());
    }

    #[test]
    fn a_missing_x_or_y_is_reported_for_each_axis_with_a_mapping_step() {
        let f = check(&mapping(Kind::Points, &[("Au", Role::Attribute)]), &["Au"]);
        assert_eq!(
            codes(&f),
            ["mapping.coordinate.missing", "mapping.coordinate.missing"]
        );
        assert_eq!(
            f.as_slice()[0].message,
            "No column is set as X (easting or longitude)."
        );
        assert_eq!(
            f.as_slice()[1].message,
            "No column is set as Y (northing or latitude)."
        );
        assert!(
            f.iter()
                .all(|x| x.step == Some(karmania_core::WizardStep::Mapping))
        );
        assert!(f.has_errors());
    }

    #[test]
    fn block_models_also_need_z_and_a_block_size() {
        let mut m = mapping(Kind::Blocks, &POINTS[..2]);
        m.block_size = None;
        let f = check(&m, &["E", "N"]);
        assert_eq!(
            codes(&f),
            ["mapping.coordinate.missing", "mapping.block_size.missing"]
        );
        assert_eq!(
            f.as_slice()[0].message,
            "No column is set as Z (elevation)."
        );
        for bad in [
            [0.0, 1.0, 1.0],
            [1.0, -2.0, 1.0],
            [1.0, 1.0, f64::NAN],
            [f64::INFINITY, 1.0, 1.0],
        ] {
            let mut m = mapping(Kind::Blocks, &POINTS[..3]);
            m.block_size = Some(bad);
            let f = check(&m, &["E", "N", "RL"]);
            assert_eq!(codes(&f), ["mapping.block_size.invalid"], "{bad:?}");
        }
        let mut m = mapping(Kind::Blocks, &POINTS[..3]);
        m.block_size = Some([10.0, 0.0, 5.0]);
        let f = check(&m, &["E", "N", "RL"]);
        assert_eq!(
            f.as_slice()[0].message,
            "The block size must be greater than 0 in all three directions, but it is 10 x 0 x 5."
        );
    }

    #[test]
    fn lines_need_a_line_identifier() {
        let m = mapping(Kind::Lines, &[("E", Role::X), ("N", Role::Y)]);
        let f = check(&m, &["E", "N"]);
        assert_eq!(codes(&f), ["mapping.line_id.missing"]);
        assert!(
            f.as_slice()[0]
                .message
                .starts_with("No column is set as the line identifier")
        );
    }

    #[test]
    fn two_columns_with_the_same_role_or_one_column_mapped_twice_are_reported() {
        let roles = [
            ("E", Role::X),
            ("E2", Role::X),
            ("N", Role::Y),
            ("N", Role::Attribute),
        ];
        let f = check(&mapping(Kind::Points, &roles), &["E", "E2", "N"]);
        assert_eq!(
            codes(&f),
            ["mapping.source.duplicate", "mapping.role.duplicate"]
        );
        assert_eq!(
            f.as_slice()[0].message,
            "The column \"N\" is mapped more than once."
        );
        assert_eq!(
            f.as_slice()[1].message,
            "More than one column is set as X (easting or longitude)."
        );
    }

    #[test]
    fn columns_that_are_not_in_the_file_are_reported_by_name() {
        let f = check(&mapping(Kind::Points, &POINTS), &["E", "N", "RL"]);
        assert_eq!(codes(&f), ["mapping.source.unknown"]);
        assert_eq!(
            f.as_slice()[0].message,
            "The mapping refers to a column that is not in the file: \"Au\"."
        );
        assert_eq!(f.as_slice()[0].examples[0].column.as_deref(), Some("Au"));
        // Names are matched exactly, including case.
        let wrong_case = check(&mapping(Kind::Points, &POINTS), &["e", "n", "rl", "au"]);
        assert_eq!(wrong_case.len(), 4);
    }

    #[test]
    fn a_coordinate_cannot_be_typed_as_text() {
        let mut m = mapping(Kind::Points, &POINTS[..2]);
        m.columns[0].column_type = Some(ColumnType::Utf8);
        m.columns[1].column_type = Some(ColumnType::Float64);
        let f = check(&m, &["E", "N"]);
        assert_eq!(codes(&f), ["mapping.coordinate.not_numeric"]);
        assert_eq!(
            f.as_slice()[0].message,
            "The column \"E\" is set as X (easting or longitude) but its type is text; coordinates must be numbers."
        );
        m.columns[0].column_type = Some(ColumnType::Int64);
        assert!(check(&m, &["E", "N"]).is_empty());
    }

    #[test]
    fn csv_cannot_produce_polygons_meshes_or_grids() {
        for kind in [Kind::Polygons, Kind::Mesh, Kind::Grid] {
            let f = check(&mapping(kind, &POINTS), &["E", "N", "RL", "Au"]);
            assert_eq!(codes(&f), ["mapping.kind.unsupported"], "{kind:?}");
            assert_eq!(f.as_slice()[0].step, Some(karmania_core::WizardStep::File));
        }
        let f = check(&mapping(Kind::Grid, &[]), &[]);
        assert!(f.as_slice()[0].message.ends_with("not as grid."));
    }

    fn example() -> Value {
        json!({
            "datasetName": "Collars",
            "kind": "points",
            "columns": [
                { "source": "Easting", "role": "x" },
                { "source": "Northing", "role": "y" },
                { "source": "RL", "role": "z" },
                { "source": "Hole", "role": "attribute", "type": "category", "rename": "hole_id" },
                { "source": "Notes", "role": "ignore" }
            ],
            "nodata": { "tokens": ["", "NA"], "numbers": [-999.0, 1.70141e38] },
            "emptyCoordinates": "skip",
            "decimalSeparator": ".",
            "crs": { "kind": "epsg", "code": 32640 }
        })
    }

    fn parse(value: &Value) -> Result<ImportMapping, serde_json::Error> {
        serde_json::from_value(value.clone())
    }

    #[test]
    fn the_documented_example_reads_into_typed_values() {
        let m = parse(&example()).unwrap();
        assert_eq!((m.dataset_name.as_str(), m.kind), ("Collars", Kind::Points));
        assert_eq!(m.columns.len(), 5);
        assert_eq!(
            m.columns[0],
            ColumnMapping {
                source: "Easting".into(),
                role: Role::X,
                column_type: None,
                rename: None
            }
        );
        assert_eq!(m.columns[3].column_type, Some(ColumnType::Categorical));
        assert_eq!(m.columns[3].rename.as_deref(), Some("hole_id"));
        assert_eq!(
            m.nodata,
            Nodata {
                tokens: vec![String::new(), "NA".into()],
                numbers: vec![-999.0, 1.70141e38]
            }
        );
        assert_eq!(
            (m.empty_coordinates, m.decimal_separator),
            (EmptyCoordinates::Skip, DecimalSeparator::Point)
        );
        assert_eq!(m.crs, Some(CrsRef::Epsg { code: 32640 }));
        assert_eq!(m.block_size, None);
    }

    #[test]
    fn writing_it_back_gives_the_same_json() {
        let original = example();
        let m = parse(&original).unwrap();
        assert_eq!(serde_json::to_value(&m).unwrap(), original);
    }

    #[test]
    fn block_size_and_a_local_or_missing_crs_round_trip() {
        let mut v = example();
        v["kind"] = json!("blocks");
        v["blockSize"] = json!([10.0, 10.0, 5.0]);
        v["decimalSeparator"] = json!(",");
        v["crs"] = json!({ "kind": "local", "units": "us_ft" });
        let m = parse(&v).unwrap();
        assert_eq!(m.block_size, Some([10.0, 10.0, 5.0]));
        assert_eq!(m.decimal_separator, DecimalSeparator::Comma);
        assert_eq!(
            m.crs,
            Some(CrsRef::Local {
                units: Units::UsSurveyFoot
            })
        );
        assert_eq!(serde_json::to_value(&m).unwrap(), v);
        v["crs"] = Value::Null;
        assert_eq!(parse(&v).unwrap().crs, None);
        assert_eq!(
            serde_json::to_value(parse(&v).unwrap()).unwrap()["crs"],
            Value::Null
        );
    }

    #[test]
    fn every_kind_and_role_uses_the_documented_name() {
        for kind in ["points", "lines", "polygons", "mesh", "grid", "blocks"] {
            let mut v = example();
            v["kind"] = json!(kind);
            assert_eq!(parse(&v).unwrap().kind.as_str(), kind);
        }
        for role in ["x", "y", "z", "line_id", "attribute", "ignore"] {
            let mut v = example();
            v["columns"][0]["role"] = json!(role);
            assert_eq!(parse(&v).unwrap().columns[0].role.as_str(), role);
        }
        for column_type in ["float", "int", "bool", "text", "category"] {
            let mut v = example();
            v["columns"][3]["type"] = json!(column_type);
            assert_eq!(
                parse(&v).unwrap().columns[3].column_type.unwrap().as_str(),
                column_type
            );
        }
        for decimal in [".", ","] {
            let mut v = example();
            v["decimalSeparator"] = json!(decimal);
            assert_eq!(
                parse(&v).unwrap().decimal_separator.as_char().to_string(),
                decimal
            );
        }
    }

    #[test]
    fn unknown_fields_wrong_names_and_missing_required_fields_are_rejected() {
        let mut extra = example();
        extra["datasetname"] = json!("typo");
        assert!(parse(&extra).is_err());
        let mut column_extra = example();
        column_extra["columns"][0]["colour"] = json!("red");
        assert!(parse(&column_extra).is_err());
        let mut snake = example();
        snake["dataset_name"] = snake["datasetName"].take();
        assert!(parse(&snake).is_err());
        for field in [
            "datasetName",
            "kind",
            "columns",
            "nodata",
            "emptyCoordinates",
            "decimalSeparator",
        ] {
            let mut v = example();
            v.as_object_mut().unwrap().remove(field);
            assert!(parse(&v).is_err(), "accepted a mapping without {field}");
        }
    }

    #[test]
    fn bad_values_are_rejected_not_guessed() {
        let bad = [
            ("kind", json!("point")),
            ("emptyCoordinates", json!("ignore")),
            ("decimalSeparator", json!("comma")),
            ("blockSize", json!([1.0, 2.0])),
            ("blockSize", json!("10")),
            ("crs", json!({ "kind": "epsg" })),
            ("nodata", json!({ "tokens": [1], "numbers": [] })),
            ("nodata", json!({ "tokens": [], "numbers": ["-999"] })),
        ];
        for (field, value) in bad {
            let mut v = example();
            v[field] = value.clone();
            assert!(parse(&v).is_err(), "accepted {field} = {value}");
        }
        let mut bad_role = example();
        bad_role["columns"][0]["role"] = json!("X");
        assert!(parse(&bad_role).is_err());
        let mut bad_type = example();
        bad_type["columns"][3]["type"] = json!("string");
        assert!(parse(&bad_type).is_err());
    }
}
