//! Grid geometry: a regular grid of cells, usually 2D, with an elevation rule.

use crate::lattice::Lattice;

/// Where the elevation of each grid cell comes from.
#[derive(Debug, Clone, PartialEq)]
pub enum GridZ {
    /// Every cell is at the same elevation, in CRS units.
    Flat {
        /// The elevation of every cell.
        elevation: f64,
    },
    /// Each cell's elevation is the value of a column in the attribute table.
    FromColumn {
        /// The name of that column.
        name: String,
    },
}

/// A regular grid. The cell values live in the dataset's attribute table, one
/// row per cell in lattice order (`i` fastest, see [`Lattice`]).
///
/// A 2D grid has `nz = 1` in its lattice.
#[derive(Debug, Clone, PartialEq)]
pub struct Grid {
    /// The cell index space.
    pub lattice: Lattice,
    /// Where cell elevations come from.
    pub z: GridZ,
}

impl Grid {
    /// Total number of cells, or `None` if it does not fit in a `u64`.
    #[must_use]
    pub fn cell_count(&self) -> Option<u64> {
        self.lattice.cell_count()
    }

    /// Whether the grid has real elevation information: elevations from a
    /// column, or more than one layer of cells.
    #[must_use]
    pub fn has_z(&self) -> bool {
        match self.z {
            GridZ::FromColumn { .. } => true,
            GridZ::Flat { .. } => self.lattice.dims[2] > 1,
        }
    }

    /// The name of the elevation column, if elevations come from one.
    #[must_use]
    pub fn z_column(&self) -> Option<&str> {
        match &self.z {
            GridZ::FromColumn { name } => Some(name),
            GridZ::Flat { .. } => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(dims: [u32; 3], z: GridZ) -> Grid {
        let lattice = Lattice {
            origin: [0.0; 3],
            spacing: [1.0; 3],
            dims,
            rotation: 0.0,
        };
        Grid { lattice, z }
    }

    #[test]
    fn a_flat_two_dimensional_grid_has_no_z() {
        let g = grid([4, 3, 1], GridZ::Flat { elevation: 120.5 });
        assert_eq!(
            (g.cell_count(), g.has_z(), g.z_column()),
            (Some(12), false, None)
        );
    }

    #[test]
    fn a_grid_with_elevations_from_a_column_has_z() {
        let z = GridZ::FromColumn {
            name: "elevation".to_string(),
        };
        let g = grid([4, 3, 1], z);
        assert_eq!((g.has_z(), g.z_column()), (true, Some("elevation")));
    }

    #[test]
    fn a_flat_grid_with_several_layers_still_has_z() {
        assert!(grid([2, 2, 3], GridZ::Flat { elevation: 0.0 }).has_z());
    }

    #[test]
    fn a_grid_too_big_to_count_reports_none() {
        let g = grid([u32::MAX, u32::MAX, 2], GridZ::Flat { elevation: 0.0 });
        assert_eq!(g.cell_count(), None);
    }
}
