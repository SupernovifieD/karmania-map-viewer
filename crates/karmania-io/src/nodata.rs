//! Suggesting which values in the data mean "no data".

use karmania_core::ColumnType;
use serde::Serialize;

use crate::numbers::{DecimalSeparator, parse_number};

/// Words that commonly mean "no value", in the order they are offered. The first
/// one, the empty string, stands for an empty cell.
pub const NODATA_TOKENS: [&str; 7] = ["", "NA", "N/A", "null", "NaN", "-", "*"];

/// Numbers that commonly mean "no value": the usual -999 family, the +/-1e30
/// used by some geophysics software, and Surfer's blank value.
pub const NODATA_NUMBERS: [f64; 6] = [-999.0, -9999.0, -99999.0, 1e30, -1e30, 1.70141e38];

/// A word that looks like "no data" and how often it appears.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TokenSuggestion {
    /// The word; the empty string means an empty cell.
    pub token: String,
    /// How many cells of numeric columns hold it, in the sample.
    pub count: u64,
}

/// A number that looks like "no data" and how often it appears.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NumberSuggestion {
    /// The number.
    pub value: f64,
    /// How many cells of numeric columns hold it, in the sample.
    pub count: u64,
}

/// The values worth offering as "no data", with how often each was seen.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct NodataSuggestions {
    /// Words found, in the order of [`NODATA_TOKENS`].
    pub tokens: Vec<TokenSuggestion>,
    /// Numbers found, in the order of [`NODATA_NUMBERS`].
    pub numbers: Vec<NumberSuggestion>,
}

/// True if `cell` is the "no data" word `token`: the empty token matches an empty
/// or blank cell; letters are compared ignoring case; `-` and `*` match exactly.
fn is_token(cell: &str, token: &str) -> bool {
    let cell = cell.trim();
    if token.is_empty() {
        cell.is_empty()
    } else {
        cell.eq_ignore_ascii_case(token)
    }
}

/// Looks through the numeric columns of a sample for the usual "no data" values.
///
/// A value is suggested only if it appears in a column of numbers: an `NA` in a
/// text column is just text, and the same goes for -999 in a name column. Counts
/// are for the sample given, not the whole file.
#[must_use]
pub fn suggest_nodata(
    rows: &[Vec<String>],
    types: &[ColumnType],
    decimal: DecimalSeparator,
) -> NodataSuggestions {
    let numeric: Vec<usize> = types
        .iter()
        .enumerate()
        .filter(|(_, t)| matches!(t, ColumnType::Float64 | ColumnType::Int64))
        .map(|(i, _)| i)
        .collect();
    let mut token_counts = [0u64; NODATA_TOKENS.len()];
    let mut number_counts = [0u64; NODATA_NUMBERS.len()];
    for row in rows {
        for &column in &numeric {
            let Some(cell) = row.get(column) else {
                continue;
            };
            for (count, token) in token_counts.iter_mut().zip(NODATA_TOKENS) {
                *count += u64::from(is_token(cell, token));
            }
            if let Some(value) = parse_number(cell, decimal) {
                for (count, wanted) in number_counts.iter_mut().zip(NODATA_NUMBERS) {
                    *count += u64::from(value == wanted);
                }
            }
        }
    }
    NodataSuggestions {
        tokens: NODATA_TOKENS
            .iter()
            .zip(token_counts)
            .filter(|&(_, count)| count > 0)
            .map(|(token, count)| TokenSuggestion {
                token: (*token).to_string(),
                count,
            })
            .collect(),
        numbers: NODATA_NUMBERS
            .iter()
            .zip(number_counts)
            .filter(|&(_, count)| count > 0)
            .map(|(&value, count)| NumberSuggestion { value, count })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delimited::sniff;
    use crate::fixtures;
    use crate::infer::{detect_decimal_separator, infer_types};
    use ColumnType::{Float64, Int64, Utf8};
    use DecimalSeparator::{Comma, Point};
    use karmania_core::Findings;

    fn rows(data: &[&[&str]]) -> Vec<Vec<String>> {
        data.iter()
            .map(|r| r.iter().map(|s| (*s).to_string()).collect())
            .collect()
    }

    fn tokens(s: &NodataSuggestions) -> Vec<(&str, u64)> {
        s.tokens
            .iter()
            .map(|t| (t.token.as_str(), t.count))
            .collect()
    }

    fn numbers(s: &NodataSuggestions) -> Vec<(f64, u64)> {
        s.numbers.iter().map(|n| (n.value, n.count)).collect()
    }

    #[test]
    fn the_sample_file_offers_its_empty_cell_and_its_minus_999() {
        let sniffed = sniff(&fixtures::text("points.csv"), &mut Findings::new()).unwrap();
        let decimal = detect_decimal_separator(&sniffed.rows, sniffed.delimiter);
        let types = infer_types(&sniffed.rows, sniffed.header.len(), decimal);
        let s = suggest_nodata(&sniffed.rows, &types, decimal);
        assert_eq!(tokens(&s), [("", 1)]);
        assert_eq!(numbers(&s), [(-999.0, 1)]);
    }

    #[test]
    fn every_listed_token_and_number_can_be_found_in_a_numeric_column() {
        let mut data: Vec<Vec<String>> = vec![vec!["1.5".to_string()]];
        for token in ["", "NA", "N/A", "null", "NaN", "-", "*"] {
            data.push(vec![token.to_string()]);
        }
        for number in ["-999", "-9999", "-99999", "1e30", "-1e30", "1.70141e38"] {
            data.push(vec![number.to_string()]);
        }
        let s = suggest_nodata(&data, &[Float64], Point);
        assert_eq!(s.tokens.len(), 7);
        assert_eq!(s.numbers.len(), 6);
        assert_eq!(tokens(&s)[1], ("NA", 1));
        assert_eq!(numbers(&s)[5], (1.70141e38, 1));
    }

    #[test]
    fn tokens_ignore_case_and_spaces_but_the_symbols_must_match() {
        let data = rows(&[
            &["na"],
            &[" N/A "],
            &["NULL"],
            &["nan"],
            &["--"],
            &["**"],
            &["1"],
        ]);
        let s = suggest_nodata(&data, &[Float64], Point);
        assert_eq!(tokens(&s), [("NA", 1), ("N/A", 1), ("null", 1), ("NaN", 1)]);
    }

    #[test]
    fn values_in_text_columns_are_not_suggested() {
        let data = rows(&[
            &["NA", "NA", "-999"],
            &["", "x", "-999"],
            &["-", "y", "-999"],
        ]);
        let s = suggest_nodata(&data, &[Utf8, Utf8, Utf8], Point);
        assert_eq!(s, NodataSuggestions::default());
        let mixed = suggest_nodata(&data, &[Utf8, Utf8, Int64], Point);
        assert_eq!(tokens(&mixed), []);
        assert_eq!(numbers(&mixed), [(-999.0, 3)]);
    }

    #[test]
    fn counts_add_up_across_numeric_columns() {
        let data = rows(&[
            &["-999", "-999.0", "NA"],
            &["1", "-9999", "2"],
            &["", "", "NA"],
        ]);
        let s = suggest_nodata(&data, &[Float64, Float64, Float64], Point);
        assert_eq!(numbers(&s), [(-999.0, 2), (-9999.0, 1)]);
        assert_eq!(tokens(&s), [("", 2), ("NA", 2)]);
    }

    #[test]
    fn decimal_commas_and_short_rows_are_handled() {
        let data = rows(&[&["-999,0"], &["1,5"], &[]]);
        let s = suggest_nodata(&data, &[Float64], Comma);
        assert_eq!(numbers(&s), [(-999.0, 1)]);
        // A row with no cell for the column is not an empty cell.
        assert_eq!(tokens(&s), []);
    }

    #[test]
    fn a_number_close_to_a_sentinel_is_not_the_sentinel() {
        let data = rows(&[&["-999.5"], &["-998"], &["999"], &["1e29"]]);
        assert_eq!(
            suggest_nodata(&data, &[Float64], Point),
            NodataSuggestions::default()
        );
    }

    #[test]
    fn nothing_to_look_at_gives_nothing() {
        assert_eq!(
            suggest_nodata(&[], &[], Point),
            NodataSuggestions::default()
        );
        let data = rows(&[&["-999"]]);
        assert_eq!(
            suggest_nodata(&data, &[], Point),
            NodataSuggestions::default()
        );
    }
}
