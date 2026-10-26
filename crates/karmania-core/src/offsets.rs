//! Reading ranges out of an offsets list without trusting it.

use std::ops::Range;

/// The range `offsets[index]..offsets[index + 1]`, or `None` if either entry is
/// missing, the pair is out of order, or the end is past `limit`.
///
/// Offsets come from user data and are only checked by validation, so this never
/// indexes directly and never overflows.
pub(crate) fn range(offsets: &[u32], index: usize, limit: usize) -> Option<Range<usize>> {
    let start = usize::try_from(*offsets.get(index)?).ok()?;
    let end = usize::try_from(*offsets.get(index.checked_add(1)?)?).ok()?;
    (start <= end && end <= limit).then_some(start..end)
}

#[cfg(test)]
mod tests {
    use super::range;

    #[test]
    fn consecutive_offsets_make_a_range() {
        assert_eq!(range(&[0, 2, 5], 0, 5), Some(0..2));
        assert_eq!(range(&[0, 2, 5], 1, 5), Some(2..5));
        assert_eq!(range(&[3, 3], 0, 9), Some(3..3));
    }

    #[test]
    fn anything_malformed_is_none() {
        assert_eq!(range(&[0, 2, 5], 2, 5), None);
        assert_eq!(range(&[], 0, 5), None);
        assert_eq!(range(&[4, 2], 0, 5), None);
        assert_eq!(range(&[0, 9], 0, 5), None);
        assert_eq!(range(&[0, u32::MAX], 0, 5), None);
        assert_eq!(range(&[0, 1], usize::MAX, 5), None);
    }
}
