//! Checks that attribute tables have one row per element (and per vertex).

use crate::codes::FindingCode;
use crate::dataset::Dataset;
use crate::findings::{Finding, Findings};
use crate::table::Table;
use crate::text::format_count;

/// A table with no columns carries no values and always passes; a table with
/// columns needs exactly one row per element. Per-vertex tables are only for
/// lines and meshes.
pub(super) fn check(dataset: &Dataset, findings: &mut Findings) {
    let things = dataset.kind().element_name();
    if let Some(expected) = dataset.expected_attribute_rows()
        && let Some(found) = mismatched_rows(&dataset.attributes, expected)
    {
        findings.add(
            Finding::new(
                FindingCode::DatasetAttributesRowsMismatch,
                format!(
                    "The attribute table has {} rows, but the dataset has {} {things}.",
                    format_count(found),
                    format_count(expected)
                ),
            )
            .with_hint(format!(
                "Give every one of the {things} exactly one value in each column."
            )),
        );
    }
    let Some(vertex_table) = &dataset.vertex_attributes else {
        return;
    };
    match dataset.expected_vertex_attribute_rows() {
        Some(expected) => {
            if let Some(found) = mismatched_rows(vertex_table, expected) {
                findings.add(
                    Finding::new(
                        FindingCode::DatasetVertexAttributesRowsMismatch,
                        format!(
                            "The per-vertex table has {} rows, but the dataset has {} vertices.",
                            format_count(found),
                            format_count(expected)
                        ),
                    )
                    .with_hint("Give every vertex exactly one value in each column."),
                );
            }
        }
        None if vertex_table.column_count() > 0 => {
            findings.add(
                Finding::new(
                    FindingCode::DatasetVertexAttributesUnsupported,
                    format!("Per-vertex attributes are only used for lines and meshes, so they are ignored for {things}."),
                )
                .with_hint("Move those values to the attribute table, or remove them."),
            );
        }
        None => {}
    }
}

/// The table's row count if it has columns and differs from `expected`.
fn mismatched_rows(table: &Table, expected: u64) -> Option<u64> {
    if table.column_count() == 0 {
        return None;
    }
    let rows = u64::try_from(table.row_count()).ok()?;
    (rows != expected).then_some(rows)
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{blocks, codes, grid, lines, mesh, points, polygons, run};
    use super::*;
    use crate::column::{Column, ColumnData};

    fn table(rows: usize) -> Table {
        let column = Column::without_nulls("v", ColumnData::Float64(vec![0.0; rows]));
        Table::from_columns(vec![column], &mut Findings::new()).unwrap()
    }

    fn with_rows(mut d: Dataset, rows: usize) -> Dataset {
        d.attributes = table(rows);
        d
    }

    fn with_vertex_rows(mut d: Dataset, rows: usize) -> Dataset {
        d.vertex_attributes = Some(table(rows));
        d
    }

    #[test]
    fn matching_tables_and_tables_without_columns_pass_for_every_kind() {
        let datasets = [
            with_rows(points(3), 3),
            with_rows(lines(4, &[0, 2, 4]), 2),
            with_rows(polygons(6, &[0, 3, 6], &[0, 1, 2]), 2),
            with_rows(mesh(4, &[0, 1, 2, 1, 2, 3]), 2),
            with_rows(grid([4, 3, 1]), 12),
            with_rows(blocks([2, 2, 2], None), 8),
            with_rows(blocks([9, 9, 9], Some(vec![0, 0, 0, 1, 1, 1])), 2),
            points(3),
        ];
        for d in &datasets {
            assert!(run(check, d).is_empty(), "{:?}", d.kind());
        }
    }

    #[test]
    fn a_table_with_the_wrong_number_of_rows_is_reported_with_both_counts() {
        let f = run(check, &with_rows(points(3), 5));
        assert_eq!(codes(&f), ["dataset.attributes.rows_mismatch"]);
        assert_eq!(
            f.as_slice()[0].message,
            "The attribute table has 5 rows, but the dataset has 3 points."
        );
        let f = run(check, &with_rows(grid([100, 100, 1]), 9_999));
        assert!(
            f.as_slice()[0]
                .message
                .ends_with("has 9,999 rows, but the dataset has 10,000 cells.")
        );
        let f = run(check, &with_rows(mesh(4, &[0, 1, 2, 1, 2, 3]), 4));
        assert!(
            f.as_slice()[0]
                .message
                .ends_with("but the dataset has 2 triangles.")
        );
    }

    #[test]
    fn a_dataset_whose_elements_cannot_be_counted_is_not_compared() {
        assert!(run(check, &with_rows(lines(3, &[]), 7)).is_empty());
    }

    #[test]
    fn per_vertex_tables_must_match_the_vertex_count_for_lines_and_meshes() {
        let ok = with_vertex_rows(lines(4, &[0, 4]), 4);
        assert!(run(check, &ok).is_empty());
        let bad = run(check, &with_vertex_rows(lines(4, &[0, 4]), 3));
        assert_eq!(codes(&bad), ["dataset.vertex_attributes.rows_mismatch"]);
        assert_eq!(
            bad.as_slice()[0].message,
            "The per-vertex table has 3 rows, but the dataset has 4 vertices."
        );
        let bad_mesh = run(check, &with_vertex_rows(mesh(5, &[0, 1, 2]), 6));
        assert_eq!(
            codes(&bad_mesh),
            ["dataset.vertex_attributes.rows_mismatch"]
        );
    }

    #[test]
    fn per_vertex_tables_on_other_shapes_are_reported_as_ignored() {
        let f = run(check, &with_vertex_rows(points(2), 2));
        assert_eq!(codes(&f), ["dataset.vertex_attributes.unsupported"]);
        assert_eq!(f.as_slice()[0].severity, crate::findings::Severity::Warning);
        assert!(f.as_slice()[0].message.ends_with("ignored for points."));
        let empty_table = {
            let mut d = points(2);
            d.vertex_attributes = Some(Table::empty());
            d
        };
        assert!(run(check, &empty_table).is_empty());
    }
}
