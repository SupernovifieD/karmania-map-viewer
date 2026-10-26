//! Guessing what kind of values a column holds, from a sample of its rows.

use std::collections::BTreeSet;

use karmania_core::ColumnType;

use crate::delimited::Delimiter;
use crate::numbers::{DecimalSeparator, is_missing_token, parse_int, parse_number};

/// A text column becomes a category when it has at most this many distinct
/// values, and each value appears at least twice on average.
const MAX_CATEGORIES: usize = 50;

/// Decides whether numbers in a sample use a decimal point or a decimal comma.
///
/// Only files that are not comma-delimited can use a decimal comma. If more of
/// the numbers with a fraction use a comma than a point, it is a comma.
#[must_use]
pub fn detect_decimal_separator(rows: &[Vec<String>], delimiter: Delimiter) -> DecimalSeparator {
    if delimiter == Delimiter::Comma {
        return DecimalSeparator::Point;
    }
    let (mut commas, mut points) = (0usize, 0usize);
    for field in rows.iter().flatten() {
        if field.contains(',') && parse_number(field, DecimalSeparator::Comma).is_some() {
            commas += 1;
        } else if field.contains('.') && parse_number(field, DecimalSeparator::Point).is_some() {
            points += 1;
        }
    }
    if commas > points {
        DecimalSeparator::Comma
    } else {
        DecimalSeparator::Point
    }
}

/// Guesses the type of each of `columns` columns from the sample `rows`.
///
/// Empty cells and the usual "no value" words (`NA`, `null`, `-`, ...) are
/// ignored. A column is:
///
/// - `Bool` if every value is `true` or `false` (any case);
/// - `Int` or `Float` if at least 90% of its values are numbers, `Int` when all
///   of those are whole numbers; the rest are left for the readers to report as
///   bad numbers. A column that has identifiers with leading zeros (`007`) is
///   text, since turning them into numbers would lose the zeros;
/// - `Category` if it is text with few distinct values that repeat;
/// - `Text` otherwise, including a column with no values at all.
#[must_use]
pub fn infer_types(
    rows: &[Vec<String>],
    columns: usize,
    decimal: DecimalSeparator,
) -> Vec<ColumnType> {
    (0..columns)
        .map(|column| {
            let values: Vec<&str> = rows
                .iter()
                .filter_map(|row| row.get(column))
                .map(String::as_str)
                .filter(|v| !is_missing_token(v))
                .collect();
            infer_column(&values, decimal)
        })
        .collect()
}

fn infer_column(values: &[&str], decimal: DecimalSeparator) -> ColumnType {
    if values.is_empty() {
        return ColumnType::Utf8;
    }
    if values
        .iter()
        .all(|v| v.trim().eq_ignore_ascii_case("true") || v.trim().eq_ignore_ascii_case("false"))
    {
        return ColumnType::Bool;
    }
    let numbers: Vec<&&str> = values
        .iter()
        .filter(|v| parse_number(v, decimal).is_some())
        .collect();
    let has_leading_zero_id = values.iter().any(|v| {
        let t = v.trim();
        t.len() > 1 && t.starts_with('0') && t.bytes().all(|b| b.is_ascii_digit())
    });
    if numbers.len() * 10 >= values.len() * 9 && !has_leading_zero_id {
        return if numbers.iter().all(|v| parse_int(v).is_some()) {
            ColumnType::Int64
        } else {
            ColumnType::Float64
        };
    }
    let distinct: BTreeSet<&str> = values.iter().map(|v| v.trim()).collect();
    if distinct.len() <= MAX_CATEGORIES && distinct.len() * 2 <= values.len() {
        ColumnType::Categorical
    } else {
        ColumnType::Utf8
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delimited::sniff;
    use crate::fixtures;
    use ColumnType::{Bool, Categorical, Float64, Int64, Utf8};
    use DecimalSeparator::{Comma, Point};
    use karmania_core::Findings;

    fn column(values: &[&str]) -> ColumnType {
        let rows: Vec<Vec<String>> = values.iter().map(|v| vec![(*v).to_string()]).collect();
        infer_types(&rows, 1, Point)[0]
    }

    fn fixture_types(name: &str) -> Vec<ColumnType> {
        let sniffed = sniff(&fixtures::text(name), &mut Findings::new()).unwrap();
        let decimal = detect_decimal_separator(&sniffed.rows, sniffed.delimiter);
        infer_types(&sniffed.rows, sniffed.header.len(), decimal)
    }

    #[test]
    fn the_sample_files_get_sensible_types() {
        assert_eq!(
            fixture_types("points.csv"),
            [Float64, Float64, Float64, Categorical, Float64, Categorical]
        );
        assert_eq!(
            fixture_types("lines.csv"),
            [Categorical, Int64, Int64, Int64]
        );
        assert_eq!(
            fixture_types("blocks.csv"),
            [Int64, Int64, Int64, Float64, Categorical]
        );
    }

    #[test]
    fn whole_numbers_are_int_and_any_fraction_makes_the_column_float() {
        assert_eq!(column(&["1", "2", "-3", "+4"]), Int64);
        assert_eq!(column(&["1", "2.5", "3"]), Float64);
        assert_eq!(column(&["1e3", "2", "3"]), Float64);
        assert_eq!(column(&["12345678901234567890", "1"]), Float64);
    }

    #[test]
    fn true_and_false_in_any_case_are_bool_but_zero_and_one_are_numbers() {
        assert_eq!(column(&["true", "FALSE", "True", "false"]), Bool);
        assert_eq!(column(&["1", "0", "1", "0"]), Int64);
        assert_eq!(column(&["true", "false", "maybe"]), Utf8);
    }

    #[test]
    fn missing_values_are_ignored_not_counted_as_text() {
        assert_eq!(
            column(&["1.5", "", "NA", "2.5", "null", "-", "N/A", "*", "3.5"]),
            Float64
        );
        assert_eq!(column(&["", "NA", "-"]), Utf8);
        assert_eq!(column(&[]), Utf8);
        // A numeric sentinel is a number; suggesting it as nodata is a later step.
        assert_eq!(column(&["1.5", "-999", "2.5"]), Float64);
    }

    #[test]
    fn a_few_stray_words_in_a_numeric_column_do_not_turn_it_into_text() {
        let mut values: Vec<&str> = vec!["1.5"; 19];
        values.push("<0.01");
        assert_eq!(column(&values), Float64);
        let half = ["1.5", "<0.01", "2.5", "<0.02"];
        assert_ne!(column(&half), Float64);
    }

    #[test]
    fn identifiers_with_leading_zeros_stay_text() {
        assert_eq!(column(&["007", "012", "100", "200"]), Utf8);
        assert_eq!(column(&["0", "10", "20"]), Int64);
        assert_eq!(column(&["0.5", "10", "20"]), Float64);
    }

    #[test]
    fn repeated_text_is_a_category_and_unique_text_is_text() {
        assert_eq!(
            column(&["ore", "waste", "ore", "waste", "ore"]),
            Categorical
        );
        assert_eq!(column(&["a", "b", "c", "d"]), Utf8);
        assert_eq!(column(&["ore", "waste"]), Utf8);
        let many: Vec<String> = (0..200).map(|i| format!("v{}", i % 60)).collect();
        let refs: Vec<&str> = many.iter().map(String::as_str).collect();
        assert_eq!(column(&refs), Utf8);
    }

    #[test]
    fn ragged_rows_count_missing_cells_as_missing() {
        let rows = vec![vec!["1".to_string(), "x".into()], vec!["2".to_string()]];
        assert_eq!(infer_types(&rows, 3, Point), [Int64, Utf8, Utf8]);
    }

    #[test]
    fn a_decimal_comma_is_found_only_outside_comma_files() {
        let rows = vec![
            vec!["1,5".to_string(), "2,25".into(), "3".into()],
            vec!["4,75".to_string(), "5".into(), "6,5".into()],
        ];
        assert_eq!(detect_decimal_separator(&rows, Delimiter::Semicolon), Comma);
        assert_eq!(detect_decimal_separator(&rows, Delimiter::Tab), Comma);
        assert_eq!(
            detect_decimal_separator(&rows, Delimiter::Whitespace),
            Comma
        );
        assert_eq!(detect_decimal_separator(&rows, Delimiter::Comma), Point);
        let points = vec![vec!["1.5".to_string(), "2.5".into()]];
        assert_eq!(
            detect_decimal_separator(&points, Delimiter::Semicolon),
            Point
        );
        assert_eq!(detect_decimal_separator(&[], Delimiter::Semicolon), Point);
    }

    #[test]
    fn a_semicolon_file_with_decimal_commas_gets_float_columns() {
        let text = "X;Y;Note\n1,5;2,5;ok\n3,5;4,5;ok\n5,5;6,5;bad\n";
        let sniffed = sniff(text, &mut Findings::new()).unwrap();
        let decimal = detect_decimal_separator(&sniffed.rows, sniffed.delimiter);
        assert_eq!(decimal, Comma);
        assert_eq!(
            infer_types(&sniffed.rows, 3, decimal),
            [Float64, Float64, Utf8]
        );
        // Read with a point, the same columns are text, which is why detection matters.
        assert_eq!(infer_types(&sniffed.rows, 3, Point)[0], Utf8);
    }
}
