//! The shapes inside a GeoJSON file: positions, geometries, and the lists of
//! them that become datasets.
//!
//! Every kind of shape collects its coordinates in a [`Coords`], which applies the
//! checks they share: the size limit, partial elevations and extra values.

use karmania_core::{
    CrsRef, Dataset, DatasetId, Finding, FindingCode, Findings, Geometry, Location, Positions,
    Provenance, Table, check_size,
};
use serde_json::Value;

use crate::geojson_properties::{Properties, property_columns};
use crate::output::Tally;

/// The coordinate system GeoJSON uses unless the file says otherwise (RFC 7946).
pub(crate) const WGS84: CrsRef = CrsRef::Epsg { code: 4326 };

/// Every geometry type GeoJSON defines.
pub(crate) const GEOMETRY_TYPES: [&str; 7] = [
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
];

/// One position of a geometry.
pub(crate) struct Position {
    x: f64,
    y: f64,
    z: Option<f64>,
    /// True if the position had more than three values.
    extra: bool,
}

fn position(value: &Value) -> Option<Position> {
    let items = value.as_array()?;
    if items.len() < 2 {
        return None;
    }
    let mut numbers = [0.0f64; 3];
    for (slot, item) in numbers.iter_mut().zip(items) {
        *slot = item.as_f64()?;
    }
    Some(Position {
        x: numbers[0],
        y: numbers[1],
        z: (items.len() >= 3).then_some(numbers[2]),
        extra: items.len() > 3,
    })
}

/// What a geometry turned out to be.
pub(crate) enum Parsed {
    Points(Vec<Position>),
    /// A valid GeoJSON type this reader does not import.
    Unsupported(&'static str),
    Invalid,
}

pub(crate) fn parse_geometry(geometry: &Value) -> Parsed {
    let Some(kind) = geometry.get("type").and_then(Value::as_str) else {
        return Parsed::Invalid;
    };
    let coordinates = geometry.get("coordinates");
    match kind {
        "Point" => coordinates
            .and_then(position)
            .map_or(Parsed::Invalid, |p| Parsed::Points(vec![p])),
        "MultiPoint" => coordinates
            .and_then(Value::as_array)
            .and_then(|list| list.iter().map(position).collect::<Option<Vec<_>>>())
            .map_or(Parsed::Invalid, Parsed::Points),
        other => GEOMETRY_TYPES
            .iter()
            .find(|known| **known == other)
            .map_or(Parsed::Invalid, |known| Parsed::Unsupported(known)),
    }
}

/// Coordinates being collected, with the checks every shape shares.
struct Coords {
    x: Vec<f64>,
    y: Vec<f64>,
    z: Vec<f64>,
    with_z: usize,
    without_z: Tally,
    extra: Tally,
}

impl Coords {
    fn new() -> Self {
        Self {
            x: Vec::new(),
            y: Vec::new(),
            z: Vec::new(),
            with_z: 0,
            without_z: Tally::new(
                Finding::new(
                    FindingCode::GeojsonZPartial,
                    "Some positions have no elevation, so the elevations of the others were ignored.",
                )
                .with_hint("Give every position an elevation, or none."),
            ),
            extra: Tally::new(Finding::new(
                FindingCode::GeojsonPositionExtraValues,
                "Some positions have more than three values (such as a measure); only the first three were used.",
            )),
        }
    }

    /// Adds a position of the feature at `at`.
    fn push(&mut self, p: &Position, at: &Location) {
        self.x.push(p.x);
        self.y.push(p.y);
        match p.z {
            Some(z) => {
                self.z.push(z);
                self.with_z += 1;
            }
            None => {
                self.z.push(0.0);
                self.without_z.hit(at.clone());
            }
        }
        if p.extra {
            self.extra.hit(at.clone());
        }
    }

    /// The positions, with the findings about them. `None` if there are none, or
    /// there are too many (`things` names them in that message).
    fn finish(self, things: &str, findings: &mut Findings) -> Option<Positions> {
        if self.x.is_empty() || !check_size(Some(self.x.len() as u64), things, findings) {
            return None;
        }
        let has_z = self.with_z == self.x.len();
        if self.with_z > 0
            && !has_z
            && let Some(finding) = self.without_z.into_finding()
        {
            findings.add(finding);
        }
        if let Some(finding) = self.extra.into_finding() {
            findings.add(finding);
        }
        Positions::from_xyz(&self.x, &self.y, has_z.then_some(&self.z[..]), findings)
    }
}

/// The dataset name: the file's name, or `fallback` if there is none.
pub(crate) fn name_of(file_name: Option<&str>, fallback: &str) -> String {
    file_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or(fallback)
        .to_string()
}

/// A dataset read from a GeoJSON file, with the usual defaults.
fn dataset(
    file_name: Option<&str>,
    fallback: &str,
    geometry: Geometry,
    attributes: Table,
) -> Dataset {
    let mut dataset = Dataset::new(
        DatasetId(0),
        name_of(file_name, fallback),
        Some(WGS84),
        geometry,
        attributes,
    );
    dataset.provenance = Provenance {
        source_file_name: file_name.map(str::to_string),
    };
    dataset
}

/// The points of a file, with the features they came from.
pub(crate) struct PointsAcc<'a> {
    coords: Coords,
    /// For each point, the position in `features` of the feature it belongs to.
    rows: Vec<usize>,
    features: Vec<Properties<'a>>,
}

impl<'a> PointsAcc<'a> {
    pub(crate) fn new() -> Self {
        Self {
            coords: Coords::new(),
            rows: Vec::new(),
            features: Vec::new(),
        }
    }

    pub(crate) fn add(&mut self, feature: Properties<'a>, positions: &[Position]) {
        if positions.is_empty() {
            return;
        }
        let at = Location::default().with_element(feature.index);
        let slot = self.features.len();
        self.features.push(feature);
        for p in positions {
            self.coords.push(p, &at);
            self.rows.push(slot);
        }
    }

    pub(crate) fn finish(
        self,
        file_name: Option<&str>,
        findings: &mut Findings,
    ) -> Option<Dataset> {
        let positions = self.coords.finish("points", findings)?;
        let columns = property_columns(&self.features, &self.rows, findings);
        let attributes = Table::from_columns(columns, findings)?;
        Some(dataset(
            file_name,
            "points",
            Geometry::Points(positions),
            attributes,
        ))
    }
}
