//! Helpers shared by the validation tests.

use crate::blocks::Blocks;
use crate::dataset::{Dataset, DatasetId, Geometry};
use crate::findings::Findings;
use crate::grid::{Grid, GridZ};
use crate::lattice::Lattice;
use crate::lines::Lines;
use crate::mesh::Mesh;
use crate::polygons::Polygons;
use crate::positions::Positions;
use crate::table::Table;

/// `n` positions along the diagonal, without Z.
pub(crate) fn positions(n: usize) -> Positions {
    let coords: Vec<f64> = (0..n).map(|i| i as f64).collect();
    Positions::from_xyz(&coords, &coords, None, &mut Findings::new()).unwrap()
}

/// A dataset with no CRS and no attributes.
pub(crate) fn dataset(geometry: Geometry) -> Dataset {
    Dataset::new(DatasetId(1), "test", None, geometry, Table::empty())
}

pub(crate) fn points(n: usize) -> Dataset {
    dataset(Geometry::Points(positions(n)))
}

pub(crate) fn lines(vertices: usize, offsets: &[u32]) -> Dataset {
    dataset(Geometry::Lines(Lines {
        positions: positions(vertices),
        offsets: offsets.to_vec(),
    }))
}

pub(crate) fn polygons(vertices: usize, rings: &[u32], polygons: &[u32]) -> Dataset {
    dataset(Geometry::Polygons(Polygons {
        positions: positions(vertices),
        ring_offsets: rings.to_vec(),
        polygon_offsets: polygons.to_vec(),
    }))
}

pub(crate) fn mesh(vertices: usize, indices: &[u32]) -> Dataset {
    dataset(Geometry::Mesh(Mesh {
        positions: positions(vertices),
        indices: indices.to_vec(),
    }))
}

pub(crate) fn lattice(dims: [u32; 3]) -> Lattice {
    Lattice {
        origin: [0.0; 3],
        spacing: [1.0; 3],
        dims,
        rotation: 0.0,
    }
}

pub(crate) fn grid(dims: [u32; 3]) -> Dataset {
    dataset(Geometry::Grid(Grid {
        lattice: lattice(dims),
        z: GridZ::Flat { elevation: 0.0 },
    }))
}

pub(crate) fn blocks(dims: [u32; 3], ijk: Option<Vec<u32>>) -> Dataset {
    dataset(Geometry::Blocks(Blocks {
        lattice: lattice(dims),
        ijk,
    }))
}

/// Runs one check on a dataset and returns what it found.
pub(crate) fn run(check: fn(&Dataset, &mut Findings), dataset: &Dataset) -> Findings {
    let mut findings = Findings::new();
    check(dataset, &mut findings);
    findings
}

/// The finding codes, in order.
pub(crate) fn codes(findings: &Findings) -> Vec<&'static str> {
    findings.iter().map(|f| f.code.as_str()).collect()
}
