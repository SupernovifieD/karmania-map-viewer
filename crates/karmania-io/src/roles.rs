//! Suggesting what each column of a table is for, from its header name.

use karmania_core::ColumnType;

/// What a column is used for in an import.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    /// The X coordinate (easting or longitude).
    X,
    /// The Y coordinate (northing or latitude).
    Y,
    /// The Z coordinate (elevation).
    Z,
    /// The line a row belongs to, for line data.
    LineId,
    /// An ordinary attribute, kept as a column of the dataset.
    Attribute,
    /// Left out of the dataset.
    Ignore,
}

impl Role {
    /// The name used by the import mapping: `x`, `y`, `z`, `line_id`,
    /// `attribute` or `ignore`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Role::X => "x",
            Role::Y => "y",
            Role::Z => "z",
            Role::LineId => "line_id",
            Role::Attribute => "attribute",
            Role::Ignore => "ignore",
        }
    }
}

/// A suggested role for one column and how sure the guess is, from 0 to 1.
///
/// A coordinate or line suggestion comes from the column's name; a column with
/// no recognised name is suggested as an ordinary attribute with confidence 0.5,
/// which means "no idea".
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoleSuggestion {
    /// The suggested role.
    pub role: Role,
    /// Confidence from 0 to 1.
    pub confidence: f64,
}

/// Names that point at a role, after normalising, with how much to trust them.
/// A longer, more specific name is more reliable than a single letter.
const NAMES: [(&str, Role, f64); 40] = [
    ("x", Role::X, 0.9),
    ("east", Role::X, 0.95),
    ("easting", Role::X, 0.95),
    ("eastings", Role::X, 0.95),
    ("xc", Role::X, 0.95),
    ("xcoord", Role::X, 0.95),
    ("xcoordinate", Role::X, 0.95),
    ("xcentre", Role::X, 0.95),
    ("xcenter", Role::X, 0.95),
    ("lon", Role::X, 0.95),
    ("long", Role::X, 0.8),
    ("longitude", Role::X, 0.95),
    ("y", Role::Y, 0.9),
    ("north", Role::Y, 0.95),
    ("northing", Role::Y, 0.95),
    ("northings", Role::Y, 0.95),
    ("yc", Role::Y, 0.95),
    ("ycoord", Role::Y, 0.95),
    ("ycoordinate", Role::Y, 0.95),
    ("ycentre", Role::Y, 0.95),
    ("ycenter", Role::Y, 0.95),
    ("lat", Role::Y, 0.95),
    ("latitude", Role::Y, 0.95),
    ("z", Role::Z, 0.9),
    ("rl", Role::Z, 0.9),
    ("elev", Role::Z, 0.95),
    ("elevation", Role::Z, 0.95),
    ("zc", Role::Z, 0.95),
    ("zcoord", Role::Z, 0.95),
    ("zcoordinate", Role::Z, 0.95),
    ("zcentre", Role::Z, 0.95),
    ("zcenter", Role::Z, 0.95),
    // Depth grows downwards while Z grows upwards, so this is only a hint.
    ("depth", Role::Z, 0.5),
    ("line", Role::LineId, 0.8),
    ("lineid", Role::LineId, 0.9),
    ("lineno", Role::LineId, 0.8),
    ("linenum", Role::LineId, 0.8),
    ("linenumber", Role::LineId, 0.8),
    ("linename", Role::LineId, 0.8),
    ("lineref", Role::LineId, 0.7),
];

/// Lowercases a header name and keeps only letters and digits, after dropping a
/// trailing unit in brackets: `Easting (m)` becomes `easting`.
fn normalise(name: &str) -> String {
    let trimmed = name.trim();
    let without_unit = match trimmed.rfind(['(', '[']) {
        Some(at) if at > 0 && trimmed.ends_with([')', ']']) => trimmed.get(..at).unwrap_or(trimmed),
        _ => trimmed,
    };
    without_unit
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// Suggests a role for each column from its name and type.
///
/// Coordinates must be numeric columns. Each of X, Y, Z and the line identifier
/// goes to at most one column, the best match, the leftmost on a tie; the other
/// columns are left as attributes.
#[must_use]
pub fn suggest_roles(header: &[String], types: &[ColumnType]) -> Vec<RoleSuggestion> {
    let mut best: Vec<Option<(Role, f64)>> = Vec::with_capacity(header.len());
    for (index, name) in header.iter().enumerate() {
        let normal = normalise(name);
        let numeric = matches!(
            types.get(index),
            Some(ColumnType::Float64 | ColumnType::Int64)
        );
        let found = NAMES
            .iter()
            .filter(|(candidate, role, _)| {
                *candidate == normal && (numeric || !matches!(role, Role::X | Role::Y | Role::Z))
            })
            .max_by(|a, b| a.2.total_cmp(&b.2))
            .map(|&(_, role, confidence)| (role, confidence));
        best.push(found);
    }
    let mut chosen: Vec<RoleSuggestion> = header
        .iter()
        .map(|_| RoleSuggestion {
            role: Role::Attribute,
            confidence: 0.5,
        })
        .collect();
    for role in [Role::X, Role::Y, Role::Z, Role::LineId] {
        let mut winner: Option<(usize, f64)> = None;
        for (index, found) in best.iter().enumerate() {
            if let Some((r, confidence)) = *found
                && r == role
                && winner.is_none_or(|(_, c)| confidence > c)
            {
                winner = Some((index, confidence));
            }
        }
        if let Some((index, confidence)) = winner
            && let Some(slot) = chosen.get_mut(index)
        {
            *slot = RoleSuggestion { role, confidence };
        }
    }
    chosen
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delimited::sniff;
    use crate::fixtures;
    use crate::infer::{detect_decimal_separator, infer_types};
    use ColumnType::{Float64, Int64, Utf8};
    use karmania_core::Findings;

    fn names(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    fn roles(items: &[&str], types: &[ColumnType]) -> Vec<Role> {
        suggest_roles(&names(items), types)
            .iter()
            .map(|s| s.role)
            .collect()
    }

    fn fixture_roles(name: &str) -> Vec<Role> {
        let s = sniff(&fixtures::text(name), &mut Findings::new()).unwrap();
        let decimal = detect_decimal_separator(&s.rows, s.delimiter);
        let types = infer_types(&s.rows, s.header.len(), decimal);
        suggest_roles(&s.header, &types)
            .iter()
            .map(|r| r.role)
            .collect()
    }

    #[test]
    fn the_sample_files_get_their_coordinate_roles() {
        use Role::{Attribute, LineId, X, Y, Z};
        assert_eq!(
            fixture_roles("points.csv"),
            [X, Y, Z, Attribute, Attribute, Attribute]
        );
        assert_eq!(fixture_roles("blocks.csv"), [X, Y, Z, Attribute, Attribute]);
        assert_eq!(fixture_roles("lines.csv"), [LineId, X, Y, Z]);
    }

    #[test]
    fn every_listed_name_is_recognised_in_any_case() {
        let cases: [(&[&str], Role); 3] = [
            (
                &[
                    "X",
                    "EAST",
                    "EASTING",
                    "XC",
                    "XCOORD",
                    "XCENTRE",
                    "LON",
                    "LONG",
                    "LONGITUDE",
                ],
                Role::X,
            ),
            (
                &[
                    "Y", "NORTH", "NORTHING", "YC", "YCOORD", "YCENTRE", "LAT", "LATITUDE",
                ],
                Role::Y,
            ),
            (
                &[
                    "Z",
                    "RL",
                    "ELEV",
                    "ELEVATION",
                    "ZC",
                    "ZCOORD",
                    "ZCENTRE",
                    "DEPTH",
                ],
                Role::Z,
            ),
        ];
        for (list, expected) in cases {
            for name in list {
                for variant in [name.to_string(), name.to_lowercase(), format!("  {name}  ")] {
                    let got = roles(&[&variant], &[Float64]);
                    assert_eq!(got, [expected], "{variant:?}");
                }
            }
        }
    }

    #[test]
    fn units_in_brackets_and_punctuation_do_not_matter() {
        for name in [
            "Easting (m)",
            "Easting[m]",
            "East_ing",
            "X-Coord",
            "x coord",
            "XCoord (UTM 40N)",
        ] {
            assert_eq!(roles(&[name], &[Float64]), [Role::X], "{name:?}");
        }
        assert_eq!(roles(&["Line ID"], &[Utf8]), [Role::LineId]);
        assert_eq!(roles(&["line_id"], &[Utf8]), [Role::LineId]);
    }

    #[test]
    fn confidence_is_higher_for_specific_names_than_for_single_letters_or_depth() {
        let c = |name: &str| suggest_roles(&names(&[name]), &[Float64])[0].confidence;
        assert!(c("Easting") > c("X"));
        assert!(c("X") > c("Long"));
        assert!(c("Long") > c("Depth"));
        assert_eq!(c("Depth"), 0.5);
        for name in ["X", "Easting", "Depth", "unknown"] {
            assert!((0.0..=1.0).contains(&c(name)));
        }
    }

    #[test]
    fn a_coordinate_name_on_a_text_column_is_not_a_coordinate() {
        assert_eq!(
            roles(&["X", "Y"], &[Utf8, Float64]),
            [Role::Attribute, Role::Y]
        );
        assert_eq!(roles(&["X"], &[]), [Role::Attribute]);
        // Integers are fine, as in block models.
        assert_eq!(roles(&["XC"], &[Int64]), [Role::X]);
    }

    #[test]
    fn only_one_column_gets_each_role_the_best_then_the_leftmost() {
        // "Easting" (0.95) beats "X" (0.9) even though X comes first.
        let r = suggest_roles(&names(&["X", "Easting", "Y"]), &[Float64, Float64, Float64]);
        assert_eq!(
            r.iter().map(|s| s.role).collect::<Vec<_>>(),
            [Role::Attribute, Role::X, Role::Y]
        );
        // A tie goes to the leftmost.
        let tie = suggest_roles(&names(&["Easting", "East"]), &[Float64, Float64]);
        assert_eq!(
            tie.iter().map(|s| s.role).collect::<Vec<_>>(),
            [Role::X, Role::Attribute]
        );
    }

    #[test]
    fn unknown_empty_and_missing_names_are_attributes_with_no_confidence() {
        let r = suggest_roles(&names(&["Au_ppm", "", "  ", "Hole"]), &[Float64; 4]);
        assert!(
            r.iter()
                .all(|s| s.role == Role::Attribute && s.confidence == 0.5)
        );
        assert!(suggest_roles(&[], &[]).is_empty());
    }

    #[test]
    fn role_names_match_the_import_mapping() {
        let all = [
            Role::X,
            Role::Y,
            Role::Z,
            Role::LineId,
            Role::Attribute,
            Role::Ignore,
        ];
        let names: Vec<_> = all.iter().map(|r| r.as_str()).collect();
        assert_eq!(names, ["x", "y", "z", "line_id", "attribute", "ignore"]);
    }
}
