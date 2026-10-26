//! The validity bitmap: which values of a column are real and which are null.
//!
//! Null is a real null, not a sentinel such as -9999 or NaN. A column's data
//! slot at a null position holds an arbitrary placeholder that must be ignored.

const WORD_BITS: usize = u64::BITS as usize;

/// One bit per value: set means the value is valid, clear means it is null.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Validity {
    words: Vec<u64>,
    len: usize,
    null_count: usize,
}

impl Validity {
    /// A bitmap of `len` values that are all valid.
    #[must_use]
    pub fn all_valid(len: usize) -> Self {
        Self::from_flags((0..len).map(|_| true))
    }

    /// Builds a bitmap from one flag per value: `true` means valid, `false`
    /// means null.
    pub fn from_flags(flags: impl IntoIterator<Item = bool>) -> Self {
        let mut words: Vec<u64> = Vec::new();
        let mut len = 0usize;
        let mut null_count = 0usize;
        for valid in flags {
            let bit = len % WORD_BITS;
            if bit == 0 {
                words.push(0);
            }
            if valid {
                if let Some(word) = words.last_mut() {
                    *word |= 1u64 << bit;
                }
            } else {
                null_count += 1;
            }
            len += 1;
        }
        Self {
            words,
            len,
            null_count,
        }
    }

    /// Number of values, valid or null.
    #[must_use]
    pub fn len(&self) -> usize {
        self.len
    }

    /// True when there are no values.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Number of null values.
    #[must_use]
    pub fn null_count(&self) -> usize {
        self.null_count
    }

    /// Whether the value at `index` is valid (not null). `None` when `index` is
    /// out of range.
    #[must_use]
    pub fn is_valid(&self, index: usize) -> Option<bool> {
        if index >= self.len {
            return None;
        }
        let word = self.words.get(index / WORD_BITS)?;
        Some(word >> (index % WORD_BITS) & 1 == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_valid_has_no_nulls() {
        let v = Validity::all_valid(130);
        assert_eq!((v.len(), v.null_count(), v.is_empty()), (130, 0, false));
        assert!((0..130).all(|i| v.is_valid(i) == Some(true)));
    }

    #[test]
    fn empty_bitmap_is_valid_and_has_no_values() {
        let v = Validity::all_valid(0);
        assert_eq!((v.len(), v.null_count(), v.is_empty()), (0, 0, true));
        assert_eq!(v.is_valid(0), None);
    }

    #[test]
    fn flags_are_kept_in_order_across_word_boundaries() {
        // Nulls at the first bit, around the 64-bit boundary, and at the end.
        let nulls = [0usize, 63, 64, 65, 127, 128, 199];
        let v = Validity::from_flags((0..200).map(|i| !nulls.contains(&i)));
        assert_eq!((v.len(), v.null_count()), (200, nulls.len()));
        for i in 0..200 {
            assert_eq!(v.is_valid(i), Some(!nulls.contains(&i)), "index {i}");
        }
    }

    #[test]
    fn out_of_range_is_none_even_inside_the_last_word() {
        let v = Validity::from_flags([true, false, true]);
        assert_eq!(v.is_valid(2), Some(true));
        assert_eq!(v.is_valid(3), None);
        assert_eq!(v.is_valid(63), None);
        assert_eq!(v.is_valid(usize::MAX), None);
    }

    #[test]
    fn all_null_bitmap_counts_every_value() {
        let v = Validity::from_flags((0..70).map(|_| false));
        assert_eq!((v.len(), v.null_count()), (70, 70));
        assert!((0..70).all(|i| v.is_valid(i) == Some(false)));
    }

    #[test]
    fn equal_flags_make_equal_bitmaps() {
        let a = Validity::from_flags([true, false, true, true]);
        let b = Validity::from_flags(vec![true, false, true, true]);
        assert_eq!(a, b);
        assert_ne!(a, Validity::from_flags([true, true, true, true]));
    }
}
