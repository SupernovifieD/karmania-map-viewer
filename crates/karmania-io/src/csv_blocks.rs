//! Block models from CSV: finding the lattice the block centres sit on.
//!
//! A block-model CSV lists the centre of each block and the block size. The
//! lattice that holds them starts half a block before the lowest centre on each
//! axis (its origin is the outer corner of cell `(0, 0, 0)`), has no rotation, and
//! is as many cells long as it takes to reach the highest centre.

use karmania_core::{Finding, FindingCode, Findings, Lattice};

use karmania_core::text::format_count;

/// Builds the lattice for block centres that span `min..=max` on each axis, for
/// blocks of the given `size`.
///
/// The number of cells along an axis is the span divided by the block size,
/// rounded to the nearest whole number, plus one. Whether every centre really
/// sits on the lattice is checked separately, row by row.
///
/// Returns `None` if the size is not positive and finite or the extent is not
/// finite (the mapping and the coordinate checks catch those first). If a span
/// would need more cells than fit along one axis (usually a wrong block size or
/// wrong units), adds a `csv.blocks.lattice_too_large` error and returns `None`.
pub fn lattice_from_centres(
    min: [f64; 3],
    max: [f64; 3],
    size: [f64; 3],
    findings: &mut Findings,
) -> Option<Lattice> {
    let mut counts = [0u64; 3];
    for axis in 0..3 {
        let (lo, hi, step) = (min[axis], max[axis], size[axis]);
        if !(step.is_finite() && step > 0.0 && lo.is_finite() && hi.is_finite() && hi >= lo) {
            return None;
        }
        // `as` saturates, so a huge span becomes u64::MAX instead of wrapping.
        counts[axis] = (((hi - lo) / step).round() as u64).saturating_add(1);
    }
    let mut dims = [0u32; 3];
    for (dim, &count) in dims.iter_mut().zip(&counts) {
        let Ok(fits) = u32::try_from(count) else {
            findings.add(
                Finding::new(
                    FindingCode::CsvBlocksLatticeTooLarge,
                    format!(
                        "The block centres span {} x {} x {} blocks, more than a block model can hold along one axis.",
                        format_count(counts[0]),
                        format_count(counts[1]),
                        format_count(counts[2]),
                    ),
                )
                .with_hint("Check the block size and the units of the coordinates."),
            );
            return None;
        };
        *dim = fits;
    }
    Some(Lattice {
        origin: [
            min[0] - size[0] / 2.0,
            min[1] - size[1] / 2.0,
            min[2] - size[2] / 2.0,
        ],
        spacing: size,
        dims,
        rotation: 0.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(min: [f64; 3], max: [f64; 3], size: [f64; 3]) -> (Option<Lattice>, Findings) {
        let mut findings = Findings::new();
        (
            lattice_from_centres(min, max, size, &mut findings),
            findings,
        )
    }

    #[test]
    fn the_sample_blocks_make_a_three_by_three_by_two_lattice() {
        let (lattice, findings) = build(
            [500_005.0, 2_765_005.0, 95.0],
            [500_025.0, 2_765_025.0, 105.0],
            [10.0, 10.0, 10.0],
        );
        assert!(findings.is_empty());
        let lattice = lattice.unwrap();
        assert_eq!(lattice.origin, [500_000.0, 2_765_000.0, 90.0]);
        assert_eq!(
            (lattice.dims, lattice.spacing, lattice.rotation),
            ([3, 3, 2], [10.0; 3], 0.0)
        );
        // The lowest and highest centres are the centres of the first and last cells.
        assert_eq!(
            lattice.cell_centre(0, 0, 0),
            Some([500_005.0, 2_765_005.0, 95.0])
        );
        assert_eq!(
            lattice.cell_centre(2, 2, 1),
            Some([500_025.0, 2_765_025.0, 105.0])
        );
    }

    #[test]
    fn a_single_block_is_a_one_cell_lattice() {
        let (lattice, _) = build([5.0, 5.0, 5.0], [5.0, 5.0, 5.0], [10.0, 10.0, 10.0]);
        let lattice = lattice.unwrap();
        assert_eq!((lattice.dims, lattice.origin), ([1, 1, 1], [0.0, 0.0, 0.0]));
    }

    #[test]
    fn blocks_can_differ_in_size_per_axis_and_have_negative_or_fractional_coordinates() {
        let (lattice, _) = build([-12.5, -7.0, 0.25], [12.5, 3.0, 4.25], [5.0, 2.0, 0.5]);
        let lattice = lattice.unwrap();
        assert_eq!(lattice.dims, [6, 6, 9]);
        assert_eq!(lattice.origin, [-15.0, -8.0, 0.0]);
    }

    #[test]
    fn a_span_that_is_not_a_whole_number_of_blocks_rounds_to_the_nearest() {
        // 1.4 blocks rounds to 1 (2 cells); 1.5 rounds to 2 (3 cells).
        assert_eq!(
            build([0.0; 3], [14.0, 15.0, 0.0], [10.0; 3])
                .0
                .unwrap()
                .dims,
            [2, 3, 1]
        );
    }

    #[test]
    fn a_span_too_big_for_one_axis_is_an_error_with_the_numbers() {
        let (lattice, findings) = build([0.0; 3], [1e12, 0.0, 0.0], [1.0; 3]);
        assert!(lattice.is_none());
        let f = &findings.as_slice()[0];
        assert_eq!(f.code.as_str(), "csv.blocks.lattice_too_large");
        assert_eq!(
            f.message,
            "The block centres span 1,000,000,000,001 x 1 x 1 blocks, more than a block model can hold along one axis."
        );
        assert!(findings.has_errors());
        // The largest axis that still fits is fine.
        let max_cells = f64::from(u32::MAX) - 1.0;
        assert!(build([0.0; 3], [max_cells, 0.0, 0.0], [1.0; 3]).0.is_some());
        assert!(
            build([0.0; 3], [f64::from(u32::MAX), 0.0, 0.0], [1.0; 3])
                .0
                .is_none()
        );
    }

    #[test]
    fn absurd_spans_do_not_overflow() {
        let (lattice, findings) = build([-1e300; 3], [1e300; 3], [1e-300; 3]);
        assert!(lattice.is_none() && findings.has_errors());
        assert!(
            findings.as_slice()[0]
                .message
                .contains("18,446,744,073,709,551,615")
        );
    }

    #[test]
    fn unusable_inputs_give_none_without_a_finding() {
        let cases = [
            ([0.0; 3], [1.0; 3], [0.0, 1.0, 1.0]),
            ([0.0; 3], [1.0; 3], [-1.0, 1.0, 1.0]),
            ([0.0; 3], [1.0; 3], [f64::NAN, 1.0, 1.0]),
            ([0.0; 3], [f64::INFINITY, 1.0, 1.0], [1.0; 3]),
            ([f64::NAN, 0.0, 0.0], [1.0; 3], [1.0; 3]),
            ([5.0, 0.0, 0.0], [1.0, 1.0, 1.0], [1.0; 3]),
        ];
        for (min, max, size) in cases {
            let (lattice, findings) = build(min, max, size);
            assert!(
                lattice.is_none() && findings.is_empty(),
                "{min:?} {max:?} {size:?}"
            );
        }
    }
}
