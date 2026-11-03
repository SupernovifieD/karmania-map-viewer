//! Small datasets for the tests of this crate.

use karmania_core::{
    Blocks, CrsRef, Dataset, DatasetId, Findings, Geometry, Grid, GridZ, Lattice, Positions, Table,
};

/// A dataset of points at the given `(x, y)` positions, in `crs`.
pub(crate) fn points(crs: Option<CrsRef>, xy: &[(f64, f64)]) -> Dataset {
    let x: Vec<f64> = xy.iter().map(|p| p.0).collect();
    let y: Vec<f64> = xy.iter().map(|p| p.1).collect();
    let positions = Positions::from_xyz(&x, &y, None, &mut Findings::new()).unwrap();
    Dataset::new(
        DatasetId(1),
        "points",
        crs,
        Geometry::Points(positions),
        Table::empty(),
    )
}

/// The lattice of 4 x 3 x 1 cells of 10 units, at 500,000 / 4,000,000.
pub(crate) fn lattice() -> Lattice {
    Lattice {
        origin: [500_000.0, 4_000_000.0, 0.0],
        spacing: [10.0, 10.0, 10.0],
        dims: [4, 3, 1],
        rotation: 0.0,
    }
}

/// A flat grid on [`lattice`], in `crs`.
pub(crate) fn grid(crs: Option<CrsRef>) -> Dataset {
    let geometry = Geometry::Grid(Grid {
        lattice: lattice(),
        z: GridZ::Flat { elevation: 0.0 },
    });
    Dataset::new(DatasetId(2), "grid", crs, geometry, Table::empty())
}

/// A dense block model on [`lattice`], in `crs`.
pub(crate) fn blocks(crs: Option<CrsRef>) -> Dataset {
    let geometry = Geometry::Blocks(Blocks {
        lattice: lattice(),
        ijk: None,
    });
    Dataset::new(DatasetId(3), "blocks", crs, geometry, Table::empty())
}
