//! Block model geometry: blocks on a lattice, dense or sparse.

use crate::lattice::Lattice;

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
}
