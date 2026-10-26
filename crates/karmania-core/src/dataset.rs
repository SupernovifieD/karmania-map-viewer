//! The dataset: one geometry in one of the six standard shapes, plus attributes.

use serde::{Deserialize, Serialize};

use crate::crs::CrsRef;
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
}

impl Geometry {
    /// The shape of this geometry.
    #[must_use]
    pub fn kind(&self) -> Kind {
        match self {
            Geometry::Points(_) => Kind::Points,
        }
    }

    /// Whether the source had real Z values. Points, lines, polygons and meshes
    /// report their positions' flag.
    #[must_use]
    pub fn has_z(&self) -> bool {
        match self {
            Geometry::Points(positions) => positions.has_z(),
        }
    }
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crs::Units;
    use crate::findings::Findings;

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
    fn a_dataset_id_serializes_as_a_plain_number() {
        assert_eq!(serde_json::to_string(&DatasetId(42)).unwrap(), "42");
        assert!(DatasetId(1) < DatasetId(2));
    }
}
