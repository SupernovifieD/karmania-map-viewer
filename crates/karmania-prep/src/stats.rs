//! Statistics of a column: how many values, how many are missing, the range, and the distinct values.
//!
//! Everything here is exact and in a fixed order, so that the same column always gives the same
//! numbers and the same classes: the distinct values are counted in a hash map (fast, with no random state)
//! and sorted by value once at the end, so that nothing leaves the map in the order it keeps.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

use karmania_core::{Column, Value};
use serde::{Deserialize, Serialize};

/// The most distinct values counted. A column with more has too many to be classified as categories, and
/// is said to have [`Distinct::TooMany`]; counting a million identifiers one by one would only be thrown away.
pub const DISTINCT_LIMIT: usize = 10_000;

/// One value of a column, owned, as a category: a number (integers as the number they are, `f64`), text
/// or a truth value. A category of a categorical column is its label. In JSON it is the number, the string or
/// the boolean itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Category {
    /// A number.
    Number(f64),
    /// Text, or the label of a categorical value.
    Text(String),
    /// True or false.
    Bool(bool),
}

/// The distinct values of a column, with how many rows have each.
#[derive(Debug, Clone, PartialEq)]
pub enum Distinct {
    /// Every distinct value in ascending order (numbers by value, text by its bytes, false before true)
    /// and its count; the counts add up to the rows that have a value and are not `non_finite`.
    Values(Vec<(Category, u64)>),
    /// More than [`DISTINCT_LIMIT`] distinct values: none are listed.
    TooMany,
}

/// What a column holds.
#[derive(Debug, Clone, PartialEq)]
pub struct ColumnStats {
    /// The number of rows.
    pub count: u64,
    /// The rows that are null (a real null, not NaN).
    pub nulls: u64,
    /// The rows of a float column that are NaN or infinite: data, not null, and not part of the range or of
    /// the distinct values.
    pub non_finite: u64,
    /// The smallest and largest finite number of a float or integer column; `None` if there is none or the
    /// column is not numeric.
    pub range: Option<(f64, f64)>,
    /// The distinct values and their counts.
    pub distinct: Distinct,
}

/// The value at `row` of `column` as a category, or `None` if it has no value to put in a class: a null, a
/// number that is not finite, a categorical code that is not in its dictionary, or a row past the end. A
/// number is the number it is, with -0 taken as 0, as [`column_stats`] counts it.
#[must_use]
pub fn category_at(column: &Column, row: usize) -> Option<Category> {
    match column.get(row)? {
        Value::Float64(v) if v.is_finite() => {
            Some(Category::Number(if v == 0.0 { 0.0 } else { v }))
        }
        Value::Float64(_) => None,
        Value::Int64(v) => Some(Category::Number(v as f64)),
        Value::Bool(v) => Some(Category::Bool(v)),
        Value::Utf8(v) => Some(Category::Text(v.to_owned())),
        Value::Category { label, .. } => label.map(|v| Category::Text(v.to_owned())),
    }
}

/// A hasher with no random state, for the maps that count values: the keys are the bits of numbers and
/// text, a lookup is made for every row of a column of millions, and nothing leaves a map in the order it
/// keeps (see [`Counts::into_distinct`], which sorts), so the hash only has to be fast and spread well.
#[derive(Default)]
struct FastHasher(u64);

impl Hasher for FastHasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.write_u64(u64::from(byte));
        }
    }

    /// One round of the finaliser of splitmix64, which gives every bit of a number's bits a say.
    fn write_u64(&mut self, n: u64) {
        let mut z = (self.0 ^ n).wrapping_add(0x9E37_79B9_7F4A_7C15);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        self.0 = z ^ (z >> 31);
    }
}

type Counted<K> = HashMap<K, u64, BuildHasherDefault<FastHasher>>;

/// The counts of the distinct values of one kind, until there are too many.
#[derive(Default)]
struct Counts {
    /// By the bits of the number, which are those of the value once -0 is 0 (a NaN never gets here).
    numbers: Counted<u64>,
    texts: Counted<String>,
    bools: [u64; 2],
    too_many: bool,
}

impl Counts {
    fn distinct(&self) -> usize {
        self.numbers.len() + self.texts.len() + self.bools.iter().filter(|&&n| n > 0).count()
    }

    fn room(&mut self, limit: usize) -> bool {
        if self.distinct() >= limit {
            self.too_many = true;
        }
        !self.too_many
    }

    fn number(&mut self, value: f64, limit: usize) {
        let bits = if value == 0.0 { 0 } else { value.to_bits() };
        if let Some(n) = self.numbers.get_mut(&bits) {
            *n += 1;
        } else if self.room(limit) {
            self.numbers.insert(bits, 1);
        }
    }

    fn text(&mut self, value: &str, limit: usize) {
        if let Some(n) = self.texts.get_mut(value) {
            *n += 1;
        } else if self.room(limit) {
            self.texts.insert(value.to_owned(), 1);
        }
    }

    fn bool(&mut self, value: bool) {
        self.bools[usize::from(value)] += 1;
    }

    /// The distinct values in ascending order: the maps do not keep one, so the values are sorted here,
    /// and every value is different, so the order is total and does not depend on how the map was filled.
    fn into_distinct(self) -> Distinct {
        if self.too_many {
            return Distinct::TooMany;
        }
        let mut values: Vec<(Category, u64)> = Vec::with_capacity(self.distinct());
        values.extend(
            self.bools
                .iter()
                .enumerate()
                .filter(|(_, n)| **n > 0)
                .map(|(b, n)| (Category::Bool(b == 1), *n)),
        );
        let mut numbers: Vec<(f64, u64)> = self
            .numbers
            .into_iter()
            .map(|(bits, n)| (f64::from_bits(bits), n))
            .collect();
        numbers.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
        values.extend(numbers.into_iter().map(|(v, n)| (Category::Number(v), n)));
        let mut texts: Vec<(String, u64)> = self.texts.into_iter().collect();
        texts.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        values.extend(texts.into_iter().map(|(v, n)| (Category::Text(v), n)));
        Distinct::Values(values)
    }
}

/// The statistics of `column`, counting at most [`DISTINCT_LIMIT`] distinct values.
#[must_use]
pub fn column_stats(column: &Column) -> ColumnStats {
    column_stats_with_limit(column, DISTINCT_LIMIT)
}

/// The statistics of the first `rows` rows of `column` (all of them if it has fewer), counting at most
/// [`DISTINCT_LIMIT`] distinct values: for a grid of several layers, of which the first is what is drawn.
#[must_use]
pub fn column_stats_rows(column: &Column, rows: usize) -> ColumnStats {
    stats_of(column, rows, DISTINCT_LIMIT)
}

/// The statistics of `column`, counting at most `limit` distinct values.
#[must_use]
pub fn column_stats_with_limit(column: &Column, limit: usize) -> ColumnStats {
    stats_of(column, column.len(), limit)
}

fn stats_of(column: &Column, rows: usize, limit: usize) -> ColumnStats {
    let rows = rows.min(column.len());
    let mut counts = Counts::default();
    let (mut nulls, mut non_finite) = (0_u64, 0_u64);
    let mut range: Option<(f64, f64)> = None;
    let mut widen = |v: f64| {
        range = Some(range.map_or((v, v), |(lo, hi)| (lo.min(v), hi.max(v))));
    };
    for row in 0..rows {
        match column.get(row) {
            None => nulls += 1,
            Some(Value::Float64(v)) if !v.is_finite() => non_finite += 1,
            Some(Value::Float64(v)) => {
                widen(v);
                counts.number(v, limit);
            }
            Some(Value::Int64(v)) => {
                widen(v as f64);
                counts.number(v as f64, limit);
            }
            Some(Value::Bool(v)) => counts.bool(v),
            Some(Value::Utf8(v)) => counts.text(v, limit),
            // A code that is not in the dictionary has no label to count (validation refuses it): a null.
            Some(Value::Category { label: None, .. }) => nulls += 1,
            Some(Value::Category { label: Some(v), .. }) => counts.text(v, limit),
        }
    }
    ColumnStats {
        count: rows as u64,
        nulls,
        non_finite,
        range,
        distinct: counts.into_distinct(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use karmania_core::{ColumnData, Validity};

    fn floats(values: &[f64], valid: &[bool]) -> Column {
        Column::new(
            "v",
            ColumnData::Float64(values.to_vec()),
            Validity::from_flags(valid.iter().copied()),
        )
        .unwrap()
    }

    fn numbers(d: &Distinct) -> Vec<(f64, u64)> {
        match d {
            Distinct::Values(v) => v
                .iter()
                .map(|(c, n)| match c {
                    Category::Number(x) => (*x, *n),
                    other => panic!("{other:?}"),
                })
                .collect(),
            Distinct::TooMany => panic!("too many"),
        }
    }

    #[test]
    fn a_float_column_counts_rows_nulls_non_finite_range_and_distinct_values() {
        let c = floats(
            &[3.0, 1.0, f64::NAN, 3.0, 99.0, f64::INFINITY, -0.0, 0.0, 2.5],
            &[true, true, true, true, false, true, true, true, true],
        );
        let s = column_stats(&c);
        assert_eq!((s.count, s.nulls, s.non_finite), (9, 1, 2));
        assert_eq!(s.range, Some((-0.0, 3.0)));
        // 99 is null (not counted), -0 and 0 are one value, and NaN and infinity are not values.
        assert_eq!(
            numbers(&s.distinct),
            [(0.0, 2), (1.0, 1), (2.5, 1), (3.0, 2)]
        );
    }

    #[test]
    fn the_order_of_the_rows_does_not_change_anything() {
        let a = column_stats(&floats(&[5.0, 1.0, 3.0, 1.0, 5.0, 5.0], &[true; 6]));
        let b = column_stats(&floats(&[1.0, 5.0, 5.0, 3.0, 5.0, 1.0], &[true; 6]));
        assert_eq!(a, b);
        assert_eq!(numbers(&a.distinct), [(1.0, 2), (3.0, 1), (5.0, 3)]);
    }

    #[test]
    fn integers_text_booleans_and_categories() {
        let ints = Column::without_nulls("i", ColumnData::Int64(vec![7, -2, 7, 100]));
        let s = column_stats(&ints);
        assert_eq!(s.range, Some((-2.0, 100.0)));
        assert_eq!(numbers(&s.distinct), [(-2.0, 1), (7.0, 2), (100.0, 1)]);
        let text = Column::without_nulls(
            "t",
            ColumnData::Utf8(["b", "a", "b", "B", ""].map(String::from).to_vec()),
        );
        let s = column_stats(&text);
        assert_eq!(s.range, None);
        let Distinct::Values(v) = s.distinct else {
            panic!()
        };
        let order: Vec<_> = v.iter().map(|(c, n)| (c.clone(), *n)).collect();
        assert_eq!(
            order,
            [("", 1), ("B", 1), ("a", 1), ("b", 2)].map(|(t, n)| (Category::Text(t.into()), n))
        );
        let bools = Column::without_nulls("b", ColumnData::Bool(vec![true, false, true]));
        let Distinct::Values(v) = column_stats(&bools).distinct else {
            panic!()
        };
        assert_eq!(v, [(Category::Bool(false), 1), (Category::Bool(true), 2)]);
        // A categorical column counts its labels; a code outside the dictionary is a null.
        let cats = Column::without_nulls(
            "c",
            ColumnData::Categorical {
                codes: vec![1, 0, 1, 9],
                dictionary: vec!["rock".into(), "ore".into()],
            },
        );
        let s = column_stats(&cats);
        assert_eq!(s.nulls, 1);
        let Distinct::Values(v) = s.distinct else {
            panic!()
        };
        assert_eq!(
            v,
            [
                (Category::Text("ore".into()), 2),
                (Category::Text("rock".into()), 1)
            ]
        );
    }

    #[test]
    fn more_distinct_values_than_the_limit_are_too_many_but_the_rest_is_exact() {
        let c = Column::without_nulls("v", ColumnData::Float64((0..50).map(f64::from).collect()));
        let s = column_stats_with_limit(&c, 10);
        assert_eq!(s.distinct, Distinct::TooMany);
        assert_eq!((s.count, s.range), (50, Some((0.0, 49.0))));
        assert!(matches!(
            column_stats_with_limit(&c, 50).distinct,
            Distinct::Values(_)
        ));
        // Repeats of a value already counted do not count against the limit.
        let few = Column::without_nulls(
            "v",
            ColumnData::Float64([1.0, 2.0, 1.0, 2.0, 1.0].repeat(100)),
        );
        assert_eq!(
            numbers(&column_stats_with_limit(&few, 2).distinct),
            [(1.0, 300), (2.0, 200)]
        );
    }

    #[test]
    fn an_empty_column_and_a_column_of_nothing_but_nulls() {
        let empty = column_stats(&floats(&[], &[]));
        assert_eq!((empty.count, empty.nulls, empty.range), (0, 0, None));
        assert_eq!(empty.distinct, Distinct::Values(vec![]));
        let nulls = column_stats(&floats(&[1.0, 2.0], &[false, false]));
        assert_eq!((nulls.count, nulls.nulls, nulls.range), (2, 2, None));
    }
}
