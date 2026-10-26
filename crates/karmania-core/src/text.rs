//! Small helpers for building plain-language messages.

/// Formats a count with thousands separators, the same way on every platform:
/// `1203` becomes `"1,203"`.
#[must_use]
pub fn format_count(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::format_count;

    #[test]
    fn counts_get_thousands_separators() {
        let cases = [
            (0, "0"),
            (7, "7"),
            (999, "999"),
            (1_000, "1,000"),
            (1_203, "1,203"),
            (134_217_728, "134,217,728"),
            (u64::MAX, "18,446,744,073,709,551,615"),
        ];
        for (n, text) in cases {
            assert_eq!(format_count(n), text);
        }
    }
}
