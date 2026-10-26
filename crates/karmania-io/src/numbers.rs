//! Reading numbers from text, the same way everywhere in the readers.

/// Which character separates the whole part of a number from its fraction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DecimalSeparator {
    /// A point: `12.5`.
    Point,
    /// A comma: `12,5`.
    Comma,
}

impl DecimalSeparator {
    /// The character: `.` or `,`.
    #[must_use]
    pub const fn as_char(self) -> char {
        match self {
            DecimalSeparator::Point => '.',
            DecimalSeparator::Comma => ',',
        }
    }
}

/// True for text that means "no value": empty, `NA`, `N/A`, `null`, `NaN`, `-`
/// or `*`, ignoring case and surrounding spaces.
#[must_use]
pub fn is_missing_token(field: &str) -> bool {
    let trimmed = field.trim();
    trimmed.is_empty()
        || ["na", "n/a", "null", "nan", "-", "*"]
            .iter()
            .any(|token| trimmed.eq_ignore_ascii_case(token))
}

/// Reads a finite number.
///
/// An optional sign, digits with at most one decimal separator (the one given),
/// and an optional exponent. Thousands separators, `NaN`, `inf` and anything with
/// stray characters are not numbers. The other separator is not accepted: with a
/// decimal point, `1,5` is not a number.
#[must_use]
pub fn parse_number(field: &str, decimal: DecimalSeparator) -> Option<f64> {
    let trimmed = field.trim();
    let unsigned = trimmed.strip_prefix(['+', '-']).unwrap_or(trimmed);
    if !unsigned.starts_with(|c: char| c.is_ascii_digit() || c == '.' || c == ',') {
        return None;
    }
    let value = match decimal {
        DecimalSeparator::Point => trimmed.parse::<f64>().ok()?,
        DecimalSeparator::Comma => {
            if trimmed.contains('.') || trimmed.matches(',').count() > 1 {
                return None;
            }
            trimmed.replace(',', ".").parse::<f64>().ok()?
        }
    };
    value.is_finite().then_some(value)
}

/// Reads a whole number: an optional sign and digits, nothing else, fitting an
/// `i64`.
#[must_use]
pub fn parse_int(field: &str) -> Option<i64> {
    let trimmed = field.trim();
    let digits = trimmed.strip_prefix(['+', '-']).unwrap_or(trimmed);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    trimmed
        .strip_prefix('+')
        .unwrap_or(trimmed)
        .parse::<i64>()
        .ok()
}

/// True for text that reads as a number with either decimal separator. Used to
/// tell a header row from data.
#[must_use]
pub fn looks_numeric(field: &str) -> bool {
    parse_number(field, DecimalSeparator::Point).is_some()
        || parse_number(field, DecimalSeparator::Comma).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use DecimalSeparator::{Comma, Point};

    #[test]
    fn numbers_with_the_right_separator_parse() {
        let cases = [
            ("12", Point, 12.0),
            (" -3.5 ", Point, -3.5),
            ("+0.25", Point, 0.25),
            (".5", Point, 0.5),
            ("1e3", Point, 1000.0),
            ("2.5E-4", Point, 0.00025),
            ("12,5", Comma, 12.5),
            ("-0,25", Comma, -0.25),
            (",5", Comma, 0.5),
            ("7", Comma, 7.0),
            ("1,5e2", Comma, 150.0),
        ];
        for (text, decimal, expected) in cases {
            assert_eq!(parse_number(text, decimal), Some(expected), "{text:?}");
        }
    }

    #[test]
    fn the_wrong_separator_stray_text_and_non_finite_words_are_not_numbers() {
        for text in [
            "", "abc", "1,5", "NaN", "inf", "-inf", "1.2.3", "-", "12abc", "0x10", "1 000", "1e999",
        ] {
            assert_eq!(parse_number(text, Point), None, "point: {text:?}");
        }
        for text in ["1.5", "1,2,3", "1,5.5", "x"] {
            assert_eq!(parse_number(text, Comma), None, "comma: {text:?}");
        }
    }

    #[test]
    fn whole_numbers_allow_a_sign_and_must_fit_in_64_bits() {
        assert_eq!(parse_int("42"), Some(42));
        assert_eq!(parse_int(" -7 "), Some(-7));
        assert_eq!(parse_int("+9"), Some(9));
        assert_eq!(parse_int("9223372036854775807"), Some(i64::MAX));
        for text in [
            "",
            "-",
            "1.0",
            "1e3",
            "9223372036854775808",
            "abc",
            "1,5",
            "0x1",
        ] {
            assert_eq!(parse_int(text), None, "{text:?}");
        }
    }

    #[test]
    fn missing_tokens_ignore_case_and_spaces_but_zero_is_not_missing() {
        for yes in [
            "", "  ", "NA", "na", "N/A", "n/a", "null", "NULL", "NaN", "nan", "-", "*", " NA ",
        ] {
            assert!(is_missing_token(yes), "{yes:?}");
        }
        for no in ["0", "-999", "none", "--", "**", "N/B", "a"] {
            assert!(!is_missing_token(no), "{no:?}");
        }
    }

    #[test]
    fn looks_numeric_accepts_either_separator() {
        for yes in ["1", "-2", "+3.5", ".5", "1,5", "-0,25", "1e3", " 7 "] {
            assert!(looks_numeric(yes), "{yes:?}");
        }
        for no in [
            "", "abc", "NaN", "inf", "1,2,3", "1.2.3", "-", "DH001", "1,5.5", "0x10",
        ] {
            assert!(!looks_numeric(no), "{no:?}");
        }
    }

    #[test]
    fn separators_have_characters() {
        assert_eq!((Point.as_char(), Comma.as_char()), ('.', ','));
    }
}
