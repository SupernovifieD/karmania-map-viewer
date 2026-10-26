//! Importing a GeoJSON file into datasets.
//!
//! [`read_geojson`] reads a FeatureCollection, a single Feature or a bare
//! geometry. The properties of the features become attribute columns (see
//! [`crate::geojson_properties`]). A feature that cannot be used is left out and
//! counted in a warning; nothing is guessed:
//!
//! - an element of the collection that is not a feature, a feature with no
//!   geometry, a geometry type that cannot be imported, and a geometry whose
//!   coordinates are malformed are each counted separately;
//! - positions with more than three values (a measure, for example) use the first
//!   three and are counted;
//! - if only some positions have an elevation, the elevations are ignored.
//!
//! The shapes themselves are in [`crate::geojson_shapes`].
//!
//! GeoJSON has no column mapping: the shape of the data decides the kind of
//! dataset. A file with no coordinate system is read as WGS 84 longitude and
//! latitude, as RFC 7946 says, with an info finding saying so.

use std::collections::BTreeMap;

use karmania_core::{Dataset, Finding, FindingCode, Findings, Location};
use serde_json::error::Category;
use serde_json::{Map, Value};

use crate::geojson_properties::Properties;
use crate::geojson_shapes::{GEOMETRY_TYPES, Parsed, PointsAcc, parse_geometry};
use crate::output::{ReadOutput, Tally};

/// One feature (or a bare geometry): where it is in the file, its geometry and
/// its properties.
struct Item<'a> {
    index: u64,
    geometry: Option<&'a Value>,
    properties: Option<&'a Map<String, Value>>,
}

impl<'a> Item<'a> {
    fn properties(&self) -> Properties<'a> {
        Properties {
            index: self.index,
            values: self.properties,
        }
    }

    fn at(&self) -> Location {
        Location::default().with_element(self.index)
    }
}

/// Features left out, and values ignored, counted by reason.
struct Skips {
    not_a_feature: Tally,
    no_geometry: Tally,
    unsupported: BTreeMap<&'static str, Tally>,
    invalid_geometry: Tally,
}

impl Skips {
    fn new() -> Self {
        Self {
            not_a_feature: Tally::new(
                Finding::new(
                    FindingCode::GeojsonFeatureInvalid,
                    "Some items in the list of features are not features, so they were left out.",
                )
                .with_hint("Each item should be an object with \"type\": \"Feature\"."),
            ),
            no_geometry: Tally::new(Finding::new(
                FindingCode::GeojsonGeometryMissing,
                "Some features have no geometry, so they were left out.",
            )),
            unsupported: BTreeMap::new(),
            invalid_geometry: Tally::new(
                Finding::new(
                    FindingCode::GeojsonGeometryInvalid,
                    "Some features have a geometry that could not be read, so they were left out.",
                )
                .with_hint("Check that the coordinates are lists of numbers (longitude, latitude and optionally elevation)."),
            ),
        }
    }

    fn unsupported(&mut self, kind: &'static str, at: Location) {
        self.unsupported
            .entry(kind)
            .or_insert_with(|| {
                Tally::new(
                    Finding::new(
                        FindingCode::GeojsonGeometryUnsupported,
                        format!(
                            "Features of type {kind} cannot be imported, so they were left out."
                        ),
                    )
                    .with_hint("Convert them to points, lines or polygons, or ignore them."),
                )
            })
            .hit(at);
    }

    fn report(self, findings: &mut Findings) {
        let tallies = [self.not_a_feature, self.no_geometry]
            .into_iter()
            .chain(self.unsupported.into_values())
            .chain([self.invalid_geometry]);
        for finding in tallies.filter_map(Tally::into_finding) {
            findings.add(finding);
        }
    }
}

/// Reads a GeoJSON file into datasets.
///
/// Returns no datasets if there are errors (the text is not JSON or not GeoJSON,
/// the file is too big, or nothing in it can be imported).
#[must_use]
pub fn read_geojson(text: &str, file_name: Option<&str>) -> ReadOutput {
    let mut findings = Findings::new();
    let datasets = read(text, file_name, &mut findings);
    ReadOutput {
        datasets: if findings.has_errors() {
            Vec::new()
        } else {
            datasets
        },
        findings,
    }
}

fn read(text: &str, file_name: Option<&str>, findings: &mut Findings) -> Vec<Dataset> {
    let Some(root) = parse(text, findings) else {
        return Vec::new();
    };
    let mut skips = Skips::new();
    let Some(items) = items(&root, &mut skips, findings) else {
        return Vec::new();
    };
    let mut points = PointsAcc::new();
    for item in &items {
        let Some(geometry) = item.geometry.filter(|g| !g.is_null()) else {
            skips.no_geometry.hit(item.at());
            continue;
        };
        match parse_geometry(geometry) {
            Parsed::Points(positions) => points.add(item.properties(), &positions),
            Parsed::Unsupported(kind) => skips.unsupported(kind, item.at()),
            Parsed::Invalid => skips.invalid_geometry.hit(item.at()),
        }
    }
    skips.report(findings);

    let datasets: Vec<Dataset> = points.finish(file_name, findings).into_iter().collect();
    if datasets.is_empty() && !findings.has_errors() {
        findings.add(
            Finding::new(
                FindingCode::GeojsonFeaturesNone,
                "The file has no features that can be imported.",
            )
            .with_hint("The file should have points, lines or polygons in it."),
        );
    }
    if !datasets.is_empty() {
        findings.add(
            Finding::new(
                FindingCode::GeojsonCrsAssumed,
                "The file does not say which coordinate system it uses, so longitude and latitude on WGS 84 (EPSG:4326) were assumed, as the GeoJSON standard says.",
            )
            .with_hint("Choose another coordinate system if the coordinates are not longitude and latitude."),
        );
    }
    datasets
}

/// Parses the text, adding an error if it is empty or not JSON.
fn parse(text: &str, findings: &mut Findings) -> Option<Value> {
    let text = text.trim_start_matches('\u{feff}');
    if text.trim().is_empty() {
        findings.add(
            Finding::new(FindingCode::FileEmpty, "The file has no data in it.")
                .with_hint("Check that you chose the right file."),
        );
        return None;
    }
    match serde_json::from_str(text) {
        Ok(value) => Some(value),
        Err(error) => {
            let reason = match error.classify() {
                Category::Eof => "it ends too early",
                _ => "it cannot be read there",
            };
            findings.add(
                Finding::new(
                    FindingCode::GeojsonJsonInvalid,
                    format!(
                        "The file is not valid JSON: {reason} (line {}, column {}).",
                        error.line(),
                        error.column()
                    ),
                )
                .with_hint("Check that the file is complete and was not edited by hand.")
                .at(Location::default().with_line(error.line() as u64)),
            );
            None
        }
    }
}

/// The features of the file, whatever shape it has: a FeatureCollection, one
/// Feature or a bare geometry. Adds an error and returns `None` for anything
/// else.
fn items<'a>(root: &'a Value, skips: &mut Skips, findings: &mut Findings) -> Option<Vec<Item<'a>>> {
    let structure_error = |findings: &mut Findings, message: &str| {
        findings.add(
            Finding::new(FindingCode::GeojsonStructureInvalid, message)
                .with_hint("A GeoJSON file holds a FeatureCollection, a Feature or a geometry."),
        );
    };
    let Some(object) = root.as_object() else {
        structure_error(
            findings,
            "The file is JSON but not GeoJSON: it should be an object with a \"type\".",
        );
        return None;
    };
    match object.get("type").and_then(Value::as_str) {
        Some("FeatureCollection") => {
            let Some(list) = object.get("features").and_then(Value::as_array) else {
                structure_error(
                    findings,
                    "The FeatureCollection has no list of \"features\".",
                );
                return None;
            };
            let mut items = Vec::with_capacity(list.len());
            for (index, value) in list.iter().enumerate() {
                match feature(value, index as u64) {
                    Some(item) => items.push(item),
                    None => skips
                        .not_a_feature
                        .hit(Location::default().with_element(index as u64)),
                }
            }
            Some(items)
        }
        Some("Feature") => feature(root, 0).map(|item| vec![item]),
        Some(kind) if GEOMETRY_TYPES.contains(&kind) => Some(vec![Item {
            index: 0,
            geometry: Some(root),
            properties: None,
        }]),
        _ => {
            structure_error(
                findings,
                "The file is JSON but not GeoJSON: its \"type\" should be FeatureCollection, Feature or a geometry type.",
            );
            None
        }
    }
}

fn feature(value: &Value, index: u64) -> Option<Item<'_>> {
    let object = value.as_object()?;
    (object.get("type").and_then(Value::as_str) == Some("Feature")).then(|| Item {
        index,
        geometry: object.get("geometry"),
        properties: object.get("properties").and_then(Value::as_object),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;
    use karmania_core::{ColumnType, CrsRef, Geometry, Kind, Positions, Value as Cell};
    use serde_json::json;

    fn codes(out: &ReadOutput) -> Vec<&'static str> {
        out.findings.iter().map(|f| f.code.as_str()).collect()
    }

    fn read(value: &serde_json::Value) -> ReadOutput {
        read_geojson(&value.to_string(), Some("test.geojson"))
    }

    fn collection(features: Vec<serde_json::Value>) -> serde_json::Value {
        json!({"type": "FeatureCollection", "features": features})
    }

    fn point(coordinates: serde_json::Value, properties: serde_json::Value) -> serde_json::Value {
        json!({
            "type": "Feature",
            "properties": properties,
            "geometry": {"type": "Point", "coordinates": coordinates}
        })
    }

    fn only(out: &ReadOutput) -> &Dataset {
        assert_eq!(out.datasets.len(), 1, "findings: {:?}", codes(out));
        &out.datasets[0]
    }

    fn points(d: &Dataset) -> &Positions {
        let Geometry::Points(p) = &d.geometry else {
            panic!("not points")
        };
        p
    }

    #[test]
    fn the_points_of_the_mixed_sample_are_imported_and_the_rest_is_reported() {
        let out = read_geojson(&fixtures::text("mixed.geojson"), Some("mixed.geojson"));
        // The road and the lease are not imported yet; one well has no elevation.
        assert_eq!(
            codes(&out),
            [
                "geojson.geometry.unsupported",
                "geojson.geometry.unsupported",
                "geojson.z.partial",
                "geojson.crs.assumed"
            ]
        );
        let messages: Vec<_> = out.findings.iter().map(|f| f.message.as_str()).collect();
        assert_eq!(
            &messages[..2],
            [
                "Features of type LineString cannot be imported, so they were left out.",
                "Features of type Polygon cannot be imported, so they were left out."
            ]
        );
        let d = only(&out);
        assert_eq!(
            (d.name.as_str(), d.kind(), d.has_z(), d.element_count()),
            ("mixed.geojson", Kind::Points, false, Some(2))
        );
        assert_eq!(d.crs, Some(CrsRef::Epsg { code: 4326 }));
        assert_eq!(
            d.provenance.source_file_name.as_deref(),
            Some("mixed.geojson")
        );
        assert_eq!(points(d).get(1), Some([55.4, 25.3, 0.0]));
        let columns: Vec<_> = d
            .attributes
            .columns()
            .iter()
            .map(|c| (c.name(), c.column_type()))
            .collect();
        assert_eq!(
            columns,
            [("depth", ColumnType::Float64), ("name", ColumnType::Utf8)]
        );
        assert_eq!(
            d.attributes.column("name").unwrap().get(1),
            Some(Cell::Utf8("Well B"))
        );
        let z = out
            .findings
            .iter()
            .find(|f| f.code.as_str() == "geojson.z.partial")
            .unwrap();
        // Well A is the first feature and has no elevation.
        assert_eq!((z.count, z.examples[0].element), (1, Some(0)));
        assert!(karmania_core::validate(d).is_loadable());
    }

    #[test]
    fn points_that_all_have_an_elevation_keep_it() {
        let out = read(&collection(vec![
            point(json!([55.3, 25.2, 10.5]), json!({"n": 1})),
            point(json!([55.4, 25.3, -2]), json!({"n": 2})),
        ]));
        assert_eq!(codes(&out), ["geojson.crs.assumed"]);
        let d = only(&out);
        assert!(d.has_z());
        assert_eq!(points(d).get(0), Some([55.3, 25.2, 10.5]));
        assert_eq!(points(d).get(1), Some([55.4, 25.3, -2.0]));
    }

    #[test]
    fn a_multipoint_gives_one_point_per_position_each_with_the_features_properties() {
        let out = read(&collection(vec![
            json!({
                "type": "Feature",
                "properties": {"site": "A", "n": 7},
                "geometry": {"type": "MultiPoint", "coordinates": [[1, 2], [3, 4], [5, 6]]}
            }),
            point(json!([7, 8]), json!({"site": "B", "n": 9})),
        ]));
        let d = only(&out);
        assert_eq!(d.element_count(), Some(4));
        assert_eq!(points(d).get(2), Some([5.0, 6.0, 0.0]));
        let n = d.attributes.column("n").unwrap();
        let values: Vec<_> = (0..4).map(|i| n.get(i)).collect();
        assert_eq!(
            values,
            [
                Some(Cell::Int64(7)),
                Some(Cell::Int64(7)),
                Some(Cell::Int64(7)),
                Some(Cell::Int64(9))
            ]
        );
    }

    #[test]
    fn a_single_feature_or_a_bare_geometry_is_read_too() {
        let feature = point(json!([1, 2]), json!({"k": "v"}));
        let out = read(&feature);
        assert_eq!(only(&out).element_count(), Some(1));
        assert!(only(&out).attributes.column("k").is_some());

        let bare = json!({"type": "MultiPoint", "coordinates": [[1, 2], [3, 4]]});
        let out = read(&bare);
        assert_eq!(only(&out).element_count(), Some(2));
        assert_eq!(only(&out).attributes.column_count(), 0);
    }

    #[test]
    fn a_name_is_made_up_when_the_file_has_none() {
        let text = collection(vec![point(json!([1, 2]), json!(null))]).to_string();
        assert_eq!(only(&read_geojson(&text, None)).name, "points");
        assert_eq!(only(&read_geojson(&text, Some("  "))).name, "points");
    }

    #[test]
    fn text_that_is_not_json_is_an_error_with_the_line() {
        let out = read_geojson(
            "{\n  \"type\": \"FeatureCollection\",\n  \"features\": [\n",
            None,
        );
        assert!(out.datasets.is_empty());
        assert_eq!(codes(&out), ["geojson.json.invalid"]);
        let f = &out.findings.as_slice()[0];
        assert_eq!(
            f.message,
            "The file is not valid JSON: it ends too early (line 4, column 0)."
        );
        assert_eq!(f.examples[0].line, Some(4));

        let out = read_geojson("{\"type\": oops}", None);
        assert_eq!(codes(&out), ["geojson.json.invalid"]);
        assert!(
            out.findings.as_slice()[0]
                .message
                .contains("cannot be read there")
        );
    }

    #[test]
    fn json_that_is_not_geojson_says_what_is_wrong() {
        let cases = [
            ("[1, 2]", "it should be an object"),
            ("\"hello\"", "it should be an object"),
            ("{}", "its \"type\" should be"),
            ("{\"type\": \"Banana\"}", "its \"type\" should be"),
            ("{\"type\": 5}", "its \"type\" should be"),
            (
                "{\"type\": \"FeatureCollection\"}",
                "no list of \"features\"",
            ),
            (
                "{\"type\": \"FeatureCollection\", \"features\": {}}",
                "no list of \"features\"",
            ),
        ];
        for (text, expected) in cases {
            let out = read_geojson(text, None);
            assert!(out.datasets.is_empty(), "{text}");
            assert_eq!(codes(&out), ["geojson.structure.invalid"], "{text}");
            assert!(
                out.findings.as_slice()[0].message.contains(expected),
                "{text}"
            );
        }
    }

    #[test]
    fn an_empty_file_and_a_byte_order_mark_are_handled() {
        for text in ["", "  \n\t ", "\u{feff}", "\u{feff}  "] {
            let out = read_geojson(text, None);
            assert_eq!(codes(&out), ["file.empty"], "{text:?}");
        }
        let with_mark = format!(
            "\u{feff}{}",
            collection(vec![point(json!([1, 2]), json!({}))])
        );
        assert_eq!(
            only(&read_geojson(&with_mark, None)).element_count(),
            Some(1)
        );
    }

    #[test]
    fn a_file_with_nothing_to_import_is_an_error_after_saying_why() {
        let out = read(&collection(vec![]));
        assert_eq!(codes(&out), ["geojson.features.none"]);
        assert!(out.datasets.is_empty());

        let out = read(&collection(vec![json!({
            "type": "Feature", "properties": {}, "geometry": {"type": "GeometryCollection", "geometries": []}
        })]));
        assert_eq!(
            codes(&out),
            ["geojson.geometry.unsupported", "geojson.features.none"]
        );
        assert!(out.datasets.is_empty());

        // A multipoint with no positions has no points either.
        let out = read(&json!({"type": "MultiPoint", "coordinates": []}));
        assert_eq!(codes(&out), ["geojson.features.none"]);
    }

    #[test]
    fn features_that_cannot_be_used_are_left_out_and_counted_by_reason_with_their_place() {
        let out = read(&collection(vec![
            point(json!([1, 2]), json!({})),              // 0: fine
            json!(5),                                     // 1: not a feature
            json!({"type": "Foo"}),                       // 2: not a feature
            json!({"type": "Feature", "properties": {}}), // 3: no geometry
            json!({"type": "Feature", "geometry": null}), // 4: no geometry
            point(json!(["a", "b"]), json!({})),          // 5: bad coordinates
            point(json!([1]), json!({})),                 // 6: bad coordinates
            point(json!(null), json!({})),                // 7: bad coordinates
            json!({"type": "Feature", "geometry": {"type": "Blob", "coordinates": [1, 2]}}), // 8
            json!({"type": "Feature", "geometry": {"coordinates": [1, 2]}}), // 9: no type
            json!({"type": "Feature", "geometry": {"type": "MultiPoint", "coordinates": [[1, 2], [3]]}}), // 10
            point(json!([3, 4]), json!({})), // 11: fine
        ]));
        assert_eq!(
            codes(&out),
            [
                "geojson.feature.invalid",
                "geojson.geometry.missing",
                "geojson.geometry.invalid",
                "geojson.crs.assumed"
            ]
        );
        let at = |code: &str| {
            let f = out
                .findings
                .iter()
                .find(|f| f.code.as_str() == code)
                .unwrap();
            (
                f.count,
                f.examples.iter().map(|l| l.element).collect::<Vec<_>>(),
            )
        };
        assert_eq!(at("geojson.feature.invalid"), (2, vec![Some(1), Some(2)]));
        assert_eq!(at("geojson.geometry.missing"), (2, vec![Some(3), Some(4)]));
        assert_eq!(
            at("geojson.geometry.invalid"),
            (
                6,
                vec![Some(5), Some(6), Some(7), Some(8), Some(9), Some(10)]
            )
        );
        // Features 0 and 11 are the points.
        assert_eq!(only(&out).element_count(), Some(2));
    }

    #[test]
    fn a_feature_with_one_bad_position_is_left_out_whole() {
        let out = read(&collection(vec![
            json!({"type": "Feature", "properties": {"a": 1},
                   "geometry": {"type": "MultiPoint", "coordinates": [[1, 2], "x"]}}),
            point(json!([5, 6]), json!({"a": 2})),
        ]));
        let d = only(&out);
        assert_eq!(d.element_count(), Some(1));
        assert_eq!(points(d).get(0), Some([5.0, 6.0, 0.0]));
        assert_eq!(
            d.attributes.column("a").unwrap().get(0),
            Some(Cell::Int64(2))
        );
    }

    #[test]
    fn positions_with_more_than_three_values_use_three_and_are_counted() {
        let out = read(&collection(vec![
            point(json!([1, 2, 3, 99]), json!({})),
            point(json!([4, 5, 6]), json!({})),
            point(json!([7, 8, 9, 1, 2]), json!({})),
        ]));
        assert_eq!(
            codes(&out),
            ["geojson.position.extra_values", "geojson.crs.assumed"]
        );
        let f = &out.findings.as_slice()[0];
        assert_eq!((f.count, f.examples[1].element), (2, Some(2)));
        let d = only(&out);
        assert!(d.has_z());
        assert_eq!(points(d).get(2), Some([7.0, 8.0, 9.0]));
    }

    #[test]
    fn properties_that_are_missing_null_or_not_an_object_give_no_columns_and_no_trouble() {
        let out = read(&collection(vec![
            json!({"type": "Feature", "geometry": {"type": "Point", "coordinates": [1, 2]}}),
            point(json!([3, 4]), json!(null)),
            point(json!([5, 6]), json!([1, 2])),
        ]));
        assert_eq!(codes(&out), ["geojson.crs.assumed"]);
        assert_eq!(only(&out).attributes.column_count(), 0);
        assert_eq!(only(&out).element_count(), Some(3));
    }

    #[test]
    fn extreme_numbers_are_kept_and_numbers_beyond_range_are_a_json_error() {
        let out = read(&collection(vec![point(
            json!([1.5e300, -2.5e-300, 1e-320]),
            json!({}),
        )]));
        assert_eq!(
            points(only(&out)).get(0),
            Some([1.5e300, -2.5e-300, 1e-320])
        );
        let out = read_geojson("{\"type\":\"Point\",\"coordinates\":[1e999, 2]}", None);
        assert_eq!(codes(&out), ["geojson.json.invalid"]);
    }

    #[test]
    fn absurdly_deep_nesting_is_an_error_not_a_crash() {
        let text = format!("{}{}", "[".repeat(100_000), "]".repeat(100_000));
        let out = read_geojson(&text, None);
        assert_eq!(codes(&out), ["geojson.json.invalid"]);
        assert!(out.datasets.is_empty());
    }

    #[test]
    fn projected_coordinates_in_a_file_with_no_crs_are_caught_by_validation() {
        let out = read(&collection(vec![point(
            json!([500_000.0, 2_765_000.0]),
            json!({}),
        )]));
        let report = karmania_core::validate(only(&out));
        assert!(
            report
                .findings()
                .any(|f| f.code.as_str() == "crs.geographic.out_of_range")
        );
    }

    #[test]
    fn reading_twice_gives_the_same_result() {
        let text = fixtures::text("mixed.geojson");
        assert_eq!(
            read_geojson(&text, Some("m.geojson")),
            read_geojson(&text, Some("m.geojson"))
        );
    }
}
