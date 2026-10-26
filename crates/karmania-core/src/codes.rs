//! The registry of stable finding codes.
//!
//! Every finding carries a [`FindingCode`]. A code fixes the finding's severity
//! and the wizard step that can fix it, so one code always means the same thing.
//! Codes are stable once released: never rename one or change its meaning, add
//! a new code instead. Each code is documented in `docs/validation-codes.md`,
//! and a test fails if the registry and that file disagree.

use serde::{Serialize, Serializer};

use crate::findings::{Severity, WizardStep};

/// Declares [`FindingCode`] and its lookups from one table, so a code cannot be
/// added to the enum and forgotten in `ALL`, `as_str`, `severity` or `step`.
macro_rules! finding_codes {
    ($($(#[$meta:meta])* $variant:ident => $code:literal, $severity:ident, $step:expr;)+) => {
        /// A stable identifier for one kind of finding.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub enum FindingCode {
            $($(#[$meta])* $variant,)+
        }

        impl FindingCode {
            /// Every registered code, in declaration order.
            pub const ALL: &'static [FindingCode] = &[$(FindingCode::$variant,)+];

            /// The dotted lowercase identifier, for example `table.column.name_empty`.
            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(FindingCode::$variant => $code,)+
                }
            }

            /// The severity every finding with this code has.
            #[must_use]
            pub const fn severity(self) -> Severity {
                match self {
                    $(FindingCode::$variant => Severity::$severity,)+
                }
            }

            /// The wizard step that can fix findings with this code, if any.
            #[must_use]
            pub const fn step(self) -> Option<WizardStep> {
                match self {
                    $(FindingCode::$variant => $step,)+
                }
            }
        }
    };
}

finding_codes! {
    /// The X, Y and Z coordinate lists have different lengths.
    DatasetCoordinatesLengthMismatch => "dataset.coordinates.length_mismatch", Error, None;
    /// The dataset has more elements than the size limit allows.
    DatasetTooLarge => "dataset.too_large", Error, None;
    /// A table column has a different number of rows from the first column.
    TableColumnLengthMismatch => "table.column.length_mismatch", Error, None;
    /// A table column has no name.
    TableColumnNameEmpty => "table.column.name_empty", Error, Some(WizardStep::Mapping);
    /// Two or more table columns share a name.
    TableColumnNameDuplicate => "table.column.name_duplicate", Error, Some(WizardStep::Mapping);
}

impl Serialize for FindingCode {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    const DOCS: &str = include_str!("../../../docs/validation-codes.md");

    /// One `## \`code\`` section of the docs file.
    #[derive(Default)]
    struct Entry {
        code: String,
        severity: String,
        step: String,
        message: String,
        hint: String,
        example: String,
    }

    fn parse_docs(text: &str) -> Vec<Entry> {
        let mut entries: Vec<Entry> = Vec::new();
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("## `") {
                let code = rest.trim_end_matches('`').to_string();
                entries.push(Entry {
                    code,
                    ..Entry::default()
                });
            } else if let Some(entry) = entries.last_mut() {
                let field = |prefix: &str| line.strip_prefix(prefix).map(|v| v.trim().to_string());
                if let Some(v) = field("- Severity:") {
                    entry.severity = v;
                } else if let Some(v) = field("- Step:") {
                    entry.step = v;
                } else if let Some(v) = field("- Message:") {
                    entry.message = v;
                } else if let Some(v) = field("- Hint:") {
                    entry.hint = v;
                } else if let Some(v) = field("- Example:") {
                    entry.example = v;
                }
            }
        }
        entries
    }

    fn follows_the_code_style(code: &str) -> bool {
        let segments: Vec<&str> = code.split('.').collect();
        (2..=3).contains(&segments.len())
            && segments.iter().all(|s| {
                s.chars().next().is_some_and(|c| c.is_ascii_lowercase())
                    && s.chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
            })
    }

    #[test]
    fn codes_are_unique_and_follow_the_style() {
        let mut seen = BTreeSet::new();
        for code in FindingCode::ALL {
            let text = code.as_str();
            assert!(follows_the_code_style(text), "bad code style: {text}");
            assert!(seen.insert(text), "duplicate code: {text}");
        }
    }

    #[test]
    fn a_code_serializes_as_its_string() {
        let json = serde_json::to_string(&FindingCode::DatasetTooLarge).unwrap();
        assert_eq!(json, r#""dataset.too_large""#);
    }

    #[test]
    fn every_registered_code_is_documented_and_the_docs_match() {
        let docs = parse_docs(DOCS);
        for code in FindingCode::ALL {
            let name = code.as_str();
            let entry = docs
                .iter()
                .find(|e| e.code == name)
                .unwrap_or_else(|| panic!("{name} is missing from docs/validation-codes.md"));
            assert_eq!(entry.severity, code.severity().as_str(), "{name}: severity");
            let step = code.step().map_or("none", WizardStep::as_str);
            assert_eq!(entry.step, step, "{name}: step");
            for (field, value) in [
                ("Message", &entry.message),
                ("Hint", &entry.hint),
                ("Example", &entry.example),
            ] {
                assert!(!value.is_empty(), "{name}: missing {field}");
            }
        }
    }

    #[test]
    fn the_docs_list_no_code_that_is_not_registered_and_are_sorted() {
        let docs = parse_docs(DOCS);
        let registered: BTreeSet<&str> = FindingCode::ALL.iter().map(|c| c.as_str()).collect();
        for entry in &docs {
            assert!(
                registered.contains(entry.code.as_str()),
                "stale doc: {}",
                entry.code
            );
        }
        let names: Vec<&str> = docs.iter().map(|e| e.code.as_str()).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(
            names, sorted,
            "docs must be sorted by code, without duplicates"
        );
    }
}
