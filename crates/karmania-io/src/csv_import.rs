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

use std::collections::BTreeMap;

use karmania_core::{
    Column, ColumnData, ColumnType, Dataset, DatasetId, Finding, FindingCode, Findings, Geometry,
    Kind, Location, Positions, Provenance, Table, Validity, check_size,
};

use crate::delimited::{Delimiter, PREVIEW_ROWS, Record, RecordReader};
use crate::infer::infer_types;
use crate::mapping::{EmptyCoordinates, ImportMapping, validate_mapping};
use crate::numbers::{DecimalSeparator, parse_int, parse_number};
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

/// What a reader produced: the datasets (none if there were errors) and every
/// finding along the way.
#[derive(Debug, Clone, PartialEq)]
pub struct ReadOutput {
    /// The datasets. Their ids are all zero; whoever holds the datasets assigns
    /// real ones.
    pub datasets: Vec<Dataset>,
    /// What was found.
    pub findings: Findings,
}

/// One finding being counted as rows go by.
struct Tally(Finding);

impl Tally {
    fn new(finding: Finding) -> Self {
        let mut finding = finding;
        finding.count = 0;
        Self(finding)
    }

    fn hit(&mut self, at: Location) {
        self.0.count += 1;
        self.0.add_example(at);
    }

    fn into_finding(self) -> Option<Finding> {
        (self.0.count > 0).then_some(self.0)
    }
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

/// Reads a CSV file into a dataset, a few rows at a time.
///
/// Create it with [`CsvImport::new`], call [`CsvImport::step`] until it returns
/// `true`, then take the result with [`CsvImport::finish`]. A mapping with
/// errors, an empty file, or a file too big to hold makes the import finish at
/// once with no dataset.
pub struct CsvImport<'a> {
    reader: RecordReader<'a>,
    record: Record,
    file_name: Option<String>,
    mapping: &'a ImportMapping,
    conversion: Conversion,
    coordinates: [Option<CoordinateColumn>; 3],
    builders: Vec<Builder>,
    positions: [Vec<f64>; 3],
    header_len: usize,
    ragged: Tally,
    skipped: Tally,
    findings: Findings,
    done: bool,
    rows: u64,
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
        let mut findings = Findings::new();
        let mut reader = RecordReader::new(text, options.delimiter);
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
            validate_mapping(mapping, &header, &mut findings);
        } else {
            findings.add(
                Finding::new(FindingCode::FileEmpty, "The file has no data in it.")
                    .with_hint("Check that you chose the right file."),
            );
        }
        if mapping.kind != Kind::Points && !findings.has_errors() {
            findings.add(Finding::new(
                FindingCode::MappingKindUnsupported,
                "This version can only import a CSV file as points.",
            ));
        }
        let lines = text.lines().filter(|l| !l.trim().is_empty()).count() as u64;
        let data_rows = lines.saturating_sub(u64::from(options.has_header));
        check_size(Some(data_rows), "points", &mut findings);

        let index_of = |name: &str| header.iter().position(|h| h == name);
        let coordinate = |role: Role| {
            let column = mapping.columns.iter().find(|c| c.role == role)?;
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
        let sample = sample_types(text, options, mapping, header.len());
        let builders = mapping
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
        let done = findings.has_errors();
        Self {
            // Without a header the first row is data, so start again from the top.
            reader: if options.has_header {
                reader
            } else {
                RecordReader::new(text, options.delimiter)
            },
            record: Record::new(),
            file_name: file_name.map(str::to_string),
            mapping,
            conversion: Conversion::new(mapping),
            coordinates: [
                coordinate(Role::X),
                coordinate(Role::Y),
                coordinate(Role::Z),
            ],
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
        }
    }
}

impl CsvImport<'_> {
    /// Reads up to `max_rows` more rows. Returns `true` when the file is done.
    pub fn step(&mut self, max_rows: usize) -> bool {
        for _ in 0..max_rows {
            if self.done {
                break;
            }
            if !self.reader.read(&mut self.record) {
                self.done = true;
                break;
            }
            self.row();
        }
        self.done
    }

    /// The number of data rows read so far.
    #[must_use]
    pub fn rows_read(&self) -> u64 {
        self.rows
    }

    fn row(&mut self) {
        self.rows += 1;
        let line = self.record.line();
        if self.record.len() != self.header_len {
            self.ragged.hit(Location::default().with_line(line));
        }
        let mut values = [0.0f64; 3];
        let mut usable = true;
        for (axis, slot) in self.coordinates.iter_mut().enumerate() {
            let Some(column) = slot else { continue };
            match self.conversion.float(self.record.get(column.source)) {
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
        for (axis, store) in self.positions.iter_mut().enumerate() {
            if self.coordinates.get(axis).is_some_and(Option::is_some) {
                store.push(values[axis]);
            }
        }
        for builder in &mut self.builders {
            builder.push(self.record.get(builder.source), &self.conversion, line);
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
        let mut columns = Vec::new();
        for builder in self.builders {
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
        let [x, y, z] = self.positions;
        let positions =
            Positions::from_xyz(&x, &y, has_z.then_some(z.as_slice()), &mut self.findings);
        let attributes = Table::from_columns(columns, &mut self.findings);
        let (Some(positions), Some(attributes)) = (positions, attributes) else {
            return ReadOutput {
                datasets: Vec::new(),
                findings: self.findings,
            };
        };
        let name = if self.mapping.dataset_name.trim().is_empty() {
            self.file_name
                .clone()
                .unwrap_or_else(|| "points".to_string())
        } else {
            self.mapping.dataset_name.clone()
        };
        let mut dataset = Dataset::new(
            DatasetId(0),
            name,
            self.mapping.crs,
            Geometry::Points(positions),
            attributes,
        );
        dataset.provenance = Provenance {
            source_file_name: self.file_name,
        };
        ReadOutput {
            datasets: vec![dataset],
            findings: self.findings,
        }
    }
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
    use karmania_core::{CrsRef, Value};

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
}
