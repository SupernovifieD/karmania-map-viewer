//! Attribute tables: ordered named columns of equal length.

use std::collections::{BTreeMap, BTreeSet};

use crate::codes::FindingCode;
use crate::column::Column;
use crate::findings::{Finding, Findings, Location};
use crate::text::format_count;

/// An ordered set of columns. Names are unique and non-empty and every column
/// has the same number of rows; [`Table::from_columns`] enforces both.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Table {
    columns: Vec<Column>,
    row_count: usize,
}

impl Table {
    /// A table with no columns and no rows.
    #[must_use]
    pub fn empty() -> Self {
        Self::default()
    }

    /// Builds a table from columns, keeping their order.
    ///
    /// Problems are reported to `findings` and return `None`: a column with an
    /// empty (or blank) name, a name used more than once, or a column whose
    /// length differs from the first column's. All problems found are reported,
    /// not just the first. No columns at all is a valid, empty table.
    pub fn from_columns(columns: Vec<Column>, findings: &mut Findings) -> Option<Self> {
        let mut ok = true;

        for (i, column) in columns.iter().enumerate() {
            if column.name().trim().is_empty() {
                ok = false;
                findings.add(
                    Finding::new(
                        FindingCode::TableColumnNameEmpty,
                        format!("Column {} has no name.", format_count(i as u64 + 1)),
                    )
                    .with_hint("Give the column a name, or ignore it."),
                );
            }
        }

        let mut uses: BTreeMap<&str, u64> = BTreeMap::new();
        for column in columns.iter().filter(|c| !c.name().trim().is_empty()) {
            *uses.entry(column.name()).or_insert(0) += 1;
        }
        let mut reported = BTreeSet::new();
        for column in &columns {
            let name = column.name();
            if let Some(&times) = uses.get(name)
                && times > 1
                && reported.insert(name)
            {
                ok = false;
                let mut finding = Finding::new(
                    FindingCode::TableColumnNameDuplicate,
                    format!("The column name \"{name}\" is used more than once."),
                )
                .with_hint("Give each column a different name, or ignore the extra columns.")
                .at(Location::default().with_column(name));
                finding.count = times;
                findings.add(finding);
            }
        }

        if let Some(first) = columns.first() {
            for column in columns.iter().skip(1).filter(|c| c.len() != first.len()) {
                ok = false;
                findings.add(
                    Finding::new(
                        FindingCode::TableColumnLengthMismatch,
                        format!(
                            "Column \"{}\" has {} values, but the first column \"{}\" has {}.",
                            column.name(),
                            format_count(column.len() as u64),
                            first.name(),
                            format_count(first.len() as u64),
                        ),
                    )
                    .with_hint("Make every column the same length.")
                    .at(Location::default().with_column(column.name())),
                );
            }
        }

        if !ok {
            return None;
        }
        let row_count = columns.first().map_or(0, Column::len);
        Some(Self { columns, row_count })
    }

    /// The columns, in order.
    #[must_use]
    pub fn columns(&self) -> &[Column] {
        &self.columns
    }

    /// The column called `name`, if any.
    #[must_use]
    pub fn column(&self, name: &str) -> Option<&Column> {
        self.columns.iter().find(|c| c.name() == name)
    }

    /// Number of columns.
    #[must_use]
    pub fn column_count(&self) -> usize {
        self.columns.len()
    }

    /// Number of rows: the length of every column, or 0 with no columns.
    #[must_use]
    pub fn row_count(&self) -> usize {
        self.row_count
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::column::ColumnData;

    fn floats(name: &str, n: usize) -> Column {
        Column::without_nulls(name, ColumnData::Float64(vec![0.0; n]))
    }

    fn build(columns: Vec<Column>) -> (Option<Table>, Findings) {
        let mut findings = Findings::new();
        let table = Table::from_columns(columns, &mut findings);
        (table, findings)
    }

    fn summary(findings: &Findings) -> Vec<(&'static str, String, u64)> {
        findings
            .iter()
            .map(|f| (f.code.as_str(), f.message.clone(), f.count))
            .collect()
    }

    #[test]
    fn a_valid_table_keeps_column_order_and_finds_columns_by_name() {
        let (table, findings) = build(vec![floats("b", 3), floats("a", 3)]);
        let table = table.unwrap();
        assert!(findings.is_empty());
        let names: Vec<_> = table.columns().iter().map(Column::name).collect();
        assert_eq!(names, ["b", "a"]);
        assert_eq!((table.column_count(), table.row_count()), (2, 3));
        assert!(table.column("a").is_some() && table.column("zzz").is_none());
    }

    #[test]
    fn no_columns_is_a_valid_empty_table() {
        let (table, findings) = build(vec![]);
        assert_eq!(table, Some(Table::empty()));
        assert!(findings.is_empty());
        assert_eq!(Table::empty().row_count(), 0);
    }

    #[test]
    fn empty_and_blank_names_are_reported_with_their_position() {
        let (table, findings) = build(vec![floats("x", 1), floats("", 1), floats("  ", 1)]);
        assert!(table.is_none());
        assert_eq!(
            summary(&findings),
            [
                (
                    "table.column.name_empty",
                    "Column 2 has no name.".to_string(),
                    1
                ),
                (
                    "table.column.name_empty",
                    "Column 3 has no name.".to_string(),
                    1
                ),
            ]
        );
    }

    #[test]
    fn a_repeated_name_is_one_finding_with_the_number_of_uses() {
        let (table, findings) = build(vec![
            floats("grade", 1),
            floats("x", 1),
            floats("grade", 1),
            floats("grade", 1),
        ]);
        assert!(table.is_none());
        assert_eq!(
            summary(&findings),
            [(
                "table.column.name_duplicate",
                "The column name \"grade\" is used more than once.".to_string(),
                3
            )]
        );
        let example = findings.as_slice()[0].examples[0].column.as_deref();
        assert_eq!(example, Some("grade"));
    }

    #[test]
    fn two_empty_names_are_not_also_reported_as_duplicates() {
        let (_, findings) = build(vec![floats("", 1), floats("", 1)]);
        assert!(
            findings
                .iter()
                .all(|f| f.code.as_str() == "table.column.name_empty")
        );
        assert_eq!(findings.len(), 2);
    }

    #[test]
    fn a_column_of_a_different_length_is_reported_against_the_first() {
        let (table, findings) = build(vec![floats("x", 5), floats("y", 5), floats("grade", 1_204)]);
        assert!(table.is_none());
        assert_eq!(
            summary(&findings),
            [(
                "table.column.length_mismatch",
                "Column \"grade\" has 1,204 values, but the first column \"x\" has 5.".to_string(),
                1
            )]
        );
    }

    #[test]
    fn every_problem_is_reported_and_earlier_findings_are_kept() {
        let mut findings = Findings::new();
        findings.add(Finding::new(FindingCode::DatasetTooLarge, "earlier"));
        let columns = vec![floats("a", 2), floats("a", 3), floats("", 2)];
        assert!(Table::from_columns(columns, &mut findings).is_none());
        let codes: Vec<_> = findings.iter().map(|f| f.code.as_str()).collect();
        assert_eq!(
            codes,
            [
                "dataset.too_large",
                "table.column.name_empty",
                "table.column.name_duplicate",
                "table.column.length_mismatch",
            ]
        );
    }
}
