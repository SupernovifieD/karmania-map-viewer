//! Mesh geometry: a triangle mesh over a shared vertex list.

use crate::positions::Positions;

/// A triangle mesh.
///
/// `indices` holds three vertex indices per triangle, in triangle order. Index
/// values are kept as given, even if out of range or if a triangle is
/// degenerate; validation (steps 2.6 and 2.7) reports those.
#[derive(Debug, Clone, PartialEq)]
pub struct Mesh {
    /// The vertices.
    pub positions: Positions,
    /// Three vertex indices per triangle.
    pub indices: Vec<u32>,
}

impl Mesh {
    /// Number of complete triangles (a trailing partial triple is not counted).
    #[must_use]
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// Number of vertices.
    #[must_use]
    pub fn vertex_count(&self) -> usize {
        self.positions.len()
    }

    /// The three vertex indices of triangle `index`, or `None` if there is no
    /// such complete triangle.
    #[must_use]
    pub fn triangle(&self, index: usize) -> Option<[u32; 3]> {
        self.indices.as_chunks::<3>().0.get(index).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::findings::Findings;

    fn mesh(vertices: usize, indices: &[u32]) -> Mesh {
        let coords: Vec<f64> = (0..vertices).map(|i| i as f64).collect();
        let positions = Positions::from_xyz(&coords, &coords, None, &mut Findings::new()).unwrap();
        Mesh {
            positions,
            indices: indices.to_vec(),
        }
    }

    #[test]
    fn triangles_are_read_three_indices_at_a_time() {
        let m = mesh(4, &[0, 1, 2, 2, 1, 3]);
        assert_eq!((m.triangle_count(), m.vertex_count()), (2, 4));
        assert_eq!(m.triangle(0), Some([0, 1, 2]));
        assert_eq!(m.triangle(1), Some([2, 1, 3]));
        assert_eq!(m.triangle(2), None);
    }

    #[test]
    fn a_trailing_partial_triangle_is_not_counted_or_returned() {
        let m = mesh(3, &[0, 1, 2, 0, 1]);
        assert_eq!(m.triangle_count(), 1);
        assert_eq!(m.triangle(1), None);
        assert_eq!(m.triangle(usize::MAX), None);
    }

    #[test]
    fn out_of_range_and_degenerate_indices_are_kept_for_validation() {
        let m = mesh(2, &[0, 0, 0, 7, u32::MAX, 1]);
        assert_eq!(m.triangle(0), Some([0, 0, 0]));
        assert_eq!(m.triangle(1), Some([7, u32::MAX, 1]));
    }

    #[test]
    fn an_empty_mesh_has_no_triangles() {
        let m = mesh(0, &[]);
        assert_eq!(
            (m.triangle_count(), m.vertex_count(), m.triangle(0)),
            (0, 0, None)
        );
    }
}
