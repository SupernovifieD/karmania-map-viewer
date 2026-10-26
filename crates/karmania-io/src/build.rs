//! Making datasets from arrays handed over by code, not read from a file.
//!
//! This is what a page that embeds Karmania uses to give it points, lines, polygons,
//! meshes, grids or block models it already holds. The inputs here are plain Rust
//! values; the bindings turn typed arrays into them. A problem with the arrays
//! themselves (lengths that disagree, a name used twice) is a finding and no dataset
//! is made; a problem with the data (a missing coordinate system, coordinates that
//! are not numbers) is found by validation when the dataset is loaded.

use karmania_core::text::format_count;
use karmania_core::{
    Column, ColumnData, CrsRef, Dataset, DatasetId, Finding, FindingCode, Findings, Geometry, Kind,
    Lines, Positions, Table, Validity,
};

/// The values of one column.
#[derive(Debug, Clone, PartialEq)]
pub enum ColumnValues {
    /// Decimal numbers.
    Float(Vec<f64>),
    /// Whole numbers.
    Int(Vec<i64>),
    /// True or false.
    Bool(Vec<bool>),
    /// Text.
    Text(Vec<String>),
    /// Text from a short list: each value is an index into `dictionary`.
    Category {
        /// The index of each value's text in `dictionary`.
        codes: Vec<u32>,
        /// The distinct texts.
        dictionary: Vec<String>,
    },
}

impl ColumnValues {
    fn len(&self) -> usize {
        match self {
            ColumnValues::Float(v) => v.len(),
            ColumnValues::Int(v) => v.len(),
            ColumnValues::Bool(v) => v.len(),
            ColumnValues::Text(v) => v.len(),
            ColumnValues::Category { codes, .. } => codes.len(),
        }
    }

    fn into_data(self) -> ColumnData {
        match self {
            ColumnValues::Float(v) => ColumnData::Float64(v),
            ColumnValues::Int(v) => ColumnData::Int64(v),
            ColumnValues::Bool(v) => ColumnData::Bool(v),
            ColumnValues::Text(v) => ColumnData::Utf8(v),
            ColumnValues::Category { codes, dictionary } => {
                ColumnData::Categorical { codes, dictionary }
            }
        }
    }
}

/// One attribute column: a name, its values, and which of them are null.
#[derive(Debug, Clone, PartialEq)]
pub struct ColumnInput {
    /// The column's name.
    pub name: String,
    /// Its values. A value at a null position is ignored.
    pub values: ColumnValues,
    /// One flag per value, `true` for null; `None` means no value is null.
    pub nulls: Option<Vec<bool>>,
}

/// Makes a table from columns, in order. Adds a finding and returns `None` if a
/// column's null flags do not match its values, a name is empty or used twice, or
/// the columns have different lengths.
pub fn table_from_columns(inputs: Vec<ColumnInput>, findings: &mut Findings) -> Option<Table> {
    let mut columns = Vec::with_capacity(inputs.len());
    let mut ok = true;
    for input in inputs {
        let values = input.values.len();
        let validity = match &input.nulls {
            Some(nulls) => Validity::from_flags(nulls.iter().map(|null| !null)),
            None => Validity::all_valid(values),
        };
        let name = input.name;
        match Column::new(name.clone(), input.values.into_data(), validity) {
            Ok(column) => columns.push(column),
            Err(mismatch) => {
                ok = false;
                findings.add(
                    Finding::new(
                        FindingCode::TableColumnLengthMismatch,
                        format!(
                            "Column \"{name}\" has {} values but {} null flags.",
                            format_count(mismatch.data_len as u64),
                            format_count(mismatch.validity_len as u64)
                        ),
                    )
                    .with_hint("Give a null flag for every value, or none."),
                );
            }
        }
    }
    let table = Table::from_columns(columns, findings);
    if ok { table } else { None }
}

/// The name a dataset gets when none is given: the name of its kind.
fn name_or_kind(name: String, kind: Kind) -> String {
    if name.trim().is_empty() {
        kind.as_str().to_string()
    } else {
        name
    }
}

/// Points to load: one position and one row of attributes each.
#[derive(Debug, Clone, PartialEq)]
pub struct PointsInput {
    /// The dataset's name; blank means `points`.
    pub name: String,
    /// The coordinate system; `None` is reported by validation.
    pub crs: Option<CrsRef>,
    /// Easting or longitude of each point.
    pub x: Vec<f64>,
    /// Northing or latitude of each point.
    pub y: Vec<f64>,
    /// Elevation of each point, or `None` for a 2D set.
    pub z: Option<Vec<f64>>,
    /// The attribute columns, one value per point.
    pub columns: Vec<ColumnInput>,
}

/// Makes a points dataset. `None`, with a finding, if the coordinate lists differ in
/// length or the columns cannot be made into a table.
pub fn build_points(input: PointsInput, findings: &mut Findings) -> Option<Dataset> {
    let positions = Positions::from_xyz(&input.x, &input.y, input.z.as_deref(), findings);
    let attributes = table_from_columns(input.columns, findings);
    Some(Dataset::new(
        DatasetId(0),
        name_or_kind(input.name, Kind::Points),
        input.crs,
        Geometry::Points(positions?),
        attributes?,
    ))
}

/// The attribute table for a per-vertex table: none if there are no columns, since
/// "no table" and "a table with no columns" mean the same and the first is simpler.
fn optional_table(columns: Vec<ColumnInput>, findings: &mut Findings) -> Option<Option<Table>> {
    if columns.is_empty() {
        Some(None)
    } else {
        table_from_columns(columns, findings).map(Some)
    }
}

/// Lines to load: positions in line order, where each line starts, and attributes
/// per line and optionally per vertex.
#[derive(Debug, Clone, PartialEq)]
pub struct LinesInput {
    /// The dataset's name; blank means `lines`.
    pub name: String,
    /// The coordinate system; `None` is reported by validation.
    pub crs: Option<CrsRef>,
    /// Easting or longitude of each vertex.
    pub x: Vec<f64>,
    /// Northing or latitude of each vertex.
    pub y: Vec<f64>,
    /// Elevation of each vertex, or `None` for 2D lines.
    pub z: Option<Vec<f64>>,
    /// Where each line starts in the vertex list, plus the end: one more entry than
    /// there are lines, starting at 0 and never decreasing.
    pub offsets: Vec<u32>,
    /// The attribute columns, one value per line.
    pub columns: Vec<ColumnInput>,
    /// Attribute columns with one value per vertex; none for no vertex table.
    pub vertex_columns: Vec<ColumnInput>,
}

/// Makes a lines dataset. `None`, with a finding, if the coordinate lists differ in
/// length or the columns cannot be made into tables. Offsets that do not fit the
/// vertices are left to validation.
pub fn build_lines(input: LinesInput, findings: &mut Findings) -> Option<Dataset> {
    let positions = Positions::from_xyz(&input.x, &input.y, input.z.as_deref(), findings);
    let attributes = table_from_columns(input.columns, findings);
    let vertex_attributes = optional_table(input.vertex_columns, findings);
    let mut dataset = Dataset::new(
        DatasetId(0),
        name_or_kind(input.name, Kind::Lines),
        input.crs,
        Geometry::Lines(Lines {
            positions: positions?,
            offsets: input.offsets,
        }),
        attributes?,
    );
    dataset.vertex_attributes = vertex_attributes?;
    Some(dataset)
}

#[cfg(test)]
mod tests {
    use super::*;
    use karmania_core::{ColumnType, Units, Value};

    fn metres() -> Option<CrsRef> {
        Some(CrsRef::Local {
            units: Units::Metre,
        })
    }

    fn column(name: &str, values: ColumnValues) -> ColumnInput {
        ColumnInput {
            name: name.into(),
            values,
            nulls: None,
        }
    }

    fn points(x: Vec<f64>, y: Vec<f64>, columns: Vec<ColumnInput>) -> PointsInput {
        PointsInput {
            name: "Wells".into(),
            crs: metres(),
            x,
            y,
            z: None,
            columns,
        }
    }

    fn codes(findings: &Findings) -> Vec<&'static str> {
        findings.iter().map(|f| f.code.as_str()).collect()
    }

    #[test]
    fn points_with_columns_of_every_type_become_a_dataset() {
        let columns = vec![
            column("au", ColumnValues::Float(vec![0.5, 1.5, 2.5])),
            column("n", ColumnValues::Int(vec![1, 2, i64::MAX])),
            column("ok", ColumnValues::Bool(vec![true, false, true])),
            column(
                "note",
                ColumnValues::Text(vec!["a".into(), "b".into(), "c".into()]),
            ),
            column(
                "rock",
                ColumnValues::Category {
                    codes: vec![0, 1, 0],
                    dictionary: vec!["ore".into(), "waste".into()],
                },
            ),
        ];
        let mut input = points(vec![1.0, 2.0, 3.0], vec![4.0, 5.0, 6.0], columns);
        input.z = Some(vec![7.0, 8.0, 9.0]);
        let mut findings = Findings::new();
        let d = build_points(input, &mut findings).unwrap();
        assert!(findings.is_empty());
        assert_eq!(
            (d.name.as_str(), d.kind(), d.has_z(), d.element_count()),
            ("Wells", Kind::Points, true, Some(3))
        );
        assert_eq!(d.crs, metres());
        let types: Vec<_> = d
            .attributes
            .columns()
            .iter()
            .map(Column::column_type)
            .collect();
        assert_eq!(
            types,
            [
                ColumnType::Float64,
                ColumnType::Int64,
                ColumnType::Bool,
                ColumnType::Utf8,
                ColumnType::Categorical
            ]
        );
        assert_eq!(
            d.attributes.column("n").unwrap().get(2),
            Some(Value::Int64(i64::MAX))
        );
        assert!(karmania_core::validate(&d).is_loadable());
    }

    #[test]
    fn null_flags_make_real_nulls() {
        let mut au = column("au", ColumnValues::Float(vec![1.0, 2.0, 3.0]));
        au.nulls = Some(vec![false, true, false]);
        let mut findings = Findings::new();
        let d = build_points(points(vec![0.0; 3], vec![0.0; 3], vec![au]), &mut findings).unwrap();
        let au = d.attributes.column("au").unwrap();
        assert_eq!(
            (au.get(0), au.get(1), au.null_count()),
            (Some(Value::Float64(1.0)), None, 1)
        );
    }

    #[test]
    fn a_blank_name_becomes_the_name_of_the_kind() {
        let mut input = points(vec![1.0], vec![2.0], vec![]);
        input.name = "  ".into();
        let d = build_points(input, &mut Findings::new()).unwrap();
        assert_eq!(d.name, "points");
    }

    #[test]
    fn coordinate_lists_of_different_lengths_make_no_dataset_and_a_finding() {
        let mut findings = Findings::new();
        assert!(build_points(points(vec![1.0, 2.0], vec![1.0], vec![]), &mut findings).is_none());
        assert_eq!(codes(&findings), ["dataset.coordinates.length_mismatch"]);
        let mut with_z = points(vec![1.0, 2.0], vec![1.0, 2.0], vec![]);
        with_z.z = Some(vec![1.0]);
        let mut findings = Findings::new();
        assert!(build_points(with_z, &mut findings).is_none());
        assert!(findings.has_errors());
    }

    #[test]
    fn column_problems_make_no_dataset_and_say_which_column() {
        // Null flags that do not match the values.
        let mut bad = column("au", ColumnValues::Float(vec![1.0, 2.0]));
        bad.nulls = Some(vec![false]);
        let mut findings = Findings::new();
        assert!(
            build_points(points(vec![0.0; 2], vec![0.0; 2], vec![bad]), &mut findings).is_none()
        );
        assert_eq!(codes(&findings), ["table.column.length_mismatch"]);
        assert_eq!(
            findings.as_slice()[0].message,
            "Column \"au\" has 2 values but 1 null flags."
        );
        // A column with the wrong number of values for the points.
        let mut findings = Findings::new();
        let short = column("au", ColumnValues::Float(vec![1.0]));
        let table_ok = build_points(
            points(vec![0.0; 2], vec![0.0; 2], vec![short]),
            &mut findings,
        );
        // It builds (the table is fine on its own); loading finds the row mismatch.
        assert!(table_ok.is_some());
        assert!(
            karmania_core::validate(&table_ok.unwrap())
                .findings()
                .any(|f| f.code.as_str() == "dataset.attributes.rows_mismatch")
        );
        // Names used twice, or empty, and columns of different lengths.
        for columns in [
            vec![
                column("a", ColumnValues::Float(vec![1.0])),
                column("a", ColumnValues::Float(vec![1.0])),
            ],
            vec![column(" ", ColumnValues::Float(vec![1.0]))],
            vec![
                column("a", ColumnValues::Float(vec![1.0])),
                column("b", ColumnValues::Float(vec![1.0, 2.0])),
            ],
        ] {
            let mut findings = Findings::new();
            assert!(build_points(points(vec![0.0], vec![0.0], columns), &mut findings).is_none());
            assert!(findings.has_errors());
        }
    }

    #[test]
    fn data_problems_are_left_to_validation() {
        // Not a number as a coordinate, and no coordinate system.
        let mut input = points(vec![f64::NAN, 2.0], vec![1.0, 2.0], vec![]);
        input.crs = None;
        let d = build_points(input, &mut Findings::new()).unwrap();
        let report = karmania_core::validate(&d);
        let found: Vec<_> = report.findings().map(|f| f.code.as_str()).collect();
        assert!(found.contains(&"values.coordinates.not_finite") && found.contains(&"crs.missing"));
    }

    fn lines(offsets: Vec<u32>) -> LinesInput {
        LinesInput {
            name: "Roads".into(),
            crs: metres(),
            x: vec![0.0, 1.0, 2.0, 5.0, 6.0],
            y: vec![0.0, 1.0, 0.0, 5.0, 6.0],
            z: None,
            offsets,
            columns: vec![column(
                "name",
                ColumnValues::Text(vec!["A".into(), "B".into()]),
            )],
            vertex_columns: Vec::new(),
        }
    }

    #[test]
    fn lines_become_a_dataset_with_per_line_and_per_vertex_attributes() {
        let mut input = lines(vec![0, 3, 5]);
        input.vertex_columns = vec![column(
            "depth",
            ColumnValues::Float(vec![1.0, 2.0, 3.0, 4.0, 5.0]),
        )];
        let mut findings = Findings::new();
        let d = build_lines(input, &mut findings).unwrap();
        assert!(findings.is_empty());
        assert_eq!(
            (d.kind(), d.element_count(), d.geometry.vertex_count()),
            (Kind::Lines, Some(2), Some(5))
        );
        assert_eq!(d.vertex_attributes.as_ref().map(Table::row_count), Some(5));
        assert!(karmania_core::validate(&d).is_loadable());
    }

    #[test]
    fn no_vertex_columns_means_no_vertex_table() {
        let d = build_lines(lines(vec![0, 3, 5]), &mut Findings::new()).unwrap();
        assert!(d.vertex_attributes.is_none());
        assert_eq!(d.name, "Roads");
        let mut unnamed = lines(vec![0, 3, 5]);
        unnamed.name = String::new();
        assert_eq!(
            build_lines(unnamed, &mut Findings::new()).unwrap().name,
            "lines"
        );
    }

    #[test]
    fn offsets_that_do_not_fit_are_left_to_validation_which_names_the_problem() {
        let cases: [(Vec<u32>, &str); 4] = [
            (vec![0, 4, 3, 5], "lines.offsets.decreasing"),
            (vec![1, 3, 5], "lines.offsets.bad_start"),
            (vec![0, 3, 4], "lines.offsets.bad_end"),
            (vec![], "lines.offsets.empty"),
        ];
        for (offsets, code) in cases {
            let d = build_lines(lines(offsets), &mut Findings::new()).unwrap();
            let report = karmania_core::validate(&d);
            assert!(report.findings().any(|f| f.code.as_str() == code), "{code}");
            assert!(!report.is_loadable());
        }
    }

    #[test]
    fn a_line_of_one_vertex_loads_with_a_warning() {
        let mut input = lines(vec![0, 1, 5]);
        input.columns = vec![column(
            "name",
            ColumnValues::Text(vec!["A".into(), "B".into()]),
        )];
        let d = build_lines(input, &mut Findings::new()).unwrap();
        let report = karmania_core::validate(&d);
        assert!(report.is_loadable());
        assert!(
            report
                .findings()
                .any(|f| f.code.as_str() == "lines.line.too_short")
        );
    }

    #[test]
    fn vertex_columns_with_the_wrong_number_of_rows_are_found_by_validation() {
        let mut input = lines(vec![0, 3, 5]);
        input.vertex_columns = vec![column("depth", ColumnValues::Float(vec![1.0, 2.0]))];
        let d = build_lines(input, &mut Findings::new()).unwrap();
        assert!(
            karmania_core::validate(&d)
                .findings()
                .any(|f| f.code.as_str() == "dataset.vertex_attributes.rows_mismatch")
        );
    }

    #[test]
    fn lines_with_mismatched_coordinate_lists_or_bad_columns_make_no_dataset() {
        let mut short = lines(vec![0, 3, 5]);
        short.y.pop();
        let mut findings = Findings::new();
        assert!(build_lines(short, &mut findings).is_none());
        assert_eq!(codes(&findings), ["dataset.coordinates.length_mismatch"]);
        let mut bad = lines(vec![0, 3, 5]);
        bad.vertex_columns = vec![
            column("a", ColumnValues::Float(vec![1.0])),
            column("a", ColumnValues::Float(vec![1.0])),
        ];
        let mut findings = Findings::new();
        assert!(build_lines(bad, &mut findings).is_none());
        assert!(findings.has_errors());
    }
}
