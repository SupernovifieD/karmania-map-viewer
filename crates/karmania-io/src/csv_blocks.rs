//! Block models from CSV: finding the lattice the block centres sit on, and
//! which cell each block is in.
//!
//! A block-model CSV lists the centre of each block and the block size. The
//! lattice that holds them starts half a block before the lowest centre on each
//! axis (its origin is the outer corner of cell `(0, 0, 0)`), has no rotation, and
//! is as many cells long as it takes to reach the highest centre.

use karmania_core::blocks::repeated_blocks;
use karmania_core::text::format_count;
use karmania_core::{Finding, FindingCode, Findings, Lattice, Location};

/// How far from a lattice position a centre may be and still count as on it, as
/// a fraction of the block size. Absorbs the rounding in exported coordinates.
const TOLERANCE: f64 = 0.01;

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

/// Where the blocks of a file go: the lattice, and dense or sparse storage.
#[derive(Debug, Clone, PartialEq)]
pub struct Placement {
    /// The lattice the blocks sit on.
    pub lattice: Lattice,
    /// `None` for a dense model. Otherwise the `i, j, k` triplets of the blocks in
    /// file order.
    pub ijk: Option<Vec<u32>>,
    /// For a dense model, the rows in lattice order: block `n` of the model is row
    /// `order[n]` of the file. `None` when the rows are already in that order,
    /// and always `None` for a sparse model, which keeps the file order.
    pub order: Option<Vec<usize>>,
}

/// Puts the blocks of a file on a lattice.
///
/// `centres` are the block centres (x, y and z of every row) and `lines` the file
/// line of each row, for the findings. Every centre must be within 1% of a block
/// of a lattice position, no two rows may be the same block, and there must be at
/// least one row; otherwise errors are added and `None` is returned. A model with
/// a block for every cell is dense and its rows are reordered to lattice order
/// (`i` fastest); anything else is sparse and lists each block's cell.
///
/// The block size must be positive and finite and the centres finite (the mapping
/// check and the number parser guarantee both); other input gives `None`.
pub fn place_blocks(
    centres: [&[f64]; 3],
    lines: &[u64],
    size: [f64; 3],
    findings: &mut Findings,
) -> Option<Placement> {
    let rows = lines.len();
    if centres.iter().any(|axis| axis.len() != rows) {
        return None;
    }
    if rows == 0 {
        findings.add(
            Finding::new(
                FindingCode::CsvBlocksNone,
                "There are no rows to build a block model from.",
            )
            .with_hint("Check that the file has blocks in it and that no rows were left out."),
        );
        return None;
    }
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for (axis, values) in centres.iter().enumerate() {
        for &v in *values {
            min[axis] = min[axis].min(v);
            max[axis] = max[axis].max(v);
        }
    }
    let lattice = lattice_from_centres(min, max, size, findings)?;

    let mut off_lattice = Finding::new(
        FindingCode::CsvBlocksOffLattice,
        "Some blocks are not on the same grid as the others: their centres are not a whole number of block sizes away from the first block.",
    )
    .with_hint("Check the block size, and that the coordinate columns hold block centres, not corners.");
    off_lattice.count = 0;
    let mut triplets: Vec<[u32; 3]> = Vec::with_capacity(rows);
    let mut inside: Vec<usize> = Vec::with_capacity(rows);
    for (row, &line) in lines.iter().enumerate() {
        let mut cell = [0u32; 3];
        let mut on_lattice = true;
        for axis in 0..3 {
            let steps = (centres[axis][row] - min[axis]) / size[axis];
            let nearest = steps.round();
            if (steps - nearest).abs() > TOLERANCE {
                on_lattice = false;
                break;
            }
            // The nearest step is between 0 and the last cell, so this fits.
            cell[axis] = nearest as u32;
        }
        if on_lattice {
            inside.push(row);
        } else {
            off_lattice.count += 1;
            off_lattice.add_example(Location::default().with_line(line));
        }
        triplets.push(cell);
    }
    let mut failed = off_lattice.count > 0;
    if failed {
        findings.add(off_lattice);
    }

    let repeats = repeated_blocks(&triplets, &inside, &lattice);
    if !repeats.is_empty() {
        failed = true;
        let mut twice = Finding::new(
            FindingCode::CsvBlocksDuplicate,
            "Some blocks are listed more than once: several rows have the same centre.",
        )
        .with_hint("List each block once.");
        twice.count = repeats.len() as u64;
        for row in repeats {
            let cell = triplets.get(row).copied().unwrap_or_default();
            let line = lines.get(row).copied().unwrap_or_default();
            twice.add_example(Location::default().with_line(line).with_cell(cell));
        }
        findings.add(twice);
    }
    if failed {
        return None;
    }

    // With every block inside the lattice and none repeated, a block for every
    // cell means the rows are a permutation of the cells.
    if lattice.cell_count() == u64::try_from(rows).ok() {
        let mut order = vec![0usize; rows];
        for (row, &[i, j, k]) in triplets.iter().enumerate() {
            let slot = lattice
                .index(i, j, k)
                .and_then(|cell| usize::try_from(cell).ok())
                .and_then(|cell| order.get_mut(cell));
            if let Some(slot) = slot {
                *slot = row;
            }
        }
        let in_order = order.iter().enumerate().all(|(n, &row)| n == row);
        return Some(Placement {
            lattice,
            ijk: None,
            order: (!in_order).then_some(order),
        });
    }
    Some(Placement {
        lattice,
        ijk: Some(triplets.into_iter().flatten().collect()),
        order: None,
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

    /// Places centres whose rows are on lines 2, 3, ... (line 1 is the header).
    fn place(centres: &[[f64; 3]], size: [f64; 3]) -> (Option<Placement>, Findings) {
        let axis = |n: usize| centres.iter().map(|c| c[n]).collect::<Vec<f64>>();
        let (x, y, z) = (axis(0), axis(1), axis(2));
        let lines: Vec<u64> = (2..).take(centres.len()).collect();
        let mut findings = Findings::new();
        let placed = place_blocks([&x, &y, &z], &lines, size, &mut findings);
        (placed, findings)
    }

    fn codes(findings: &Findings) -> Vec<&'static str> {
        findings.iter().map(|f| f.code.as_str()).collect()
    }

    /// Centres of a 3 x 2 x 2 model of 10 m blocks with its corner at the origin,
    /// `i` fastest.
    fn full_model() -> Vec<[f64; 3]> {
        let mut centres = Vec::new();
        for k in 0..2 {
            for j in 0..2 {
                for i in 0..3 {
                    centres.push([
                        f64::from(i) * 10.0 + 5.0,
                        f64::from(j) * 10.0 + 5.0,
                        f64::from(k) * 10.0 + 5.0,
                    ]);
                }
            }
        }
        centres
    }

    #[test]
    fn a_block_for_every_cell_in_lattice_order_is_dense_and_needs_no_reordering() {
        let (placed, findings) = place(&full_model(), [10.0; 3]);
        assert!(findings.is_empty());
        let placed = placed.unwrap();
        assert_eq!(placed.lattice.dims, [3, 2, 2]);
        assert_eq!((placed.ijk, placed.order), (None, None));
    }

    #[test]
    fn dense_rows_in_any_other_order_come_with_the_order_that_fixes_them() {
        let mut centres = full_model();
        centres.reverse();
        let placed = place(&centres, [10.0; 3]).0.unwrap();
        assert_eq!(placed.ijk, None);
        let expected: Vec<usize> = (0..12).rev().collect();
        assert_eq!(placed.order, Some(expected));
    }

    #[test]
    fn a_shuffled_dense_model_puts_every_row_in_its_cell() {
        let mut centres = full_model();
        // A fixed pseudo-random shuffle.
        let mut state = 7u32;
        for n in (1..centres.len()).rev() {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            centres.swap(n, (state >> 16) as usize % (n + 1));
        }
        let placed = place(&centres, [10.0; 3]).0.unwrap();
        let order = placed.order.unwrap();
        assert_eq!(order.len(), 12);
        for (n, &row) in order.iter().enumerate() {
            let [i, j, k] = placed.lattice.ijk(n as u64).unwrap();
            assert_eq!(placed.lattice.cell_centre(i, j, k), Some(centres[row]));
        }
    }

    #[test]
    fn fewer_blocks_than_cells_is_sparse_and_keeps_the_file_order() {
        let centres = [[25.0, 5.0, 5.0], [5.0, 5.0, 5.0], [5.0, 25.0, 15.0]];
        let (placed, findings) = place(&centres, [10.0; 3]);
        assert!(findings.is_empty());
        let placed = placed.unwrap();
        assert_eq!(placed.lattice.dims, [3, 3, 2]);
        assert_eq!(placed.ijk, Some(vec![2, 0, 0, 0, 0, 0, 0, 2, 1]));
        assert_eq!(placed.order, None);
    }

    #[test]
    fn a_single_block_is_a_dense_one_cell_model() {
        let placed = place(&[[3.0, 4.0, 5.0]], [2.0, 2.0, 2.0]).0.unwrap();
        assert_eq!(placed.lattice.dims, [1, 1, 1]);
        assert_eq!((placed.ijk, placed.order), (None, None));
    }

    #[test]
    fn centres_with_rounding_noise_are_still_on_the_lattice() {
        let centres = [
            [500_005.000_000_1, 2_765_004.999_999_9, 95.0],
            [500_015.004, 2_765_005.0, 95.0],
            [500_025.0, 2_765_025.0, 95.049],
        ];
        let (placed, findings) = place(&centres, [10.0; 3]);
        assert!(findings.is_empty());
        assert_eq!(placed.unwrap().ijk, Some(vec![0, 0, 0, 1, 0, 0, 2, 2, 0]));
    }

    #[test]
    fn blocks_can_differ_in_size_per_axis_and_sit_at_negative_coordinates() {
        let centres = [[-1.25, -9.0, 0.0], [1.25, -5.0, 10.0]];
        let placed = place(&centres, [0.5, 2.0, 5.0]).0.unwrap();
        assert_eq!(placed.lattice.dims, [6, 3, 3]);
        assert_eq!(placed.ijk, Some(vec![0, 0, 0, 5, 2, 2]));
    }

    #[test]
    fn centres_that_are_not_on_the_grid_are_an_error_with_their_lines() {
        let centres = [
            [5.0, 5.0, 5.0],
            [15.05, 5.0, 5.0], // 0.5% of a block off: fine
            [22.0, 5.0, 5.0],  // line 4
            [15.2, 5.0, 5.0],  // line 5: 2% off
            [5.0, 5.0, 8.0],   // line 6: off on z
        ];
        let (placed, findings) = place(&centres, [10.0; 3]);
        assert!(placed.is_none());
        assert_eq!(codes(&findings), ["csv.blocks.off_lattice"]);
        let f = &findings.as_slice()[0];
        assert_eq!(f.count, 3);
        let lines: Vec<_> = f.examples.iter().map(|l| l.line).collect();
        assert_eq!(lines, [Some(4), Some(5), Some(6)]);
        assert!(f.hint.is_some());
    }

    #[test]
    fn repeated_blocks_are_an_error_that_blames_the_later_rows() {
        let centres = [
            [5.0, 5.0, 5.0],
            [15.0, 5.0, 5.0],
            [5.0, 5.0, 5.0],
            [15.0, 5.0, 5.0],
            [5.0, 5.0, 5.0],
        ];
        let (placed, findings) = place(&centres, [10.0; 3]);
        assert!(placed.is_none());
        assert_eq!(codes(&findings), ["csv.blocks.duplicate"]);
        let f = &findings.as_slice()[0];
        assert_eq!(f.count, 3);
        let at: Vec<_> = f.examples.iter().map(|l| (l.line, l.cell)).collect();
        assert_eq!(
            at,
            [
                (Some(4), Some([0, 0, 0])),
                (Some(5), Some([1, 0, 0])),
                (Some(6), Some([0, 0, 0]))
            ]
        );
    }

    #[test]
    fn a_repeat_that_makes_the_count_equal_the_cells_is_not_mistaken_for_dense() {
        // Three rows, three cells, but the middle cell has no block.
        let centres = [[5.0, 5.0, 5.0], [25.0, 5.0, 5.0], [5.0, 5.0, 5.0]];
        let (placed, findings) = place(&centres, [10.0; 3]);
        assert!(placed.is_none());
        assert_eq!(codes(&findings), ["csv.blocks.duplicate"]);
    }

    #[test]
    fn off_lattice_and_repeated_blocks_are_both_reported_and_not_confused() {
        let centres = [
            [5.0, 5.0, 5.0],
            [15.0, 5.0, 5.0],
            [5.0, 5.0, 5.0], // repeat, line 4
            [7.0, 5.0, 5.0], // off the grid, line 5
        ];
        let (placed, findings) = place(&centres, [10.0; 3]);
        assert!(placed.is_none());
        assert_eq!(
            codes(&findings),
            ["csv.blocks.off_lattice", "csv.blocks.duplicate"]
        );
        assert_eq!(findings.as_slice()[0].count, 1);
        assert_eq!(findings.as_slice()[1].count, 1);
    }

    #[test]
    fn no_rows_is_an_error() {
        let (placed, findings) = place(&[], [10.0; 3]);
        assert!(placed.is_none());
        assert_eq!(codes(&findings), ["csv.blocks.none"]);
        assert!(findings.has_errors());
    }

    #[test]
    fn a_lattice_that_is_too_large_is_reported_once_and_nothing_else() {
        let centres = [[0.0; 3], [1e12, 0.0, 0.0]];
        let (placed, findings) = place(&centres, [1.0; 3]);
        assert!(placed.is_none());
        assert_eq!(codes(&findings), ["csv.blocks.lattice_too_large"]);
    }

    #[test]
    fn errors_already_held_by_the_caller_do_not_stop_a_good_placement() {
        let mut findings = Findings::new();
        findings.add(Finding::new(FindingCode::FileEmpty, "Earlier error."));
        let (x, y, z) = ([5.0], [5.0], [5.0]);
        let placed = place_blocks([&x, &y, &z], &[2], [10.0; 3], &mut findings);
        assert!(placed.is_some());
    }

    #[test]
    fn mismatched_input_lengths_give_nothing_and_no_finding() {
        let mut findings = Findings::new();
        let placed = place_blocks([&[1.0], &[], &[]], &[2], [1.0; 3], &mut findings);
        assert!(placed.is_none() && findings.is_empty());
    }
}
