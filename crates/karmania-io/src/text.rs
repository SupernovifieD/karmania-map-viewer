//! Turning file bytes into text.
//!
//! UTF-8 is expected, with or without a byte-order mark. UTF-16 with a mark is
//! read too (Excel's "Unicode text" export is UTF-16). Anything else that is not
//! valid UTF-8 is read as Windows-1252 and a warning says so, because silently
//! guessing could garble names and units.

use std::borrow::Cow;

use karmania_core::{Finding, FindingCode, Findings};

/// How a file's bytes were turned into text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    /// UTF-8, the expected encoding.
    Utf8,
    /// UTF-16, little endian, announced by a byte-order mark.
    Utf16Le,
    /// UTF-16, big endian, announced by a byte-order mark.
    Utf16Be,
    /// Windows-1252, used when the bytes are not valid UTF-8.
    Windows1252,
}

impl Encoding {
    /// The name shown to users: `UTF-8`, `UTF-16 LE`, `UTF-16 BE` or `Windows-1252`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Encoding::Utf8 => "UTF-8",
            Encoding::Utf16Le => "UTF-16 LE",
            Encoding::Utf16Be => "UTF-16 BE",
            Encoding::Windows1252 => "Windows-1252",
        }
    }
}

/// The text of a file and how it was decoded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedText<'a> {
    /// The text, without any byte-order mark. Borrowed when the file is UTF-8.
    pub text: Cow<'a, str>,
    /// The encoding that was used.
    pub encoding: Encoding,
    /// Whether the file started with a byte-order mark (which was removed).
    pub had_bom: bool,
}

/// Windows-1252 for bytes 0x80 to 0x9F; all other bytes equal their Unicode
/// code point. The five undefined bytes map to the control character with the
/// same number, as the WHATWG Encoding Standard does.
const WINDOWS_1252_HIGH: [u16; 32] = [
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, //
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F, //
    0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, //
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178,
];

fn windows_1252(byte: u8) -> char {
    let code = match byte {
        0x80..=0x9F => u32::from(WINDOWS_1252_HIGH[usize::from(byte - 0x80)]),
        other => u32::from(other),
    };
    char::from_u32(code).unwrap_or(char::REPLACEMENT_CHARACTER)
}

/// Decodes a file's bytes. Never fails: a problem becomes a warning finding.
pub fn decode<'a>(bytes: &'a [u8], findings: &mut Findings) -> DecodedText<'a> {
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return utf16(rest, Encoding::Utf16Le, findings);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return utf16(rest, Encoding::Utf16Be, findings);
    }
    let (rest, had_bom) = match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        Some(rest) => (rest, true),
        None => (bytes, false),
    };
    if let Ok(text) = std::str::from_utf8(rest) {
        return DecodedText {
            text: Cow::Borrowed(text),
            encoding: Encoding::Utf8,
            had_bom,
        };
    }
    findings.add(
        Finding::new(
            FindingCode::FileEncodingFallback,
            "The file is not valid UTF-8, so it was read as Windows-1252 (Western European text). Letters with accents may look wrong if it uses a different encoding.",
        )
        .with_hint("Save the file as UTF-8 and import it again."),
    );
    DecodedText {
        text: Cow::Owned(rest.iter().map(|&b| windows_1252(b)).collect()),
        encoding: Encoding::Windows1252,
        had_bom,
    }
}

fn utf16<'a>(bytes: &[u8], encoding: Encoding, findings: &mut Findings) -> DecodedText<'a> {
    let pairs = bytes.as_chunks::<2>();
    let units = pairs.0.iter().map(|&[a, b]| match encoding {
        Encoding::Utf16Be => u16::from_be_bytes([a, b]),
        _ => u16::from_le_bytes([a, b]),
    });
    let mut text = String::with_capacity(bytes.len() / 2);
    let mut bad = u64::from(!pairs.1.is_empty());
    for decoded in char::decode_utf16(units) {
        text.push(decoded.unwrap_or_else(|_| {
            bad += 1;
            char::REPLACEMENT_CHARACTER
        }));
    }
    if !pairs.1.is_empty() {
        text.push(char::REPLACEMENT_CHARACTER);
    }
    if bad > 0 {
        let mut finding = Finding::new(
            FindingCode::FileEncodingInvalidUtf16,
            "Some UTF-16 characters could not be read and were replaced with a question-mark symbol.",
        )
        .with_hint("Save the file as UTF-8 and import it again.");
        finding.count = bad;
        findings.add(finding);
    }
    DecodedText {
        text: Cow::Owned(text),
        encoding,
        had_bom: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(bytes: &[u8]) -> (DecodedText<'_>, Findings) {
        let mut findings = Findings::new();
        let decoded = decode(bytes, &mut findings);
        (decoded, findings)
    }

    #[test]
    fn utf8_is_borrowed_not_copied_and_needs_no_finding() {
        let (d, f) = run("Kärnten, 12.5 m — ok".as_bytes());
        assert!(f.is_empty() && !d.had_bom);
        assert_eq!(
            (d.encoding, &*d.text),
            (Encoding::Utf8, "Kärnten, 12.5 m — ok")
        );
        assert!(matches!(d.text, Cow::Borrowed(_)));
    }

    #[test]
    fn a_utf8_byte_order_mark_is_removed_and_remembered() {
        let (d, f) = run(b"\xEF\xBB\xBFX,Y\n1,2\n");
        assert!(f.is_empty() && d.had_bom);
        assert_eq!(&*d.text, "X,Y\n1,2\n");
    }

    #[test]
    fn empty_input_and_a_lone_mark_decode_to_empty_text() {
        for bytes in [&b""[..], b"\xEF\xBB\xBF"] {
            let (d, f) = run(bytes);
            assert!(f.is_empty() && d.text.is_empty());
        }
    }

    #[test]
    fn invalid_utf8_is_read_as_windows_1252_with_a_warning() {
        // "Café – 5 €" in Windows-1252: é = E9, en dash = 96, euro = 80.
        let (d, f) = run(b"Caf\xE9 \x96 5 \x80");
        assert_eq!(
            (d.encoding, &*d.text),
            (Encoding::Windows1252, "Café – 5 €")
        );
        assert_eq!(f.len(), 1);
        let one = &f.as_slice()[0];
        assert_eq!(one.code.as_str(), "file.encoding.fallback");
        assert_eq!(one.step, Some(karmania_core::WizardStep::File));
        assert_eq!(one.severity, karmania_core::Severity::Warning);
    }

    #[test]
    fn windows_1252_covers_every_byte_and_keeps_ascii() {
        let all: Vec<u8> = (0..=255).collect();
        let (d, _) = run(&all);
        assert_eq!(d.encoding, Encoding::Windows1252);
        assert_eq!(d.text.chars().count(), 256);
        assert!(d.text.starts_with("\0\u{1}\u{2}"));
        let chars: Vec<char> = d.text.chars().collect();
        assert_eq!((chars[0x41], chars[0xE9], chars[0xFF]), ('A', 'é', 'ÿ'));
        assert_eq!(
            (chars[0x93], chars[0x94], chars[0x99]),
            ('\u{201C}', '\u{201D}', '™')
        );
        // The five undefined bytes become the matching control characters.
        for byte in [0x81, 0x8D, 0x8F, 0x90, 0x9D] {
            assert_eq!(chars[byte] as u32, byte as u32);
        }
    }

    #[test]
    fn utf16_with_a_mark_is_read_in_both_byte_orders() {
        let le = [
            &[0xFF, 0xFE][..],
            &[b'X', 0, b',', 0, 0xE9, 0, 0x3D, 0xD8, 0x00, 0xDE],
        ]
        .concat();
        let (d, f) = run(&le);
        assert!(f.is_empty() && d.had_bom);
        assert_eq!((d.encoding, &*d.text), (Encoding::Utf16Le, "X,é😀"));
        let be = [&[0xFE, 0xFF][..], &[0, b'X', 0, b'\t', 0x00, 0xE9]].concat();
        let (d, f) = run(&be);
        assert!(f.is_empty());
        assert_eq!((d.encoding, &*d.text), (Encoding::Utf16Be, "X\té"));
    }

    #[test]
    fn broken_utf16_is_repaired_and_counted() {
        // A lone high surrogate, then an odd trailing byte.
        let bytes = [0xFF, 0xFE, b'A', 0, 0x3D, 0xD8, b'B', 0, 0x41];
        let (d, f) = run(&bytes);
        assert_eq!(&*d.text, "A\u{FFFD}B\u{FFFD}");
        let one = &f.as_slice()[0];
        assert_eq!(
            (one.code.as_str(), one.count),
            ("file.encoding.invalid_utf16", 2)
        );
    }

    #[test]
    fn arbitrary_bytes_never_panic() {
        let mut state = 7u32;
        for length in 0..300 {
            let bytes: Vec<u8> = (0..length)
                .map(|_| {
                    state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    (state >> 24) as u8
                })
                .collect();
            let (d, _) = run(&bytes);
            assert!(d.text.len() <= bytes.len() * 3 + 3);
        }
    }

    #[test]
    fn encoding_names_are_for_users() {
        assert_eq!(Encoding::Utf8.as_str(), "UTF-8");
        assert_eq!(Encoding::Windows1252.as_str(), "Windows-1252");
        assert_eq!(
            (Encoding::Utf16Le.as_str(), Encoding::Utf16Be.as_str()),
            ("UTF-16 LE", "UTF-16 BE")
        );
    }
}
