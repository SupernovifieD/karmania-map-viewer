//! The import mapping: the contract between the import wizard and the readers.
//!
//! It says what each column of a file is for, which values mean "no data", how
//! numbers are written and which coordinate reference system the data is in. It is
//! sent as JSON (camelCase field names) and unknown fields are rejected, so a typo
//! in a client is an error instead of a silently ignored setting.

use karmania_core::{ColumnType, CrsRef, Kind};
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

#[cfg(test)]
mod tests {
    use super::*;
    use karmania_core::Units;
    use serde_json::{Value, json};

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
