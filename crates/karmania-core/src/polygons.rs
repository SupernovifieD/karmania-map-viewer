//! Polygon geometry: polygons made of rings made of vertices.

use std::ops::Range;

use crate::offsets;
use crate::positions::Positions;

/// A set of polygons, each with an exterior ring and optional holes.
///
/// All vertices are in one [`Positions`] list. Rings are stored open: the
/// closing vertex that repeats the first one is not stored. `ring_offsets` has
/// one more entry than there are rings (ring `r` uses vertices
/// `ring_offsets[r]..ring_offsets[r + 1]`). `polygon_offsets` has one more entry
/// than there are polygons (polygon `p` uses rings `polygon_offsets[p]..
/// polygon_offsets[p + 1]`). The first ring of each polygon is its exterior and
/// the rest are holes. Ring orientation is not enforced. Offsets are only
/// checked by validation, so accessors return `None` rather than trusting them.
#[derive(Debug, Clone, PartialEq)]
pub struct Polygons {
    /// Every vertex of every ring, in ring order.
    pub positions: Positions,
    /// Where each ring starts in `positions`, plus the end.
    pub ring_offsets: Vec<u32>,
    /// Where each polygon starts in the ring list, plus the end.
    pub polygon_offsets: Vec<u32>,
}

impl Polygons {
    /// Number of polygons, or `None` if `polygon_offsets` is empty.
    #[must_use]
    pub fn polygon_count(&self) -> Option<usize> {
        self.polygon_offsets.len().checked_sub(1)
    }

    /// Number of rings, or `None` if `ring_offsets` is empty.
    #[must_use]
    pub fn ring_count(&self) -> Option<usize> {
        self.ring_offsets.len().checked_sub(1)
    }

    /// Total number of vertices.
    #[must_use]
    pub fn vertex_count(&self) -> usize {
        self.positions.len()
    }

    /// The ring indices of polygon `index` (exterior first), or `None` if the
    /// polygon does not exist or its offsets are malformed.
    #[must_use]
    pub fn ring_range(&self, index: usize) -> Option<Range<usize>> {
        offsets::range(&self.polygon_offsets, index, self.ring_count()?)
    }

    /// The vertex indices of ring `index`, or `None` if the ring does not exist
    /// or its offsets are malformed.
    #[must_use]
    pub fn vertex_range(&self, index: usize) -> Option<Range<usize>> {
        offsets::range(&self.ring_offsets, index, self.vertex_count())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::findings::Findings;

    fn polygons(vertices: usize, ring_offsets: &[u32], polygon_offsets: &[u32]) -> Polygons {
        let coords: Vec<f64> = (0..vertices).map(|i| i as f64).collect();
        let positions = Positions::from_xyz(&coords, &coords, None, &mut Findings::new()).unwrap();
        Polygons {
            positions,
            ring_offsets: ring_offsets.to_vec(),
            polygon_offsets: polygon_offsets.to_vec(),
        }
    }

    #[test]
    fn a_polygon_with_a_hole_has_an_exterior_then_a_hole() {
        // One polygon: a 4-vertex exterior ring and a 4-vertex hole.
        let p = polygons(8, &[0, 4, 8], &[0, 2]);
        assert_eq!(
            (p.polygon_count(), p.ring_count(), p.vertex_count()),
            (Some(1), Some(2), 8)
        );
        assert_eq!(p.ring_range(0), Some(0..2));
        assert_eq!(p.vertex_range(0), Some(0..4));
        assert_eq!(p.vertex_range(1), Some(4..8));
    }

    #[test]
    fn several_polygons_share_one_ring_list() {
        let p = polygons(9, &[0, 3, 6, 9], &[0, 1, 3]);
        assert_eq!(p.polygon_count(), Some(2));
        assert_eq!(p.ring_range(0), Some(0..1));
        assert_eq!(p.ring_range(1), Some(1..3));
        assert_eq!(p.ring_range(2), None);
    }

    #[test]
    fn malformed_offsets_return_none_instead_of_panicking() {
        let empty = polygons(0, &[], &[]);
        assert_eq!((empty.polygon_count(), empty.ring_count()), (None, None));
        assert_eq!(empty.ring_range(0), None);
        // Polygon claims 5 rings but only 2 exist; ring runs past the vertices.
        let bad = polygons(3, &[0, 2, 9], &[0, 5]);
        assert_eq!(bad.ring_range(0), None);
        assert_eq!(bad.vertex_range(1), None);
        let decreasing = polygons(6, &[0, 4, 2], &[0, 2]);
        assert_eq!(decreasing.vertex_range(1), None);
    }

    #[test]
    fn no_polygons_is_a_single_zero_offset() {
        let p = polygons(0, &[0], &[0]);
        assert_eq!((p.polygon_count(), p.ring_count()), (Some(0), Some(0)));
    }
}
