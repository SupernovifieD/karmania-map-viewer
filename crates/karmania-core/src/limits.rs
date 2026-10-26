//! The dataset size limit, checked before anything is allocated.

use crate::codes::FindingCode;
use crate::findings::{Finding, Findings};
use crate::text::format_count;

/// The most elements a dataset may have: points, vertices, grid cells or
/// blocks, each counted on its own. Larger datasets are rejected with an error
/// finding before any memory is allocated for them.
pub const MAX_ELEMENTS: u64 = 134_217_728;

/// Checks a planned size against [`MAX_ELEMENTS`] before allocating.
///
/// `count` is the number of `things` (a plural noun such as `"points"`,
/// `"cells"` or `"blocks"`) about to be created, or `None` if the count is too
/// large to calculate. Returns `true` if it is within the limit. Otherwise adds
/// a `dataset.too_large` error to `findings` and returns `false`, and the caller
/// must not allocate.
pub fn check_size(count: Option<u64>, things: &str, findings: &mut Findings) -> bool {
    if count.is_some_and(|n| n <= MAX_ELEMENTS) {
        return true;
    }
    let limit = format_count(MAX_ELEMENTS);
    let message = match count {
        Some(n) => format!(
            "This dataset would have about {} {things}, which is more than the limit of {limit}.",
            format_count(n)
        ),
        None => format!("This dataset would have far more {things} than the limit of {limit}."),
    };
    findings.add(
        Finding::new(FindingCode::DatasetTooLarge, message).with_hint(format!(
            "Use fewer {things}, or split the data into several datasets."
        )),
    );
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(count: Option<u64>, things: &str) -> (bool, Findings) {
        let mut findings = Findings::new();
        (check_size(count, things, &mut findings), findings)
    }

    #[test]
    fn the_limit_is_two_to_the_power_of_27() {
        assert_eq!(MAX_ELEMENTS, 1 << 27);
    }

    #[test]
    fn sizes_up_to_and_including_the_limit_pass_without_a_finding() {
        for n in [0, 1, 1_000_000, MAX_ELEMENTS] {
            let (ok, findings) = run(Some(n), "points");
            assert!(ok && findings.is_empty(), "{n} should be allowed");
        }
    }

    #[test]
    fn one_element_over_the_limit_fails_with_a_plain_message() {
        let (ok, findings) = run(Some(MAX_ELEMENTS + 1), "cells");
        assert!(!ok);
        let f = &findings.as_slice()[0];
        assert_eq!(f.code.as_str(), "dataset.too_large");
        assert_eq!(
            f.message,
            "This dataset would have about 134,217,729 cells, which is more than the limit of 134,217,728."
        );
        assert_eq!(
            f.hint.as_deref(),
            Some("Use fewer cells, or split the data into several datasets.")
        );
        assert_eq!((f.count, f.step), (1, None));
        assert!(findings.has_errors());
    }

    #[test]
    fn a_count_too_large_to_calculate_also_fails() {
        let (ok, findings) = run(None, "blocks");
        assert!(!ok);
        assert_eq!(
            findings.as_slice()[0].message,
            "This dataset would have far more blocks than the limit of 134,217,728."
        );
        let (ok, _) = run(Some(u64::MAX), "blocks");
        assert!(!ok);
    }

    #[test]
    fn repeated_identical_failures_merge_into_one_finding() {
        let mut findings = Findings::new();
        assert!(!check_size(Some(200_000_000), "vertices", &mut findings));
        assert!(!check_size(Some(200_000_000), "vertices", &mut findings));
        assert!(!check_size(Some(300_000_000), "vertices", &mut findings));
        assert_eq!(findings.len(), 2);
        assert_eq!(findings.as_slice()[0].count, 2);
    }

    #[test]
    fn a_real_lattice_size_estimate_can_be_checked_before_allocating() {
        use crate::lattice::Lattice;
        let big = Lattice {
            origin: [0.0; 3],
            spacing: [1.0; 3],
            dims: [1_000, 1_000, 1_000],
            rotation: 0.0,
        };
        let (ok, findings) = run(big.cell_count(), "cells");
        assert!(!ok);
        assert!(
            findings.as_slice()[0]
                .message
                .contains("1,000,000,000 cells")
        );
        let small = Lattice {
            dims: [100, 100, 100],
            ..big
        };
        assert!(run(small.cell_count(), "cells").0);
    }
}
