//! The dataset: one geometry in one of the six standard shapes, plus attributes.

use serde::{Deserialize, Serialize};

use crate::blocks::Blocks;
use crate::crs::CrsRef;
use crate::grid::Grid;
use crate::lines::Lines;
use crate::mesh::Mesh;
use crate::polygons::Polygons;
use crate::positions::Positions;
use crate::table::Table;

/// The six standard shapes of map data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// Individual points.
    Points,
    /// Polylines.
    Lines,
    /// Polygons with optional holes.
    Polygons,
    /// A triangle mesh.
    Mesh,
    /// A regular grid of cells.
    Grid,
    /// A block model.
    Blocks,
}

impl Kind {
    /// The lowercase name used in JSON: `points`, `lines`, `polygons`, `mesh`,
    /// `grid` or `blocks`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Kind::Points => "points",
            Kind::Lines => "lines",
            Kind::Polygons => "polygons",
            Kind::Mesh => "mesh",
            Kind::Grid => "grid",
            Kind::Blocks => "blocks",
        }
    }
}

/// An identifier for a dataset, assigned by whoever holds the datasets (the
/// engine's registry), not by the dataset itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct DatasetId(pub u64);

/// The geometry of a dataset. One variant per [`Kind`]. Each element has one
/// row in the dataset's attribute table.
#[derive(Debug, Clone, PartialEq)]
pub enum Geometry {
    /// Individual points, one attribute row per point.
    Points(Positions),
    /// Polylines, one attribute row per line.
    Lines(Lines),
    /// Polygons with optional holes, one attribute row per polygon.
    Polygons(Polygons),
    /// A triangle mesh, one attribute row per triangle.
    Mesh(Mesh),
    /// A regular grid, one attribute row per cell.
    Grid(Grid),
    /// A block model, one attribute row per block.
    Blocks(Blocks),
}

impl Geometry {
    /// The shape of this geometry.
    #[must_use]
    pub fn kind(&self) -> Kind {
        match self {
            Geometry::Points(_) => Kind::Points,
            Geometry::Lines(_) => Kind::Lines,
            Geometry::Polygons(_) => Kind::Polygons,
            Geometry::Mesh(_) => Kind::Mesh,
            Geometry::Grid(_) => Kind::Grid,
            Geometry::Blocks(_) => Kind::Blocks,
        }
    }

    /// Whether the source had real Z values. Points, lines, polygons and meshes
    /// report their positions' flag, a grid reports its elevation rule, and a
    /// block model is always three-dimensional.
    #[must_use]
    pub fn has_z(&self) -> bool {
        match self {
            Geometry::Points(positions) => positions.has_z(),
            Geometry::Lines(lines) => lines.positions.has_z(),
            Geometry::Polygons(polygons) => polygons.positions.has_z(),
            Geometry::Mesh(mesh) => mesh.positions.has_z(),
            Geometry::Grid(grid) => grid.has_z(),
            Geometry::Blocks(_) => true,
        }
    }

    /// The number of elements: points, lines, polygons, triangles, cells or
    /// blocks. An attribute table has one row per element. `None` when the
    /// geometry is too malformed to count (for example empty offsets) or the
    /// count does not fit in a `u64`.
    #[must_use]
    pub fn element_count(&self) -> Option<u64> {
        match self {
            Geometry::Points(positions) => to_u64(positions.len()),
            Geometry::Lines(lines) => lines.line_count().and_then(to_u64),
            Geometry::Polygons(polygons) => polygons.polygon_count().and_then(to_u64),
            Geometry::Mesh(mesh) => to_u64(mesh.triangle_count()),
            Geometry::Grid(grid) => grid.cell_count(),
            Geometry::Blocks(blocks) => blocks.block_count(),
        }
    }

    /// The number of vertices, for the shapes built from a vertex list: lines,
    /// polygons and meshes. `None` for points, grids and block models.
    #[must_use]
    pub fn vertex_count(&self) -> Option<u64> {
        match self {
            Geometry::Lines(lines) => to_u64(lines.vertex_count()),
            Geometry::Polygons(polygons) => to_u64(polygons.vertex_count()),
            Geometry::Mesh(mesh) => to_u64(mesh.vertex_count()),
            Geometry::Points(_) | Geometry::Grid(_) | Geometry::Blocks(_) => None,
        }
    }

    /// The number of rows a per-vertex attribute table must have: the vertex
    /// count for lines and meshes, the only shapes that may carry one. `None`
    /// for the other shapes.
    #[must_use]
    pub fn expected_vertex_attribute_rows(&self) -> Option<u64> {
        match self {
            Geometry::Lines(_) | Geometry::Mesh(_) => self.vertex_count(),
            _ => None,
        }
    }
}

fn to_u64(n: usize) -> Option<u64> {
    u64::try_from(n).ok()
}

/// Where a dataset came from.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Provenance {
    /// The name of the file the data was read from, if any.
    pub source_file_name: Option<String>,
}

/// A dataset: a name, a CRS, one geometry and its attributes.
///
/// The CRS is optional only so that a missing one can be reported: validation
/// treats `None` as an error. The shape and `has_z` come from the geometry.
#[derive(Debug, Clone, PartialEq)]
pub struct Dataset {
    /// Identifier assigned by the holder of the dataset.
    pub id: DatasetId,
    /// A human-readable name.
    pub name: String,
    /// The coordinate reference system, or `None` if the source did not say.
    pub crs: Option<CrsRef>,
    /// The geometry.
    pub geometry: Geometry,
    /// One row per element. May have no columns.
    pub attributes: Table,
    /// Optional per-vertex attributes, used by lines and meshes.
    pub vertex_attributes: Option<Table>,
    /// Where the data came from.
    pub provenance: Provenance,
}

impl Dataset {
    /// Creates a dataset with no vertex attributes and default provenance.
    #[must_use]
    pub fn new(
        id: DatasetId,
        name: impl Into<String>,
        crs: Option<CrsRef>,
        geometry: Geometry,
        attributes: Table,
    ) -> Self {
        Self {
            id,
            name: name.into(),
            crs,
            geometry,
            attributes,
            vertex_attributes: None,
            provenance: Provenance::default(),
        }
    }

    /// The shape of the dataset.
    #[must_use]
    pub fn kind(&self) -> Kind {
        self.geometry.kind()
    }

    /// Whether the source had real Z values.
    #[must_use]
    pub fn has_z(&self) -> bool {
        self.geometry.has_z()
    }

    /// The number of elements; see [`Geometry::element_count`].
    #[must_use]
    pub fn element_count(&self) -> Option<u64> {
        self.geometry.element_count()
    }

    /// The number of rows `attributes` should have: one per element (per point,
    /// line, polygon, triangle, cell or block).
    #[must_use]
    pub fn expected_attribute_rows(&self) -> Option<u64> {
        self.element_count()
    }

    /// The number of rows `vertex_attributes` should have, if the shape can
    /// carry per-vertex attributes; see [`Geometry::expected_vertex_attribute_rows`].
    #[must_use]
    pub fn expected_vertex_attribute_rows(&self) -> Option<u64> {
        self.geometry.expected_vertex_attribute_rows()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crs::Units;
    use crate::findings::Findings;
    use crate::grid::GridZ;
    use crate::lattice::Lattice;

    fn points(z: Option<&[f64]>) -> Geometry {
        let mut findings = Findings::new();
        let positions = Positions::from_xyz(&[1.0, 2.0], &[3.0, 4.0], z, &mut findings).unwrap();
        Geometry::Points(positions)
    }

    #[test]
    fn kind_names_match_the_import_mapping_json() {
        let all = [
            Kind::Points,
            Kind::Lines,
            Kind::Polygons,
            Kind::Mesh,
            Kind::Grid,
            Kind::Blocks,
        ];
        for kind in all {
            let json = serde_json::to_string(&kind).unwrap();
            assert_eq!(json, format!("\"{}\"", kind.as_str()));
            assert_eq!(serde_json::from_str::<Kind>(&json).unwrap(), kind);
        }
        assert!(serde_json::from_str::<Kind>("\"point\"").is_err());
    }

    #[test]
    fn a_new_dataset_derives_kind_and_has_z_from_its_geometry() {
        let crs = Some(CrsRef::Local {
            units: Units::Metre,
        });
        let d = Dataset::new(DatasetId(7), "holes", crs, points(None), Table::empty());
        assert_eq!((d.kind(), d.has_z()), (Kind::Points, false));
        assert_eq!((d.id, d.name.as_str(), d.crs), (DatasetId(7), "holes", crs));
        assert!(d.vertex_attributes.is_none());
        assert_eq!(d.provenance, Provenance::default());

        let d3 = Dataset::new(
            DatasetId(8),
            "survey",
            None,
            points(Some(&[5.0, 6.0])),
            Table::empty(),
        );
        assert_eq!((d3.kind(), d3.has_z(), d3.crs), (Kind::Points, true, None));
    }

    #[test]
    fn a_lines_dataset_reports_the_lines_kind_and_its_positions_z_flag() {
        let mut findings = Findings::new();
        let positions =
            Positions::from_xyz(&[0.0, 1.0], &[0.0, 1.0], Some(&[5.0, 6.0]), &mut findings)
                .unwrap();
        let lines = Lines {
            positions,
            offsets: vec![0, 2],
        };
        let d = Dataset::new(
            DatasetId(1),
            "roads",
            None,
            Geometry::Lines(lines),
            Table::empty(),
        );
        assert_eq!((d.kind(), d.has_z()), (Kind::Lines, true));
    }

    #[test]
    fn a_polygons_dataset_reports_the_polygons_kind() {
        let mut findings = Findings::new();
        let positions =
            Positions::from_xyz(&[0.0, 1.0, 1.0], &[0.0, 0.0, 1.0], None, &mut findings).unwrap();
        let polygons = Polygons {
            positions,
            ring_offsets: vec![0, 3],
            polygon_offsets: vec![0, 1],
        };
        let geometry = Geometry::Polygons(polygons);
        let d = Dataset::new(DatasetId(2), "lots", None, geometry, Table::empty());
        assert_eq!((d.kind(), d.has_z()), (Kind::Polygons, false));
    }

    #[test]
    fn a_mesh_dataset_reports_the_mesh_kind_and_its_z_flag() {
        let mut findings = Findings::new();
        let xs = [0.0, 1.0, 0.0];
        let positions = Positions::from_xyz(&xs, &xs, Some(&xs), &mut findings).unwrap();
        let mesh = Mesh {
            positions,
            indices: vec![0, 1, 2],
        };
        let d = Dataset::new(
            DatasetId(3),
            "surface",
            None,
            Geometry::Mesh(mesh),
            Table::empty(),
        );
        assert_eq!((d.kind(), d.has_z()), (Kind::Mesh, true));
    }

    #[test]
    fn a_grid_dataset_reports_the_grid_kind() {
        let lattice = Lattice {
            origin: [0.0; 3],
            spacing: [10.0; 3],
            dims: [5, 5, 1],
            rotation: 0.0,
        };
        let grid = Grid {
            lattice,
            z: GridZ::Flat { elevation: 100.0 },
        };
        let d = Dataset::new(
            DatasetId(4),
            "dem",
            None,
            Geometry::Grid(grid),
            Table::empty(),
        );
        assert_eq!((d.kind(), d.has_z()), (Kind::Grid, false));
    }

    #[test]
    fn a_block_model_dataset_reports_the_blocks_kind_and_is_always_3d() {
        let lattice = Lattice {
            origin: [0.0; 3],
            spacing: [5.0; 3],
            dims: [2, 2, 1],
            rotation: 0.0,
        };
        let blocks = Blocks { lattice, ijk: None };
        let d = Dataset::new(
            DatasetId(5),
            "model",
            None,
            Geometry::Blocks(blocks),
            Table::empty(),
        );
        assert_eq!((d.kind(), d.has_z()), (Kind::Blocks, true));
    }

    fn positions(n: usize) -> Positions {
        let coords: Vec<f64> = (0..n).map(|i| i as f64).collect();
        Positions::from_xyz(&coords, &coords, None, &mut Findings::new()).unwrap()
    }

    fn lattice(dims: [u32; 3]) -> Lattice {
        Lattice {
            origin: [0.0; 3],
            spacing: [1.0; 3],
            dims,
            rotation: 0.0,
        }
    }

    fn flat() -> GridZ {
        GridZ::Flat { elevation: 0.0 }
    }

    #[test]
    fn every_kind_counts_its_elements_vertices_and_expected_rows() {
        let lines = Lines {
            positions: positions(5),
            offsets: vec![0, 2, 5],
        };
        let polygons = Polygons {
            positions: positions(6),
            ring_offsets: vec![0, 3, 6],
            polygon_offsets: vec![0, 1, 2],
        };
        let mesh = Mesh {
            positions: positions(4),
            indices: vec![0, 1, 2, 2, 1, 3],
        };
        let grid = Grid {
            lattice: lattice([4, 3, 1]),
            z: flat(),
        };
        let dense = Blocks {
            lattice: lattice([2, 3, 4]),
            ijk: None,
        };
        let sparse = Blocks {
            lattice: lattice([9, 9, 9]),
            ijk: Some(vec![0, 0, 0, 1, 1, 1, 2, 2, 2]),
        };
        // (geometry, elements, vertices, expected per-vertex attribute rows)
        let cases = [
            (Geometry::Points(positions(3)), Some(3), None, None),
            (Geometry::Lines(lines), Some(2), Some(5), Some(5)),
            (Geometry::Polygons(polygons), Some(2), Some(6), None),
            (Geometry::Mesh(mesh), Some(2), Some(4), Some(4)),
            (Geometry::Grid(grid), Some(12), None, None),
            (Geometry::Blocks(dense), Some(24), None, None),
            (Geometry::Blocks(sparse), Some(3), None, None),
        ];
        for (geometry, elements, vertices, vertex_rows) in cases {
            let kind = geometry.kind();
            assert_eq!(geometry.element_count(), elements, "{kind:?} elements");
            assert_eq!(geometry.vertex_count(), vertices, "{kind:?} vertices");
            assert_eq!(
                geometry.expected_vertex_attribute_rows(),
                vertex_rows,
                "{kind:?} vertex rows"
            );
            let d = Dataset::new(DatasetId(1), "d", None, geometry, Table::empty());
            assert_eq!(d.element_count(), elements);
            assert_eq!(d.expected_attribute_rows(), elements);
            assert_eq!(d.expected_vertex_attribute_rows(), vertex_rows);
        }
    }

    #[test]
    fn malformed_or_oversized_geometry_has_no_element_count() {
        let no_lines = Geometry::Lines(Lines {
            positions: positions(2),
            offsets: vec![],
        });
        let no_polygons = Geometry::Polygons(Polygons {
            positions: positions(2),
            ring_offsets: vec![0],
            polygon_offsets: vec![],
        });
        let huge = Geometry::Grid(Grid {
            lattice: lattice([u32::MAX, u32::MAX, 2]),
            z: flat(),
        });
        for geometry in [no_lines, no_polygons, huge] {
            assert_eq!(geometry.element_count(), None);
        }
        let partial = Geometry::Mesh(Mesh {
            positions: positions(3),
            indices: vec![0, 1, 2, 0],
        });
        assert_eq!(partial.element_count(), Some(1));
    }

    #[test]
    fn a_dataset_id_serializes_as_a_plain_number() {
        assert_eq!(serde_json::to_string(&DatasetId(42)).unwrap(), "42");
        assert!(DatasetId(1) < DatasetId(2));
    }
}
