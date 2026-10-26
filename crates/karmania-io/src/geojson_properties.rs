//! Attribute columns from the properties of GeoJSON features.
//!
//! The properties of a feature are a JSON object whose values can be anything.
//! One column is made for each property name, and its type comes from the values
//! across all the features:
//!
//! - all true/false values give a `Bool` column;
//! - all numbers give `Int64` if every one is a whole number that fits, `Float64`
//!   otherwise;
//! - all text gives `Categorical` when few values repeat a lot (the same rule as
//!   for CSV), `Utf8` otherwise;
//! - anything else (different kinds of value, or lists and objects) is read as
//!   text, with a warning.
//!
//! A missing property and a `null` are both null. JSON objects are unordered, so
//! the columns come in alphabetical order of property name.

use std::collections::{BTreeMap, BTreeSet};

use karmania_core::{Column, ColumnData, Finding, FindingCode, Findings, Location, Validity};
use serde_json::{Map, Value};

use crate::infer::is_category;

/// The properties of one feature, and where the feature is in the file.
#[derive(Debug, Clone, Copy)]
pub struct Properties<'a> {
    /// The position of the feature in the file, counting from 0.
    pub index: u64,
    /// The `properties` member, if the feature has an object there.
    pub values: Option<&'a Map<String, Value>>,
}

/// What a JSON value is, for deciding a column's type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Kind {
    Bool,
    Number,
    Text,
    Nested,
}

impl Kind {
    fn of(value: &Value) -> Option<Self> {
        match value {
            Value::Null => None,
            Value::Bool(_) => Some(Self::Bool),
            Value::Number(_) => Some(Self::Number),
            Value::String(_) => Some(Self::Text),
            Value::Array(_) | Value::Object(_) => Some(Self::Nested),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Bool => "true/false",
            Self::Number => "numbers",
            Self::Text => "text",
            Self::Nested => "lists or objects",
        }
    }
}

/// How a column is stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shape {
    Bool,
    Int,
    Float,
    Text,
    Category,
    /// Text made from values that were not text.
    ConvertedText,
}

/// Builds the attribute columns for the rows of one dataset.
///
/// `features` are the features the rows came from and `rows[r]` is the position
/// in `features` of the feature that row `r` belongs to (a feature with several
/// parts has several rows). Columns come in alphabetical order of property name.
/// Properties with a blank name are left out, with a warning.
pub fn property_columns(
    features: &[Properties<'_>],
    rows: &[usize],
    findings: &mut Findings,
) -> Vec<Column> {
    let mut names: BTreeSet<&str> = BTreeSet::new();
    let mut unnamed = Finding::new(
        FindingCode::GeojsonPropertyUnnamed,
        "Some features have a property with no name; it was left out.",
    )
    .with_hint("Give every property a name.");
    unnamed.count = 0;
    for feature in features {
        for key in feature.values.into_iter().flat_map(Map::keys) {
            if key.trim().is_empty() {
                unnamed.count += 1;
                unnamed.add_example(Location::default().with_element(feature.index));
            } else {
                names.insert(key);
            }
        }
    }
    if unnamed.count > 0 {
        findings.add(unnamed);
    }

    let mut columns = Vec::with_capacity(names.len());
    for name in names {
        let cells: Vec<Option<&Value>> = features
            .iter()
            .map(|f| f.values.and_then(|m| m.get(name)).filter(|v| !v.is_null()))
            .collect();
        let shape = shape_of(name, features, &cells, findings);
        columns.extend(build(name, &cells, rows, shape));
    }
    columns
}

/// Decides how a property is stored, warning if it has to become text.
fn shape_of(
    name: &str,
    features: &[Properties<'_>],
    cells: &[Option<&Value>],
    findings: &mut Findings,
) -> Shape {
    let kinds: BTreeSet<Kind> = cells.iter().flatten().filter_map(|v| Kind::of(v)).collect();
    let all_whole = cells
        .iter()
        .flatten()
        .filter(|v| v.is_number())
        .all(|v| v.as_i64().is_some());
    match kinds.iter().copied().collect::<Vec<_>>().as_slice() {
        [] => Shape::Text,
        [Kind::Bool] => Shape::Bool,
        [Kind::Number] if all_whole => Shape::Int,
        [Kind::Number] => Shape::Float,
        [Kind::Text] => {
            let strings: Vec<&str> = cells.iter().flatten().filter_map(|v| v.as_str()).collect();
            let distinct: BTreeSet<&str> = strings.iter().copied().collect();
            if is_category(distinct.len(), strings.len()) {
                Shape::Category
            } else {
                Shape::Text
            }
        }
        _ => {
            let reason = if kinds.len() > 1 {
                let names: Vec<&str> = kinds.iter().map(|k| k.name()).collect();
                format!("its values are of different kinds ({})", join_and(&names))
            } else {
                "its values are lists or objects".to_string()
            };
            let mut finding = Finding::new(
                FindingCode::GeojsonPropertyAsText,
                format!("The property \"{name}\" was read as text because {reason}."),
            )
            .with_hint("Use the same kind of value for a property in every feature.");
            finding.count = 0;
            for (feature, cell) in features.iter().zip(cells) {
                if cell.is_some_and(|v| !v.is_string()) {
                    finding.count += 1;
                    finding.add_example(
                        Location::default()
                            .with_element(feature.index)
                            .with_column(name),
                    );
                }
            }
            findings.add(finding);
            Shape::ConvertedText
        }
    }
}

/// "a", "a and b", "a, b and c".
fn join_and(words: &[&str]) -> String {
    match words {
        [] => String::new(),
        [only] => (*only).to_string(),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    }
}

fn build(name: &str, cells: &[Option<&Value>], rows: &[usize], shape: Shape) -> Option<Column> {
    let values = || rows.iter().map(|&slot| cells.get(slot).copied().flatten());
    let validity = Validity::from_flags(values().map(|v| v.is_some()));
    let data = match shape {
        Shape::Bool => ColumnData::Bool(
            values()
                .map(|v| v.and_then(Value::as_bool).unwrap_or(false))
                .collect(),
        ),
        Shape::Int => ColumnData::Int64(
            values()
                .map(|v| v.and_then(Value::as_i64).unwrap_or(0))
                .collect(),
        ),
        Shape::Float => ColumnData::Float64(
            values()
                .map(|v| v.and_then(Value::as_f64).unwrap_or(0.0))
                .collect(),
        ),
        Shape::Text | Shape::ConvertedText => ColumnData::Utf8(
            values()
                .map(|v| v.map(text_of).unwrap_or_default())
                .collect(),
        ),
        Shape::Category => {
            let mut dictionary: Vec<String> = Vec::new();
            let mut index: BTreeMap<&str, u32> = BTreeMap::new();
            let codes = values()
                .map(|v| {
                    let Some(text) = v.and_then(Value::as_str) else {
                        return 0;
                    };
                    let next = u32::try_from(dictionary.len()).unwrap_or(u32::MAX);
                    *index.entry(text).or_insert_with(|| {
                        dictionary.push(text.to_string());
                        next
                    })
                })
                .collect();
            ColumnData::Categorical { codes, dictionary }
        }
    };
    Column::new(name, data, validity).ok()
}

/// A value as text: strings as they are, everything else as compact JSON.
fn text_of(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use karmania_core::{ColumnType, Value as Cell};
    use serde_json::json;

    /// One feature per object, in order, each its own row.
    fn run(objects: &[serde_json::Value]) -> (Vec<Column>, Findings) {
        let features: Vec<Properties<'_>> = objects
            .iter()
            .enumerate()
            .map(|(i, v)| Properties {
                index: i as u64,
                values: v.as_object(),
            })
            .collect();
        let rows: Vec<usize> = (0..features.len()).collect();
        let mut findings = Findings::new();
        let columns = property_columns(&features, &rows, &mut findings);
        (columns, findings)
    }

    fn types(columns: &[Column]) -> Vec<(&str, ColumnType)> {
        columns
            .iter()
            .map(|c| (c.name(), c.column_type()))
            .collect()
    }

    fn codes(findings: &Findings) -> Vec<&'static str> {
        findings.iter().map(|f| f.code.as_str()).collect()
    }

    #[test]
    fn each_property_gets_a_column_typed_from_all_its_values() {
        let (columns, findings) = run(&[
            json!({"name": "A", "depth": 120.5, "n": 1, "ok": true}),
            json!({"name": "B", "depth": 98, "n": 2, "ok": false}),
            json!({"name": "C", "depth": 1, "n": 3, "ok": true}),
        ]);
        assert!(findings.is_empty());
        // Alphabetical, not file order.
        assert_eq!(
            types(&columns),
            [
                ("depth", ColumnType::Float64),
                ("n", ColumnType::Int64),
                ("name", ColumnType::Utf8),
                ("ok", ColumnType::Bool),
            ]
        );
        // Whole numbers among decimals are read as decimals.
        assert_eq!(columns[0].get(1), Some(Cell::Float64(98.0)));
        assert_eq!(columns[1].get(2), Some(Cell::Int64(3)));
        assert_eq!(columns[3].get(1), Some(Cell::Bool(false)));
    }

    #[test]
    fn missing_properties_and_nulls_are_null() {
        let (columns, findings) = run(&[
            json!({"a": 1, "b": null}),
            json!({"b": "x"}),
            json!(null),
            json!({"a": 3}),
        ]);
        assert!(findings.is_empty());
        let a = &columns[0];
        assert_eq!(
            (a.get(0), a.get(1), a.get(2), a.get(3)),
            (Some(Cell::Int64(1)), None, None, Some(Cell::Int64(3)),)
        );
        assert_eq!(columns[1].null_count(), 3);
        assert_eq!(a.len(), 4);
    }

    #[test]
    fn repeated_text_becomes_a_category_and_varied_text_stays_text() {
        let objects: Vec<_> = (0..20)
            .map(|i| json!({"rock": if i % 2 == 0 { "ore" } else { "waste" }, "id": format!("id{i}")}))
            .collect();
        let (columns, _) = run(&objects);
        assert_eq!(
            types(&columns),
            [("id", ColumnType::Utf8), ("rock", ColumnType::Categorical)]
        );
        // Codes follow the first appearance.
        assert_eq!(
            columns[1].get(1),
            Some(Cell::Category {
                code: 1,
                label: Some("waste")
            })
        );
    }

    #[test]
    fn different_kinds_of_value_become_text_with_a_warning_that_counts_the_converted() {
        let (columns, findings) = run(&[
            json!({"depth": 12.5}),
            json!({"depth": "unknown"}),
            json!({"depth": true}),
            json!({"depth": 7}),
        ]);
        assert_eq!(types(&columns), [("depth", ColumnType::Utf8)]);
        let texts: Vec<_> = (0..4).map(|i| columns[0].get(i)).collect();
        assert_eq!(
            texts,
            [
                Some(Cell::Utf8("12.5")),
                Some(Cell::Utf8("unknown")),
                Some(Cell::Utf8("true")),
                Some(Cell::Utf8("7")),
            ]
        );
        assert_eq!(codes(&findings), ["geojson.property.as_text"]);
        let f = &findings.as_slice()[0];
        assert_eq!(
            f.message,
            "The property \"depth\" was read as text because its values are of different kinds (true/false, numbers and text)."
        );
        // The text value was already text, so three values were converted.
        assert_eq!(f.count, 3);
        let at: Vec<_> = f.examples.iter().map(|l| l.element).collect();
        assert_eq!(at, [Some(0), Some(2), Some(3)]);
        assert_eq!(f.examples[0].column.as_deref(), Some("depth"));
    }

    #[test]
    fn lists_and_objects_are_kept_as_compact_json_text() {
        let (columns, findings) = run(&[json!({"tags": ["a", 1]}), json!({"tags": {"k": null}})]);
        assert_eq!(types(&columns), [("tags", ColumnType::Utf8)]);
        assert_eq!(columns[0].get(0), Some(Cell::Utf8("[\"a\",1]")));
        assert_eq!(columns[0].get(1), Some(Cell::Utf8("{\"k\":null}")));
        assert_eq!(
            findings.as_slice()[0].message,
            "The property \"tags\" was read as text because its values are lists or objects."
        );
    }

    #[test]
    fn numbers_too_big_for_a_whole_number_are_decimals() {
        let (columns, _) = run(&[
            json!({"big": 18_446_744_073_709_551_615u64}),
            json!({"big": 1}),
        ]);
        assert_eq!(types(&columns), [("big", ColumnType::Float64)]);
        let whole = run(&[json!({"n": i64::MIN}), json!({"n": i64::MAX})]).0;
        assert_eq!(types(&whole), [("n", ColumnType::Int64)]);
    }

    #[test]
    fn a_property_that_is_always_null_is_an_empty_text_column() {
        let (columns, findings) = run(&[json!({"a": null}), json!({"a": null})]);
        assert!(findings.is_empty());
        assert_eq!(types(&columns), [("a", ColumnType::Utf8)]);
        assert_eq!(columns[0].null_count(), 2);
    }

    #[test]
    fn blank_property_names_are_left_out_with_a_warning() {
        let (columns, findings) = run(&[json!({"": 1, "ok": 2}), json!({"  ": 3, "ok": 4})]);
        assert_eq!(types(&columns), [("ok", ColumnType::Int64)]);
        assert_eq!(codes(&findings), ["geojson.property.unnamed"]);
        assert_eq!(findings.as_slice()[0].count, 2);
    }

    #[test]
    fn a_feature_with_several_rows_repeats_its_values_on_each() {
        let objects = [json!({"v": 1}), json!({"v": 2})];
        let features: Vec<_> = objects
            .iter()
            .enumerate()
            .map(|(i, v)| Properties {
                index: 10 + i as u64,
                values: v.as_object(),
            })
            .collect();
        // Feature 0 has three rows (a multi-part geometry), feature 1 has one.
        let mut findings = Findings::new();
        let columns = property_columns(&features, &[0, 0, 0, 1], &mut findings);
        let values: Vec<_> = (0..4).map(|i| columns[0].get(i)).collect();
        assert_eq!(
            values,
            [
                Some(Cell::Int64(1)),
                Some(Cell::Int64(1)),
                Some(Cell::Int64(1)),
                Some(Cell::Int64(2))
            ]
        );
    }

    #[test]
    fn no_features_and_no_properties_give_no_columns() {
        assert!(run(&[]).0.is_empty());
        assert!(run(&[json!({}), json!(null), json!(5)]).0.is_empty());
    }

    #[test]
    fn the_same_input_always_gives_the_same_columns() {
        let objects = [json!({"z": 1, "a": "x", "m": true}), json!({"a": "y"})];
        let first = run(&objects);
        let second = run(&objects);
        assert_eq!(first.0, second.0);
        let names: Vec<_> = first.0.iter().map(Column::name).collect();
        assert_eq!(names, ["a", "m", "z"]);
    }
}
