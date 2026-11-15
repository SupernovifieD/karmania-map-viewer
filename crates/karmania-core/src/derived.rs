//! What a dataset was made from, when it was made from another dataset (contour lines).

use serde::{Deserialize, Serialize};

use crate::dataset::DatasetId;

/// The settings of a set of contour lines. In JSON: `{ "column": .., "interval": .., "base": .., "indexEvery": .. }`; `column` is only
/// for grids and is left out when it is not given (a grid then uses its first column of numbers).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContourParams {
    /// Grids only: the column the heights are in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
    /// The height between two lines, greater than 0.
    pub interval: f64,
    /// A height that has a line; the others are `base + k * interval`.
    pub base: f64,
    /// Every this many lines is an index line, the base being one; 1 or more.
    pub index_every: u32,
}

/// How a dataset was made from another. In JSON the `kind` and what that kind has: `{ "kind": "contours", "params": { .. } }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Derivation {
    /// Contour lines of a grid or a mesh, with the settings they were made with.
    Contours {
        /// The settings, as they were when the lines were made (the interval is the one used, not "default").
        params: ContourParams,
    },
}

/// The dataset another was made from, and how. In JSON: `{ "id": 3, "kind": "contours", "params": { .. } }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DerivedFrom {
    /// The dataset it was made from.
    pub id: DatasetId,
    /// How.
    #[serde(flatten)]
    pub how: Derivation,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params() -> ContourParams {
        ContourParams {
            column: Some("z".to_string()),
            interval: 2.5,
            base: 0.0,
            index_every: 5,
        }
    }

    #[test]
    fn the_settings_have_their_names_in_json_and_leave_out_a_column_that_is_not_given() {
        let json = serde_json::to_value(params()).unwrap();
        assert_eq!(
            json,
            json!({"column": "z", "interval": 2.5, "base": 0.0, "indexEvery": 5})
        );
        let none = ContourParams {
            column: None,
            ..params()
        };
        assert_eq!(
            serde_json::to_value(&none).unwrap(),
            json!({"interval": 2.5, "base": 0.0, "indexEvery": 5})
        );
        let read: ContourParams =
            serde_json::from_value(json!({"interval": 1, "base": 0.5, "indexEvery": 4})).unwrap();
        assert_eq!(
            read,
            ContourParams {
                column: None,
                interval: 1.0,
                base: 0.5,
                index_every: 4
            }
        );
    }

    #[test]
    fn what_a_dataset_came_from_is_its_id_the_kind_and_the_settings_in_one_object() {
        let from = DerivedFrom {
            id: DatasetId(3),
            how: Derivation::Contours { params: params() },
        };
        let json = serde_json::to_value(&from).unwrap();
        assert_eq!(
            json,
            json!({
                "id": 3,
                "kind": "contours",
                "params": {"column": "z", "interval": 2.5, "base": 0.0, "indexEvery": 5}
            })
        );
        assert_eq!(serde_json::from_value::<DerivedFrom>(json).unwrap(), from);
    }
}
