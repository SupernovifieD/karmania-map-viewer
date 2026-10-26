//! Checks for the explicit block list of a sparse block model.

use crate::codes::FindingCode;
use crate::dataset::{Dataset, Geometry};
use crate::findings::{Finding, Findings, Location};
use crate::lattice::Lattice;
use crate::limits::MAX_ELEMENTS;
use crate::text::format_count;

/// Checks that a sparse block list holds whole triplets, that every block is
/// inside the lattice, and that no block is listed twice. Dense models have no
/// list and pass.
pub(super) fn check(dataset: &Dataset, findings: &mut Findings) {
    let Geometry::Blocks(blocks) = &dataset.geometry else {
        return;
    };
    let Some(ijk) = &blocks.ijk else {
        return;
    };
    if !ijk.len().is_multiple_of(3) {
        findings.add(
            Finding::new(
                FindingCode::BlocksIjkIncomplete,
                format!(
                    "The list of block positions ends with an incomplete triplet: it has {} numbers, which is not a multiple of 3.",
                    format_count(ijk.len() as u64)
                ),
            )
            .with_hint("Give three numbers (i, j, k) for every block."),
        );
    }
    let triplets = ijk.as_chunks::<3>().0;
    let lattice = &blocks.lattice;
    let [nx, ny, nz] = lattice.dims;
    let mut outside = Finding::new(
        FindingCode::BlocksIjkOutOfRange,
        format!(
            "Some blocks are outside the model, which has {} x {} x {} cells.",
            format_count(u64::from(nx)),
            format_count(u64::from(ny)),
            format_count(u64::from(nz))
        ),
    )
    .with_hint(
        "Block positions start at 0 and must be lower than the number of cells on each axis.",
    );
    outside.count = 0;
    let mut inside: Vec<usize> = Vec::with_capacity(triplets.len());
    for (index, &[i, j, k]) in triplets.iter().enumerate() {
        if i < nx && j < ny && k < nz {
            inside.push(index);
        } else {
            outside.count += 1;
            outside = outside.at(Location::default()
                .with_element(index as u64)
                .with_cell([i, j, k]));
        }
    }
    if outside.count > 0 {
        findings.add(outside);
    }
    let duplicates = duplicate_blocks(triplets, &inside, lattice);
    if !duplicates.is_empty() {
        let mut twice = Finding::new(
            FindingCode::BlocksIjkDuplicate,
            "Some blocks are listed more than once.",
        )
        .with_hint("List each block once.");
        twice.count = duplicates.len() as u64;
        for index in duplicates {
            let cell = triplets.get(index).copied().unwrap_or_default();
            twice = twice.at(Location::default()
                .with_element(index as u64)
                .with_cell(cell));
        }
        findings.add(twice);
    }
}

/// The indices of blocks that repeat an earlier block, in ascending order.
/// `inside` lists the indices of the blocks that are within the lattice.
///
/// When the lattice is small enough, one bit per cell finds repeats in a single
/// pass. A sparse model on a huge lattice falls back to sorting the blocks.
fn duplicate_blocks(triplets: &[[u32; 3]], inside: &[usize], lattice: &Lattice) -> Vec<usize> {
    match lattice.cell_count() {
        Some(cells) if cells <= MAX_ELEMENTS => by_bitmap(triplets, inside, lattice, cells),
        _ => by_sorting(triplets, inside),
    }
}

fn by_bitmap(triplets: &[[u32; 3]], inside: &[usize], lattice: &Lattice, cells: u64) -> Vec<usize> {
    let words = usize::try_from(cells.div_ceil(64)).unwrap_or(0);
    let mut seen = vec![0u64; words];
    let mut repeats = Vec::new();
    for &index in inside {
        let Some(&[i, j, k]) = triplets.get(index) else {
            continue;
        };
        let Some(cell) = lattice.index(i, j, k).and_then(|c| usize::try_from(c).ok()) else {
            continue;
        };
        let Some(word) = seen.get_mut(cell / 64) else {
            continue;
        };
        let bit = 1u64 << (cell % 64);
        if *word & bit != 0 {
            repeats.push(index);
        }
        *word |= bit;
    }
    repeats
}

fn by_sorting(triplets: &[[u32; 3]], inside: &[usize]) -> Vec<usize> {
    let mut order: Vec<usize> = inside.to_vec();
    order.sort_unstable_by_key(|&index| (triplets.get(index).copied(), index));
    let mut repeats = Vec::new();
    for pair in order.windows(2) {
        if let [first, second] = *pair
            && triplets.get(first) == triplets.get(second)
        {
            repeats.push(second);
        }
    }
    repeats.sort_unstable();
    repeats
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{blocks, codes, grid, run};
    use super::*;

    fn found(dims: [u32; 3], ijk: Vec<u32>) -> Findings {
        run(check, &blocks(dims, Some(ijk)))
    }

    #[test]
    fn dense_models_and_other_shapes_have_nothing_to_check() {
        assert!(run(check, &blocks([2, 2, 2], None)).is_empty());
        assert!(run(check, &grid([2, 2, 1])).is_empty());
    }

    #[test]
    fn a_valid_sparse_list_passes() {
        assert!(found([4, 4, 4], vec![0, 0, 0, 3, 3, 3, 1, 2, 3]).is_empty());
        assert!(found([4, 4, 4], vec![]).is_empty());
    }

    #[test]
    fn an_incomplete_last_triplet_is_reported() {
        let f = found([4, 4, 4], vec![0, 0, 0, 1, 1]);
        assert_eq!(codes(&f), ["blocks.ijk.incomplete"]);
        assert_eq!(
            f.as_slice()[0].message,
            "The list of block positions ends with an incomplete triplet: it has 5 numbers, which is not a multiple of 3."
        );
    }

    #[test]
    fn a_block_outside_the_lattice_on_any_axis_is_counted_with_its_cell() {
        let f = found(
            [2, 3, 4],
            vec![2, 0, 0, 0, 3, 0, 0, 0, 4, 1, 2, 3, u32::MAX, 0, 0],
        );
        assert_eq!(codes(&f), ["blocks.ijk.out_of_range"]);
        let one = &f.as_slice()[0];
        assert_eq!(
            one.message,
            "Some blocks are outside the model, which has 2 x 3 x 4 cells."
        );
        assert_eq!(one.count, 4);
        assert_eq!(one.examples[0].element, Some(0));
        assert_eq!(one.examples[0].cell, Some([2, 0, 0]));
        assert_eq!(one.examples[3].cell, Some([u32::MAX, 0, 0]));
    }

    #[test]
    fn repeated_blocks_are_counted_and_the_first_copy_is_not_blamed() {
        let f = found([4, 4, 4], vec![1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1]);
        assert_eq!(codes(&f), ["blocks.ijk.duplicate"]);
        let one = &f.as_slice()[0];
        assert_eq!(one.count, 2);
        let at: Vec<_> = one.examples.iter().map(|l| l.element).collect();
        assert_eq!(at, [Some(2), Some(3)]);
        assert_eq!(one.examples[0].cell, Some([1, 1, 1]));
    }

    #[test]
    fn out_of_range_blocks_are_not_also_called_duplicates() {
        let f = found([2, 2, 2], vec![9, 9, 9, 9, 9, 9]);
        assert_eq!(codes(&f), ["blocks.ijk.out_of_range"]);
    }

    #[test]
    fn a_huge_lattice_finds_the_same_duplicates_by_sorting() {
        let ijk = vec![5, 5, 5, 9, 9, 9, 5, 5, 5, 99_999, 0, 0, 9, 9, 9, 5, 5, 5];
        let big = found([100_000, 100_000, 100_000], ijk.clone());
        let small = found([100, 100, 100], ijk.iter().map(|&v| v.min(99)).collect());
        let counts = |f: &Findings| {
            f.iter()
                .find(|x| x.code.as_str() == "blocks.ijk.duplicate")
                .map(|x| x.count)
        };
        // Big lattice: blocks 2, 4 and 5 repeat earlier ones (sort path).
        assert_eq!(counts(&big), Some(3));
        let at: Vec<_> = big.as_slice()[0]
            .examples
            .iter()
            .map(|l| l.element)
            .collect();
        assert_eq!(at, [Some(2), Some(4), Some(5)]);
        // Same shape on a small lattice (bitmap path) clamps 99_999 to 99; the
        // repeats are the same three.
        assert_eq!(counts(&small), Some(3));
    }

    #[test]
    fn both_duplicate_paths_agree_on_a_pseudo_random_list() {
        let mut ijk = Vec::new();
        let mut state = 12345u32;
        for _ in 0..3000 {
            for _ in 0..3 {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                ijk.push((state >> 16) % 7);
            }
        }
        let triplets = ijk.as_chunks::<3>().0;
        let inside: Vec<usize> = (0..triplets.len()).collect();
        let lattice = crate::lattice::Lattice {
            origin: [0.0; 3],
            spacing: [1.0; 3],
            dims: [7, 7, 7],
            rotation: 0.0,
        };
        let cells = lattice.cell_count().unwrap();
        let a = by_bitmap(triplets, &inside, &lattice, cells);
        let b = by_sorting(triplets, &inside);
        assert_eq!(a, b);
        assert_eq!(a.len(), 3000 - 343);
    }

    #[test]
    fn many_problems_keep_at_most_twenty_examples() {
        let ijk: Vec<u32> = (0..60).flat_map(|_| [1, 1, 1]).collect();
        let f = found([4, 4, 4], ijk);
        let one = &f.as_slice()[0];
        assert_eq!((one.count, one.examples.len()), (59, 20));
    }
}
