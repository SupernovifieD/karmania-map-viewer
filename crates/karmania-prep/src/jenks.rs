//! Natural breaks (Jenks): the classes that make the values in each as alike as can be.
//!
//! The classes are the split of the sorted values into `k` runs that has the smallest sum, over the runs,
//! of the squared distances of the values from the run's mean (the one-dimensional `k`-means, which Fisher's
//! method finds exactly). The optimum is found by dynamic programming with the divide and conquer
//! speed-up, which holds because the cost of a run satisfies the quadrangle inequality, so the work is
//! about `k * n * log n` and not `k * n * n`. Ties are broken towards the earliest split, so the same values
//! always give the same breaks, and nothing but `+`, `-`, `*` and `/` is used, which every platform
//! computes the same.

/// The most values the breaks are found from. A column with more is sampled (see [`sample`]).
pub const SAMPLE_SIZE: usize = 10_000;

/// An evenly strided sample of `values` of at most [`SAMPLE_SIZE`], in the order of the rows: the values
/// at the rows `floor(i * n / SAMPLE_SIZE)`. All of `values` if there are no more than that. It uses no
/// random number, so the same column always gives the same sample.
#[must_use]
pub fn sample(values: &[f64]) -> Vec<f64> {
    if values.len() <= SAMPLE_SIZE {
        return values.to_vec();
    }
    let n = values.len() as u128;
    (0..SAMPLE_SIZE as u128)
        .filter_map(|i| usize::try_from(i * n / SAMPLE_SIZE as u128).ok())
        .filter_map(|row| values.get(row).copied())
        .collect()
}

/// Prefix sums of the values and of their squares, taken from the first so that large coordinates do not
/// lose their digits.
struct Sums {
    sum: Vec<f64>,
    squares: Vec<f64>,
}

impl Sums {
    fn new(sorted: &[f64]) -> Self {
        let shift = sorted.first().copied().unwrap_or(0.0);
        let (mut sum, mut squares) = (vec![0.0], vec![0.0]);
        for &v in sorted {
            let x = v - shift;
            sum.push(sum.last().copied().unwrap_or(0.0) + x);
            squares.push(squares.last().copied().unwrap_or(0.0) + x * x);
        }
        Self { sum, squares }
    }

    /// The sum of the squared distances from the mean of the values `from..=to`.
    fn cost(&self, from: usize, to: usize) -> f64 {
        let (Some(s0), Some(s1), Some(q0), Some(q1)) = (
            self.sum.get(from),
            self.sum.get(to + 1),
            self.squares.get(from),
            self.squares.get(to + 1),
        ) else {
            return f64::INFINITY;
        };
        let (count, sum) = ((to + 1 - from) as f64, s1 - s0);
        ((q1 - q0) - sum * sum / count).max(0.0)
    }
}

/// The values `class` starts at, for the classes after the first, when the `sorted` values (not
/// empty, ascending) are split into at most `classes` classes: `k - 1` values, ascending and different,
/// each a value that was given, with `k` the smaller of `classes` and the number of different values.
/// A value that is a break starts the class above it.
#[must_use]
pub fn natural_breaks(sorted: &[f64], classes: usize) -> Vec<f64> {
    let n = sorted.len();
    let distinct = 1 + sorted.windows(2).filter(|pair| pair[0] != pair[1]).count();
    let k = classes.min(distinct).min(n);
    if k < 2 {
        return Vec::new();
    }
    let sums = Sums::new(sorted);
    // `best[i]`: the least cost of splitting the values up to `i` into the classes so far. `split[m][i]`:
    // where the last of `m + 1` classes starts in that best split.
    let mut best: Vec<f64> = (0..n).map(|i| sums.cost(0, i)).collect();
    let mut split: Vec<Vec<usize>> = Vec::with_capacity(k);
    split.push(vec![0; n]);
    for m in 1..k {
        let mut next = vec![f64::INFINITY; n];
        let mut starts = vec![0; n];
        divide(
            &sums,
            &best,
            m,
            (m, n - 1),
            (m, n - 1),
            &mut next,
            &mut starts,
        );
        best = next;
        split.push(starts);
    }
    let mut breaks = Vec::with_capacity(k - 1);
    let mut end = n - 1;
    for m in (1..k).rev() {
        let start = split
            .get(m)
            .and_then(|row| row.get(end))
            .copied()
            .unwrap_or(0);
        breaks.extend(sorted.get(start));
        end = start.saturating_sub(1);
    }
    breaks.reverse();
    breaks.dedup();
    breaks
}

/// Fills `next` and `starts` for the values `at.0..=at.1` of the class `m + 1`, knowing that the start of its
/// last class lies in `from.0..=from.1` (the starts only move one way as the values do).
fn divide(
    sums: &Sums,
    best: &[f64],
    m: usize,
    at: (usize, usize),
    from: (usize, usize),
    next: &mut [f64],
    starts: &mut [usize],
) {
    if at.0 > at.1 {
        return;
    }
    let mid = at.0 + (at.1 - at.0) / 2;
    let (low, high) = (from.0.max(m), from.1.min(mid));
    let mut choice = (f64::INFINITY, low);
    for start in low..=high {
        let cost = best.get(start - 1).copied().unwrap_or(f64::INFINITY) + sums.cost(start, mid);
        if cost < choice.0 {
            choice = (cost, start);
        }
    }
    if let (Some(slot), Some(at_mid)) = (next.get_mut(mid), starts.get_mut(mid)) {
        (*slot, *at_mid) = choice;
    }
    if mid > at.0 {
        divide(
            sums,
            best,
            m,
            (at.0, mid - 1),
            (from.0, choice.1),
            next,
            starts,
        );
    }
    divide(
        sums,
        best,
        m,
        (mid + 1, at.1),
        (choice.1, from.1),
        next,
        starts,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The least sum of squares over every way to split `sorted` into `k` runs, by trying them all.
    fn brute_force(sorted: &[f64], k: usize) -> f64 {
        fn cost(run: &[f64]) -> f64 {
            let mean = run.iter().sum::<f64>() / run.len() as f64;
            run.iter().map(|v| (v - mean).powi(2)).sum()
        }
        fn go(sorted: &[f64], k: usize) -> f64 {
            if k == 1 {
                return cost(sorted);
            }
            (1..=sorted.len() - (k - 1))
                .map(|cut| cost(&sorted[..cut]) + go(&sorted[cut..], k - 1))
                .fold(f64::INFINITY, f64::min)
        }
        go(sorted, k)
    }

    /// The sum of squares of the split that has `breaks` as the values the later classes start at.
    fn cost_of(sorted: &[f64], breaks: &[f64]) -> f64 {
        let mut total = 0.0;
        let mut start = 0;
        for end in breaks
            .iter()
            .map(|b| sorted.partition_point(|v| v < b))
            .chain([sorted.len()])
        {
            let run = &sorted[start..end];
            let mean = run.iter().sum::<f64>() / run.len() as f64;
            total += run.iter().map(|v| (v - mean).powi(2)).sum::<f64>();
            start = end;
        }
        total
    }

    #[test]
    fn three_clear_groups_are_split_where_the_gaps_are() {
        let v = [1.0, 2.0, 3.0, 10.0, 11.0, 12.0, 100.0, 101.0, 102.0];
        assert_eq!(natural_breaks(&v, 3), [10.0, 100.0]);
        assert_eq!(natural_breaks(&v, 2), [100.0]);
        assert!(natural_breaks(&v, 1).is_empty());
    }

    #[test]
    fn the_split_is_the_best_there_is_for_many_small_sets_of_values() {
        let mut seed = 99_u64;
        let mut next = move || {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((seed >> 33) % 40) as f64
        };
        for round in 0..300 {
            let n = 4 + round % 9;
            let mut v: Vec<f64> = (0..n).map(|_| next()).collect();
            v.sort_unstable_by(f64::total_cmp);
            for k in 2..=4_usize {
                let breaks = natural_breaks(&v, k);
                let distinct = 1 + v.windows(2).filter(|p| p[0] != p[1]).count();
                let used = breaks.len() + 1;
                assert_eq!(used, k.min(distinct), "{v:?} {k}");
                let wanted = brute_force(&v, used);
                assert!(
                    (cost_of(&v, &breaks) - wanted).abs() < 1e-9,
                    "{v:?} k={k}: {breaks:?}"
                );
                assert!(
                    breaks.windows(2).all(|p| p[0] < p[1]) && breaks.iter().all(|b| v.contains(b))
                );
            }
        }
    }

    #[test]
    fn fewer_different_values_than_classes_make_one_class_for_each() {
        assert_eq!(natural_breaks(&[5.0, 5.0, 7.0, 9.0, 9.0], 10), [7.0, 9.0]);
        assert!(natural_breaks(&[3.0, 3.0, 3.0], 4).is_empty());
        assert!(natural_breaks(&[3.0], 4).is_empty());
    }

    #[test]
    fn large_values_far_from_zero_keep_their_digits() {
        let v: Vec<f64> = [0.0, 0.25, 0.5, 8.0, 8.25, 8.5]
            .iter()
            .map(|d| 4_012_345.0 + d)
            .collect();
        assert_eq!(natural_breaks(&v, 2), [4_012_353.0]);
    }

    #[test]
    fn a_long_column_is_sampled_at_even_strides_and_a_short_one_not_at_all() {
        let short: Vec<f64> = (0..SAMPLE_SIZE).map(|i| i as f64).collect();
        assert_eq!(sample(&short), short);
        let long: Vec<f64> = (0..SAMPLE_SIZE * 3).map(|i| i as f64).collect();
        let s = sample(&long);
        assert_eq!(s.len(), SAMPLE_SIZE);
        assert_eq!(s[..4], [0.0, 3.0, 6.0, 9.0]);
        assert_eq!(s.last(), Some(&((SAMPLE_SIZE as f64 - 1.0) * 3.0)));
        assert_eq!(sample(&long), s, "the same every time");
    }

    #[test]
    fn ten_thousand_values_in_twelve_classes_give_eleven_breaks() {
        let v: Vec<f64> = (0..SAMPLE_SIZE)
            .map(|i| ((i * 7919) % 10_007) as f64)
            .collect();
        let mut sorted = v;
        sorted.sort_unstable_by(f64::total_cmp);
        let breaks = natural_breaks(&sorted, 12);
        assert_eq!(breaks.len(), 11);
    }
}
