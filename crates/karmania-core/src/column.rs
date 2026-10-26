//! Attribute columns: typed values with real nulls.
//!
//! A column holds one of five types of data plus a [`Validity`] bitmap. The data
//! slot of a null value holds an arbitrary placeholder that readers must ignore;
//! always go through [`Column::get`] or the validity bitmap.

use std::fmt;

use crate::validity::Validity;

/// The storage type of a column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ColumnType {
    /// 64-bit floating point numbers.
    Float64,
    /// 64-bit signed integers.
    Int64,
    /// True or false.
    Bool,
    /// UTF-8 text.
    Utf8,
    /// Codes into a dictionary of distinct strings.
    Categorical,
}

impl ColumnType {
    /// The name shown to users and used by the import mapping:
    /// `float`, `int`, `bool`, `text` or `category`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            ColumnType::Float64 => "float",
            ColumnType::Int64 => "int",
            ColumnType::Bool => "bool",
            ColumnType::Utf8 => "text",
            ColumnType::Categorical => "category",
        }
    }
}

/// The values of a column, one vector per type.
#[derive(Debug, Clone, PartialEq)]
pub enum ColumnData {
    /// 64-bit floating point numbers.
    Float64(Vec<f64>),
    /// 64-bit signed integers.
    Int64(Vec<i64>),
    /// True or false.
    Bool(Vec<bool>),
    /// UTF-8 text.
    Utf8(Vec<String>),
    /// Codes into a dictionary. A code outside the dictionary is representable
    /// on purpose, so validation can report it instead of construction failing.
    Categorical {
        /// One code per value, an index into `dictionary`.
        codes: Vec<u32>,
        /// The distinct strings the codes refer to.
        dictionary: Vec<String>,
    },
}

impl ColumnData {
    /// Number of values.
    #[must_use]
    pub fn len(&self) -> usize {
        match self {
            ColumnData::Float64(v) => v.len(),
            ColumnData::Int64(v) => v.len(),
            ColumnData::Bool(v) => v.len(),
            ColumnData::Utf8(v) => v.len(),
            ColumnData::Categorical { codes, .. } => codes.len(),
        }
    }

    /// True when there are no values.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The storage type of the data.
    #[must_use]
    pub fn column_type(&self) -> ColumnType {
        match self {
            ColumnData::Float64(_) => ColumnType::Float64,
            ColumnData::Int64(_) => ColumnType::Int64,
            ColumnData::Bool(_) => ColumnType::Bool,
            ColumnData::Utf8(_) => ColumnType::Utf8,
            ColumnData::Categorical { .. } => ColumnType::Categorical,
        }
    }
}

/// One non-null value read from a column.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Value<'a> {
    /// A floating point number (may be NaN or infinite; that is data, not null).
    Float64(f64),
    /// An integer.
    Int64(i64),
    /// A boolean.
    Bool(bool),
    /// Text.
    Utf8(&'a str),
    /// A categorical value.
    Category {
        /// The stored code.
        code: u32,
        /// The dictionary string, or `None` if the code is outside the dictionary.
        label: Option<&'a str>,
    },
}

/// The data and the validity bitmap of a column have different lengths. This is
/// a bug in the code building the column, not a data problem.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LengthMismatch {
    /// Number of values in the data.
    pub data_len: usize,
    /// Number of values in the validity bitmap.
    pub validity_len: usize,
}

impl fmt::Display for LengthMismatch {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "column data has {} values but its validity bitmap has {}",
            self.data_len, self.validity_len
        )
    }
}

impl std::error::Error for LengthMismatch {}

/// A named column of values with nulls.
#[derive(Debug, Clone, PartialEq)]
pub struct Column {
    name: String,
    data: ColumnData,
    validity: Validity,
}

impl Column {
    /// Creates a column. Fails if `validity` and `data` differ in length.
    ///
    /// # Errors
    ///
    /// Returns [`LengthMismatch`] when the lengths differ.
    pub fn new(
        name: impl Into<String>,
        data: ColumnData,
        validity: Validity,
    ) -> Result<Self, LengthMismatch> {
        if data.len() != validity.len() {
            return Err(LengthMismatch {
                data_len: data.len(),
                validity_len: validity.len(),
            });
        }
        Ok(Self {
            name: name.into(),
            data,
            validity,
        })
    }

    /// Creates a column in which every value is valid.
    #[must_use]
    pub fn without_nulls(name: impl Into<String>, data: ColumnData) -> Self {
        let validity = Validity::all_valid(data.len());
        Self {
            name: name.into(),
            data,
            validity,
        }
    }

    /// The column name. Table construction checks that names are unique and
    /// non-empty; a lone column may have any name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The raw data. Entries at null positions are placeholders.
    #[must_use]
    pub fn data(&self) -> &ColumnData {
        &self.data
    }

    /// The validity bitmap.
    #[must_use]
    pub fn validity(&self) -> &Validity {
        &self.validity
    }

    /// Number of values, valid or null.
    #[must_use]
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// True when there are no values.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// Number of null values.
    #[must_use]
    pub fn null_count(&self) -> usize {
        self.validity.null_count()
    }

    /// The storage type of the column.
    #[must_use]
    pub fn column_type(&self) -> ColumnType {
        self.data.column_type()
    }

    /// The smallest and largest valid, finite number in a float or integer
    /// column. Nulls, NaN and infinities are ignored. `None` for other column
    /// types or when no such number exists.
    #[must_use]
    pub fn finite_range(&self) -> Option<(f64, f64)> {
        let numbers = (0..self.len()).filter_map(|i| match self.get(i)? {
            Value::Float64(v) if v.is_finite() => Some(v),
            Value::Int64(v) => Some(v as f64),
            _ => None,
        });
        numbers.fold(None, |range, v| match range {
            None => Some((v, v)),
            Some((lo, hi)) => Some((lo.min(v), hi.max(v))),
        })
    }

    /// The value at `index`, or `None` if it is null or `index` is out of range.
    #[must_use]
    pub fn get(&self, index: usize) -> Option<Value<'_>> {
        if self.validity.is_valid(index) != Some(true) {
            return None;
        }
        match &self.data {
            ColumnData::Float64(v) => v.get(index).copied().map(Value::Float64),
            ColumnData::Int64(v) => v.get(index).copied().map(Value::Int64),
            ColumnData::Bool(v) => v.get(index).copied().map(Value::Bool),
            ColumnData::Utf8(v) => v.get(index).map(|s| Value::Utf8(s.as_str())),
            ColumnData::Categorical { codes, dictionary } => {
                let code = *codes.get(index)?;
                let label = usize::try_from(code)
                    .ok()
                    .and_then(|i| dictionary.get(i))
                    .map(String::as_str);
                Some(Value::Category { code, label })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn type_names_are_the_import_mapping_names() {
        let names = [
            (ColumnType::Float64, "float"),
            (ColumnType::Int64, "int"),
            (ColumnType::Bool, "bool"),
            (ColumnType::Utf8, "text"),
            (ColumnType::Categorical, "category"),
        ];
        for (t, name) in names {
            assert_eq!(t.as_str(), name);
        }
    }

    #[test]
    fn mismatched_validity_length_is_rejected() {
        let data = ColumnData::Int64(vec![1, 2, 3]);
        let err = Column::new("a", data.clone(), Validity::all_valid(2)).unwrap_err();
        assert_eq!(
            err,
            LengthMismatch {
                data_len: 3,
                validity_len: 2
            }
        );
        assert_eq!(
            err.to_string(),
            "column data has 3 values but its validity bitmap has 2"
        );
        assert!(Column::new("a", data, Validity::all_valid(3)).is_ok());
    }

    #[test]
    fn every_type_reads_back_its_values() {
        let cases = [
            (ColumnData::Float64(vec![1.5, -2.0]), Value::Float64(1.5)),
            (ColumnData::Int64(vec![7, -8]), Value::Int64(7)),
            (ColumnData::Bool(vec![true, false]), Value::Bool(true)),
            (ColumnData::Utf8(strings(&["Au", "é"])), Value::Utf8("Au")),
            (
                ColumnData::Categorical {
                    codes: vec![1, 0],
                    dictionary: strings(&["a", "b"]),
                },
                Value::Category {
                    code: 1,
                    label: Some("b"),
                },
            ),
        ];
        for (data, first) in cases {
            let col = Column::without_nulls("c", data);
            assert_eq!((col.len(), col.null_count(), col.is_empty()), (2, 0, false));
            assert_eq!(col.get(0), Some(first));
            assert!(col.get(1).is_some());
        }
    }

    #[test]
    fn nulls_read_as_none_and_are_counted() {
        let data = ColumnData::Float64(vec![1.0, -9999.0, 3.0]);
        let col = Column::new("g", data, Validity::from_flags([true, false, true])).unwrap();
        assert_eq!(col.get(0), Some(Value::Float64(1.0)));
        assert_eq!(col.get(1), None);
        assert_eq!(col.get(2), Some(Value::Float64(3.0)));
        assert_eq!(col.null_count(), 1);
        assert_eq!(col.column_type(), ColumnType::Float64);
    }

    #[test]
    fn out_of_range_index_is_none_not_a_panic() {
        let col = Column::without_nulls("c", ColumnData::Bool(vec![true]));
        assert_eq!(col.get(1), None);
        assert_eq!(col.get(usize::MAX), None);
    }

    #[test]
    fn a_category_code_outside_the_dictionary_is_kept_with_no_label() {
        let data = ColumnData::Categorical {
            codes: vec![0, 5, u32::MAX],
            dictionary: strings(&["x"]),
        };
        let col = Column::without_nulls("c", data);
        assert_eq!(
            col.get(0),
            Some(Value::Category {
                code: 0,
                label: Some("x")
            })
        );
        assert_eq!(
            col.get(1),
            Some(Value::Category {
                code: 5,
                label: None
            })
        );
        assert_eq!(
            col.get(2),
            Some(Value::Category {
                code: u32::MAX,
                label: None
            })
        );
    }

    #[test]
    fn nan_is_a_value_not_a_null() {
        let col = Column::without_nulls("c", ColumnData::Float64(vec![f64::NAN]));
        assert_eq!(col.null_count(), 0);
        assert!(matches!(col.get(0), Some(Value::Float64(x)) if x.is_nan()));
    }

    #[test]
    fn the_finite_range_ignores_nulls_nan_and_infinities() {
        let data = ColumnData::Float64(vec![5.0, f64::NAN, -2.0, f64::INFINITY, 99.0, 0.5]);
        let validity = Validity::from_flags([true, true, true, true, false, true]);
        let col = Column::new("z", data, validity).unwrap();
        assert_eq!(col.finite_range(), Some((-2.0, 5.0)));
    }

    #[test]
    fn the_finite_range_covers_integers_and_skips_other_types() {
        let ints = Column::without_nulls("i", ColumnData::Int64(vec![3, -7, 10]));
        assert_eq!(ints.finite_range(), Some((-7.0, 10.0)));
        let text = Column::without_nulls("t", ColumnData::Utf8(strings(&["1", "2"])));
        let flags = Column::without_nulls("b", ColumnData::Bool(vec![true]));
        assert_eq!((text.finite_range(), flags.finite_range()), (None, None));
        let none = Column::without_nulls("n", ColumnData::Float64(vec![f64::NAN]));
        assert_eq!(none.finite_range(), None);
        assert_eq!(
            Column::without_nulls("e", ColumnData::Int64(vec![])).finite_range(),
            None
        );
    }

    #[test]
    fn empty_columns_of_every_type_are_fine() {
        let empties = [
            ColumnData::Float64(vec![]),
            ColumnData::Int64(vec![]),
            ColumnData::Bool(vec![]),
            ColumnData::Utf8(vec![]),
            ColumnData::Categorical {
                codes: vec![],
                dictionary: vec![],
            },
        ];
        for data in empties {
            let col = Column::without_nulls("c", data);
            assert!(col.is_empty() && col.get(0).is_none());
        }
    }
}
