//! Class breaks: dividing the values of a column into classes for colouring.
//!
//! The breaks are numbers that were given (the smallest and largest value, and for quantiles values of
//! the column) or the equal steps between them; nothing is interpolated between values. The class of a
//! value is decided in one place, [`class_of`], and the counts below and the class index of step 13.17
//! both use it, so the legend's numbers are those of the picture.

use karmania_core::{Column, ColumnType, Dataset, Finding, FindingCode, Geometry, Value};
use serde::{Deserialize, Serialize};

use crate::jenks;
use crate::stats::{Category, DISTINCT_LIMIT, Distinct, column_stats_rows};

/// The most classes: the class index is one byte, and 255 means no value.
pub const MAX_CLASSES: usize = 254;

/// The most values shown as categories before the rest are "Other".
pub const MAX_CATEGORIES: usize = 20;

/// How a column is divided into classes. In JSON: `equal`, `quantile`, `jenks` or `categories`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Method {
    /// Equal intervals from the smallest to the largest finite value.
    Equal,
    /// Quantiles, exact, from the sorted values: about as many values in each class.
    Quantile,
    /// Natural breaks (Jenks), found from an evenly strided sample of at most 10,000 values.
    Jenks,
    /// Categories: the values that most rows have (up to 20), and the rest as "Other".
    Categories,
}

/// Classes of a column, and how many rows are in each.
///
/// JSON: `{"kind":"ranges","column":..,"bounds":[..],"counts":[..],"nulls":..,"sampled":..}` or
/// `{"kind":"categories","column":..,"values":[..],"counts":[..],"other":..,"nulls":..}`; `sampled` and
/// `other` are left out when there are none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ClassBreaks {
    /// Ranges of numbers.
    Ranges {
        /// The column the classes are of.
        column: String,
        /// `classes + 1` numbers, ascending: class `c` is from `bounds[c]` up to, but not including,
        /// `bounds[c + 1]`, and the last class includes its upper bound. There can be fewer classes than were
        /// asked for, when the values do not make that many different ranges (a column of one value has one).
        /// The last two bounds are equal when the largest value is a class of its own (a value that stands
        /// alone, or that many rows share): that class is `[max, max]`.
        bounds: Vec<f64>,
        /// How many rows are in each class.
        counts: Vec<u64>,
        /// How many rows have no value to put in a class: null, or not a finite number.
        nulls: u64,
        /// For natural breaks of a column with more than 10,000 values: how many values the breaks were found
        /// from (an evenly strided sample of the rows, so the same every time), which the legend says. `None`
        /// when every value was used. The counts are always of every row.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sampled: Option<u64>,
    },
    /// The values that most rows have, one class each, and the rest together.
    Categories {
        /// The column the classes are of.
        column: String,
        /// The values, the most common first; rows that have the same number of each are in ascending order
        /// of value (numbers by value, text by its bytes, false before true). A categorical column gives its labels.
        values: Vec<Category>,
        /// How many rows have each of `values`.
        counts: Vec<u64>,
        /// How many rows have a value that is not in `values`: the class "Other"; `None` when there is none.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        other: Option<u64>,
        /// How many rows have no value: null, or not a finite number.
        nulls: u64,
    },
}

/// The class of a number, given the `bounds` of ranges (see [`ClassBreaks::Ranges`]): the last class
/// that starts at or below it. A number below the first bound is in the first class and one above the last
/// bound in the last, so that a number is always in a class; `None` for a number that is not finite, and
/// when there are no classes (fewer than two bounds).
#[must_use]
pub fn class_of(bounds: &[f64], value: f64) -> Option<usize> {
    let classes = bounds.len().checked_sub(1).filter(|&n| n > 0)?;
    if !value.is_finite() {
        return None;
    }
    let starting_at_or_below = bounds.partition_point(|&bound| bound <= value);
    Some(starting_at_or_below.saturating_sub(1).min(classes - 1))
}

/// The finite numbers of `column`, in row order, and how many rows have none.
fn numbers(column: &Column, rows: usize) -> (Vec<f64>, u64) {
    let rows = rows.min(column.len());
    let mut values = Vec::with_capacity(rows);
    let mut without = 0;
    for row in 0..rows {
        match column.get(row) {
            Some(Value::Float64(v)) if v.is_finite() => values.push(v),
            Some(Value::Int64(v)) => values.push(v as f64),
            _ => without += 1,
        }
    }
    (values, without)
}

/// Divides the numbers of `column` into `classes` ranges by `method`, and counts the rows of each.
///
/// `classes` is taken from 1 to [`MAX_CLASSES`]. Where the values do not make that many different
/// ranges the result has fewer (a column of one value has one class, bounds `[v, v]`).
///
/// # Errors
///
/// A finding: `classes.column.not_numeric` for a column of text, truth values or categories, and
/// `classes.column.no_values` for a column with no finite number.
pub fn classify(column: &Column, method: Method, classes: usize) -> Result<ClassBreaks, Finding> {
    classify_rows(column, method, classes, column.len())
}

/// As [`classify`], over the first `rows` rows of the column: for a grid of several layers, of which the first
/// is what is drawn, so that the counts of the legend are those of the picture.
///
/// # Errors
///
/// The findings of [`classify`].
pub fn classify_rows(
    column: &Column,
    method: Method,
    classes: usize,
    rows: usize,
) -> Result<ClassBreaks, Finding> {
    if method == Method::Categories {
        return categories(column, classes, rows);
    }
    let classes = classes.clamp(1, MAX_CLASSES);
    if !matches!(
        column.column_type(),
        ColumnType::Float64 | ColumnType::Int64
    ) {
        return Err(not_numeric(column));
    }
    let (mut values, nulls) = numbers(column, rows);
    if values.is_empty() {
        return Err(no_values(column));
    }
    let mut sampled = None;
    let bounds = match method {
        Method::Equal => equal_bounds(&values, classes),
        Method::Quantile => {
            values.sort_unstable_by(f64::total_cmp);
            quantile_bounds(&values, classes)
        }
        // Handled above, before the numbers of the column are taken; here so that the match is whole.
        Method::Categories => return categories(column, classes, rows),
        Method::Jenks => {
            let (min, max) = extent(&values);
            let mut used = jenks::sample(&values);
            sampled = (used.len() < values.len()).then_some(used.len() as u64);
            used.sort_unstable_by(f64::total_cmp);
            let mut bounds = vec![min];
            bounds.extend(jenks::natural_breaks(&used, classes));
            bounds.push(max);
            without_empty_classes(bounds, classes)
        }
    };
    let mut counts = vec![0; bounds.len() - 1];
    for &value in &values {
        if let Some(count) = class_of(&bounds, value).and_then(|c| counts.get_mut(c)) {
            *count += 1;
        }
    }
    Ok(ClassBreaks::Ranges {
        column: column.name().to_owned(),
        bounds,
        counts,
        nulls,
        sampled,
    })
}

/// The most common values of `column` as classes, up to `classes` (from 1 to [`MAX_CATEGORIES`]), and the
/// rest as "Other".
fn categories(column: &Column, classes: usize, rows: usize) -> Result<ClassBreaks, Finding> {
    let stats = column_stats_rows(column, rows);
    let Distinct::Values(mut values) = stats.distinct else {
        return Err(too_many_values(column));
    };
    if values.is_empty() {
        return Err(no_values(column));
    }
    // The values come in ascending order, and a stable sort keeps that order among those with the same count.
    values.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    let shown = classes.clamp(1, MAX_CATEGORIES).min(values.len());
    let others: u64 = values.iter().skip(shown).map(|(_, n)| n).sum();
    values.truncate(shown);
    let (values, counts) = values.into_iter().unzip();
    Ok(ClassBreaks::Categories {
        column: column.name().to_owned(),
        values,
        counts,
        other: (others > 0).then_some(others),
        nulls: stats.nulls + stats.non_finite,
    })
}

/// Removes a bound equal to the one before it, which would be a class with no range; at least two bounds
/// stay (the smallest and the largest, equal for a column of one value).
///
/// The largest value gets a class of its own, `[max, max]`, which [`class_of`] puts exactly the values equal
/// to the largest in, in two cases: when a bound before the last is the largest value already (a value that
/// stands alone at the top, or that many rows share, however many bounds it takes), and when the bounds are
/// reduced to the smallest and the largest and more than one class was asked for: two different values are
/// not a constant column, and a column that is mostly one value has most of its quantile bounds equal and
/// would otherwise be one class. A class at the bottom cannot be kept the same way: `[min, min)` holds nothing.
fn without_empty_classes(mut bounds: Vec<f64>, classes: usize) -> Vec<f64> {
    let (Some(&min), Some(&max)) = (bounds.first(), bounds.last()) else {
        return bounds;
    };
    let top_alone = min < max && bounds.len() >= 3 && bounds[bounds.len() - 2] == max;
    bounds.dedup();
    // A column of one value (one bound left) is one class, `[v, v]`.
    let reduced = bounds.len() == 2 && min < max && classes >= 2;
    if top_alone || reduced || bounds.len() == 1 {
        bounds.push(max);
    }
    bounds
}

/// The smallest and the largest of `values` (not empty).
fn extent(values: &[f64]) -> (f64, f64) {
    values
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &v| {
            (lo.min(v), hi.max(v))
        })
}

/// Equal steps from the smallest to the largest of `values` (not empty, finite): the bound `k` is `min + (range / n) *
/// k`, which is exact where the width divides evenly (integers from -200 to -188 in 6 classes give -198, which
/// the blend `min * (1 - t) + max * t` does not: -198.00000000000003, found by the third review of the milestone). When the
/// range itself is wider than a float, `max - min` is infinite and the bound is the blend, which cannot overflow. Each
/// is held between the one before it and the largest value, because rounding can put a bound a few units in the last place
/// above the next, or above the largest, when the range is a few of them wide (the bounds went down, and the engine refused
/// them: found by the second review). The first bound is the smallest value itself and the last the largest.
fn equal_bounds(values: &[f64], classes: usize) -> Vec<f64> {
    let (min, max) = extent(values);
    let n = classes as f64;
    let range = max - min;
    let mut bounds = Vec::with_capacity(classes + 1);
    bounds.push(min);
    for k in 1..classes {
        let bound = if range.is_finite() {
            min + (range / n) * k as f64
        } else {
            let t = k as f64 / n;
            min * (1.0 - t) + max * t
        };
        let before = bounds.last().copied().unwrap_or(min);
        bounds.push(bound.clamp(before, max));
    }
    bounds.push(max);
    without_empty_classes(bounds, classes)
}

/// Quantiles of `sorted` (not empty): the bound `k` is the value `floor(k * n / classes)` places from the
/// start, so a value that is a bound starts the class above it, and about `n / classes` values are in
/// each. The first bound is the smallest value and the last the largest. A value that many rows share
/// makes bounds that are equal, which are one bound (fewer classes).
fn quantile_bounds(sorted: &[f64], classes: usize) -> Vec<f64> {
    let n = sorted.len() as u128;
    let at = |rank: u128| {
        usize::try_from(rank)
            .ok()
            .and_then(|i| sorted.get(i))
            .copied()
    };
    let mut bounds: Vec<f64> = (0..classes as u128)
        .filter_map(|k| at(k * n / classes as u128))
        .collect();
    bounds.extend(sorted.last());
    without_empty_classes(bounds, classes)
}

/// Divides the column of `dataset` called `column` into `classes` classes by `method`: see [`classify`].
///
/// # Errors
///
/// The findings of [`classify`], and `classes.column.missing` if the dataset has no such column.
pub fn classify_dataset(
    dataset: &Dataset,
    column: &str,
    method: Method,
    classes: usize,
) -> Result<ClassBreaks, Finding> {
    let found = dataset
        .attributes
        .column(column)
        .ok_or_else(|| column_missing(column))?;
    classify_rows(found, method, classes, drawn_rows(dataset))
}

/// How many rows of the attributes of `dataset` are drawn: all of them, except for a grid of several layers, of
/// which only the first is (`display.grid.layers_hidden`), the `nx * ny` cells of its first layer.
#[must_use]
pub fn drawn_rows(dataset: &Dataset) -> usize {
    match &dataset.geometry {
        Geometry::Grid(grid) => {
            let [nx, ny, _] = grid.lattice.dims;
            usize::try_from(u64::from(nx) * u64::from(ny)).unwrap_or(usize::MAX)
        }
        _ => usize::MAX,
    }
}

/// The finding for a column that a dataset does not have.
pub(crate) fn column_missing(name: &str) -> Finding {
    Finding::new(
        FindingCode::ClassesColumnMissing,
        format!("The dataset has no column named {name}, so nothing can be coloured by it."),
    )
    .with_hint("Colour by a column the dataset has, or draw the layer in a single colour.")
}

fn not_numeric(column: &Column) -> Finding {
    let kind = match column.column_type() {
        ColumnType::Utf8 => "text",
        ColumnType::Bool => "true or false",
        _ => "categories",
    };
    Finding::new(
        FindingCode::ClassesColumnNotNumeric,
        format!(
            "The column {} is {kind}, not numbers, so it cannot be divided into ranges.",
            column.name()
        ),
    )
    .with_hint("Colour by categories instead, or by a column of numbers.")
}

fn too_many_values(column: &Column) -> Finding {
    Finding::new(
        FindingCode::ClassesColumnTooManyValues,
        format!(
            "The column {} has more than {} different values, so they cannot be shown as categories.",
            column.name(),
            karmania_core::text::format_count(DISTINCT_LIMIT as u64)
        ),
    )
    .with_hint("Divide the column into ranges instead.")
}

fn no_values(column: &Column) -> Finding {
    Finding::new(
        FindingCode::ClassesColumnNoValues,
        format!(
            "The column {} has no value that can be put in a class: every entry is empty or not a finite number.",
            column.name()
        ),
    )
    .with_hint("Colour by another column, or draw the layer in a single colour.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use karmania_core::{ColumnData, DatasetId, Table, Validity};

    fn floats(values: &[f64]) -> Column {
        Column::without_nulls("v", ColumnData::Float64(values.to_vec()))
    }

    fn ranges(c: &Column, method: Method, classes: usize) -> (Vec<f64>, Vec<u64>, u64) {
        match classify(c, method, classes).unwrap() {
            ClassBreaks::Ranges {
                bounds,
                counts,
                nulls,
                ..
            } => (bounds, counts, nulls),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn equal_intervals_run_from_the_smallest_to_the_largest_value() {
        let (bounds, counts, nulls) =
            ranges(&floats(&[0.0, 2.5, 5.0, 7.5, 10.0]), Method::Equal, 5);
        assert_eq!(bounds, [0.0, 2.0, 4.0, 6.0, 8.0, 10.0]);
        // The largest value is in the last class, and a value on a bound starts the class above it.
        assert_eq!((counts, nulls), (vec![1, 1, 1, 1, 1], 0));
        let (bounds, counts, _) = ranges(&floats(&[-10.0, 0.0, 4.0, 10.0]), Method::Equal, 2);
        assert_eq!((bounds, counts), (vec![-10.0, 0.0, 10.0], vec![1, 3]));
    }

    #[test]
    fn a_column_of_one_value_is_one_class_and_so_is_equal_to_its_own_bound() {
        for method in [Method::Equal, Method::Quantile] {
            let (bounds, counts, _) = ranges(&floats(&[7.0, 7.0, 7.0]), method, 5);
            assert_eq!((bounds, counts), (vec![7.0, 7.0], vec![3]), "{method:?}");
        }
    }

    #[test]
    fn rows_with_no_number_are_counted_as_nulls() {
        let c = Column::new(
            "v",
            ColumnData::Float64(vec![1.0, f64::NAN, 3.0, 99.0, f64::INFINITY]),
            Validity::from_flags([true, true, true, false, true]),
        )
        .unwrap();
        let (bounds, counts, nulls) = ranges(&c, Method::Equal, 2);
        assert_eq!(
            (bounds, counts, nulls),
            (vec![1.0, 2.0, 3.0], vec![1, 1], 3)
        );
        let ints = Column::without_nulls("i", ColumnData::Int64(vec![1, 2, 3, 4]));
        assert_eq!(ranges(&ints, Method::Equal, 2).1, [2, 2]);
    }

    #[test]
    fn quantiles_are_values_of_the_column_with_about_as_many_rows_in_each_class() {
        let (bounds, counts, _) = ranges(&floats(&[4.0, 1.0, 3.0, 2.0]), Method::Quantile, 2);
        assert_eq!((bounds, counts), (vec![1.0, 3.0, 4.0], vec![2, 2]));
        let ten: Vec<f64> = (1..=10).map(f64::from).rev().collect();
        let (bounds, counts, _) = ranges(&floats(&ten), Method::Quantile, 4);
        assert_eq!(bounds, [1.0, 3.0, 6.0, 8.0, 10.0]);
        assert_eq!(counts, [2, 3, 2, 3]);
        assert!(
            bounds.iter().all(|b| ten.contains(b)),
            "every bound is a value that was given"
        );
    }

    #[test]
    fn values_that_many_rows_share_make_fewer_classes_not_empty_ones() {
        let (bounds, counts, _) = ranges(&floats(&[1.0, 1.0, 1.0, 1.0, 5.0]), Method::Quantile, 3);
        // Two different values are two classes, the larger in a class of its own (step 13.F1; the first version
        // of this test pinned one class of five, which the review of the milestone found wrong).
        assert_eq!((bounds, counts), (vec![1.0, 5.0, 5.0], vec![4, 1]));
        let (bounds, counts, _) = ranges(
            &floats(&[1.0, 1.0, 1.0, 1.0, 2.0, 3.0, 4.0, 5.0]),
            Method::Quantile,
            4,
        );
        assert!(counts.iter().all(|&n| n > 0), "{bounds:?} {counts:?}");
        assert_eq!(counts.iter().sum::<u64>(), 8);
    }

    #[test]
    fn the_class_of_a_number_is_the_last_that_starts_at_or_below_it() {
        let bounds = [0.0, 10.0, 20.0, 30.0];
        for (value, class) in [
            (0.0, 0),
            (9.99, 0),
            (10.0, 1),
            (29.0, 2),
            (30.0, 2),
            (-5.0, 0),
            (1e9, 2),
        ] {
            assert_eq!(class_of(&bounds, value), Some(class), "{value}");
        }
        assert_eq!(class_of(&bounds, f64::NAN), None);
        assert_eq!(class_of(&bounds, f64::INFINITY), None);
        assert_eq!(class_of(&[5.0], 5.0), None);
        assert_eq!(class_of(&[], 5.0), None);
        assert_eq!(class_of(&[7.0, 7.0], 7.0), Some(0));
    }

    #[test]
    fn a_range_wider_than_a_float_and_a_number_of_classes_out_of_range() {
        let (bounds, counts, _) = ranges(&floats(&[-1.0e308, 0.0, 1.0e308]), Method::Equal, 2);
        assert!(bounds.iter().all(|b| b.is_finite()), "{bounds:?}");
        assert_eq!(counts.iter().sum::<u64>(), 3);
        assert_eq!(
            ranges(&floats(&[1.0, 2.0, 3.0]), Method::Equal, 0).1.len(),
            1,
            "0 is taken as 1"
        );
        let many: Vec<f64> = (0..1000).map(f64::from).collect();
        assert_eq!(
            ranges(&floats(&many), Method::Equal, 10_000).1.len(),
            MAX_CLASSES
        );
    }

    #[test]
    fn a_column_that_cannot_be_divided_gives_a_finding() {
        let text = Column::without_nulls("rock", ColumnData::Utf8(vec!["a".into()]));
        let error = classify(&text, Method::Equal, 5).unwrap_err();
        assert_eq!(error.code.as_str(), "classes.column.not_numeric");
        assert_eq!(
            error.message,
            "The column rock is text, not numbers, so it cannot be divided into ranges."
        );
        let nothing = Column::without_nulls("grade", ColumnData::Float64(vec![f64::NAN]));
        let error = classify(&nothing, Method::Quantile, 5).unwrap_err();
        assert_eq!(error.code.as_str(), "classes.column.no_values");
    }

    #[test]
    fn the_largest_value_can_be_a_class_of_its_own() {
        // Rows that share the largest value, and a value that stands alone at the top.
        let shared = floats(&[1.0, 2.0, 3.0, 10.0, 10.0, 10.0, 10.0, 10.0]);
        let (bounds, counts, _) = ranges(&shared, Method::Quantile, 3);
        assert_eq!(
            (bounds, counts),
            (vec![1.0, 3.0, 10.0, 10.0], vec![2, 1, 5])
        );
        let mut with_outlier: Vec<f64> = (1..=10).map(f64::from).collect();
        with_outlier.push(1000.0);
        let (bounds, counts, _) = ranges(&floats(&with_outlier), Method::Jenks, 2);
        assert_eq!((bounds, counts), (vec![1.0, 1000.0, 1000.0], vec![10, 1]));
        // Nothing of the kind at the bottom (that class could hold nothing), but the largest value is split off.
        let (bounds, counts, _) = ranges(&floats(&[1.0, 1.0, 1.0, 1.0, 5.0]), Method::Quantile, 3);
        // Two different values are two classes, the larger in a class of its own (step 13.F1; the first version
        // of this test pinned one class of five, which the review of the milestone found wrong).
        assert_eq!((bounds, counts), (vec![1.0, 5.0, 5.0], vec![4, 1]));
    }

    #[test]
    fn natural_breaks_split_the_groups_and_say_when_they_were_found_from_a_sample() {
        let c = floats(&[1.0, 2.0, 3.0, 10.0, 11.0, 12.0, 100.0, 101.0, 102.0]);
        let ClassBreaks::Ranges {
            bounds,
            counts,
            sampled,
            ..
        } = classify(&c, Method::Jenks, 3).unwrap()
        else {
            panic!("ranges")
        };
        assert_eq!(
            (bounds, counts, sampled),
            (vec![1.0, 10.0, 100.0, 102.0], vec![3, 3, 3], None)
        );
        // 30,000 values in three tight groups, one after the other (not turn and turn about: a stride of
        // 3 would then see one group only): the breaks are those of a sample, the counts are of every row.
        let long: Vec<f64> = (0..30_000)
            .map(|i| [0.0, 50.0, 90.0][i / 10_000] + (i % 100) as f64 / 100.0)
            .collect();
        let ClassBreaks::Ranges {
            bounds,
            counts,
            sampled,
            ..
        } = classify(&floats(&long), Method::Jenks, 3).unwrap()
        else {
            panic!("ranges")
        };
        assert_eq!(sampled, Some(10_000));
        assert_eq!(counts, [10_000, 10_000, 10_000]);
        assert!(
            (50.0..51.0).contains(&bounds[1]) && (90.0..91.0).contains(&bounds[2]),
            "{bounds:?}"
        );
        assert!(
            bounds[0] < 1.0 && bounds[3] > 90.0,
            "the first and last bounds are of every value: {bounds:?}"
        );
    }

    fn categories(c: &Column, classes: usize) -> (Vec<Category>, Vec<u64>, Option<u64>, u64) {
        match classify(c, Method::Categories, classes).unwrap() {
            ClassBreaks::Categories {
                values,
                counts,
                other,
                nulls,
                ..
            } => (values, counts, other, nulls),
            other => panic!("{other:?}"),
        }
    }

    fn text(items: &[&str]) -> Column {
        Column::without_nulls(
            "rock",
            ColumnData::Utf8(items.iter().map(|s| (*s).to_string()).collect()),
        )
    }

    fn named(items: &[&str]) -> Vec<Category> {
        items
            .iter()
            .map(|s| Category::Text((*s).to_string()))
            .collect()
    }

    #[test]
    fn the_most_common_values_come_first_with_ties_in_order_of_value_and_the_rest_are_other() {
        // granite 4, basalt 2, shale 2, chert 1, coal 1: two shown, three rows more than that are other.
        let c = text(&[
            "shale", "granite", "chert", "granite", "basalt", "granite", "shale", "granite",
            "basalt", "coal",
        ]);
        let (values, counts, other, nulls) = categories(&c, 2);
        assert_eq!(
            (values, counts, other, nulls),
            (named(&["granite", "basalt"]), vec![4, 2], Some(4), 0)
        );
        let (values, counts, other, _) = categories(&c, 3);
        assert_eq!(
            (values, counts, other),
            (
                named(&["granite", "basalt", "shale"]),
                vec![4, 2, 2],
                Some(2)
            )
        );
        // Every value shown: no "Other" class.
        let (values, counts, other, _) = categories(&c, 20);
        assert_eq!(values.len(), 5);
        assert_eq!((counts.iter().sum::<u64>(), other), (10, None));
        assert_eq!(
            values[3..],
            named(&["chert", "coal"]),
            "equal counts in order of value"
        );
    }

    #[test]
    fn numbers_truth_values_and_labels_are_categories_too_and_empty_rows_are_nulls() {
        let ints = Column::new(
            "code",
            ColumnData::Int64(vec![3, 1, 3, 2, 3, 1, 9]),
            Validity::from_flags([true, true, true, true, true, true, false]),
        )
        .unwrap();
        let (values, counts, other, nulls) = categories(&ints, 2);
        assert_eq!(
            (values, counts, other, nulls),
            (
                vec![Category::Number(3.0), Category::Number(1.0)],
                vec![3, 2],
                Some(1),
                1
            )
        );
        let floats_with_nan = floats(&[0.5, f64::NAN, 0.5, f64::INFINITY]);
        let (_, counts, _, nulls) = categories(&floats_with_nan, 5);
        assert_eq!((counts, nulls), (vec![2], 2));
        let bools = Column::without_nulls("flag", ColumnData::Bool(vec![true, false, true]));
        assert_eq!(
            categories(&bools, 5).0,
            vec![Category::Bool(true), Category::Bool(false)]
        );
        let labels = Column::without_nulls(
            "kind",
            ColumnData::Categorical {
                codes: vec![1, 0, 1],
                dictionary: vec!["ore".into(), "rock".into()],
            },
        );
        assert_eq!(categories(&labels, 5).0, named(&["rock", "ore"]));
    }

    #[test]
    fn at_most_twenty_are_shown_and_a_column_with_too_many_or_no_values_gives_a_finding() {
        let many: Vec<String> = (0..30).map(|i| format!("v{i:02}")).collect();
        let c = Column::without_nulls("v", ColumnData::Utf8(many));
        let (values, _, other, _) = categories(&c, 254);
        assert_eq!((values.len(), other), (MAX_CATEGORIES, Some(10)));
        assert_eq!(categories(&c, 0).0.len(), 1, "0 is taken as 1");
        let ids = Column::without_nulls("sample_id", ColumnData::Int64((0..10_001).collect()));
        let error = classify(&ids, Method::Categories, 5).unwrap_err();
        assert_eq!(error.code.as_str(), "classes.column.too_many_values");
        assert_eq!(
            error.message,
            "The column sample_id has more than 10,000 different values, so they cannot be shown as categories."
        );
        let nothing = Column::new(
            "v",
            ColumnData::Utf8(vec!["a".into()]),
            Validity::from_flags([false]),
        )
        .unwrap();
        assert_eq!(
            classify(&nothing, Method::Categories, 5)
                .unwrap_err()
                .code
                .as_str(),
            "classes.column.no_values"
        );
    }

    #[test]
    fn the_json_forms_are_those_of_the_contract_and_read_back() {
        let ranges = classify(&floats(&[0.0, 5.0, 10.0]), Method::Equal, 2).unwrap();
        let json = serde_json::to_value(&ranges).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"kind":"ranges","column":"v","bounds":[0.0,5.0,10.0],"counts":[1,2],"nulls":0})
        );
        assert_eq!(serde_json::from_value::<ClassBreaks>(json).unwrap(), ranges);
        let cats = Column::without_nulls("c", ColumnData::Int64(vec![3, 3, 1, 2]));
        let breaks = classify(&cats, Method::Categories, 2).unwrap();
        let json = serde_json::to_value(&breaks).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"kind":"categories","column":"c","values":[3.0,1.0],"counts":[2,1],"other":1,"nulls":0})
        );
        assert_eq!(serde_json::from_value::<ClassBreaks>(json).unwrap(), breaks);
        // Text and truth values are the string and the boolean themselves; `other` is left out when there is none.
        let mixed = ClassBreaks::Categories {
            column: "k".into(),
            values: vec![
                Category::Text("ore".into()),
                Category::Bool(true),
                Category::Number(2.5),
            ],
            counts: vec![3, 2, 1],
            other: None,
            nulls: 0,
        };
        let json = serde_json::to_value(&mixed).unwrap();
        assert_eq!(json["values"], serde_json::json!(["ore", true, 2.5]));
        assert!(json.get("other").is_none());
        assert_eq!(serde_json::from_value::<ClassBreaks>(json).unwrap(), mixed);
        for (name, method) in [
            ("equal", Method::Equal),
            ("quantile", Method::Quantile),
            ("jenks", Method::Jenks),
            ("categories", Method::Categories),
        ] {
            assert_eq!(
                serde_json::from_str::<Method>(&format!("\"{name}\"")).unwrap(),
                method
            );
        }
    }

    #[test]
    fn a_column_of_a_dataset_is_classified_by_name_and_a_missing_one_is_a_finding() {
        let table = Table::from_columns(
            vec![floats(&[1.0, 2.0, 3.0])],
            &mut karmania_core::Findings::new(),
        )
        .unwrap();
        let dataset = Dataset::new(
            DatasetId(1),
            "d",
            None,
            karmania_core::Geometry::Points(karmania_core::Positions::default()),
            table,
        );
        let breaks = classify_dataset(&dataset, "v", Method::Equal, 3).unwrap();
        assert!(matches!(&breaks, ClassBreaks::Ranges { column, .. } if column == "v"));
        let error = classify_dataset(&dataset, "grade", Method::Equal, 3).unwrap_err();
        assert_eq!(error.code.as_str(), "classes.column.missing");
        assert_eq!(
            error.message,
            "The dataset has no column named grade, so nothing can be coloured by it."
        );
    }

    /// A column of `zeros` zeros and `ones` ones.
    fn two_values(zeros: usize, ones: usize) -> Column {
        let mut v = vec![0.0; zeros];
        v.extend(std::iter::repeat_n(1.0, ones));
        floats(&v)
    }

    #[test]
    fn a_column_of_two_values_is_never_one_class_when_more_were_asked_for() {
        // Found by the review of the milestone: with most rows at one value, three or more quantile bounds
        // were equal and the dedup took every class but one. Two different values are not a constant.
        for (zeros, ones) in [
            (500, 500),
            (900, 100),
            (100, 900),
            (10, 5),
            (1, 999),
            (999, 1),
        ] {
            for classes in 2..=7 {
                for method in [Method::Equal, Method::Quantile, Method::Jenks] {
                    let (bounds, counts, _) = ranges(&two_values(zeros, ones), method, classes);
                    let nonempty = counts.iter().filter(|&&n| n > 0).count();
                    assert!(
                        nonempty >= 2,
                        "{zeros} zeros, {ones} ones, {classes} classes, {method:?}: {bounds:?} {counts:?}"
                    );
                    assert_eq!(counts.iter().sum::<u64>(), (zeros + ones) as u64);
                }
            }
        }
        // One class is what one class asked for, and a constant column still gives one.
        assert_eq!(ranges(&two_values(900, 100), Method::Quantile, 1).1, [1000]);
        assert_eq!(ranges(&two_values(10, 0), Method::Quantile, 5).1, [10]);
        // The shape of the answer: the zeros below, the ones in a class of their own.
        let (bounds, counts, _) = ranges(&two_values(900, 100), Method::Quantile, 3);
        assert_eq!((bounds, counts), (vec![0.0, 1.0, 1.0], vec![900, 100]));
        let (bounds, counts, _) = ranges(&two_values(500, 500), Method::Quantile, 5);
        assert_eq!((bounds, counts), (vec![0.0, 1.0, 1.0], vec![500, 500]));
    }

    #[test]
    fn the_largest_value_is_its_own_class_however_many_bounds_it_takes_and_others_stay() {
        // 300 zeros, 300 ones, 400 twos in five classes: the bounds are 0, 0, 1, 2, 2 and 2, and the
        // twos, which take three of them, are a class of their own above the zeros and the ones.
        let mut v = vec![0.0; 300];
        v.extend(std::iter::repeat_n(1.0, 300));
        v.extend(std::iter::repeat_n(2.0, 400));
        let (bounds, counts, _) = ranges(&floats(&v), Method::Quantile, 5);
        assert_eq!(
            (bounds, counts),
            (vec![0.0, 1.0, 2.0, 2.0], vec![300, 300, 400])
        );
    }

    #[test]
    fn equal_bounds_never_descend_and_never_overflow_for_a_range_of_a_few_ulps_or_wider_than_a_float()
     {
        // Found by the second review of the milestone: `min + step * k` can round above `max` when the range is a few ulps
        // wide, so that the bounds went down and the engine refused the result (a ContractError), and a range wider than a
        // float gave NaN or an infinite bound for one class and for three.
        let up = |x: f64, n: u32| (0..n).fold(x, |v, _| f64::from_bits(v.to_bits() + 1));
        let mut cases: Vec<Vec<f64>> = vec![
            vec![2.67, up(2.67, 1), 2.67, up(2.67, 1), 2.67],
            vec![-1.7e308, 1.7e308, 0.0],
            vec![f64::MIN, f64::MAX],
            vec![-1.0e-320, 1.0e-320],
            // A range of five of the smallest numbers in 7 classes: `range / n` rounds to one of them, so `min + (range / n) *
            // k` is 6 of them for the sixth bound, above the largest value, and only the hold between the bounds keeps it down.
            vec![0.0, f64::from_bits(5)],
        ];
        let mut seed = 5_u64;
        let mut next = move || {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            seed >> 33
        };
        for _ in 0..4_000 {
            let magnitude = 10_f64.powi((next() % 600) as i32 - 300);
            let low = magnitude * (1.0 + (next() % 1_000) as f64 / 1_000.0);
            cases.push(vec![low, up(low, 1 + (next() % 20) as u32)]);
        }
        for values in &cases {
            for classes in [1, 2, 3, 7, 12] {
                let (bounds, counts, _) = ranges(&floats(values), Method::Equal, classes);
                let (min, max) = extent(values);
                assert!(
                    bounds.iter().all(|b| b.is_finite()),
                    "{values:?} in {classes}: {bounds:?}"
                );
                assert!(
                    bounds.windows(2).all(|w| w[0] <= w[1]),
                    "{values:?} in {classes}: {bounds:?}"
                );
                assert_eq!(
                    (bounds[0], bounds[bounds.len() - 1]),
                    (min, max),
                    "{values:?} in {classes}"
                );
                assert_eq!(counts.iter().sum::<u64>(), values.len() as u64);
                assert_eq!(counts.len(), bounds.len() - 1);
            }
        }
    }

    #[test]
    fn equal_bounds_of_a_range_wider_than_a_float_are_still_equal_steps() {
        // Found by the fourth review of the milestone: no test told the blend used when `max - min` is infinite from
        // `min + (range / n) * k`, which clamped to the largest value gives one class too few (bounds `[min, max, max]`,
        // counts `[2, 1]`) and passed every other test.
        let (min, max) = (-1.7e308, 1.7e308);
        let (bounds, counts, _) = ranges(&floats(&[min, 0.0, max]), Method::Equal, 3);
        assert_eq!((bounds.len(), counts), (4, vec![1, 1, 1]), "{bounds:?}");
        assert_eq!((bounds[0], bounds[3]), (min, max));
        for (bound, wanted) in [(bounds[1], min / 3.0), (bounds[2], max / 3.0)] {
            assert!(
                ((bound - wanted) / wanted).abs() < 1e-12,
                "{bound:e} is not {wanted:e}"
            );
        }
    }

    #[test]
    fn equal_bounds_are_exact_where_the_width_divides_evenly_and_a_value_on_one_is_in_the_class_above()
     {
        // Found by the third review of the milestone, as a regression of step 13.F12: `min * (1 - t) + max * t` gave
        // -198.00000000000003 for -200 to -188 in 6 classes, 63.00000000000001 for 0 to 77 in 11, and integers 1 to 15 in 7
        // classes had bounds such as 6.999999999999999, so that a value on a bound fell in the class below it, against the rule of
        // step 13.15 and the label of the legend.
        let mut checked = 0;
        for min in [-200.0, -5.0, 0.0, 1.0, 5.0, 10.0, 100.0, 1_000.0] {
            for width in 1..=400_u32 {
                for classes in 2..=12_u32 {
                    if width % classes != 0 {
                        continue;
                    }
                    let max = min + f64::from(width);
                    let step = f64::from(width / classes);
                    let wanted: Vec<f64> =
                        (0..=classes).map(|k| min + step * f64::from(k)).collect();
                    // A column of every integer from min to max: each value on a bound is in the class above the bound.
                    let column =
                        floats(&(0..=width).map(|i| min + f64::from(i)).collect::<Vec<_>>());
                    let (bounds, counts, _) = ranges(&column, Method::Equal, classes as usize);
                    assert_eq!(bounds, wanted, "{min} to {max} in {classes}");
                    for k in 0..classes {
                        assert_eq!(class_of(&bounds, wanted[k as usize]), Some(k as usize));
                    }
                    assert_eq!(counts.iter().sum::<u64>(), u64::from(width) + 1);
                    checked += 1;
                }
            }
        }
        assert!(checked > 1_000, "{checked} ranges checked");
        // The three examples of the review.
        for (min, max, classes) in [(-200.0, -188.0, 6), (0.0, 77.0, 11), (1.0, 15.0, 7)] {
            let column = floats(&[min, max]);
            let (bounds, _, _) = ranges(&column, Method::Equal, classes);
            assert!(bounds.iter().all(|b| b.fract() == 0.0), "{bounds:?}");
        }
    }
}
