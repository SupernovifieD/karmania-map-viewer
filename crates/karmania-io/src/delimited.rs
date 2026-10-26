//! Delimited text (CSV and friends): reading records and sniffing the layout.
//!
//! The delimiter can be a comma, a semicolon, a tab or runs of whitespace. Quoted
//! fields may contain the delimiter and line breaks (not in whitespace-delimited
//! files). Rows may have different numbers of fields; nothing here rejects them,
//! because the full readers report ragged rows with their line numbers.

use std::collections::BTreeMap;

use karmania_core::{Finding, FindingCode, Findings};

/// How many data rows a preview keeps.
pub const PREVIEW_ROWS: usize = 200;
/// How many records are read to decide the delimiter.
const SNIFF_RECORDS: usize = 50;
/// Delimiter candidates in order of preference, used to break ties.
const CANDIDATES: [Delimiter; 4] = [
    Delimiter::Comma,
    Delimiter::Semicolon,
    Delimiter::Tab,
    Delimiter::Whitespace,
];

/// What separates the fields of a row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Delimiter {
    /// A comma.
    Comma,
    /// A semicolon, common where the decimal separator is a comma.
    Semicolon,
    /// A tab.
    Tab,
    /// Any run of spaces and tabs, with no quoting.
    Whitespace,
}

impl Delimiter {
    /// The name shown to users: `comma`, `semicolon`, `tab` or `whitespace`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Delimiter::Comma => "comma",
            Delimiter::Semicolon => "semicolon",
            Delimiter::Tab => "tab",
            Delimiter::Whitespace => "whitespace",
        }
    }

    const fn byte(self) -> Option<u8> {
        match self {
            Delimiter::Comma => Some(b','),
            Delimiter::Semicolon => Some(b';'),
            Delimiter::Tab => Some(b'\t'),
            Delimiter::Whitespace => None,
        }
    }
}

/// One row of fields, reused between reads so reading allocates rarely.
///
/// Fields are slices of one buffer. The row remembers the 1-based line of the
/// source text where it starts.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Record {
    line: u64,
    text: String,
    ends: Vec<usize>,
}

impl Record {
    /// An empty record.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The 1-based line of the source text where this row starts (0 if unset).
    #[must_use]
    pub fn line(&self) -> u64 {
        self.line
    }

    /// Number of fields.
    #[must_use]
    pub fn len(&self) -> usize {
        self.ends.len()
    }

    /// True when there are no fields.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.ends.is_empty()
    }

    /// The field at `index`, if the row has that many.
    #[must_use]
    pub fn get(&self, index: usize) -> Option<&str> {
        let end = *self.ends.get(index)?;
        let start = index
            .checked_sub(1)
            .and_then(|i| self.ends.get(i))
            .copied()
            .unwrap_or(0);
        self.text.get(start..end)
    }

    /// The fields in order.
    pub fn iter(&self) -> impl Iterator<Item = &str> {
        (0..self.len()).filter_map(|i| self.get(i))
    }

    fn clear(&mut self, line: u64) {
        self.line = line;
        self.text.clear();
        self.ends.clear();
    }

    /// Closes the field being built.
    fn end_field(&mut self) {
        self.ends.push(self.text.len());
    }
}

/// Reads the rows of a delimited text one at a time, reusing one [`Record`].
///
/// A row ends at a line break (`\n`, `\r\n` or a lone `\r`). Blank lines, and
/// lines holding only spaces or tabs that are not the delimiter, are skipped. In
/// a comma, semicolon or tab file a field starting with `"` is quoted: it may
/// contain the delimiter and line breaks, and `""` stands for one quote. Text
/// after a closing quote is kept as part of the field, and a quote that is never
/// closed runs to the end of the text. Whitespace-delimited files have no
/// quoting.
pub struct RecordReader<'a> {
    text: &'a str,
    pos: usize,
    line: u64,
    delimiter: Delimiter,
}

impl<'a> RecordReader<'a> {
    /// Starts reading `text` with the given delimiter.
    #[must_use]
    pub fn new(text: &'a str, delimiter: Delimiter) -> Self {
        Self {
            text,
            pos: 0,
            line: 1,
            delimiter,
        }
    }

    fn byte(&self, at: usize) -> Option<u8> {
        self.text.as_bytes().get(at).copied()
    }

    /// Moves past one line break at `self.pos`, if there is one.
    fn skip_line_break(&mut self) {
        match self.byte(self.pos) {
            Some(b'\r') => {
                self.pos += 1;
                if self.byte(self.pos) == Some(b'\n') {
                    self.pos += 1;
                }
                self.line += 1;
            }
            Some(b'\n') => {
                self.pos += 1;
                self.line += 1;
            }
            _ => {}
        }
    }

    /// The end of the physical line that starts at `self.pos`.
    fn line_end(&self) -> usize {
        let rest = self.text.as_bytes().get(self.pos..).unwrap_or(&[]);
        let offset = rest.iter().position(|&b| b == b'\n' || b == b'\r');
        self.pos + offset.unwrap_or(rest.len())
    }

    /// Counts the line breaks in `self.text[from..to]` and adds them to `line`.
    /// A line break is `\n` (which also covers `\r\n`) or a `\r` on its own.
    fn count_line_breaks(&mut self, from: usize, to: usize) {
        let bytes = self.text.as_bytes().get(from..to).unwrap_or(&[]);
        for (i, &b) in bytes.iter().enumerate() {
            if b == b'\n' || (b == b'\r' && bytes.get(i + 1) != Some(&b'\n')) {
                self.line += 1;
            }
        }
    }

    /// Reads the next row into `record`. Returns `false` at the end of the text.
    pub fn read(&mut self, record: &mut Record) -> bool {
        loop {
            if self.pos >= self.text.len() {
                return false;
            }
            let end = self.line_end();
            let delimiter = self.delimiter.byte();
            let blank = self.text.as_bytes().get(self.pos..end).is_some_and(|line| {
                line.iter()
                    .all(|&b| b.is_ascii_whitespace() && Some(b) != delimiter)
            });
            if !blank {
                break;
            }
            self.pos = end;
            self.skip_line_break();
        }
        record.clear(self.line);
        match self.delimiter.byte() {
            Some(delimiter) => self.read_delimited(record, delimiter),
            None => self.read_whitespace(record),
        }
        true
    }

    fn read_whitespace(&mut self, record: &mut Record) {
        let end = self.line_end();
        if let Some(line) = self.text.get(self.pos..end) {
            for field in line.split_ascii_whitespace() {
                record.text.push_str(field);
                record.end_field();
            }
        }
        self.pos = end;
        self.skip_line_break();
    }

    fn read_delimited(&mut self, record: &mut Record, delimiter: u8) {
        loop {
            if self.byte(self.pos) == Some(b'"') {
                self.read_quoted(record);
            }
            let start = self.pos;
            while self
                .byte(self.pos)
                .is_some_and(|b| b != delimiter && b != b'\n' && b != b'\r')
            {
                self.pos += 1;
            }
            if let Some(piece) = self.text.get(start..self.pos) {
                record.text.push_str(piece);
            }
            record.end_field();
            if self.byte(self.pos) == Some(delimiter) {
                self.pos += 1;
                continue;
            }
            self.skip_line_break();
            return;
        }
    }

    /// Reads a quoted field starting at the opening quote into the current
    /// field, leaving `self.pos` just after the closing quote.
    fn read_quoted(&mut self, record: &mut Record) {
        self.pos += 1;
        loop {
            let from = self.pos;
            let rest = self.text.get(from..).unwrap_or("");
            let Some(offset) = rest.find('"') else {
                record.text.push_str(rest);
                self.count_line_breaks(from, self.text.len());
                self.pos = self.text.len();
                return;
            };
            let quote = from + offset;
            record.text.push_str(&self.text[from..quote]);
            self.count_line_breaks(from, quote);
            self.pos = quote + 1;
            if self.byte(self.pos) == Some(b'"') {
                record.text.push('"');
                self.pos += 1;
            } else {
                return;
            }
        }
    }
}

/// The 1-based line number where a record starts, or 0 if unknown.
#[must_use]
pub fn line_of(record: &Record) -> u64 {
    record.line()
}

/// Reads up to `limit` rows as owned strings.
fn read_rows(text: &str, delimiter: Delimiter, limit: usize) -> Vec<Vec<String>> {
    let mut reader = RecordReader::new(text, delimiter);
    let mut record = Record::new();
    let mut rows = Vec::new();
    while rows.len() < limit && reader.read(&mut record) {
        rows.push(record.iter().map(str::to_string).collect());
    }
    rows
}

/// What the layout of a delimited text looks like.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sniffed {
    /// The detected delimiter.
    pub delimiter: Delimiter,
    /// Whether the first row holds column names.
    pub has_header: bool,
    /// Column names: the header row, or `Column 1`, `Column 2`, ... without one.
    pub header: Vec<String>,
    /// The first [`PREVIEW_ROWS`] data rows, as written.
    pub rows: Vec<Vec<String>>,
    /// The number of data rows, counted by lines, so a quoted field containing a
    /// line break counts extra.
    pub estimated_rows: u64,
}

/// Works out the delimiter, whether there is a header, and a preview.
///
/// Returns `None` and adds a `file.empty` error if the text has no content.
pub fn sniff(text: &str, findings: &mut Findings) -> Option<Sniffed> {
    let delimiter = detect_delimiter(text);
    let mut rows = read_rows(text, delimiter, PREVIEW_ROWS + 1);
    // Nothing but white space is empty whatever the delimiter: a lone tab would
    // otherwise read as a row of two empty tab-separated fields.
    if rows.is_empty() || text.trim().is_empty() {
        findings.add(
            Finding::new(FindingCode::FileEmpty, "The file has no data in it.")
                .with_hint("Check that you chose the right file."),
        );
        return None;
    }
    let first = rows.remove(0);
    let has_header = detect_header(&first, &rows);
    let (header, rows) = if has_header {
        (first.iter().map(|s| s.trim().to_string()).collect(), rows)
    } else {
        let names = (1..=first.len()).map(|n| format!("Column {n}")).collect();
        rows.insert(0, first);
        rows.truncate(PREVIEW_ROWS);
        (names, rows)
    };
    let lines = text.lines().filter(|l| !l.trim().is_empty()).count() as u64;
    Some(Sniffed {
        delimiter,
        has_header,
        header,
        rows,
        estimated_rows: lines.saturating_sub(u64::from(has_header)),
    })
}

/// Picks the delimiter that splits the first records into the same number of
/// fields (at least two) most consistently. Ties go to the earlier candidate.
fn detect_delimiter(text: &str) -> Delimiter {
    let mut best: Option<(u32, usize, usize, Delimiter)> = None;
    for (priority, delimiter) in CANDIDATES.into_iter().enumerate() {
        let rows = read_rows(text, delimiter, SNIFF_RECORDS);
        let mut frequency: BTreeMap<usize, usize> = BTreeMap::new();
        for row in &rows {
            *frequency.entry(row.len()).or_insert(0) += 1;
        }
        let Some((&fields, &times)) = frequency.iter().max_by_key(|&(&n, &t)| (t, n)) else {
            continue;
        };
        if fields < 2 {
            continue;
        }
        let consistency = (times * 1000 / rows.len()) as u32;
        let score = (consistency, fields, usize::MAX - priority, delimiter);
        if best.is_none_or(|b| (score.0, score.1, score.2) > (b.0, b.1, b.2)) {
            best = Some(score);
        }
    }
    best.map_or(Delimiter::Comma, |b| b.3)
}

/// True for text that reads as a number: an optional sign, digits with at most
/// one decimal point or decimal comma, and an optional exponent. Words such as
/// `NaN` and `inf` are not numbers here.
#[must_use]
pub fn looks_numeric(field: &str) -> bool {
    let trimmed = field.trim();
    let unsigned = trimmed.strip_prefix(['+', '-']).unwrap_or(trimmed);
    if !unsigned.starts_with(|c: char| c.is_ascii_digit() || c == '.' || c == ',') {
        return false;
    }
    let normal = if trimmed.matches(',').count() == 1 && !trimmed.contains('.') {
        trimmed.replace(',', ".")
    } else {
        trimmed.to_string()
    };
    normal.parse::<f64>().is_ok()
}

/// Whether the first row is a header: some column is text in the first row but
/// mostly numbers below it, or the first row is all distinct non-numeric names.
fn detect_header(first: &[String], rest: &[Vec<String>]) -> bool {
    if first.is_empty() {
        return false;
    }
    let numeric_in_first = first.iter().filter(|f| looks_numeric(f)).count();
    if rest.is_empty() {
        return numeric_in_first == 0;
    }
    let text_over_numbers = first.iter().enumerate().any(|(column, name)| {
        if looks_numeric(name) || name.trim().is_empty() {
            return false;
        }
        let below: Vec<&str> = rest
            .iter()
            .filter_map(|row| row.get(column))
            .map(String::as_str)
            .filter(|f| !f.trim().is_empty())
            .collect();
        let numbers = below.iter().filter(|f| looks_numeric(f)).count();
        !below.is_empty() && numbers * 5 >= below.len() * 4
    });
    if text_over_numbers {
        return true;
    }
    let mut names: Vec<&str> = first.iter().map(|f| f.trim()).collect();
    names.sort_unstable();
    names.dedup();
    numeric_in_first == 0 && names.len() == first.len() && !names.contains(&"")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;

    fn sniffed(text: &str) -> Sniffed {
        sniff(text, &mut Findings::new()).expect("some content")
    }

    fn row(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn the_sample_files_are_comma_separated_with_a_header() {
        let points = sniffed(&fixtures::text("points.csv"));
        assert_eq!(
            (points.delimiter, points.has_header),
            (Delimiter::Comma, true)
        );
        assert_eq!(
            points.header,
            ["Easting", "Northing", "RL", "Hole", "Au_ppm", "Rock"]
        );
        assert_eq!((points.rows.len(), points.estimated_rows), (8, 8));
        assert_eq!(
            points.rows[0],
            row(&[
                "500010.5",
                "2765020.25",
                "120.4",
                "DH001",
                "0.35",
                "granite"
            ])
        );
        assert_eq!(sniffed(&fixtures::text("lines.csv")).estimated_rows, 5);
        let blocks = sniffed(&fixtures::text("blocks.csv"));
        assert_eq!((blocks.header.len(), blocks.estimated_rows), (5, 18));
    }

    #[test]
    fn each_delimiter_is_recognised() {
        let cases = [
            ("a,b,c\n1,2,3\n4,5,6\n", Delimiter::Comma),
            ("a;b;c\n1;2;3\n4;5;6\n", Delimiter::Semicolon),
            ("a\tb\tc\n1\t2\t3\n4\t5\t6\n", Delimiter::Tab),
            ("a b   c\n1  2 3\n4 5    6\n", Delimiter::Whitespace),
        ];
        for (text, expected) in cases {
            let s = sniffed(text);
            assert_eq!(s.delimiter, expected, "{text:?}");
            assert_eq!((s.header.len(), s.rows.len()), (3, 2));
            assert!(s.has_header);
        }
    }

    #[test]
    fn a_semicolon_file_with_decimal_commas_is_not_mistaken_for_a_comma_file() {
        let s = sniffed("X;Y;Z\n1,5;2,5;3,5\n4,5;5,5;6,5\n7,5;8,5;9,5\n");
        assert_eq!(s.delimiter, Delimiter::Semicolon);
        assert_eq!(s.rows[0], row(&["1,5", "2,5", "3,5"]));
        let tabs = sniffed("X\tY\n1,5\t2,5\n3,5\t4,5\n");
        assert_eq!(tabs.delimiter, Delimiter::Tab);
    }

    #[test]
    fn quoted_fields_may_hold_the_delimiter_and_line_breaks() {
        let s = sniffed("name,note\n\"Smith, J\",\"two\nlines\"\nLee,ok\n");
        assert_eq!(s.delimiter, Delimiter::Comma);
        assert_eq!(s.rows[0], row(&["Smith, J", "two\nlines"]));
        assert_eq!(s.rows.len(), 2);
    }

    #[test]
    fn a_comma_file_with_spaces_after_commas_stays_comma_separated() {
        let s = sniffed("a, b, c\n1, 2, 3\n4, 5, 6\n");
        assert_eq!(s.delimiter, Delimiter::Comma);
    }

    #[test]
    fn the_header_is_found_by_text_over_numbers_and_absent_for_all_numbers() {
        assert!(sniffed("X,Y\n1,2\n3,4\n").has_header);
        let none = sniffed("1,2\n3,4\n5,6\n");
        assert!(!none.has_header);
        assert_eq!(none.header, ["Column 1", "Column 2"]);
        assert_eq!(none.rows.len(), 3);
        assert_eq!(none.estimated_rows, 3);
        // Text-only columns still make a header when the names are distinct.
        assert!(sniffed("Hole,Rock\nDH001,granite\nDH002,basalt\n").has_header);
        // A single line of names is a header with no rows.
        let only = sniffed("X,Y,Z\n");
        assert_eq!(
            (only.has_header, only.rows.len(), only.estimated_rows),
            (true, 0, 0)
        );
        // A single line of numbers is data.
        assert!(!sniffed("1,2,3\n").has_header);
    }

    #[test]
    fn a_missing_column_name_is_kept_empty_so_it_can_be_reported() {
        let s = sniffed("X,,Z\n1,2,3\n");
        assert_eq!(s.header, ["X", "", "Z"]);
    }

    #[test]
    fn crlf_blank_lines_and_a_missing_final_newline_are_handled() {
        let s = sniffed("X,Y\r\n1,2\r\n\r\n3,4\r\n\r\n5,6");
        assert_eq!(
            s.rows,
            [row(&["1", "2"]), row(&["3", "4"]), row(&["5", "6"])]
        );
        assert_eq!(s.estimated_rows, 3);
    }

    #[test]
    fn ragged_rows_and_trailing_delimiters_are_kept_as_written() {
        let s = sniffed("a,b,c\n1,2,3\n4,5\n6,7,8,9\n");
        assert_eq!(s.rows[1], row(&["4", "5"]));
        assert_eq!(s.rows[2].len(), 4);
        let trailing = sniffed("a,b,\n1,2,\n3,4,\n");
        assert_eq!(trailing.header, ["a", "b", ""]);
    }

    #[test]
    fn the_preview_keeps_200_rows_but_the_count_covers_the_whole_text() {
        let mut text = String::from("X,Y\n");
        for i in 0..1_000 {
            text.push_str(&format!("{i},{}\n", i * 2));
        }
        let s = sniffed(&text);
        assert_eq!((s.rows.len(), s.estimated_rows), (PREVIEW_ROWS, 1_000));
        // Without a header the first row is data and the preview is still 200.
        let headerless = sniffed(&text.replacen("X,Y\n", "", 1));
        assert_eq!(
            (headerless.rows.len(), headerless.estimated_rows),
            (PREVIEW_ROWS, 1_000)
        );
    }

    #[test]
    fn empty_and_blank_text_is_an_error_finding() {
        for text in ["", "\n\n  \n\t\n"] {
            let mut findings = Findings::new();
            assert!(sniff(text, &mut findings).is_none());
            assert_eq!(findings.as_slice()[0].code.as_str(), "file.empty");
            assert!(findings.has_errors());
        }
    }

    #[test]
    fn a_single_column_file_falls_back_to_comma_and_one_field_per_row() {
        let s = sniffed("depth\n1.5\n2.5\n");
        assert_eq!(
            (s.delimiter, s.header.len(), s.has_header),
            (Delimiter::Comma, 1, true)
        );
    }

    #[test]
    fn record_readers_report_the_line_where_each_record_starts() {
        let text = "a,b\n\n1,2\n\"x\ny\",3\n5,6\n";
        let mut reader = RecordReader::new(text, Delimiter::Comma);
        let mut record = Record::new();
        let mut lines = Vec::new();
        while reader.read(&mut record) {
            lines.push(line_of(&record));
        }
        assert_eq!(lines, [1, 3, 4, 6]);
        let spaced = "a b\n\n1 2\n3 4\n";
        let mut reader = RecordReader::new(spaced, Delimiter::Whitespace);
        let mut lines = Vec::new();
        while reader.read(&mut record) {
            lines.push(line_of(&record));
        }
        assert_eq!(lines, [1, 3, 4]);
    }

    #[test]
    fn numbers_are_recognised_with_either_decimal_separator() {
        for yes in [
            "1", "-2", "+3.5", ".5", "1,5", "-0,25", "1e3", "2.5E-4", " 7 ",
        ] {
            assert!(looks_numeric(yes), "{yes:?}");
        }
        for no in [
            "", "abc", "NaN", "inf", "1,2,3", "1.2.3", "-", "DH001", "1,5.5", "0x10",
        ] {
            assert!(!looks_numeric(no), "{no:?}");
        }
    }

    /// A small deterministic random generator for the tests below.
    struct Lcg(u32);

    impl Lcg {
        fn below(&mut self, n: usize) -> usize {
            self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (self.0 >> 8) as usize % n
        }
    }

    /// The line breaks in a piece of text: each `\n`, and each `\r` not followed
    /// by `\n`, which together are what an editor would show as new lines.
    fn line_breaks_in(text: &str) -> u64 {
        let bytes = text.as_bytes();
        (0..bytes.len())
            .filter(|&i| {
                bytes[i] == b'\n' || (bytes[i] == b'\r' && bytes.get(i + 1) != Some(&b'\n'))
            })
            .count() as u64
    }

    /// Writes records as delimited text, quoting a field only when needed, with
    /// random blank lines and line endings. Returns the text and the line each
    /// record starts on.
    fn write(records: &[Vec<String>], delimiter: char, rng: &mut Lcg) -> (String, Vec<u64>) {
        let mut text = String::new();
        let mut line = 1u64;
        let mut starts = Vec::new();
        let ending = |rng: &mut Lcg| if rng.below(3) == 0 { "\r\n" } else { "\n" };
        for record in records {
            for _ in 0..rng.below(3) / 2 {
                text.push_str(ending(rng));
                line += 1;
            }
            starts.push(line);
            for (i, field) in record.iter().enumerate() {
                if i > 0 {
                    text.push(delimiter);
                }
                let needs_quotes = field.contains([delimiter, '"', '\n', '\r'])
                    || field.starts_with(' ')
                    || rng.below(8) == 0;
                if needs_quotes {
                    text.push('"');
                    text.push_str(&field.replace('"', "\"\""));
                    text.push('"');
                } else {
                    text.push_str(field);
                }
                line += line_breaks_in(field);
            }
            text.push_str(ending(rng));
            line += 1;
        }
        (text, starts)
    }

    fn random_records(rng: &mut Lcg, delimiter: char) -> Vec<Vec<String>> {
        let alphabet = [
            'a', 'Z', '7', '.', ' ', delimiter, '"', '\n', '\r', 'é', '-',
        ];
        (0..rng.below(12) + 1)
            .map(|_| {
                let fields = rng.below(5) + 2;
                (0..fields)
                    .map(|_| {
                        (0..rng.below(7))
                            .map(|_| alphabet[rng.below(alphabet.len())])
                            .collect::<String>()
                    })
                    .collect()
            })
            .collect()
    }

    fn read_all(text: &str, delimiter: Delimiter) -> Vec<(u64, Vec<String>)> {
        let mut reader = RecordReader::new(text, delimiter);
        let mut record = Record::new();
        let mut out = Vec::new();
        while reader.read(&mut record) {
            out.push((record.line(), record.iter().map(str::to_string).collect()));
        }
        out
    }

    #[test]
    fn what_a_writer_writes_the_reader_reads_back_with_exact_line_numbers() {
        let mut rng = Lcg(2024);
        for (delimiter, kind) in [
            (',', Delimiter::Comma),
            (';', Delimiter::Semicolon),
            ('\t', Delimiter::Tab),
        ] {
            for _ in 0..300 {
                let records = random_records(&mut rng, delimiter);
                let (text, starts) = write(&records, delimiter, &mut rng);
                let read = read_all(&text, kind);
                let got: Vec<_> = read.iter().map(|(_, f)| f.clone()).collect();
                assert_eq!(got, records, "fields differ for {text:?}");
                let lines: Vec<_> = read.iter().map(|(l, _)| *l).collect();
                assert_eq!(lines, starts, "lines differ for {text:?}");
            }
        }
    }

    #[test]
    fn the_reader_agrees_with_the_csv_crate_on_well_formed_text() {
        let mut rng = Lcg(77);
        for _ in 0..300 {
            let records = random_records(&mut rng, ',');
            let (text, _) = write(&records, ',', &mut rng);
            let mut oracle = csv::ReaderBuilder::new()
                .has_headers(false)
                .flexible(true)
                .from_reader(text.as_bytes());
            let expected: Vec<Vec<String>> = oracle
                .records()
                .map(|r| r.unwrap().iter().map(str::to_string).collect())
                .collect();
            let ours: Vec<_> = read_all(&text, Delimiter::Comma)
                .into_iter()
                .map(|(_, f)| f)
                .collect();
            assert_eq!(ours, expected, "differs from csv for {text:?}");
        }
    }

    #[test]
    fn whitespace_files_split_on_runs_of_spaces_and_tabs() {
        let text = "  a  b\tc \n\n\t\n1 2   3\r\n4\t5\t6";
        let read = read_all(text, Delimiter::Whitespace);
        assert_eq!(
            read,
            [
                (1, vec!["a".into(), "b".into(), "c".into()]),
                (4, vec!["1".into(), "2".into(), "3".into()]),
                (5, vec!["4".into(), "5".into(), "6".into()]),
            ]
        );
    }

    #[test]
    fn odd_but_common_quoting_is_read_leniently() {
        let one = |text: &str| read_all(text, Delimiter::Comma).remove(0).1;
        assert_eq!(one("a,\"\",c"), ["a", "", "c"]);
        assert_eq!(one("\"\"\"\""), ["\""]);
        assert_eq!(one("5\" pipe,x"), ["5\" pipe", "x"]);
        assert_eq!(one("\"ab\"cd,e"), ["abcd", "e"]);
        assert_eq!(one("a,b,"), ["a", "b", ""]);
        assert_eq!(one(",,"), ["", "", ""]);
        // A quote that never closes runs to the end of the text.
        assert_eq!(one("a,\"unfinished,b\nc"), ["a", "unfinished,b\nc"]);
    }

    #[test]
    fn every_kind_of_line_ending_counts_as_one_line() {
        let cases = [("a,b\n1,2\n", 2), ("a,b\r\n1,2\r\n", 2), ("a,b\r1,2\r", 2)];
        for (text, second_line) in cases {
            let read = read_all(text, Delimiter::Comma);
            assert_eq!(
                read.iter().map(|r| r.0).collect::<Vec<_>>(),
                [1, second_line],
                "{text:?}"
            );
        }
        // CRLF inside a quoted field is one line break.
        let read = read_all("\"x\r\ny\",1\n2,3", Delimiter::Comma);
        assert_eq!(read.iter().map(|r| r.0).collect::<Vec<_>>(), [1, 3]);
    }

    #[test]
    fn lines_of_only_spaces_are_blank_but_lines_of_only_delimiters_are_rows() {
        let read = read_all("a,b\n   \n,\n\t\n", Delimiter::Comma);
        assert_eq!(read.len(), 2);
        assert_eq!(
            (read[1].0, read[1].1.clone()),
            (3, vec![String::new(), String::new()])
        );
        // In a tab file, a line of tabs is a row of empty fields.
        let tabs = read_all("a\tb\n\t\n", Delimiter::Tab);
        assert_eq!(tabs.len(), 2);
    }

    #[test]
    fn arbitrary_text_never_panics() {
        let mut state = 99u32;
        let alphabet = ['a', '1', ',', ';', '\t', ' ', '\n', '\r', '"', '.', 'é'];
        for length in 0..200 {
            let text: String = (0..length)
                .map(|_| {
                    state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    alphabet[(state >> 24) as usize % alphabet.len()]
                })
                .collect();
            let _ = sniff(&text, &mut Findings::new());
        }
    }
}
