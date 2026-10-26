//! The lattice: the regular 3D index space shared by grids and block models.

use crate::bbox::BBox;

/// A regular lattice of cells.
///
/// Conventions, shared by every importer and by the rest of the engine:
///
/// - `origin` is the outer corner of cell `(0, 0, 0)`, i.e. the minimum corner
///   before rotation. It is not a cell centre.
/// - `spacing` is the cell size along each axis.
/// - `dims` is the number of cells `(nx, ny, nz)`. A 2D grid has `nz = 1`.
/// - Before rotation, `i` increases east (+X), `j` north (+Y) and `k` up (+Z).
/// - `rotation` is in degrees, counter-clockwise about +Z when seen from above,
///   pivoting at `origin`.
/// - Values are ordered with `i` fastest, then `j`, then `k`:
///   `index = i + nx * (j + ny * k)`.
///
/// Whether the dimensions and spacing are valid is checked by validation
/// (step 2.8). Methods here never panic on invalid values: they return `None`
/// or NaN instead.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lattice {
    /// Outer (minimum) corner of cell `(0, 0, 0)`, before rotation.
    pub origin: [f64; 3],
    /// Cell size along each axis; each must be finite and greater than 0.
    pub spacing: [f64; 3],
    /// Number of cells along each axis; each must be at least 1.
    pub dims: [u32; 3],
    /// Degrees counter-clockwise about +Z, pivoting at `origin`.
    pub rotation: f64,
}

/// Sine and cosine of an angle in degrees, exact for multiples of 90 degrees so
/// that common rotations give exact coordinates.
fn rotation_sin_cos(degrees: f64) -> (f64, f64) {
    match degrees.rem_euclid(360.0) {
        0.0 => (0.0, 1.0),
        90.0 => (1.0, 0.0),
        180.0 => (0.0, -1.0),
        270.0 => (-1.0, 0.0),
        other => other.to_radians().sin_cos(),
    }
}

impl Lattice {
    /// The total number of cells `nx * ny * nz`, or `None` if it does not fit in
    /// a `u64`.
    #[must_use]
    pub fn cell_count(&self) -> Option<u64> {
        let [nx, ny, nz] = self.dims.map(u64::from);
        nx.checked_mul(ny)?.checked_mul(nz)
    }

    /// The position of cell `(i, j, k)` in value order, or `None` if the cell is
    /// outside the lattice.
    #[must_use]
    pub fn index(&self, i: u32, j: u32, k: u32) -> Option<u64> {
        let [nx, ny, nz] = self.dims;
        if i >= nx || j >= ny || k >= nz {
            return None;
        }
        u64::from(k)
            .checked_mul(u64::from(ny))?
            .checked_add(u64::from(j))?
            .checked_mul(u64::from(nx))?
            .checked_add(u64::from(i))
    }

    /// The cell `[i, j, k]` at position `index` in value order, or `None` if
    /// `index` is not a valid cell position.
    #[must_use]
    pub fn ijk(&self, index: u64) -> Option<[u32; 3]> {
        let [nx, ny, _] = self.dims.map(u64::from);
        if index >= self.cell_count()? {
            return None;
        }
        let i = index.checked_rem(nx)?;
        let rest = index.checked_div(nx)?;
        let j = rest.checked_rem(ny)?;
        let k = rest.checked_div(ny)?;
        Some([
            u32::try_from(i).ok()?,
            u32::try_from(j).ok()?,
            u32::try_from(k).ok()?,
        ])
    }

    /// Converts a point in the lattice's own axes (relative to `origin`, before
    /// rotation) to world coordinates: `origin + R(rotation) * local`.
    #[must_use]
    pub fn local_to_world(&self, local: [f64; 3]) -> [f64; 3] {
        let (sin, cos) = rotation_sin_cos(self.rotation);
        let [x, y, z] = local;
        [
            self.origin[0] + (x * cos - y * sin),
            self.origin[1] + (x * sin + y * cos),
            self.origin[2] + z,
        ]
    }

    /// The smallest axis-aligned box containing the whole lattice after
    /// rotation: the eight corners of the lattice box, rotated about `origin`.
    /// `None` if any corner is not finite, which happens when the origin,
    /// spacing or rotation is not finite; a partial box would be misleading.
    #[must_use]
    pub fn bbox(&self) -> Option<BBox> {
        let [nx, ny, nz] = self.dims.map(f64::from);
        let [dx, dy, dz] = self.spacing;
        let (sx, sy, sz) = (nx * dx, ny * dy, nz * dz);
        let corners: Vec<[f64; 3]> = [0.0, sx]
            .into_iter()
            .flat_map(|x| {
                [0.0, sy]
                    .into_iter()
                    .flat_map(move |y| [0.0, sz].into_iter().map(move |z| [x, y, z]))
            })
            .map(|local| self.local_to_world(local))
            .collect();
        let all_finite = corners.iter().all(|c| c.iter().all(|v| v.is_finite()));
        all_finite.then(|| BBox::from_points(corners)).flatten()
    }

    /// The world coordinates of the centre of cell `(i, j, k)`:
    /// `origin + R(rotation) * ((i + 0.5) dx, (j + 0.5) dy, (k + 0.5) dz)`.
    /// `None` if the cell is outside the lattice.
    #[must_use]
    pub fn cell_centre(&self, i: u32, j: u32, k: u32) -> Option<[f64; 3]> {
        let [nx, ny, nz] = self.dims;
        if i >= nx || j >= ny || k >= nz {
            return None;
        }
        let [dx, dy, dz] = self.spacing;
        Some(self.local_to_world([
            (f64::from(i) + 0.5) * dx,
            (f64::from(j) + 0.5) * dy,
            (f64::from(k) + 0.5) * dz,
        ]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lattice(dims: [u32; 3], rotation: f64) -> Lattice {
        Lattice {
            origin: [10.0, 20.0, 30.0],
            spacing: [2.0, 2.0, 2.0],
            dims,
            rotation,
        }
    }

    fn close(a: [f64; 3], b: [f64; 3]) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-12)
    }

    #[test]
    fn cell_count_multiplies_the_dimensions_and_detects_overflow() {
        assert_eq!(lattice([2, 3, 4], 0.0).cell_count(), Some(24));
        assert_eq!(lattice([5, 0, 7], 0.0).cell_count(), Some(0));
        let side = u64::from(u32::MAX);
        assert_eq!(
            lattice([u32::MAX, u32::MAX, 1], 0.0).cell_count(),
            Some(side * side)
        );
        assert_eq!(lattice([u32::MAX, u32::MAX, 2], 0.0).cell_count(), None);
    }

    #[test]
    fn values_are_ordered_with_i_fastest_then_j_then_k() {
        let l = lattice([3, 4, 5], 0.0);
        assert_eq!(l.index(0, 0, 0), Some(0));
        assert_eq!(l.index(1, 0, 0), Some(1));
        assert_eq!(l.index(0, 1, 0), Some(3));
        assert_eq!(l.index(0, 0, 1), Some(12));
        assert_eq!(l.index(2, 3, 4), Some(59));
    }

    #[test]
    fn index_and_ijk_round_trip_for_every_cell() {
        let l = lattice([3, 4, 5], 0.0);
        let mut expected = 0;
        for k in 0..5 {
            for j in 0..4 {
                for i in 0..3 {
                    assert_eq!(l.index(i, j, k), Some(expected));
                    assert_eq!(l.ijk(expected), Some([i, j, k]));
                    expected += 1;
                }
            }
        }
    }

    #[test]
    fn cells_outside_the_lattice_give_none() {
        let l = lattice([3, 4, 5], 0.0);
        assert_eq!(l.index(3, 0, 0), None);
        assert_eq!(l.index(0, 4, 0), None);
        assert_eq!(l.index(0, 0, 5), None);
        assert_eq!(l.ijk(60), None);
        assert_eq!(l.ijk(u64::MAX), None);
        assert_eq!(l.cell_centre(3, 0, 0), None);
        let empty = lattice([0, 4, 5], 0.0);
        assert_eq!((empty.ijk(0), empty.index(0, 0, 0)), (None, None));
    }

    #[test]
    fn huge_lattices_neither_overflow_nor_panic() {
        let l = lattice([u32::MAX, u32::MAX, u32::MAX], 0.0);
        assert_eq!(l.cell_count(), None);
        assert_eq!(l.index(u32::MAX - 1, u32::MAX - 1, u32::MAX - 1), None);
        assert_eq!(l.ijk(5), None);
    }

    #[test]
    fn unrotated_cell_centres_are_half_a_cell_from_the_corner() {
        let l = lattice([3, 3, 3], 0.0);
        assert_eq!(l.cell_centre(0, 0, 0), Some([11.0, 21.0, 31.0]));
        assert_eq!(l.cell_centre(2, 1, 0), Some([15.0, 23.0, 31.0]));
        let flat = Lattice {
            dims: [3, 3, 1],
            ..l
        };
        assert_eq!(flat.cell_centre(0, 0, 0), Some([11.0, 21.0, 31.0]));
    }

    #[test]
    fn a_quarter_turn_is_exact_and_counter_clockwise_about_the_origin_corner() {
        // Local offset (1, 1, 1) turned 90 degrees CCW becomes (-1, 1, 1).
        assert_eq!(
            lattice([3, 3, 3], 90.0).cell_centre(0, 0, 0),
            Some([9.0, 21.0, 31.0])
        );
        // Local (3, 1, 1) -> (-1, 3, 1).
        assert_eq!(
            lattice([3, 3, 3], 90.0).cell_centre(1, 0, 0),
            Some([9.0, 23.0, 31.0])
        );
        assert_eq!(
            lattice([3, 3, 3], 180.0).cell_centre(0, 0, 0),
            Some([9.0, 19.0, 31.0])
        );
        assert_eq!(
            lattice([3, 3, 3], 270.0).cell_centre(0, 0, 0),
            Some([11.0, 19.0, 31.0])
        );
    }

    #[test]
    fn equivalent_angles_give_identical_results() {
        let reference = lattice([3, 3, 3], 90.0).cell_centre(2, 1, 0);
        for degrees in [-270.0, 450.0, 810.0] {
            assert_eq!(lattice([3, 3, 3], degrees).cell_centre(2, 1, 0), reference);
        }
        let unrotated = lattice([3, 3, 3], 0.0).cell_centre(2, 1, 0);
        assert_eq!(lattice([3, 3, 3], 360.0).cell_centre(2, 1, 0), unrotated);
        assert_eq!(lattice([3, 3, 3], -360.0).cell_centre(2, 1, 0), unrotated);
    }

    #[test]
    fn a_thirty_degree_rotation_matches_the_rotation_formula() {
        let l = Lattice {
            origin: [0.0, 0.0, 0.0],
            spacing: [1.0, 1.0, 1.0],
            dims: [3, 1, 1],
            rotation: 30.0,
        };
        // Local (2.5, 0.5, 0.5): x' = 2.5 cos30 - 0.5 sin30, y' = 2.5 sin30 + 0.5 cos30.
        let (sin, cos) = (0.5, 3.0_f64.sqrt() / 2.0);
        let expected = [2.5 * cos - 0.5 * sin, 2.5 * sin + 0.5 * cos, 0.5];
        assert!(close(l.cell_centre(2, 0, 0).unwrap(), expected));
    }

    #[test]
    fn an_unrotated_lattice_box_runs_from_the_origin_by_its_size() {
        let l = Lattice {
            dims: [3, 2, 1],
            ..lattice([1, 1, 1], 0.0)
        };
        let b = l.bbox().unwrap();
        assert_eq!((b.min, b.max), ([10.0, 20.0, 30.0], [16.0, 24.0, 32.0]));
    }

    #[test]
    fn a_quarter_turn_swaps_the_extents_around_the_origin_corner() {
        // Local box is 6 wide (x) and 4 deep (y); turned 90 degrees CCW about the
        // origin it spans x from -4 to 0 and y from 0 to 6, relative to the origin.
        let l = Lattice {
            dims: [3, 2, 1],
            ..lattice([1, 1, 1], 90.0)
        };
        let b = l.bbox().unwrap();
        assert_eq!((b.min, b.max), ([6.0, 20.0, 30.0], [10.0, 26.0, 32.0]));
    }

    #[test]
    fn a_rotated_box_contains_every_cell_centre_and_touches_all_corners() {
        let l = Lattice {
            dims: [4, 3, 2],
            ..lattice([1, 1, 1], 30.0)
        };
        let b = l.bbox().unwrap();
        for k in 0..2 {
            for j in 0..3 {
                for i in 0..4 {
                    let c = l.cell_centre(i, j, k).unwrap();
                    assert!((0..3).all(|a| b.min[a] <= c[a] && c[a] <= b.max[a]));
                }
            }
        }
        // For a 30 degree turn the x extent comes from corners (0,sy) and (sx,0).
        let (sx, sy) = (8.0, 6.0);
        let (sin, cos) = (0.5, 3.0_f64.sqrt() / 2.0);
        assert!((b.min[0] - (10.0 - sy * sin)).abs() < 1e-12);
        assert!((b.max[0] - (10.0 + sx * cos)).abs() < 1e-12);
    }

    #[test]
    fn negative_spacing_and_empty_lattices_still_give_an_ordered_box() {
        let flipped = Lattice {
            spacing: [-2.0, 2.0, 2.0],
            dims: [3, 1, 1],
            ..lattice([1, 1, 1], 0.0)
        };
        let b = flipped.bbox().unwrap();
        assert_eq!((b.min[0], b.max[0]), (4.0, 10.0));
        let empty = lattice([0, 0, 0], 0.0).bbox().unwrap();
        assert_eq!(
            (empty.min, empty.max),
            ([10.0, 20.0, 30.0], [10.0, 20.0, 30.0])
        );
    }

    #[test]
    fn a_lattice_with_non_finite_values_has_no_box() {
        let bad_spacing = Lattice {
            spacing: [f64::NAN, 1.0, 1.0],
            ..lattice([2, 2, 2], 0.0)
        };
        assert_eq!(bad_spacing.bbox(), None);
        assert_eq!(lattice([2, 2, 2], f64::NAN).bbox(), None);
        let bad_origin = Lattice {
            origin: [f64::INFINITY, 0.0, 0.0],
            ..lattice([2, 2, 2], 0.0)
        };
        assert_eq!(bad_origin.bbox(), None);
    }

    #[test]
    fn the_pivot_is_the_origin_corner_for_any_rotation() {
        for degrees in [0.0, 30.0, 90.0, 123.456, -45.0] {
            let l = lattice([2, 2, 2], degrees);
            assert_eq!(l.local_to_world([0.0, 0.0, 0.0]), [10.0, 20.0, 30.0]);
        }
    }

    #[test]
    fn rotation_leaves_z_alone_and_a_bad_angle_gives_nan_not_a_panic() {
        assert_eq!(
            lattice([2, 2, 2], 33.0).local_to_world([5.0, 5.0, 7.0])[2],
            37.0
        );
        let nan = lattice([2, 2, 2], f64::NAN).cell_centre(0, 0, 0).unwrap();
        assert!(nan[0].is_nan() && nan[1].is_nan());
        let inf = lattice([2, 2, 2], f64::INFINITY)
            .cell_centre(0, 0, 0)
            .unwrap();
        assert!(inf[0].is_nan());
    }
}
