//! The levels of a set of contour lines: the heights `base + k * interval` for the whole numbers `k`, within the range of the data.
//!
//! One place says which heights are levels and which of them are index lines (every `index_every`th, counted from the base, so that
//! the base is one), so that the grid and the mesh contours, and the legend that says what they are, agree.

use std::ops::Range;

/// The most levels one set of contours may have (brief 11.5). A set with more is not made: it is a finding, and a larger interval
/// is the hint.
pub const MAX_LEVELS: usize = 1_000;

/// How far from the base the data may be, in intervals, before the levels are not worked out (the heights are floats, and a thousand
/// million intervals keeps them apart).
const MAX_REACH: f64 = 1.0e9;

/// How many times a first estimate of a level's number is corrected at most (it is right, or one off, since the heights are floats).
const FIX_UPS: usize = 4;

/// Why there are no levels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LevelsError {
    /// The interval is not a finite number greater than 0, the base is not finite, `index_every` is 0, or the data is so far from the
    /// base, in intervals, that the levels cannot be counted.
    Invalid,
    /// The range of the data is not a range: a number that is not finite, or the smallest above the largest.
    NoRange,
    /// More than [`MAX_LEVELS`] levels are in the range: `count` is how many (the most that a `u64` holds, if it is more).
    TooMany {
        /// How many levels there would be.
        count: u64,
    },
}

/// The levels in a range: the heights `base + k * interval` that are at or above its smallest value and at or below its largest.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Levels {
    base: f64,
    interval: f64,
    /// The `k` of the lowest level.
    first: i64,
    count: usize,
    index_every: u32,
}

impl Levels {
    /// The levels of a set of contours of data from `min` to `max` (both ends included): `base + k * interval` for the whole
    /// numbers `k`; every `index_every`th is an index line, the base being one of them.
    ///
    /// # Errors
    ///
    /// [`LevelsError::Invalid`] for an interval that is not finite and greater than 0, a base that is not finite, or `index_every`
    /// of 0; [`LevelsError::NoRange`] for a range that is not finite or is upside down; [`LevelsError::TooMany`] for more than
    /// [`MAX_LEVELS`].
    pub fn for_range(
        min: f64,
        max: f64,
        base: f64,
        interval: f64,
        index_every: u32,
    ) -> Result<Self, LevelsError> {
        if !(interval.is_finite() && interval > 0.0 && base.is_finite() && index_every >= 1) {
            return Err(LevelsError::Invalid);
        }
        if !(min.is_finite() && max.is_finite() && min <= max) {
            return Err(LevelsError::NoRange);
        }
        let span = (max - min) / interval;
        if !span.is_finite() || span > MAX_LEVELS as f64 + 2.0 {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let count = if span.is_finite() {
                span.floor() as u64
            } else {
                u64::MAX
            };
            return Err(LevelsError::TooMany { count });
        }
        let reach = ((min - base) / interval)
            .abs()
            .max(((max - base) / interval).abs());
        if !reach.is_finite() || reach > MAX_REACH {
            return Err(LevelsError::Invalid);
        }
        let mut probe = Self {
            base,
            interval,
            first: 0,
            count: 0,
            index_every,
        };
        // The lowest k whose height is at or above `min`, and the highest whose height is at or below `max`, found from the estimate
        // and then corrected, since the heights are `base + k * interval` as a float.
        let mut low = whole(((min - base) / interval).ceil());
        for _ in 0..FIX_UPS {
            if probe.height_of(low.saturating_sub(1)) >= min {
                low = low.saturating_sub(1);
            } else if probe.height_of(low) < min {
                low = low.saturating_add(1);
            } else {
                break;
            }
        }
        let mut high = whole(((max - base) / interval).floor());
        for _ in 0..FIX_UPS {
            if probe.height_of(high.saturating_add(1)) <= max {
                high = high.saturating_add(1);
            } else if probe.height_of(high) > max {
                high = high.saturating_sub(1);
            } else {
                break;
            }
        }
        let count = i128::from(high) - i128::from(low) + 1;
        if count > MAX_LEVELS as i128 {
            return Err(LevelsError::TooMany {
                count: u64::try_from(count).unwrap_or(u64::MAX),
            });
        }
        probe.first = low;
        probe.count = usize::try_from(count.max(0)).unwrap_or(0);
        Ok(probe)
    }

    /// How many levels there are.
    #[must_use]
    pub fn len(&self) -> usize {
        self.count
    }

    /// Whether there is no level in the range.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// The height of the `i`th level, from the lowest (`0`); `None` past the last.
    #[must_use]
    pub fn height(&self, i: usize) -> Option<f64> {
        (i < self.count).then(|| self.height_of(self.k_of(i)))
    }

    /// Whether the `i`th level is an index line: its `k` is a multiple of `index_every`, counted from the base (negative `k` too).
    #[must_use]
    pub fn is_index(&self, i: usize) -> bool {
        i < self.count && self.k_of(i).rem_euclid(i64::from(self.index_every)) == 0
    }

    /// The levels that a square whose values go from `low` to `high` crosses: those above `low` and at or below `high` (a value is
    /// above a level when it is at or above it), as the indices of [`Levels::height`].
    #[must_use]
    pub fn crossed_by(&self, low: f64, high: f64) -> Range<usize> {
        // (A range with a value that is not a number is not one: `low < high` is false for it.)
        if self.count == 0 || low.partial_cmp(&high) != Some(std::cmp::Ordering::Less) {
            return 0..0;
        }
        // The numbers `k` of the lowest level and one past the highest: the estimates are kept between them, and corrected a few times.
        let bottom = self.first;
        let top = self.k_of(self.count);
        let mut first =
            whole(((low - self.base) / self.interval).floor()).clamp(bottom.saturating_sub(1), top);
        for _ in 0..FIX_UPS {
            if first < top && self.height_of(first) <= low {
                first = first.saturating_add(1);
            } else if first > bottom && self.height_of(first.saturating_sub(1)) > low {
                first = first.saturating_sub(1);
            } else {
                break;
            }
        }
        let mut last = whole(((high - self.base) / self.interval).floor())
            .clamp(bottom.saturating_sub(1), top.saturating_sub(1));
        for _ in 0..FIX_UPS {
            if last < top.saturating_sub(1) && self.height_of(last.saturating_add(1)) <= high {
                last = last.saturating_add(1);
            } else if last >= bottom && self.height_of(last) > high {
                last = last.saturating_sub(1);
            } else {
                break;
            }
        }
        let start = self.index_of(first).min(self.count);
        let end = self.index_of(last.saturating_add(1)).min(self.count);
        start..end.max(start)
    }

    fn k_of(&self, i: usize) -> i64 {
        self.first
            .saturating_add(i64::try_from(i).unwrap_or(i64::MAX))
    }

    /// The index of the level `k`, clamped to the levels that there are (below the lowest is 0, above the highest is the count).
    fn index_of(&self, k: i64) -> usize {
        let from_first = i128::from(k) - i128::from(self.first);
        usize::try_from(from_first.clamp(0, self.count as i128)).unwrap_or(0)
    }

    fn height_of(&self, k: i64) -> f64 {
        #[allow(clippy::cast_precision_loss)]
        let steps = k as f64;
        self.base + steps * self.interval
    }
}

/// The default interval for data from `low` to `high` (brief 11.5): a nice number (1, 2, 2.5 or 5 times a power of ten) that gives 10 to
/// 20 levels whatever the base, the largest that gives at least 10. `None` for a range that is not one that has a span: a number that is
/// not finite, or the two ends the same.
///
/// A set of `low..high` and an interval `d` has between `floor(span / d)` and one more levels. The largest nice number at or under a
/// tenth of the span gives at least 10; the one above it is a tenth of the span or more, and the nice numbers are never more than twice
/// each other, so the one chosen is more than a twentieth of the span and the levels are fewer than 21, 20 at most.
#[must_use]
pub fn default_interval(low: f64, high: f64) -> Option<f64> {
    let span = high - low;
    if !(low.is_finite() && high.is_finite() && span.is_finite() && span > 0.0) {
        return None;
    }
    let target = span / 10.0;
    #[allow(clippy::cast_possible_truncation)]
    let exponent = target.log10().floor() as i32;
    // The power of ten of the target and the one below it, in case the target is just under a power (the logarithm is not exact).
    (exponent.saturating_sub(1)..=exponent.saturating_add(1))
        .rev()
        .flat_map(|power| {
            [50, 25, 20, 10]
                .into_iter()
                .map(move |tenths| nice(f64::from(tenths) / 10.0, power))
        })
        .find(|&interval| interval.is_finite() && interval > 0.0 && interval <= target)
}

/// `mantissa` times ten to the `power`, the nearest float to that number (a division by an exact power of ten when the power is
/// negative, so that 2.5 times ten to the minus three is 0.0025 and not a float that is a hair above it).
fn nice(mantissa: f64, power: i32) -> f64 {
    if power >= 0 {
        mantissa * 10f64.powi(power)
    } else {
        mantissa / 10f64.powi(power.saturating_neg())
    }
}

/// A whole number of intervals as an `i64`; the caller has kept it within `MAX_REACH`.
fn whole(value: f64) -> i64 {
    #[allow(clippy::cast_possible_truncation)]
    {
        value as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn heights(levels: &Levels) -> Vec<f64> {
        (0..levels.len()).filter_map(|i| levels.height(i)).collect()
    }

    #[test]
    fn the_levels_are_the_base_and_whole_intervals_from_it_within_the_range_ends_included() {
        let levels = Levels::for_range(0.0, 10.0, 0.0, 2.5, 5).unwrap();
        assert_eq!(heights(&levels), [0.0, 2.5, 5.0, 7.5, 10.0]);
        // A base that is not in the range: the others are `base + k * interval`.
        let levels = Levels::for_range(0.0, 20.0, 1.0, 5.0, 5).unwrap();
        assert_eq!(heights(&levels), [1.0, 6.0, 11.0, 16.0]);
        // A range that has no level in it has none, which is not an error.
        let levels = Levels::for_range(1.2, 1.8, 0.0, 1.0, 5).unwrap();
        assert!(levels.is_empty());
        assert_eq!(levels.height(0), None);
    }

    #[test]
    fn a_range_of_one_value_has_a_level_only_when_the_value_is_one() {
        assert_eq!(
            heights(&Levels::for_range(5.0, 5.0, 0.0, 5.0, 5).unwrap()),
            [5.0]
        );
        assert!(Levels::for_range(5.5, 5.5, 0.0, 5.0, 5).unwrap().is_empty());
    }

    #[test]
    fn heights_below_the_base_and_a_fraction_that_is_not_exact_are_levels_all_the_same() {
        let levels = Levels::for_range(-12.0, 3.0, 0.0, 5.0, 2).unwrap();
        assert_eq!(heights(&levels), [-10.0, -5.0, 0.0]);
        // Eleven levels, with the 1.0 that `0.1 * 10` makes, though `0.1 * 3` is not 0.3.
        let levels = Levels::for_range(0.0, 1.0, 0.0, 0.1, 5).unwrap();
        assert_eq!(levels.len(), 11);
        assert_eq!(levels.height(10), Some(1.0));
        assert_eq!(levels.height(11), None);
    }

    #[test]
    fn every_nth_level_from_the_base_is_an_index_line_counted_the_same_below_the_base() {
        let levels = Levels::for_range(-12.0, 13.0, 0.0, 1.0, 5).unwrap();
        let index: Vec<f64> = (0..levels.len())
            .filter(|&i| levels.is_index(i))
            .filter_map(|i| levels.height(i))
            .collect();
        assert_eq!(index, [-10.0, -5.0, 0.0, 5.0, 10.0]);
        // The base is one of them whichever the base is, and 1 makes every line one.
        let levels = Levels::for_range(0.0, 20.0, 1.0, 5.0, 2).unwrap();
        assert_eq!(heights(&levels), [1.0, 6.0, 11.0, 16.0]);
        assert_eq!(
            (0..4).map(|i| levels.is_index(i)).collect::<Vec<_>>(),
            [true, false, true, false]
        );
        let all = Levels::for_range(0.0, 3.0, 0.0, 1.0, 1).unwrap();
        assert!((0..4).all(|i| all.is_index(i)));
        assert!(!all.is_index(4));
    }

    #[test]
    fn more_than_a_thousand_levels_is_said_with_how_many() {
        assert_eq!(
            Levels::for_range(0.0, 999.0, 0.0, 1.0, 5).unwrap().len(),
            1000
        );
        assert_eq!(
            Levels::for_range(0.0, 1000.0, 0.0, 1.0, 5),
            Err(LevelsError::TooMany { count: 1001 })
        );
        assert_eq!(
            Levels::for_range(0.0, 10.0, 0.0, 0.001, 5),
            Err(LevelsError::TooMany { count: 10_000 })
        );
        assert!(matches!(
            Levels::for_range(f64::MIN, f64::MAX, 0.0, 1.0, 5),
            Err(LevelsError::TooMany { .. })
        ));
    }

    #[test]
    fn an_interval_a_base_or_a_count_that_is_not_one_and_a_range_that_is_not_one_are_errors() {
        for interval in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(
                Levels::for_range(0.0, 1.0, 0.0, interval, 5),
                Err(LevelsError::Invalid)
            );
        }
        assert_eq!(
            Levels::for_range(0.0, 1.0, f64::NAN, 1.0, 5),
            Err(LevelsError::Invalid)
        );
        assert_eq!(
            Levels::for_range(0.0, 1.0, f64::INFINITY, 1.0, 5),
            Err(LevelsError::Invalid)
        );
        assert_eq!(
            Levels::for_range(0.0, 1.0, 0.0, 1.0, 0),
            Err(LevelsError::Invalid)
        );
        // Data so far from the base, in intervals, that the levels are not worked out.
        assert_eq!(
            Levels::for_range(0.0, 1.0, 1.0e12, 1.0, 5),
            Err(LevelsError::Invalid)
        );
        for (min, max) in [(f64::NAN, 1.0), (0.0, f64::INFINITY), (2.0, 1.0)] {
            assert_eq!(
                Levels::for_range(min, max, 0.0, 1.0, 5),
                Err(LevelsError::NoRange)
            );
        }
    }

    /// The heights that the estimate of a level's number gets wrong by one (`0.1 * 3` is `0.30000000000000004`, which divided by `0.1` is
    /// `3.0000000000000004`): a range that is exactly the height of a level has that level and no other, wherever the level is.
    #[test]
    fn a_range_that_is_exactly_the_height_of_a_level_has_that_level_whatever_the_rounding() {
        let mut estimates_that_were_wrong = 0;
        for interval in [
            0.1, 0.2, 0.25, 0.3, 0.7, 1.1, 0.05, 0.15, 0.35, 1.7, 2.5, 0.01, 0.03,
        ] {
            for base in [0.0, 0.1, -0.3, 1.0, 0.7, -1.1, 0.2, 0.4] {
                for k in -30_i32..60 {
                    let height = base + f64::from(k) * interval;
                    let levels = Levels::for_range(height, height, base, interval, 5).unwrap();
                    assert_eq!(levels.len(), 1, "{base} + {k} * {interval}");
                    assert_eq!(levels.height(0), Some(height), "{base} + {k} * {interval}");
                    // A range from that level to two intervals above it has that level first, and two or three levels (the end is
                    // `height + 2 * interval` as a float, and may be a hair under the height of the third).
                    let wider =
                        Levels::for_range(height, height + 2.0 * interval, base, interval, 5)
                            .unwrap();
                    assert_eq!(wider.height(0), Some(height), "{base} + {k} * {interval}");
                    assert!((2..=3).contains(&wider.len()), "{base} + {k} * {interval}");
                    estimates_that_were_wrong +=
                        usize::from(((height - base) / interval).floor() != f64::from(k));
                }
            }
        }
        // The grid has such cases (it is no test of the correction if it has none).
        assert!(estimates_that_were_wrong > 100);
    }

    #[test]
    fn a_square_crosses_the_levels_above_its_lowest_value_and_up_to_its_highest() {
        let levels = Levels::for_range(0.0, 10.0, 0.0, 1.0, 5).unwrap();
        let crossed = |low: f64, high: f64| -> Vec<f64> {
            levels
                .crossed_by(low, high)
                .filter_map(|i| levels.height(i))
                .collect()
        };
        assert_eq!(crossed(2.5, 4.5), [3.0, 4.0]);
        // A value at a level is above it, so a square from 3 to 4 crosses 4 and not 3.
        assert_eq!(crossed(3.0, 4.0), [4.0]);
        assert_eq!(crossed(3.0, 3.0), Vec::<f64>::new());
        assert_eq!(crossed(3.2, 3.8), Vec::<f64>::new());
        // Beyond the levels there are: none.
        assert_eq!(crossed(-5.0, -1.0), Vec::<f64>::new());
        assert_eq!(crossed(11.0, 20.0), Vec::<f64>::new());
        assert_eq!(crossed(-5.0, 1.5), [0.0, 1.0]);
        assert_eq!(crossed(9.5, 50.0), [10.0]);
        // Values far outside the levels, or the largest numbers there are, are answered at once.
        assert_eq!(crossed(1.0e300, 1.0e301), Vec::<f64>::new());
        assert_eq!(
            crossed(f64::MIN, f64::MAX),
            (0..11).map(f64::from).collect::<Vec<_>>()
        );
        assert_eq!(crossed(f64::NAN, 5.0), Vec::<f64>::new());
    }

    #[test]
    fn the_default_interval_is_a_nice_number_that_gives_ten_to_twenty_levels_at_any_base() {
        let nice_mantissas = [1.0, 2.0, 2.5, 5.0];
        let mut cases = 0;
        let mut span = 1.0e-9;
        while span < 1.0e12 {
            for offset in [0.0, 0.3, -0.7, 12_345.678, -987.65, 1.0 / 3.0] {
                let low = offset * span;
                let high = low + span;
                let interval = default_interval(low, high).unwrap();
                // A nice number: 1, 2, 2.5 or 5 times a power of ten (to the digits of a float).
                let power = interval.log10().floor();
                let mantissa = interval / 10f64.powf(power);
                assert!(
                    nice_mantissas.iter().any(|m| (mantissa - m).abs() < 1e-9)
                        || (mantissa - 10.0).abs() < 1e-9,
                    "{interval} for {low}..{high} is not nice ({mantissa})"
                );
                for base in [0.0, interval / 3.0, -interval * 7.0] {
                    let levels = Levels::for_range(low, high, base, interval, 5).unwrap();
                    assert!(
                        (10..=20).contains(&levels.len()),
                        "{} levels of {interval} in {low}..{high} from {base}",
                        levels.len()
                    );
                }
                cases += 1;
            }
            span *= 1.13;
        }
        assert!(cases > 1_000);
        // Some that are known: a hundred over 0 to 100 (the largest that gives ten), 2.5 for 25 to 50 worth, and clean decimals.
        assert_eq!(default_interval(0.0, 100.0), Some(10.0));
        assert_eq!(default_interval(0.0, 99.0), Some(5.0));
        assert_eq!(default_interval(100.0, 350.0), Some(25.0));
        assert_eq!(default_interval(0.0, 0.025), Some(0.0025));
        assert_eq!(default_interval(-3.2, 4.0), Some(0.5));
        assert_eq!(default_interval(0.0, 1.0), Some(0.1));
    }

    #[test]
    fn there_is_no_default_interval_without_a_span() {
        assert_eq!(default_interval(5.0, 5.0), None);
        assert_eq!(default_interval(5.0, 1.0), None);
        assert_eq!(default_interval(f64::NAN, 1.0), None);
        assert_eq!(default_interval(0.0, f64::INFINITY), None);
        assert_eq!(default_interval(f64::MIN, f64::MAX), None);
        // A span of a hair: still a nice number, and no more than a thousand levels.
        assert!(default_interval(1.0, 1.0 + f64::EPSILON).is_some_and(|d| d > 0.0));
    }

    #[test]
    fn a_nice_number_is_the_float_nearest_to_its_decimal_so_its_name_is_clean() {
        // 2.5 times a tenth to the sixth is 2.4999999999999998e-6 as a product, and 2.5e-6 is what a person reads.
        for mantissa in [1.0, 2.0, 2.5, 5.0, 10.0] {
            for power in -22..=22 {
                let written: f64 = format!("{mantissa}e{power}").parse().unwrap();
                assert_eq!(nice(mantissa, power), written, "{mantissa}e{power}");
            }
        }
    }
}
