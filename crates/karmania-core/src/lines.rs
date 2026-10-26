//! Line geometry: polylines stored as one vertex list plus offsets.

use std::ops::Range;

use crate::offsets;
use crate::positions::Positions;

/// A set of polylines.
///
/// All vertices are in one [`Positions`] list. `offsets` has one more entry
/// than there are lines: line `i` uses vertices `offsets[i]..offsets[i + 1]`.
/// A valid `offsets` starts at 0, ends at the vertex count and never decreases;
/// that is checked by validation, so accessors here return `None` instead of
/// trusting it.
#[derive(Debug, Clone, PartialEq)]
pub struct Lines {
    /// Every vertex of every line, in line order.
    pub positions: Positions,
    /// Where each line starts, plus the end: `line_count + 1` entries.
    pub offsets: Vec<u32>,
}

impl Lines {
    /// Number of lines, or `None` if `offsets` is empty (so malformed).
    #[must_use]
    pub fn line_count(&self) -> Option<usize> {
        self.offsets.len().checked_sub(1)
    }

    /// Total number of vertices.
    #[must_use]
    pub fn vertex_count(&self) -> usize {
        self.positions.len()
    }

    /// The vertex range of line `index`, or `None` if the line does not exist
    /// or its offsets are out of order or past the last vertex.
    #[must_use]
    pub fn vertex_range(&self, index: usize) -> Option<Range<usize>> {
        offsets::range(&self.offsets, index, self.vertex_count())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::findings::Findings;

    fn lines(vertices: usize, offsets: &[u32]) -> Lines {
        let coords: Vec<f64> = (0..vertices).map(|i| i as f64).collect();
        let positions = Positions::from_xyz(&coords, &coords, None, &mut Findings::new()).unwrap();
        Lines {
            positions,
            offsets: offsets.to_vec(),
        }
    }

    #[test]
    fn offsets_give_each_lines_vertex_range() {
        let l = lines(5, &[0, 2, 5]);
        assert_eq!((l.line_count(), l.vertex_count()), (Some(2), 5));
        assert_eq!(l.vertex_range(0), Some(0..2));
        assert_eq!(l.vertex_range(1), Some(2..5));
        assert_eq!(l.vertex_range(2), None);
    }

    #[test]
    fn no_lines_is_a_single_zero_offset() {
        let l = lines(0, &[0]);
        assert_eq!((l.line_count(), l.vertex_range(0)), (Some(0), None));
    }

    #[test]
    fn malformed_offsets_return_none_instead_of_panicking() {
        assert_eq!(lines(3, &[]).line_count(), None);
        let decreasing = lines(5, &[0, 4, 2]);
        assert_eq!(decreasing.vertex_range(1), None);
        let past_end = lines(3, &[0, 9]);
        assert_eq!(past_end.vertex_range(0), None);
        let huge = lines(3, &[0, u32::MAX]);
        assert_eq!(huge.vertex_range(0), None);
    }

    #[test]
    fn an_index_near_usize_max_does_not_overflow() {
        let l = lines(1, &[0, 1]);
        assert_eq!(l.vertex_range(usize::MAX), None);
    }
}
