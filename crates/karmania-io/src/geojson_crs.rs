//! The coordinate system a GeoJSON file declares.
//!
//! RFC 7946 dropped the `crs` member: every file is WGS 84 longitude and latitude.
//! Older files can still carry the legacy member, which names a coordinate system
//! in one of a few forms. Only EPSG codes (and the OGC name `CRS84`, which is
//! WGS 84 longitude and latitude) are understood.

use serde_json::Value;

/// What a file says about its coordinate system.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FileCrs {
    /// There is no `crs` member, so WGS 84 longitude and latitude, as RFC 7946 says.
    Missing,
    /// The file names an EPSG coordinate system.
    Epsg(u32),
    /// There is a `crs` member that cannot be used: another kind of name, a link,
    /// or `null` (which means "unknown"). Holds the name if the file gave one.
    Unrecognized(Option<String>),
}

/// Reads the legacy `crs` member of a GeoJSON object.
pub(crate) fn file_crs(root: &Value) -> FileCrs {
    let Some(member) = root.get("crs") else {
        return FileCrs::Missing;
    };
    let properties = member.get("properties");
    match member.get("type").and_then(Value::as_str) {
        Some("name") => {
            let Some(name) = properties
                .and_then(|p| p.get("name"))
                .and_then(Value::as_str)
            else {
                return FileCrs::Unrecognized(None);
            };
            match epsg_code(name) {
                Some(code) => FileCrs::Epsg(code),
                None => FileCrs::Unrecognized(Some(name.chars().take(60).collect())),
            }
        }
        // An older form: {"type": "EPSG", "properties": {"code": 32640}}.
        Some("EPSG") => properties
            .and_then(|p| p.get("code"))
            .and_then(Value::as_u64)
            .and_then(|code| u32::try_from(code).ok())
            .filter(|&code| code > 0)
            .map_or(FileCrs::Unrecognized(None), FileCrs::Epsg),
        _ => FileCrs::Unrecognized(None),
    }
}

/// The EPSG code in a coordinate system name such as `EPSG:32640`,
/// `urn:ogc:def:crs:EPSG::32640` or `http://www.opengis.net/def/crs/EPSG/0/32640`.
fn epsg_code(name: &str) -> Option<u32> {
    let lower = name.trim().to_ascii_lowercase();
    if lower.ends_with("crs84") {
        return Some(4326);
    }
    if !lower.contains("epsg") {
        return None;
    }
    let tail = lower.rsplit([':', '/']).next()?;
    tail.parse::<u32>().ok().filter(|&code| code > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn named(name: &str) -> Value {
        json!({"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": name}}})
    }

    #[test]
    fn a_file_without_a_crs_member_is_missing_one() {
        assert_eq!(
            file_crs(&json!({"type": "FeatureCollection"})),
            FileCrs::Missing
        );
        assert_eq!(file_crs(&json!([1, 2])), FileCrs::Missing);
    }

    #[test]
    fn the_usual_ways_to_name_an_epsg_code_are_understood() {
        for name in [
            "urn:ogc:def:crs:EPSG::32640",
            "urn:ogc:def:crs:EPSG:6.6:32640",
            "EPSG:32640",
            "epsg:32640",
            "  EPSG:32640 ",
            "http://www.opengis.net/def/crs/EPSG/0/32640",
        ] {
            assert_eq!(file_crs(&named(name)), FileCrs::Epsg(32640), "{name}");
        }
    }

    #[test]
    fn crs84_is_wgs_84() {
        for name in [
            "urn:ogc:def:crs:OGC:1.3:CRS84",
            "urn:ogc:def:crs:OGC::CRS84",
            "CRS84",
            "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
        ] {
            assert_eq!(file_crs(&named(name)), FileCrs::Epsg(4326), "{name}");
        }
    }

    #[test]
    fn the_older_epsg_type_gives_its_code_as_a_number() {
        let member = |code: Value| json!({"crs": {"type": "EPSG", "properties": {"code": code}}});
        assert_eq!(file_crs(&member(json!(32640))), FileCrs::Epsg(32640));
        for bad in [
            json!(0),
            json!(-5),
            json!("32640"),
            json!(1.5),
            json!(5_000_000_000u64),
        ] {
            assert_eq!(
                file_crs(&member(bad.clone())),
                FileCrs::Unrecognized(None),
                "{bad}"
            );
        }
    }

    #[test]
    fn anything_else_is_unrecognized_and_keeps_the_name_if_there_is_one() {
        assert_eq!(
            file_crs(&named("My mine grid")),
            FileCrs::Unrecognized(Some("My mine grid".into()))
        );
        for name in [
            "EPSG:",
            "EPSG:abc",
            "EPSG:0",
            "EPSG:-3",
            "urn:ogc:def:crs:EPSG::",
        ] {
            assert!(
                matches!(file_crs(&named(name)), FileCrs::Unrecognized(Some(_))),
                "{name}"
            );
        }
        for member in [
            json!(null),
            json!(5),
            json!("EPSG:4326"),
            json!({"type": "link", "properties": {"href": "http://x/crs", "type": "proj4"}}),
            json!({"type": "name"}),
            json!({"type": "name", "properties": {"name": 5}}),
            json!({}),
        ] {
            let root = json!({"type": "Point", "crs": member});
            assert_eq!(file_crs(&root), FileCrs::Unrecognized(None), "{root}");
        }
    }

    #[test]
    fn a_very_long_name_is_cut_for_messages() {
        let long = "x".repeat(500);
        let FileCrs::Unrecognized(Some(name)) = file_crs(&named(&long)) else {
            panic!("expected a name");
        };
        assert_eq!(name.chars().count(), 60);
    }
}
