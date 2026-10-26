//! Importing a delimited text file (CSV) into a dataset.
//!
//! [`CsvImport`] reads the file row by row under an [`ImportMapping`]. It can run
//! in small steps, so a caller can report progress and stay responsive, or all at
//! once with [`read_csv`]. Problems become findings and nothing is fixed silently:
//! unreadable values become nulls with a warning, rows that cannot be used are
//! counted, and a coordinate that is empty or unreadable follows the mapping's
//! `emptyCoordinates` choice (stop with an error, or skip the row with a warning).
//!
//! Rules for the values:
//!
//! - An empty cell is null in every column.
//! - The "no data" words and numbers of the mapping make numeric columns
//!   (float and int) null. They do not touch text, category or bool columns, where
//!   `NA` or `-` may be real text.
//! - A value that cannot be read as the column's type is null, and counted in one
//!   warning per column.
//! - Coordinates must be numbers; empty, "no data" and unreadable values are
//!   missing coordinates.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

use karmania_core::{
    Blocks, Column, ColumnData, ColumnType, Dataset, DatasetId, Finding, FindingCode, Findings,
    Geometry, Kind, Lines, Location, Positions, Provenance, Table, Validity, check_size,
};

use crate::csv_blocks::place_blocks;
use crate::delimited::{Delimiter, PREVIEW_ROWS, ReaderPosition, Record, RecordReader};
use crate::infer::infer_types;
use crate::mapping::{EmptyCoordinates, ImportMapping, validate_mapping};
use crate::numbers::{DecimalSeparator, parse_int, parse_number};
use crate::output::{ReadOutput, Tally};
use crate::roles::Role;

/// How the text of a CSV file is laid out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CsvOptions {
    /// What separates the fields.
    pub delimiter: Delimiter,
    /// Whether the first row holds column names. Without a header the columns
    /// are called `Column 1`, `Column 2`, ...
    pub has_header: bool,
}

/// The result of reading one cell as a value of some type.
enum Cell<T> {
    Value(T),
    Null,
    /// Not empty, but not readable as the wanted type.
    Bad,
}

/// How cells are turned into values.
struct Conversion {
    decimal: DecimalSeparator,
    tokens: Vec<String>,
    numbers: Vec<f64>,
}

impl Conversion {
    fn new(mapping: &ImportMapping) -> Self {
        Self {
            decimal: mapping.decimal_separator,
            tokens: mapping
                .nodata
                .tokens
                .iter()
                .map(|t| t.trim().to_string())
                .collect(),
            numbers: mapping.nodata.numbers.clone(),
        }
    }

    fn is_nodata_token(&self, cell: &str) -> bool {
        self.tokens
            .iter()
            .any(|t| !t.is_empty() && cell.eq_ignore_ascii_case(t))
    }

    fn float(&self, cell: Option<&str>) -> Cell<f64> {
        let text = cell.unwrap_or("").trim();
        if text.is_empty() || self.is_nodata_token(text) {
            return Cell::Null;
        }
        match parse_number(text, self.decimal) {
            Some(v) if self.numbers.contains(&v) => Cell::Null,
            Some(v) => Cell::Value(v),
            None => Cell::Bad,
        }
    }

    fn int(&self, cell: Option<&str>) -> Cell<i64> {
        let text = cell.unwrap_or("").trim();
        if text.is_empty() || self.is_nodata_token(text) {
            return Cell::Null;
        }
        match parse_int(text) {
            Some(v) if self.numbers.contains(&(v as f64)) => Cell::Null,
            Some(v) => Cell::Value(v),
            None => Cell::Bad,
        }
    }
}

enum Data {
    Float(Vec<f64>),
    Int(Vec<i64>),
    Bool(Vec<bool>),
    Text(Vec<String>),
    Category {
        codes: Vec<u32>,
        dictionary: Vec<String>,
        index: BTreeMap<String, u32>,
    },
}

/// An attribute column being filled.
struct Builder {
    name: String,
    source: usize,
    data: Data,
    valid: Vec<bool>,
    unreadable: Tally,
}

impl Builder {
    fn new(name: String, source: usize, column_type: ColumnType) -> Self {
        let data = match column_type {
            ColumnType::Float64 => Data::Float(Vec::new()),
            ColumnType::Int64 => Data::Int(Vec::new()),
            ColumnType::Bool => Data::Bool(Vec::new()),
            ColumnType::Utf8 => Data::Text(Vec::new()),
            ColumnType::Categorical => Data::Category {
                codes: Vec::new(),
                dictionary: Vec::new(),
                index: BTreeMap::new(),
            },
        };
        let unreadable = Tally::new(
            Finding::new(
                FindingCode::CsvValueUnreadable,
                format!(
                    "Some values in the column \"{name}\" could not be read as {}, so they were left empty.",
                    column_type.as_str()
                ),
            )
            .with_hint("Check the column's type, or the values you marked as no data."),
        );
        Self {
            name,
            source,
            data,
            valid: Vec::new(),
            unreadable,
        }
    }

    fn push(&mut self, cell: Option<&str>, conversion: &Conversion, line: u64) {
        let mut bad = false;
        let valid = match &mut self.data {
            Data::Float(values) => match conversion.float(cell) {
                Cell::Value(v) => {
                    values.push(v);
                    true
                }
                other => {
                    values.push(0.0);
                    bad = matches!(other, Cell::Bad);
                    false
                }
            },
            Data::Int(values) => match conversion.int(cell) {
                Cell::Value(v) => {
                    values.push(v);
                    true
                }
                other => {
                    values.push(0);
                    bad = matches!(other, Cell::Bad);
                    false
                }
            },
            Data::Bool(values) => {
                let text = cell.unwrap_or("").trim();
                let parsed = if text.eq_ignore_ascii_case("true") {
                    Some(true)
                } else if text.eq_ignore_ascii_case("false") {
                    Some(false)
                } else {
                    None
                };
                values.push(parsed.unwrap_or(false));
                bad = parsed.is_none() && !text.is_empty();
                parsed.is_some()
            }
            Data::Text(values) => {
                let text = cell.unwrap_or("");
                values.push(text.to_string());
                !text.trim().is_empty()
            }
            Data::Category {
                codes,
                dictionary,
                index,
            } => {
                let text = cell.unwrap_or("");
                if text.trim().is_empty() {
                    codes.push(0);
                    false
                } else {
                    let next = u32::try_from(dictionary.len()).unwrap_or(u32::MAX);
                    let code = *index.entry(text.to_string()).or_insert_with(|| {
                        dictionary.push(text.to_string());
                        next
                    });
                    codes.push(code);
                    true
                }
            }
        };
        self.valid.push(valid);
        if bad {
            self.unreadable
                .hit(Location::default().with_line(line).with_column(&self.name));
        }
    }

    /// Reorders the rows so that row `i` becomes the old row `order[i]`.
    fn permute(&mut self, order: &[usize]) {
        match &mut self.data {
            Data::Float(v) => permute(v, order),
            Data::Int(v) => permute(v, order),
            Data::Bool(v) => permute(v, order),
            Data::Text(v) => permute(v, order),
            Data::Category { codes, .. } => permute(codes, order),
        }
        permute(&mut self.valid, order);
    }

    /// The finished column and the warning about unreadable values, if any. The
    /// data and validity always have the same length by construction.
    fn finish(self) -> (Option<Column>, Option<Finding>) {
        let data = match self.data {
            Data::Float(v) => ColumnData::Float64(v),
            Data::Int(v) => ColumnData::Int64(v),
            Data::Bool(v) => ColumnData::Bool(v),
            Data::Text(v) => ColumnData::Utf8(v),
            Data::Category {
                codes, dictionary, ..
            } => ColumnData::Categorical { codes, dictionary },
        };
        let validity = Validity::from_flags(self.valid);
        (
            Column::new(self.name, data, validity).ok(),
            self.unreadable.into_finding(),
        )
    }
}

/// A coordinate column: where it is, its name, and a count of missing values.
struct CoordinateColumn {
    source: usize,
    name: String,
    missing: Tally,
}

/// Rows being grouped into lines by their line identifier.
struct LineState {
    source: usize,
    name: String,
    /// The identifiers in order of first appearance.
    ids: Vec<String>,
    index: BTreeMap<String, u32>,
    /// The line each kept row belongs to.
    line_of_row: Vec<u32>,
    last: Option<u32>,
    /// Lines whose rows were interrupted by another line's rows.
    scattered_lines: BTreeSet<u32>,
    scattered: Tally,
    missing_id: Tally,
}

impl LineState {
    /// Files the row under its line. Returns `false`, and counts it, if the row
    /// has no identifier.
    fn assign(&mut self, cell: Option<&str>, line: u64) -> bool {
        let id = cell.unwrap_or("").trim();
        let at = Location::default().with_line(line).with_column(&self.name);
        if id.is_empty() {
            self.missing_id.hit(at);
            return false;
        }
        let known = self.index.contains_key(id);
        let next = u32::try_from(self.ids.len()).unwrap_or(u32::MAX);
        let line_index = *self.index.entry(id.to_string()).or_insert_with(|| {
            self.ids.push(id.to_string());
            next
        });
        if known && self.last != Some(line_index) && self.scattered_lines.insert(line_index) {
            self.scattered.hit(at);
        }
        self.last = Some(line_index);
        self.line_of_row.push(line_index);
        true
    }

    /// The order of the kept rows that puts each line's rows together (lines in
    /// order of first appearance, rows within a line in file order), and the
    /// offset where each line starts in that order.
    fn grouping(&self) -> (Vec<usize>, Vec<u32>) {
        let lines = self.ids.len();
        let mut starts = vec![0usize; lines + 1];
        for &line in &self.line_of_row {
            if let Some(count) = starts.get_mut(line as usize + 1) {
                *count += 1;
            }
        }
        for i in 1..starts.len() {
            starts[i] += starts[i - 1];
        }
        let mut next = starts.clone();
        let mut order = vec![0usize; self.line_of_row.len()];
        for (row, &line) in self.line_of_row.iter().enumerate() {
            if let Some(slot) = next.get_mut(line as usize) {
                if let Some(place) = order.get_mut(*slot) {
                    *place = row;
                }
                *slot += 1;
            }
        }
        let offsets = starts
            .into_iter()
            .map(|s| u32::try_from(s).unwrap_or(u32::MAX))
            .collect();
        (order, offsets)
    }
}

/// Reorders `values` so that element `i` of the result is `values[order[i]]`.
fn permute<T: Clone>(values: &mut Vec<T>, order: &[usize]) {
    *values = order
        .iter()
        .filter_map(|&i| values.get(i).cloned())
        .collect();
}

/// Reads a CSV file into a dataset, a few rows at a time.
///
/// Create it with [`CsvImport::new`], call [`CsvImport::step`] until it returns
/// `true`, then take the result with [`CsvImport::finish`]. A mapping with
/// errors, an empty file, or a file too big to hold makes the import finish at
/// once with no dataset.
pub struct CsvImport<'a> {
    text: Cow<'a, str>,
    delimiter: Delimiter,
    /// Where the next row starts.
    position: ReaderPosition,
    record: Record,
    file_name: Option<String>,
    mapping: Cow<'a, ImportMapping>,
    conversion: Conversion,
    coordinates: [Option<CoordinateColumn>; 3],
    lines: Option<LineState>,
    /// For a block model, the file line of each kept row.
    block_lines: Option<Vec<u64>>,
    builders: Vec<Builder>,
    positions: [Vec<f64>; 3],
    header_len: usize,
    ragged: Tally,
    skipped: Tally,
    findings: Findings,
    done: bool,
    rows: u64,
    estimated_rows: u64,
}

impl<'a> CsvImport<'a> {
    /// Prepares an import of `text`.
    ///
    /// The mapping is checked first (see [`validate_mapping`]). Attribute columns
    /// whose type the mapping leaves open get one guessed from the first rows.
    #[must_use]
    pub fn new(
        text: &'a str,
        options: CsvOptions,
        mapping: &'a ImportMapping,
        file_name: Option<&str>,
    ) -> Self {
        Self::build(
            Cow::Borrowed(text),
            options,
            Cow::Borrowed(mapping),
            file_name,
        )
    }

    /// Like [`CsvImport::new`], but the import keeps its own copy of the mapping
    /// and takes the text, so it does not borrow from anything and can be held
    /// between calls (for example by a WebAssembly object).
    #[must_use]
    pub fn owned(
        text: String,
        options: CsvOptions,
        mapping: ImportMapping,
        file_name: Option<&str>,
    ) -> CsvImport<'static> {
        CsvImport::build(Cow::Owned(text), options, Cow::Owned(mapping), file_name)
    }

    fn build(
        text: Cow<'a, str>,
        options: CsvOptions,
        mapping: Cow<'a, ImportMapping>,
        file_name: Option<&str>,
    ) -> Self {
        let text_ref: &str = &text;
        let mapping_ref: &ImportMapping = &mapping;
        let mut findings = Findings::new();
        let mut reader = RecordReader::new(text_ref, options.delimiter);
        let mut first = Record::new();
        let have_first = reader.read(&mut first);
        let header: Vec<String> = if !have_first {
            Vec::new()
        } else if options.has_header {
            first.iter().map(|s| s.trim().to_string()).collect()
        } else {
            (1..=first.len()).map(|n| format!("Column {n}")).collect()
        };
        if have_first {
            validate_mapping(mapping_ref, &header, &mut findings);
        } else {
            findings.add(
                Finding::new(FindingCode::FileEmpty, "The file has no data in it.")
                    .with_hint("Check that you chose the right file."),
            );
        }
        let lines = text_ref.lines().filter(|l| !l.trim().is_empty()).count() as u64;
        let data_rows = lines.saturating_sub(u64::from(options.has_header));
        let things = match mapping_ref.kind {
            Kind::Lines => "vertices",
            Kind::Blocks => "blocks",
            _ => "points",
        };
        check_size(Some(data_rows), things, &mut findings);

        let index_of = |name: &str| header.iter().position(|h| h == name);
        let coordinate = |role: Role| {
            let column = mapping_ref.columns.iter().find(|c| c.role == role)?;
            Some(CoordinateColumn {
                source: index_of(&column.source)?,
                name: column.source.clone(),
                missing: Tally::new(
                    Finding::new(
                        FindingCode::CsvCoordinateMissing,
                        format!(
                            "Some rows have an empty or unreadable value in the coordinate column \"{}\".",
                            column.source
                        ),
                    )
                    .with_hint("Fix those rows, or choose to skip rows with an empty coordinate."),
                ),
            })
        };
        let sample = sample_types(text_ref, options, mapping_ref, header.len());
        let builders = mapping_ref
            .columns
            .iter()
            .filter(|c| c.role == Role::Attribute)
            .filter_map(|c| {
                let source = index_of(&c.source)?;
                let column_type = c.column_type.or_else(|| sample.get(source).copied())?;
                let name = c.rename.clone().unwrap_or_else(|| c.source.clone());
                Some(Builder::new(name, source, column_type))
            })
            .collect();
        let line_state = (mapping_ref.kind == Kind::Lines)
            .then(|| {
                let column = mapping_ref
                    .columns
                    .iter()
                    .find(|c| c.role == Role::LineId)?;
                let name = column.rename.clone().unwrap_or_else(|| column.source.clone());
                Some(LineState {
                    source: index_of(&column.source)?,
                    scattered: Tally::new(
                        Finding::new(
                            FindingCode::CsvLinesScattered,
                            "The rows of some lines are not next to each other in the file; they were gathered by line identifier.",
                        ),
                    ),
                    missing_id: Tally::new(
                        Finding::new(
                            FindingCode::CsvLineIdMissing,
                            "Some rows were left out because they have no line identifier.",
                        )
                        .with_hint("Fill in the line identifier, or remove those rows."),
                    ),
                    name,
                    ids: Vec::new(),
                    index: BTreeMap::new(),
                    line_of_row: Vec::new(),
                    last: None,
                    scattered_lines: BTreeSet::new(),
                })
            })
            .flatten();
        let done = findings.has_errors();
        let coordinates = [
            coordinate(Role::X),
            coordinate(Role::Y),
            coordinate(Role::Z),
        ];
        let conversion = Conversion::new(mapping_ref);
        let block_lines = (mapping_ref.kind == Kind::Blocks).then(Vec::new);
        // Without a header the first row is data, so start again from the top.
        let position = if options.has_header {
            reader.position()
        } else {
            ReaderPosition::START
        };
        Self {
            delimiter: options.delimiter,
            position,
            record: Record::new(),
            file_name: file_name.map(str::to_string),
            conversion,
            coordinates,
            lines: line_state,
            block_lines,
            builders,
            positions: [Vec::new(), Vec::new(), Vec::new()],
            header_len: header.len(),
            ragged: Tally::new(
                Finding::new(
                    FindingCode::CsvRowsRagged,
                    format!(
                        "Some rows have a different number of values from the header ({}); missing values were left empty and extra ones ignored.",
                        header.len()
                    ),
                )
                .with_hint("Check the delimiter, and the file for stray line breaks and quotes."),
            ),
            skipped: Tally::new(
                Finding::new(
                    FindingCode::CsvRowsSkipped,
                    "Some rows were left out because a coordinate was empty or unreadable.",
                )
                .with_hint("Check the file if you expected every row to be used."),
            ),
            findings,
            done,
            rows: 0,
            estimated_rows: data_rows,
            text,
            mapping,
        }
    }
}

impl CsvImport<'_> {
    /// Reads up to `max_rows` more rows. Returns `true` when the file is done.
    pub fn step(&mut self, max_rows: usize) -> bool {
        if self.done {
            return true;
        }
        // The reader borrows the text and the row handler needs all of `self`, so
        // the text (and the row buffer) are taken out for the length of the step.
        let text = std::mem::take(&mut self.text);
        let mut record = std::mem::replace(&mut self.record, Record::new());
        let mut reader = RecordReader::resume(&text, self.delimiter, self.position);
        for _ in 0..max_rows {
            if !reader.read(&mut record) {
                self.done = true;
                break;
            }
            self.row(&record);
        }
        self.position = reader.position();
        self.record = record;
        self.text = text;
        self.done
    }

    /// The number of data rows read so far.
    #[must_use]
    pub fn rows_read(&self) -> u64 {
        self.rows
    }

    /// About how many data rows the file has, counted by lines before any row is
    /// read. A quoted field with a line break in it counts as several, so this can
    /// be more than the real number, never less.
    #[must_use]
    pub fn estimated_rows(&self) -> u64 {
        self.estimated_rows
    }

    fn row(&mut self, record: &Record) {
        self.rows += 1;
        let line = record.line();
        if record.len() != self.header_len {
            self.ragged.hit(Location::default().with_line(line));
        }
        let mut values = [0.0f64; 3];
        let mut usable = true;
        for (axis, slot) in self.coordinates.iter_mut().enumerate() {
            let Some(column) = slot else { continue };
            match self.conversion.float(record.get(column.source)) {
                Cell::Value(v) => values[axis] = v,
                Cell::Null | Cell::Bad => {
                    usable = false;
                    column.missing.hit(
                        Location::default()
                            .with_line(line)
                            .with_column(&column.name),
                    );
                }
            }
        }
        if !usable {
            self.skipped.hit(Location::default().with_line(line));
            return;
        }
        if let Some(lines) = &mut self.lines
            && !lines.assign(record.get(lines.source), line)
        {
            return;
        }
        for (axis, store) in self.positions.iter_mut().enumerate() {
            if self.coordinates.get(axis).is_some_and(Option::is_some) {
                store.push(values[axis]);
            }
        }
        if let Some(block_lines) = &mut self.block_lines {
            block_lines.push(line);
        }
        for builder in &mut self.builders {
            builder.push(record.get(builder.source), &self.conversion, line);
        }
    }

    /// Ends the import and returns the dataset (if there were no errors) and the
    /// findings. Call it after [`CsvImport::step`] has returned `true`; calling
    /// it earlier returns what has been read so far.
    #[must_use]
    pub fn finish(mut self) -> ReadOutput {
        let has_z = self.coordinates[2].is_some();
        if self.mapping.empty_coordinates == EmptyCoordinates::Skip {
            if let Some(f) = self.skipped.into_finding() {
                self.findings.add(f);
            }
        } else {
            for column in self.coordinates.into_iter().flatten() {
                if let Some(f) = column.missing.into_finding() {
                    self.findings.add(f);
                }
            }
        }
        if let Some(f) = self.ragged.into_finding() {
            self.findings.add(f);
        }
        let grouped = self.lines.map(|lines| {
            let (order, offsets) = lines.grouping();
            let grouped = Grouped {
                contiguous: lines.scattered_lines.is_empty(),
                ids: lines.ids,
                name: lines.name,
                order,
                offsets,
            };
            for tally in [lines.missing_id, lines.scattered] {
                if let Some(f) = tally.into_finding() {
                    self.findings.add(f);
                }
            }
            grouped
        });
        let mut builders = self.builders;
        let mut positions = self.positions;
        if let Some(g) = grouped.as_ref().filter(|g| !g.contiguous) {
            for builder in &mut builders {
                builder.permute(&g.order);
            }
            for axis in &mut positions {
                permute(axis, &g.order);
            }
        }
        // Earlier errors come first: a file with unusable coordinates should not
        // also be told it has no blocks.
        let placement = match (&self.block_lines, self.mapping.block_size) {
            (Some(lines), Some(size)) if !self.findings.has_errors() => {
                let [x, y, z] = &positions;
                place_blocks([x, y, z], lines, size, &mut self.findings)
            }
            _ => None,
        };
        if let Some(order) = placement.as_ref().and_then(|p| p.order.as_ref()) {
            for builder in &mut builders {
                builder.permute(order);
            }
        }
        let mut columns = Vec::new();
        for builder in builders {
            let (column, finding) = builder.finish();
            columns.extend(column);
            if let Some(f) = finding {
                self.findings.add(f);
            }
        }
        if self.findings.has_errors() {
            return ReadOutput {
                datasets: Vec::new(),
                findings: self.findings,
            };
        }
        let built = if self.mapping.kind == Kind::Blocks {
            placement.and_then(|placed| {
                let blocks = Blocks {
                    lattice: placed.lattice,
                    ijk: placed.ijk,
                };
                Table::from_columns(columns, &mut self.findings)
                    .map(|attributes| (Geometry::Blocks(blocks), attributes, None, "blocks"))
            })
        } else {
            let [x, y, z] = positions;
            Positions::from_xyz(&x, &y, has_z.then_some(z.as_slice()), &mut self.findings).and_then(
                |positions| match grouped {
                    None => Table::from_columns(columns, &mut self.findings).map(|attributes| {
                        (Geometry::Points(positions), attributes, None, "points")
                    }),
                    Some(g) => {
                        let ids = Column::without_nulls(g.name, ColumnData::Utf8(g.ids));
                        let attributes = Table::from_columns(vec![ids], &mut self.findings);
                        let vertex_attributes = if columns.is_empty() {
                            Some(None)
                        } else {
                            Table::from_columns(columns, &mut self.findings).map(Some)
                        };
                        let lines = Lines {
                            positions,
                            offsets: g.offsets,
                        };
                        attributes
                            .zip(vertex_attributes)
                            .map(|(a, v)| (Geometry::Lines(lines), a, v, "lines"))
                    }
                },
            )
        };
        let Some((geometry, attributes, vertex_attributes, default_name)) = built else {
            return ReadOutput {
                datasets: Vec::new(),
                findings: self.findings,
            };
        };
        let name = if self.mapping.dataset_name.trim().is_empty() {
            self.file_name
                .clone()
                .unwrap_or_else(|| default_name.to_string())
        } else {
            self.mapping.dataset_name.clone()
        };
        let mut dataset = Dataset::new(DatasetId(0), name, self.mapping.crs, geometry, attributes);
        dataset.vertex_attributes = vertex_attributes;
        dataset.provenance = Provenance {
            source_file_name: self.file_name,
        };
        ReadOutput {
            datasets: vec![dataset],
            findings: self.findings,
        }
    }
}

/// How the kept rows divide into lines.
struct Grouped {
    ids: Vec<String>,
    name: String,
    /// The row order that puts each line's rows together.
    order: Vec<usize>,
    /// Where each line starts in that order, plus the end.
    offsets: Vec<u32>,
    /// True if the rows were already together, so nothing needs reordering.
    contiguous: bool,
}

/// Guesses column types from the first rows, for attribute columns whose type the
/// mapping leaves open. Empty when every attribute has a type.
fn sample_types(
    text: &str,
    options: CsvOptions,
    mapping: &ImportMapping,
    columns: usize,
) -> Vec<ColumnType> {
    if mapping
        .columns
        .iter()
        .all(|c| c.role != Role::Attribute || c.column_type.is_some())
    {
        return Vec::new();
    }
    let mut reader = RecordReader::new(text, options.delimiter);
    let mut record = Record::new();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut skip_header = options.has_header;
    while rows.len() < PREVIEW_ROWS && reader.read(&mut record) {
        if skip_header {
            skip_header = false;
            continue;
        }
        rows.push(record.iter().map(str::to_string).collect());
    }
    infer_types(&rows, columns, mapping.decimal_separator)
}

/// Reads a whole CSV file in one call. See [`CsvImport`] for stepwise reading.
#[must_use]
pub fn read_csv(
    text: &str,
    options: CsvOptions,
    mapping: &ImportMapping,
    file_name: Option<&str>,
) -> ReadOutput {
    let mut import = CsvImport::new(text, options, mapping, file_name);
    while !import.step(10_000) {}
    import.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;
    use crate::mapping::{ColumnMapping, Nodata};
    use karmania_core::{Blocks, CrsRef, Value};

    const COMMA: CsvOptions = CsvOptions {
        delimiter: Delimiter::Comma,
        has_header: true,
    };

    fn col(source: &str, role: Role, column_type: Option<ColumnType>) -> ColumnMapping {
        ColumnMapping {
            source: source.into(),
            role,
            column_type,
            rename: None,
        }
    }

    fn collars() -> ImportMapping {
        ImportMapping {
            dataset_name: "Collars".into(),
            kind: Kind::Points,
            columns: vec![
                col("Easting", Role::X, None),
                col("Northing", Role::Y, None),
                col("RL", Role::Z, None),
                col("Hole", Role::Attribute, None),
                col("Au_ppm", Role::Attribute, None),
                col("Rock", Role::Attribute, None),
            ],
            nodata: Nodata {
                tokens: vec![String::new()],
                numbers: vec![-999.0],
            },
            empty_coordinates: EmptyCoordinates::Error,
            block_size: None,
            decimal_separator: DecimalSeparator::Point,
            crs: Some(CrsRef::Epsg { code: 32640 }),
        }
    }

    fn codes(out: &ReadOutput) -> Vec<&'static str> {
        out.findings.iter().map(|f| f.code.as_str()).collect()
    }

    fn only(out: &ReadOutput) -> &Dataset {
        assert_eq!(out.datasets.len(), 1, "findings: {:?}", codes(out));
        &out.datasets[0]
    }

    fn simple(x_y: &[(&str, &str)]) -> (String, ImportMapping) {
        let mut text = String::from("X,Y\n");
        for (x, y) in x_y {
            text.push_str(&format!("{x},{y}\n"));
        }
        let mut mapping = collars();
        mapping.columns = vec![col("X", Role::X, None), col("Y", Role::Y, None)];
        (text, mapping)
    }

    #[test]
    fn the_sample_file_becomes_eight_points_with_attributes() {
        let out = read_csv(
            &fixtures::text("points.csv"),
            COMMA,
            &collars(),
            Some("points.csv"),
        );
        assert!(out.findings.is_empty(), "{:?}", codes(&out));
        let d = only(&out);
        assert_eq!(
            (d.name.as_str(), d.kind(), d.has_z()),
            ("Collars", Kind::Points, true)
        );
        assert_eq!(d.crs, Some(CrsRef::Epsg { code: 32640 }));
        assert_eq!(d.provenance.source_file_name.as_deref(), Some("points.csv"));
        assert_eq!(d.element_count(), Some(8));
        let Geometry::Points(p) = &d.geometry else {
            panic!("not points")
        };
        assert_eq!(p.get(0), Some([500_010.5, 2_765_020.25, 120.4]));
        assert_eq!(p.get(7), Some([500_185.5, 2_765_205.25, 109.3]));
        let names: Vec<_> = d.attributes.columns().iter().map(Column::name).collect();
        assert_eq!(names, ["Hole", "Au_ppm", "Rock"]);
        let au = d.attributes.column("Au_ppm").unwrap();
        // Row 3 is -999 (nodata number) and row 5 is empty: both null.
        assert_eq!(au.null_count(), 2);
        assert_eq!((au.get(2), au.get(4)), (None, None));
        assert_eq!(au.get(0), Some(Value::Float64(0.35)));
        let hole = d.attributes.column("Hole").unwrap();
        assert_eq!(hole.column_type(), ColumnType::Categorical);
        assert_eq!(
            hole.get(3),
            Some(Value::Category {
                code: 1,
                label: Some("DH002")
            })
        );
        assert!(karmania_core::validate(d).is_loadable());
    }

    #[test]
    fn without_z_the_points_have_no_z() {
        let (text, mapping) = simple(&[("1", "2"), ("3", "4")]);
        let d = read_csv(&text, COMMA, &mapping, None);
        assert!(!only(&d).has_z());
    }

    #[test]
    fn a_dataset_without_a_name_takes_the_file_name() {
        let (text, mut mapping) = simple(&[("1", "2")]);
        mapping.dataset_name = "  ".into();
        let out = read_csv(&text, COMMA, &mapping, Some("survey.csv"));
        assert_eq!(only(&out).name, "survey.csv");
        let anon = read_csv(&text, COMMA, &mapping, None);
        assert_eq!(only(&anon).name, "points");
    }

    #[test]
    fn an_empty_coordinate_stops_the_import_when_the_mapping_says_error() {
        let (text, mapping) = simple(&[("1", "2"), ("", "4"), ("5", "abc"), ("7", "8")]);
        let out = read_csv(&text, COMMA, &mapping, None);
        assert!(out.datasets.is_empty());
        assert_eq!(
            codes(&out),
            ["csv.coordinate.missing", "csv.coordinate.missing"]
        );
        let x = &out.findings.as_slice()[0];
        assert_eq!(
            x.message,
            "Some rows have an empty or unreadable value in the coordinate column \"X\"."
        );
        assert_eq!(
            (x.count, x.step),
            (1, Some(karmania_core::WizardStep::Nodata))
        );
        assert_eq!(x.examples[0].line, Some(3));
        assert_eq!(x.examples[0].column.as_deref(), Some("X"));
        assert_eq!(out.findings.as_slice()[1].examples[0].line, Some(4));
        assert!(out.findings.has_errors());
    }

    #[test]
    fn with_skip_the_bad_rows_are_left_out_and_counted_with_their_lines() {
        let (text, mut mapping) = simple(&[("1", "2"), ("", "4"), ("5", "abc"), ("7", "8")]);
        mapping.empty_coordinates = EmptyCoordinates::Skip;
        let out = read_csv(&text, COMMA, &mapping, None);
        assert_eq!(codes(&out), ["csv.rows.skipped"]);
        let f = &out.findings.as_slice()[0];
        assert_eq!((f.count, f.severity), (2, karmania_core::Severity::Warning));
        let lines: Vec<_> = f.examples.iter().map(|l| l.line).collect();
        assert_eq!(lines, [Some(3), Some(4)]);
        let d = only(&out);
        assert_eq!(d.element_count(), Some(2));
        let Geometry::Points(p) = &d.geometry else {
            panic!("not points")
        };
        assert_eq!(
            (p.get(0), p.get(1)),
            (Some([1.0, 2.0, 0.0]), Some([7.0, 8.0, 0.0]))
        );
    }

    #[test]
    fn skipped_rows_take_their_attribute_values_with_them() {
        let text = "X,Y,Name\n1,2,a\n,4,b\n7,8,c\n";
        let mut mapping = collars();
        mapping.empty_coordinates = EmptyCoordinates::Skip;
        mapping.columns = vec![
            col("X", Role::X, None),
            col("Y", Role::Y, None),
            col("Name", Role::Attribute, Some(ColumnType::Utf8)),
        ];
        let d = read_csv(text, COMMA, &mapping, None);
        let name = only(&d).attributes.column("Name").unwrap();
        assert_eq!(
            (name.get(0), name.get(1), name.len()),
            (Some(Value::Utf8("a")), Some(Value::Utf8("c")), 2)
        );
    }

    #[test]
    fn a_nodata_number_in_a_coordinate_counts_as_missing() {
        let (text, mapping) = simple(&[("1", "2"), ("-999", "4")]);
        let mut mapping = mapping;
        mapping.nodata.numbers = vec![-999.0];
        let out = read_csv(&text, COMMA, &mapping, None);
        assert_eq!(codes(&out), ["csv.coordinate.missing"]);
    }

    #[test]
    fn unreadable_attribute_values_become_null_with_one_warning_per_column() {
        let text =
            "X,Y,Au,Count,Flag\n1,2,0.5,1,true\n3,4,<0.01,2.5,maybe\n5,6,0.7,x,false\n7,8,,,\n";
        let mut mapping = collars();
        mapping.columns = vec![
            col("X", Role::X, None),
            col("Y", Role::Y, None),
            col("Au", Role::Attribute, Some(ColumnType::Float64)),
            col("Count", Role::Attribute, Some(ColumnType::Int64)),
            col("Flag", Role::Attribute, Some(ColumnType::Bool)),
        ];
        let out = read_csv(text, COMMA, &mapping, None);
        assert_eq!(
            codes(&out),
            [
                "csv.value.unreadable",
                "csv.value.unreadable",
                "csv.value.unreadable"
            ]
        );
        let au = &out.findings.as_slice()[0];
        assert_eq!(
            au.message,
            "Some values in the column \"Au\" could not be read as float, so they were left empty."
        );
        assert_eq!((au.count, au.examples[0].line), (1, Some(3)));
        assert_eq!(out.findings.as_slice()[1].count, 2);
        assert_eq!(out.findings.as_slice()[2].count, 1);
        assert!(
            out.findings
                .iter()
                .all(|f| f.severity == karmania_core::Severity::Warning)
        );
        let d = only(&out);
        assert_eq!(d.attributes.column("Au").unwrap().null_count(), 2);
        assert_eq!(d.attributes.column("Count").unwrap().null_count(), 3);
        assert_eq!(d.attributes.column("Flag").unwrap().null_count(), 2);
    }

    #[test]
    fn nodata_words_apply_to_numbers_only_and_empty_cells_are_null_everywhere() {
        let text = "X,Y,Val,Note\n1,2,NA,NA\n3,4,5,\n";
        let mut mapping = collars();
        mapping.nodata.tokens = vec![String::new(), "NA".into()];
        mapping.columns = vec![
            col("X", Role::X, None),
            col("Y", Role::Y, None),
            col("Val", Role::Attribute, Some(ColumnType::Float64)),
            col("Note", Role::Attribute, Some(ColumnType::Utf8)),
        ];
        let out = read_csv(text, COMMA, &mapping, None);
        assert!(out.findings.is_empty());
        let d = only(&out);
        assert_eq!(d.attributes.column("Val").unwrap().get(0), None);
        let note = d.attributes.column("Note").unwrap();
        assert_eq!((note.get(0), note.get(1)), (Some(Value::Utf8("NA")), None));
    }

    #[test]
    fn a_semicolon_file_with_decimal_commas_is_read_as_numbers() {
        let text = "X;Y;V\n1,5;2,5;0,25\n3,5;4,5;0,75\n";
        let mut mapping = collars();
        mapping.decimal_separator = DecimalSeparator::Comma;
        mapping.columns = vec![
            col("X", Role::X, None),
            col("Y", Role::Y, None),
            col("V", Role::Attribute, None),
        ];
        let options = CsvOptions {
            delimiter: Delimiter::Semicolon,
            has_header: true,
        };
        let out = read_csv(text, options, &mapping, None);
        assert!(out.findings.is_empty(), "{:?}", codes(&out));
        let d = only(&out);
        let Geometry::Points(p) = &d.geometry else {
            panic!("not points")
        };
        assert_eq!(p.get(1), Some([3.5, 4.5, 0.0]));
        assert_eq!(
            d.attributes.column("V").unwrap().get(1),
            Some(Value::Float64(0.75))
        );
    }

    #[test]
    fn a_file_without_a_header_uses_generated_column_names() {
        let text = "1,2,10\n3,4,20\n";
        let mut mapping = collars();
        mapping.columns = vec![
            col("Column 1", Role::X, None),
            col("Column 2", Role::Y, None),
            col("Column 3", Role::Attribute, None),
        ];
        let options = CsvOptions {
            delimiter: Delimiter::Comma,
            has_header: false,
        };
        let out = read_csv(text, options, &mapping, None);
        let d = only(&out);
        assert_eq!(d.element_count(), Some(2));
        assert_eq!(
            d.attributes.column("Column 3").unwrap().get(0),
            Some(Value::Int64(10))
        );
    }

    #[test]
    fn rename_and_ignore_are_honoured() {
        let text = "X,Y,A,B\n1,2,3,4\n";
        let mut mapping = collars();
        mapping.columns = vec![
            col("X", Role::X, None),
            col("Y", Role::Y, None),
            ColumnMapping {
                rename: Some("alpha".into()),
                ..col("A", Role::Attribute, None)
            },
            col("B", Role::Ignore, None),
        ];
        let d = read_csv(text, COMMA, &mapping, None);
        let names: Vec<_> = only(&d)
            .attributes
            .columns()
            .iter()
            .map(Column::name)
            .collect();
        assert_eq!(names, ["alpha"]);
    }

    #[test]
    fn ragged_rows_are_counted_and_missing_cells_are_empty() {
        let text = "X,Y,V\n1,2,5\n3,4\n5,6,7,8\n";
        let mut mapping = collars();
        mapping.columns = vec![
            col("X", Role::X, None),
            col("Y", Role::Y, None),
            col("V", Role::Attribute, Some(ColumnType::Float64)),
        ];
        let out = read_csv(text, COMMA, &mapping, None);
        assert_eq!(codes(&out), ["csv.rows.ragged"]);
        let f = &out.findings.as_slice()[0];
        assert_eq!(f.count, 2);
        assert!(
            f.message
                .contains("different number of values from the header (3)")
        );
        let lines: Vec<_> = f.examples.iter().map(|l| l.line).collect();
        assert_eq!(lines, [Some(3), Some(4)]);
        let v = only(&out).attributes.column("V").unwrap();
        assert_eq!(
            (v.get(0), v.get(1), v.get(2)),
            (Some(Value::Float64(5.0)), None, Some(Value::Float64(7.0)))
        );
    }

    #[test]
    fn line_numbers_count_blank_lines_and_quoted_line_breaks() {
        let text = "X,Y,N\n1,2,\"a\nb\"\n\n,4,c\n";
        let mut mapping = collars();
        mapping.columns = vec![
            col("X", Role::X, None),
            col("Y", Role::Y, None),
            col("N", Role::Attribute, None),
        ];
        let out = read_csv(text, COMMA, &mapping, None);
        assert_eq!(out.findings.as_slice()[0].examples[0].line, Some(5));
    }

    #[test]
    fn a_bad_mapping_gives_its_findings_and_no_dataset() {
        let mut mapping = collars();
        mapping.columns = vec![
            col("Missing", Role::X, None),
            col("Northing", Role::Y, None),
        ];
        let out = read_csv(&fixtures::text("points.csv"), COMMA, &mapping, None);
        assert!(out.datasets.is_empty());
        assert_eq!(codes(&out), ["mapping.source.unknown"]);
        let mut no_x = collars();
        no_x.columns.remove(0);
        assert!(
            codes(&read_csv(&fixtures::text("points.csv"), COMMA, &no_x, None))
                .contains(&"mapping.coordinate.missing")
        );
    }

    #[test]
    fn empty_header_only_and_non_points_inputs_do_not_panic_and_say_why() {
        let mapping = collars();
        let empty = read_csv("", COMMA, &mapping, None);
        assert_eq!(
            (empty.datasets.len(), codes(&empty)),
            (0, vec!["file.empty"])
        );
        let (header_only, m) = simple(&[]);
        let out = read_csv(&header_only, COMMA, &m, None);
        assert_eq!(only(&out).element_count(), Some(0));
        let (text, mut lines) = simple(&[("1", "2")]);
        lines.kind = Kind::Lines;
        lines.columns.push(col("X", Role::LineId, None));
        let out = read_csv(&text, COMMA, &lines, None);
        assert!(out.datasets.is_empty() && out.findings.has_errors());
    }

    fn line_mapping(columns: Vec<ColumnMapping>) -> ImportMapping {
        let mut mapping = collars();
        mapping.kind = Kind::Lines;
        mapping.columns = columns;
        mapping
    }

    fn line_columns() -> Vec<ColumnMapping> {
        vec![
            col("Line", Role::LineId, None),
            col("X", Role::X, None),
            col("Y", Role::Y, None),
            col("Z", Role::Z, None),
        ]
    }

    fn as_lines(d: &Dataset) -> &karmania_core::Lines {
        let Geometry::Lines(lines) = &d.geometry else {
            panic!("not lines")
        };
        lines
    }

    fn line_ids(d: &Dataset) -> Vec<String> {
        let ids = d.attributes.columns().first().expect("an id column");
        (0..ids.len())
            .map(|i| match ids.get(i) {
                Some(Value::Utf8(s)) => s.to_string(),
                other => panic!("unexpected {other:?}"),
            })
            .collect()
    }

    #[test]
    fn the_sample_file_becomes_two_lines_grouped_by_their_identifier() {
        let mapping = line_mapping(line_columns());
        let out = read_csv(
            &fixtures::text("lines.csv"),
            COMMA,
            &mapping,
            Some("lines.csv"),
        );
        assert!(out.findings.is_empty(), "{:?}", codes(&out));
        let d = only(&out);
        assert_eq!(
            (d.kind(), d.has_z(), d.name.as_str()),
            (Kind::Lines, true, "Collars")
        );
        let lines = as_lines(d);
        assert_eq!(lines.offsets, [0, 3, 5]);
        assert_eq!(
            lines.positions.get(0),
            Some([500_000.0, 2_765_000.0, 100.0])
        );
        assert_eq!(lines.positions.get(3), Some([500_200.0, 2_765_000.0, 98.0]));
        assert_eq!(d.element_count(), Some(2));
        assert_eq!(line_ids(d), ["A", "B"]);
        assert_eq!(d.attributes.columns()[0].name(), "Line");
        assert!(d.vertex_attributes.is_none());
        assert!(karmania_core::validate(d).is_loadable());
    }

    #[test]
    fn lines_come_in_order_of_first_appearance_and_vertices_in_row_order() {
        let text = "Line,X,Y\nB,1,1\nB,2,2\nA,3,3\nA,4,4\nA,5,5\n";
        let mut columns = line_columns();
        columns.pop();
        let out = read_csv(text, COMMA, &line_mapping(columns), None);
        assert!(out.findings.is_empty());
        let d = only(&out);
        assert_eq!(line_ids(d), ["B", "A"]);
        assert_eq!(as_lines(d).offsets, [0, 2, 5]);
        assert!(!d.has_z());
    }

    #[test]
    fn rows_of_a_line_that_are_not_together_are_gathered_and_reported_as_info() {
        let text = "Line,X,Y,V\nA,1,1,10\nB,2,2,20\nA,3,3,30\nB,4,4,40\nA,5,5,50\n";
        let mut columns = line_columns();
        columns.pop();
        columns.push(col("V", Role::Attribute, Some(ColumnType::Int64)));
        let out = read_csv(text, COMMA, &line_mapping(columns), None);
        assert_eq!(codes(&out), ["csv.lines.scattered"]);
        let f = &out.findings.as_slice()[0];
        assert_eq!((f.severity, f.count), (karmania_core::Severity::Info, 2));
        let lines: Vec<_> = f.examples.iter().map(|l| l.line).collect();
        assert_eq!(lines, [Some(4), Some(5)]);
        let d = only(&out);
        assert_eq!(line_ids(d), ["A", "B"]);
        let l = as_lines(d);
        assert_eq!(l.offsets, [0, 3, 5]);
        let xs: Vec<f64> = l.positions.iter().map(|p| p[0]).collect();
        assert_eq!(xs, [1.0, 3.0, 5.0, 2.0, 4.0]);
        // The vertex attributes were reordered with the vertices.
        let v = d.vertex_attributes.as_ref().unwrap().column("V").unwrap();
        let values: Vec<_> = (0..5).map(|i| v.get(i)).collect();
        let expected: Vec<_> = [10, 30, 50, 20, 40].map(|n| Some(Value::Int64(n))).to_vec();
        assert_eq!(values, expected);
    }

    #[test]
    fn identifiers_are_trimmed_and_a_missing_one_leaves_the_row_out_with_a_warning() {
        let text = "Line,X,Y\n A ,1,1\n,2,2\nA,3,3\n  ,4,4\n";
        let mut columns = line_columns();
        columns.pop();
        let out = read_csv(text, COMMA, &line_mapping(columns), None);
        assert_eq!(codes(&out), ["csv.line_id.missing"]);
        let f = &out.findings.as_slice()[0];
        assert_eq!((f.count, f.severity), (2, karmania_core::Severity::Warning));
        let lines: Vec<_> = f.examples.iter().map(|l| l.line).collect();
        assert_eq!(lines, [Some(3), Some(5)]);
        let d = only(&out);
        assert_eq!(line_ids(d), ["A"]);
        assert_eq!(as_lines(d).offsets, [0, 2]);
    }

    #[test]
    fn skipped_coordinate_rows_do_not_disturb_the_line_grouping() {
        let text = "Line,X,Y\nA,1,1\nA,,2\nB,3,3\nA,4,4\n";
        let mut columns = line_columns();
        columns.pop();
        let mut mapping = line_mapping(columns);
        mapping.empty_coordinates = EmptyCoordinates::Skip;
        let out = read_csv(text, COMMA, &mapping, None);
        assert_eq!(codes(&out), ["csv.rows.skipped", "csv.lines.scattered"]);
        let d = only(&out);
        assert_eq!(as_lines(d).offsets, [0, 2, 3]);
        let xs: Vec<f64> = as_lines(d).positions.iter().map(|p| p[0]).collect();
        assert_eq!(xs, [1.0, 4.0, 3.0]);
    }

    #[test]
    fn the_line_column_can_be_renamed_and_other_columns_become_vertex_attributes() {
        let mut columns = line_columns();
        columns[0].rename = Some("line_name".into());
        columns.push(col("Q", Role::Attribute, None));
        let text = "Line,X,Y,Z,Q\nA,1,1,1,x\nA,2,2,2,y\n";
        let out = read_csv(text, COMMA, &line_mapping(columns), None);
        let d = only(&out);
        assert_eq!(d.attributes.columns()[0].name(), "line_name");
        let vertex = d.vertex_attributes.as_ref().unwrap();
        assert_eq!(vertex.row_count(), 2);
        assert_eq!(vertex.columns()[0].name(), "Q");
        assert!(karmania_core::validate(d).is_loadable());
    }

    #[test]
    fn a_lines_file_with_only_a_header_gives_a_lines_dataset_with_no_lines() {
        let out = read_csv(
            "Line,X,Y,Z\n",
            COMMA,
            &line_mapping(line_columns()),
            Some("empty.csv"),
        );
        let d = only(&out);
        assert_eq!(
            (d.element_count(), as_lines(d).offsets.clone()),
            (Some(0), vec![0])
        );
        assert_eq!(d.name, "Collars");
        // Validation then says the dataset is empty.
        let report = karmania_core::validate(d);
        assert!(
            report
                .findings()
                .any(|f| f.code.as_str() == "dataset.empty")
        );
    }

    #[test]
    fn stepping_in_small_batches_gives_the_same_result_as_reading_at_once() {
        let text = fixtures::text("points.csv");
        let mapping = collars();
        let whole = read_csv(&text, COMMA, &mapping, Some("p.csv"));
        let mut import = CsvImport::new(&text, COMMA, &mapping, Some("p.csv"));
        let mut steps = 0;
        while !import.step(3) {
            steps += 1;
            assert!(import.rows_read() <= 3 * steps);
        }
        assert_eq!(import.rows_read(), 8);
        assert_eq!(import.finish(), whole);
        assert_eq!(steps, 2);
    }

    fn block_mapping() -> ImportMapping {
        let mut mapping = collars();
        mapping.dataset_name = "Model".into();
        mapping.kind = Kind::Blocks;
        mapping.columns = vec![
            col("XC", Role::X, None),
            col("YC", Role::Y, None),
            col("ZC", Role::Z, None),
            col("Density", Role::Attribute, None),
            col("Domain", Role::Attribute, None),
        ];
        mapping.block_size = Some([10.0; 3]);
        mapping
    }

    fn as_blocks(d: &Dataset) -> &Blocks {
        let Geometry::Blocks(blocks) = &d.geometry else {
            panic!("not blocks")
        };
        blocks
    }

    /// The sample block file with the given data lines (1-based, the header is
    /// line 1) removed or replaced.
    fn blocks_file(change: impl Fn(usize, &str) -> Option<String>) -> String {
        let text = fixtures::text("blocks.csv");
        let mut out = String::new();
        for (n, row) in text.lines().enumerate() {
            let kept = if n == 0 {
                Some(row.to_string())
            } else {
                change(n + 1, row)
            };
            if let Some(row) = kept {
                out.push_str(&row);
                out.push('\n');
            }
        }
        out
    }

    fn density(d: &Dataset, block: usize) -> Option<Value<'_>> {
        d.attributes.column("Density").unwrap().get(block)
    }

    #[test]
    fn the_sample_file_becomes_a_dense_three_by_three_by_two_model() {
        let out = read_csv(
            &fixtures::text("blocks.csv"),
            COMMA,
            &block_mapping(),
            Some("blocks.csv"),
        );
        assert!(out.findings.is_empty(), "{:?}", codes(&out));
        let d = only(&out);
        assert_eq!(
            (d.name.as_str(), d.kind(), d.has_z()),
            ("Model", Kind::Blocks, true)
        );
        assert_eq!(d.element_count(), Some(18));
        let blocks = as_blocks(d);
        assert!(blocks.is_dense());
        assert_eq!(blocks.lattice.dims, [3, 3, 2]);
        assert_eq!(blocks.lattice.origin, [500_000.0, 2_765_000.0, 90.0]);
        assert_eq!(blocks.lattice.spacing, [10.0; 3]);
        let names: Vec<_> = d.attributes.columns().iter().map(Column::name).collect();
        assert_eq!(names, ["Density", "Domain"]);
        assert_eq!(density(d, 0), Some(Value::Float64(2.5)));
        assert_eq!(density(d, 17), Some(Value::Float64(4.2)));
        assert!(karmania_core::validate(d).is_loadable());
    }

    #[test]
    fn rows_in_another_order_are_put_in_lattice_order_with_their_values() {
        let text = fixtures::text("blocks.csv");
        let mut rows: Vec<&str> = text.lines().skip(1).collect();
        rows.reverse();
        let reversed = format!("XC,YC,ZC,Density,Domain\n{}\n", rows.join("\n"));
        let out = read_csv(&reversed, COMMA, &block_mapping(), None);
        let d = only(&out);
        assert!(as_blocks(d).is_dense());
        // Block 0 is still the one at the lowest corner, with its own density.
        assert_eq!(density(d, 0), Some(Value::Float64(2.5)));
        assert_eq!(density(d, 1), Some(Value::Float64(2.6)));
        assert_eq!(density(d, 17), Some(Value::Float64(4.2)));
        // Every block keeps its own domain label (the codes differ, since the
        // first label seen differs).
        let domain = d.attributes.column("Domain").unwrap();
        let label = |block: usize| match domain.get(block) {
            Some(Value::Category { label, .. }) => label,
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!((label(0), label(8)), (Some("ore"), Some("ore")));
        assert_eq!((label(9), label(17)), (Some("waste"), Some("waste")));
    }

    #[test]
    fn missing_blocks_make_a_sparse_model_in_file_order() {
        // Leave out the block at (1, 1, 0) (line 6) and the last one (line 19).
        let text = blocks_file(|line, row| (line != 6 && line != 19).then(|| row.to_string()));
        let out = read_csv(&text, COMMA, &block_mapping(), None);
        assert!(out.findings.is_empty(), "{:?}", codes(&out));
        let d = only(&out);
        assert_eq!(d.element_count(), Some(16));
        let blocks = as_blocks(d);
        assert_eq!(blocks.lattice.dims, [3, 3, 2]);
        let ijk = blocks.ijk.as_ref().expect("sparse");
        assert_eq!(ijk.len(), 48);
        assert_eq!(blocks.block_ijk(0), Some([0, 0, 0]));
        // The block after the missing (1, 1, 0) is (2, 1, 0), now the fifth in the list.
        assert_eq!(blocks.block_ijk(4), Some([2, 1, 0]));
        assert_eq!(density(d, 4), Some(Value::Float64(3.0)));
        assert!(karmania_core::validate(d).is_loadable());
    }

    #[test]
    fn a_centre_off_the_grid_is_an_error_with_its_line_and_no_dataset() {
        let text = blocks_file(|line, row| {
            Some(if line == 4 {
                row.replacen("500025", "500022", 1)
            } else {
                row.to_string()
            })
        });
        let out = read_csv(&text, COMMA, &block_mapping(), None);
        assert!(out.datasets.is_empty());
        assert_eq!(codes(&out), ["csv.blocks.off_lattice"]);
        let at: Vec<_> = out.findings.as_slice()[0]
            .examples
            .iter()
            .map(|l| l.line)
            .collect();
        assert_eq!(at, [Some(4)]);
    }

    #[test]
    fn a_repeated_block_is_an_error_with_its_line_and_cell() {
        // Line 4 becomes a copy of line 2, so there are 18 rows for 18 cells but
        // one cell is empty and another is doubled.
        let first = fixtures::text("blocks.csv")
            .lines()
            .nth(1)
            .unwrap()
            .to_string();
        let text =
            blocks_file(|line, row| Some(if line == 4 { first.clone() } else { row.into() }));
        let out = read_csv(&text, COMMA, &block_mapping(), None);
        assert!(out.datasets.is_empty());
        assert_eq!(codes(&out), ["csv.blocks.duplicate"]);
        let example = &out.findings.as_slice()[0].examples[0];
        assert_eq!((example.line, example.cell), (Some(4), Some([0, 0, 0])));
    }

    #[test]
    fn a_block_size_that_does_not_fit_the_centres_is_reported() {
        let text = fixtures::text("blocks.csv");
        let mut mapping = block_mapping();
        mapping.block_size = Some([3.0; 3]);
        assert_eq!(
            codes(&read_csv(&text, COMMA, &mapping, None)),
            ["csv.blocks.off_lattice"]
        );
        mapping.block_size = Some([1e-9; 3]);
        assert_eq!(
            codes(&read_csv(&text, COMMA, &mapping, None)),
            ["csv.blocks.lattice_too_large"]
        );
        mapping.block_size = None;
        let out = read_csv(&text, COMMA, &mapping, None);
        assert_eq!(codes(&out), ["mapping.block_size.missing"]);
        assert!(out.datasets.is_empty());
    }

    #[test]
    fn rows_with_a_missing_coordinate_follow_the_mapping_before_the_model_is_built() {
        let text = blocks_file(|line, row| {
            Some(if line == 6 {
                row.replacen(",95,", ",,", 1)
            } else {
                row.to_string()
            })
        });
        let mut mapping = block_mapping();
        let out = read_csv(&text, COMMA, &mapping, None);
        assert!(out.datasets.is_empty());
        assert_eq!(codes(&out), ["csv.coordinate.missing"]);

        mapping.empty_coordinates = EmptyCoordinates::Skip;
        let out = read_csv(&text, COMMA, &mapping, None);
        assert_eq!(codes(&out), ["csv.rows.skipped"]);
        let d = only(&out);
        assert_eq!(d.element_count(), Some(17));
        assert!(!as_blocks(d).is_dense());
    }

    #[test]
    fn a_file_with_no_usable_rows_has_no_blocks() {
        let header_only = read_csv("XC,YC,ZC,Density,Domain\n", COMMA, &block_mapping(), None);
        assert!(header_only.datasets.is_empty());
        assert_eq!(codes(&header_only), ["csv.blocks.none"]);

        let all_skipped =
            blocks_file(|_, row| Some(row.replacen(",95,", ",,", 1).replacen(",105,", ",,", 1)));
        let mut mapping = block_mapping();
        mapping.empty_coordinates = EmptyCoordinates::Skip;
        let out = read_csv(&all_skipped, COMMA, &mapping, None);
        assert!(out.datasets.is_empty());
        assert_eq!(codes(&out), ["csv.rows.skipped", "csv.blocks.none"]);
    }

    #[test]
    fn a_block_model_without_attribute_columns_is_valid() {
        let mut mapping = block_mapping();
        mapping.columns.truncate(3);
        let out = read_csv(&fixtures::text("blocks.csv"), COMMA, &mapping, None);
        assert!(out.findings.is_empty(), "{:?}", codes(&out));
        let d = only(&out);
        assert_eq!(d.attributes.column_count(), 0);
        assert!(karmania_core::validate(d).is_loadable());
    }

    #[test]
    fn stepping_through_a_block_file_gives_the_same_result_as_reading_it_at_once() {
        let text = fixtures::text("blocks.csv");
        let mapping = block_mapping();
        let whole = read_csv(&text, COMMA, &mapping, Some("b.csv"));
        let mut import = CsvImport::new(&text, COMMA, &mapping, Some("b.csv"));
        while !import.step(1) {}
        assert_eq!(import.rows_read(), 18);
        assert_eq!(import.finish(), whole);
    }

    /// An import that owns everything it needs, built from values that are gone
    /// when this returns.
    fn owned_import(rows: usize) -> CsvImport<'static> {
        let mut text = String::from("X,Y\n");
        for i in 0..rows {
            text.push_str(&format!("{i},{}\n", i * 2));
        }
        let (_, mapping) = simple(&[]);
        CsvImport::owned(text, COMMA, mapping, Some("owned.csv"))
    }

    #[test]
    fn an_import_that_owns_its_inputs_gives_the_same_result_as_one_that_borrows() {
        let text = fixtures::text("points.csv");
        let whole = read_csv(&text, COMMA, &collars(), Some("points.csv"));
        let mut owned = CsvImport::owned(text.clone(), COMMA, collars(), Some("points.csv"));
        drop(text);
        let mut steps = 0;
        while !owned.step(3) {
            steps += 1;
        }
        assert_eq!(steps, 2);
        assert_eq!(owned.finish(), whole);
    }

    #[test]
    fn an_owned_import_can_be_held_between_steps_and_stepping_after_the_end_is_harmless() {
        let mut import = owned_import(10);
        assert!(!import.step(4));
        assert_eq!(import.rows_read(), 4);
        assert!(!import.step(4));
        assert!(import.step(4));
        assert_eq!(import.rows_read(), 10);
        // Done stays done and reads nothing more.
        assert!(import.step(4));
        assert_eq!(import.rows_read(), 10);
        let out = import.finish();
        assert_eq!(only(&out).element_count(), Some(10));
        assert_eq!(only(&out).name, "Collars");
    }

    #[test]
    fn stepping_one_row_at_a_time_matches_reading_in_one_go_for_every_kind() {
        let blocks = fixtures::text("blocks.csv");
        let lines = fixtures::text("lines.csv");
        let cases: [(String, ImportMapping); 3] = [
            (fixtures::text("points.csv"), collars()),
            (lines, line_mapping(line_columns())),
            (blocks, block_mapping()),
        ];
        for (text, mapping) in cases {
            let whole = read_csv(&text, COMMA, &mapping, Some("f.csv"));
            let mut import = CsvImport::owned(text, COMMA, mapping, Some("f.csv"));
            while !import.step(1) {}
            assert_eq!(import.finish(), whole);
        }
    }
}
