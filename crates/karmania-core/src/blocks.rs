//! Block model geometry: blocks on a lattice, dense or sparse.

use crate::lattice::Lattice;
use crate::limits::MAX_ELEMENTS;

/// A block model.
///
/// When `ijk` is `None` the model is dense: there is one block per lattice cell,
/// in lattice order (`i` fastest). When `ijk` is present the model is sparse:
/// it is a flat list of `i, j, k` triplets, one block per triplet, in the order
/// given. Triplets are kept as given, even if out of range, duplicated or
/// incomplete; validation (step 2.9) reports those. The block values live in the
/// dataset's attribute table, one row per block.
#[derive(Debug, Clone, PartialEq)]
pub struct Blocks {
    /// The block index space.
    pub lattice: Lattice,
    /// `None` for a dense model, otherwise sparse `i, j, k` triplets.
    pub ijk: Option<Vec<u32>>,
}

impl Blocks {
    /// True when there is one block per lattice cell.
    #[must_use]
    pub fn is_dense(&self) -> bool {
        self.ijk.is_none()
    }

    /// The number of blocks: all lattice cells when dense, otherwise the number
    /// of complete triplets. `None` if a dense count does not fit in a `u64`.
    #[must_use]
    pub fn block_count(&self) -> Option<u64> {
        match &self.ijk {
            None => self.lattice.cell_count(),
            Some(ijk) => u64::try_from(ijk.len() / 3).ok(),
        }
    }

    /// True when a sparse list ends with an incomplete triplet.
    #[must_use]
    pub fn has_partial_triplet(&self) -> bool {
        self.ijk.as_ref().is_some_and(|ijk| ijk.len() % 3 != 0)
    }

    /// The lattice cell `[i, j, k]` of block `index`, or `None` if there is no
    /// such block. For a sparse model the stored triplet is returned as given,
    /// even if it lies outside the lattice.
    #[must_use]
    pub fn block_ijk(&self, index: usize) -> Option<[u32; 3]> {
        match &self.ijk {
            None => self.lattice.ijk(u64::try_from(index).ok()?),
            Some(ijk) => ijk.as_chunks::<3>().0.get(index).copied(),
        }
    }
}

/// The indices of blocks that repeat an earlier block, in ascending order.
/// `inside` lists the indices of the blocks that are within the lattice; the
/// others are ignored.
///
/// When the lattice is small enough, one bit per cell finds repeats in a single
/// pass. A sparse model on a huge lattice falls back to sorting the blocks.
#[must_use]
pub fn repeated_blocks(triplets: &[[u32; 3]], inside: &[usize], lattice: &Lattice) -> Vec<usize> {
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
    use super::*;

    fn blocks(dims: [u32; 3], ijk: Option<Vec<u32>>) -> Blocks {
        let lattice = Lattice {
            origin: [0.0; 3],
            spacing: [5.0; 3],
            dims,
            rotation: 0.0,
        };
        Blocks { lattice, ijk }
    }

    #[test]
    fn a_dense_model_has_one_block_per_cell_in_lattice_order() {
        let b = blocks([2, 3, 4], None);
        assert_eq!(
            (b.is_dense(), b.block_count(), b.has_partial_triplet()),
            (true, Some(24), false)
        );
        assert_eq!(b.block_ijk(0), Some([0, 0, 0]));
        assert_eq!(b.block_ijk(1), Some([1, 0, 0]));
        assert_eq!(b.block_ijk(2), Some([0, 1, 0]));
        assert_eq!(b.block_ijk(23), Some([1, 2, 3]));
        assert_eq!(b.block_ijk(24), None);
    }

    #[test]
    fn a_sparse_model_has_one_block_per_triplet_in_the_order_given() {
        let b = blocks([10, 10, 10], Some(vec![5, 5, 5, 0, 1, 2]));
        assert_eq!((b.is_dense(), b.block_count()), (false, Some(2)));
        assert_eq!(b.block_ijk(0), Some([5, 5, 5]));
        assert_eq!(b.block_ijk(1), Some([0, 1, 2]));
        assert_eq!(b.block_ijk(2), None);
    }

    #[test]
    fn sparse_triplets_are_kept_as_given_even_when_invalid() {
        let outside = blocks([2, 2, 2], Some(vec![9, 9, 9, 9, 9, 9]));
        assert_eq!(outside.block_ijk(0), Some([9, 9, 9]));
        assert_eq!(outside.block_ijk(1), Some([9, 9, 9]));
    }

    #[test]
    fn an_incomplete_trailing_triplet_is_flagged_but_not_counted() {
        let b = blocks([4, 4, 4], Some(vec![1, 2, 3, 4, 5]));
        assert_eq!((b.block_count(), b.has_partial_triplet()), (Some(1), true));
        assert_eq!(b.block_ijk(1), None);
    }

    #[test]
    fn empty_and_huge_models_do_not_panic() {
        let empty = blocks([4, 4, 4], Some(vec![]));
        assert_eq!((empty.block_count(), empty.block_ijk(0)), (Some(0), None));
        let huge = blocks([u32::MAX, u32::MAX, 2], None);
        assert_eq!((huge.block_count(), huge.block_ijk(0)), (None, None));
        assert_eq!(blocks([2, 2, 2], None).block_ijk(usize::MAX), None);
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
        let lattice = Lattice {
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
    fn only_the_blocks_listed_as_inside_can_repeat() {
        let lattice = blocks([4, 4, 4], None).lattice;
        let triplets = [[1, 1, 1], [1, 1, 1], [9, 9, 9], [9, 9, 9], [1, 1, 1]];
        assert_eq!(repeated_blocks(&triplets, &[0, 1, 4], &lattice), [1, 4]);
        assert_eq!(repeated_blocks(&triplets, &[1, 4], &lattice), [4]);
        assert!(repeated_blocks(&triplets, &[], &lattice).is_empty());
        // An index past the end of the list is ignored on both paths.
        assert!(repeated_blocks(&triplets, &[17], &lattice).is_empty());
    }
}
