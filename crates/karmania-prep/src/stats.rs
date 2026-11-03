//! Statistics of a column: how many values, how many are missing, the range, and the distinct values.
//!
//! Everything here is exact and in a fixed order, so that the same column always gives the same
//! numbers and the same classes: distinct values are kept in an ordered map and listed by value, never in
//! the order a hash map happens to give.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use karmania_core::{Column, Value};

/// The most distinct values counted. A column with more has too many to be classified as categories, and
/// is said to have [`Distinct::TooMany`]; counting a million identifiers one by one would only be thrown away.
pub const DISTINCT_LIMIT: usize = 10_000;

/// One value of a column, owned, as a category: a number (integers as the number they are, `f64`), text
/// or a truth value. A category of a categorical column is its label.
#[derive(Debug, Clone, PartialEq)]
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

/// A number ordered by [`f64::total_cmp`], with -0 taken as 0, so that it can be a key.
#[derive(Debug, Clone, Copy)]
struct Number(f64);

impl PartialEq for Number {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Number {}
impl PartialOrd for Number {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Number {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.total_cmp(&other.0)
    }
}

/// The counts of the distinct values of one kind, until there are too many.
#[derive(Default)]
struct Counts {
    numbers: BTreeMap<Number, u64>,
    texts: BTreeMap<String, u64>,
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
        let value = if value == 0.0 { 0.0 } else { value };
        if let Some(n) = self.numbers.get_mut(&Number(value)) {
            *n += 1;
        } else if self.room(limit) {
            self.numbers.insert(Number(value), 1);
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
        values.extend(
            self.numbers
                .into_iter()
                .map(|(v, n)| (Category::Number(v.0), n)),
        );
        values.extend(self.texts.into_iter().map(|(v, n)| (Category::Text(v), n)));
        Distinct::Values(values)
    }
}

/// The statistics of `column`, counting at most [`DISTINCT_LIMIT`] distinct values.
#[must_use]
pub fn column_stats(column: &Column) -> ColumnStats {
    column_stats_with_limit(column, DISTINCT_LIMIT)
}

/// The statistics of `column`, counting at most `limit` distinct values.
#[must_use]
pub fn column_stats_with_limit(column: &Column, limit: usize) -> ColumnStats {
    let mut counts = Counts::default();
    let (mut nulls, mut non_finite) = (0_u64, 0_u64);
    let mut range: Option<(f64, f64)> = None;
    let mut widen = |v: f64| {
        range = Some(range.map_or((v, v), |(lo, hi)| (lo.min(v), hi.max(v))));
    };
    for row in 0..column.len() {
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
        count: column.len() as u64,
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
