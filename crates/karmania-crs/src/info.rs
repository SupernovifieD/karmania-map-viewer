//! What a coordinate system is: its name, whether it is geographic or projected, and the
//! unit of its horizontal axes. These are the shapes of the engine's `CrsInfo` contract, and
//! [`describe`] reads them from a WKT definition.

use karmania_core::Units;
use serde::Serialize;

use crate::wkt::{self, Node};

/// Whether a coordinate system uses angles on the Earth or a flat map grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CrsKind {
    /// Longitude and latitude, in angular units.
    Geographic,
    /// Easting and northing on a map projection, in length units.
    Projected,
    /// Anything else: geocentric systems, or an entry with no usable definition.
    Other,
}

impl CrsKind {
    /// The lowercase name used in JSON: `geographic`, `projected` or `other`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            CrsKind::Geographic => "geographic",
            CrsKind::Projected => "projected",
            CrsKind::Other => "other",
        }
    }
}

/// The unit of a coordinate system's horizontal axes, as far as Karmania can scale it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum AxisUnits {
    /// International metre.
    #[serde(rename = "m")]
    Metre,
    /// International foot, exactly 0.3048 m.
    #[serde(rename = "ft")]
    Foot,
    /// US survey foot, exactly 1200/3937 m.
    #[serde(rename = "us_ft")]
    UsSurveyFoot,
    /// Degrees of longitude and latitude.
    #[serde(rename = "degree")]
    Degree,
    /// Any other unit (a grad, a radian, Clarke's foot, a link, ...), or none stated.
    #[serde(rename = "other")]
    Other,
}

impl AxisUnits {
    /// The short name used in JSON: `m`, `ft`, `us_ft`, `degree` or `other`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            AxisUnits::Metre => "m",
            AxisUnits::Foot => "ft",
            AxisUnits::UsSurveyFoot => "us_ft",
            AxisUnits::Degree => "degree",
            AxisUnits::Other => "other",
        }
    }

    /// How many metres one unit is; `None` for degrees and for other units.
    #[must_use]
    pub const fn metres_per_unit(self) -> Option<f64> {
        match self {
            AxisUnits::Metre => Some(Units::Metre.metres_per_unit()),
            AxisUnits::Foot => Some(Units::Foot.metres_per_unit()),
            AxisUnits::UsSurveyFoot => Some(Units::UsSurveyFoot.metres_per_unit()),
            AxisUnits::Degree | AxisUnits::Other => None,
        }
    }
}

/// What an EPSG code means.
///
/// JSON form: `{"code":32640,"name":"WGS 84 / UTM zone 40N","kind":"projected","units":"m",
/// "metresPerUnit":1.0}`; `metresPerUnit` is left out for degrees and other units.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrsInfo {
    /// The EPSG code.
    pub code: u32,
    /// The system's name, for example `WGS 84 / UTM zone 40N`. For a compound system it is the
    /// full compound name; for an entry without a definition it is `EPSG:<code>`.
    pub name: String,
    /// Geographic, projected or other.
    pub kind: CrsKind,
    /// The unit of the horizontal axes.
    pub units: AxisUnits,
    /// How many metres one unit is, for metres and feet.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metres_per_unit: Option<f64>,
}

/// How near a unit's factor has to be to a known one: far inside the distance between the
/// international foot and the US survey foot (6e-7 m), so no unit takes the other's name.
const FACTOR_TOLERANCE: f64 = 1e-12;

/// Describes one definition, given as the EPSG `code` and the WKT text of the definition.
///
/// Compound and bound systems report their horizontal part, because that is what places 2D data.
/// Text that cannot be read, or an empty definition, gives the kind `other` with the name
/// `EPSG:<code>`.
#[must_use]
pub fn describe(code: u32, wkt_text: &str) -> CrsInfo {
    let fallback = || CrsInfo {
        code,
        name: format!("EPSG:{code}"),
        kind: CrsKind::Other,
        units: AxisUnits::Other,
        metres_per_unit: None,
    };
    let Some(root) = wkt::parse(wkt_text) else {
        return fallback();
    };
    let name = wkt::first_text(&root).unwrap_or_else(|| format!("EPSG:{code}"));
    let Some(core) = wkt::horizontal_part(&root) else {
        return CrsInfo { name, ..fallback() };
    };
    let kind = match core.keyword() {
        Some("PROJCS" | "PROJCRS") => CrsKind::Projected,
        Some("GEOGCS" | "GEOGCRS") => CrsKind::Geographic,
        _ => CrsKind::Other,
    };
    let units = unit_factor(core, kind).map_or(AxisUnits::Other, |factor| classify(kind, factor));
    CrsInfo {
        code,
        name,
        kind,
        units,
        metres_per_unit: units.metres_per_unit(),
    }
}

/// The factor of a system's own axis unit: its direct `UNIT` child. Geographic systems written
/// in the newer style keep it in an `ANGLEUNIT` further in.
fn unit_factor(core: &Node, kind: CrsKind) -> Option<f64> {
    let direct = core
        .args()
        .iter()
        .find(|n| matches!(n.keyword(), Some("UNIT" | "LENGTHUNIT" | "ANGLEUNIT")));
    let node = direct.or_else(|| {
        (kind == CrsKind::Geographic)
            .then(|| wkt::find_keyword(core, "ANGLEUNIT"))
            .flatten()
    })?;
    let [Node::Text(_), Node::Number(factor), ..] = node.args() else {
        return None;
    };
    Some(*factor)
}

/// Names a unit by its factor (radians for an angle, metres for a length), not by its name,
/// which the registry spells in several ways.
fn classify(kind: CrsKind, factor: f64) -> AxisUnits {
    let near = |expected: f64| (factor - expected).abs() <= FACTOR_TOLERANCE;
    if kind == CrsKind::Geographic {
        return if near(std::f64::consts::PI / 180.0) {
            AxisUnits::Degree
        } else {
            AxisUnits::Other
        };
    }
    if near(Units::Metre.metres_per_unit()) {
        AxisUnits::Metre
    } else if near(Units::Foot.metres_per_unit()) {
        AxisUnits::Foot
    } else if near(Units::UsSurveyFoot.metres_per_unit()) {
        AxisUnits::UsSurveyFoot
    } else {
        AxisUnits::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEGREE: &str = r#"UNIT["degree",0.0174532925199433]"#;

    fn projected(unit: &str) -> String {
        format!(r#"PROJCS["Grid",GEOGCS["Datum",{DEGREE}],PROJECTION["P"],{unit},AXIS["X",EAST]]"#)
    }

    #[test]
    fn a_geographic_system_reports_degrees_and_no_metres() {
        let info = describe(4326, &format!(r#"GEOGCS["WGS 84",DATUM["d"],{DEGREE}]"#));
        assert_eq!(
            (info.name.as_str(), info.kind),
            ("WGS 84", CrsKind::Geographic)
        );
        assert_eq!(
            (info.units, info.metres_per_unit),
            (AxisUnits::Degree, None)
        );
    }

    #[test]
    fn newer_style_geographic_definitions_keep_the_angle_unit_deeper_in() {
        let wkt = r#"GEOGCRS["WGS 84 (3D)",DATUM["d"],CS[ellipsoidal,3],AXIS["lat",north,ANGLEUNIT["degree",0.0174532925199433]]]"#;
        let info = describe(4327, wkt);
        assert_eq!(
            (info.name.as_str(), info.kind, info.units),
            ("WGS 84 (3D)", CrsKind::Geographic, AxisUnits::Degree)
        );
    }

    #[test]
    fn angle_units_other_than_the_degree_are_other() {
        for factor in ["0.015707963267948967", "1"] {
            let wkt = format!(r#"GEOGCS["G",DATUM["d"],UNIT["u",{factor}]]"#);
            assert_eq!(describe(1, &wkt).units, AxisUnits::Other, "{factor}");
        }
    }

    #[test]
    fn a_projected_system_reports_its_length_unit_and_its_metres() {
        let metre = describe(32640, &projected(r#"UNIT["metre",1]"#));
        assert_eq!(
            (metre.kind, metre.units),
            (CrsKind::Projected, AxisUnits::Metre)
        );
        assert_eq!(metre.metres_per_unit, Some(1.0));
        let foot = describe(1, &projected(r#"UNIT["foot",0.3048]"#));
        assert_eq!(
            (foot.units, foot.metres_per_unit),
            (AxisUnits::Foot, Some(0.3048))
        );
        // The way the registry writes it, fifteen digits, and in full.
        for factor in ["0.304800609601219", "0.3048006096012192"] {
            let us = describe(
                2229,
                &projected(&format!(r#"UNIT["US survey foot",{factor}]"#)),
            );
            assert_eq!(us.units, AxisUnits::UsSurveyFoot, "{factor}");
            assert_eq!(us.metres_per_unit, Some(1200.0 / 3937.0));
        }
    }

    #[test]
    fn the_international_and_the_us_survey_foot_are_not_taken_for_each_other() {
        let near_foot = describe(1, &projected(r#"UNIT["foot",0.3048000001]"#));
        assert_eq!(near_foot.units, AxisUnits::Other);
        assert_ne!(
            describe(1, &projected(r#"UNIT["x",0.3048]"#)).units,
            describe(1, &projected(r#"UNIT["x",0.3048006096012192]"#)).units
        );
    }

    #[test]
    fn other_length_units_are_other_and_have_no_metres() {
        for factor in ["0.3047972654", "0.201168", "20.1168"] {
            let info = describe(1, &projected(&format!(r#"UNIT["u",{factor}]"#)));
            assert_eq!(
                (info.kind, info.units, info.metres_per_unit),
                (CrsKind::Projected, AxisUnits::Other, None)
            );
        }
    }

    #[test]
    fn the_unit_of_the_datum_below_a_projected_system_is_not_its_own() {
        // Only a UNIT that is a direct child of the system counts, not the degree inside GEOGCS.
        let no_own_unit =
            r#"PROJCS["Grid",GEOGCS["Datum",UNIT["degree",0.0174532925199433]],PROJECTION["P"]]"#;
        assert_eq!(describe(1, no_own_unit).units, AxisUnits::Other);
    }

    #[test]
    fn compound_systems_report_their_horizontal_part_under_the_compound_name() {
        let wkt = format!(
            r#"COMPD_CS["KKJ + N60 height",{},VERT_CS["N60 height",UNIT["metre",1]]]"#,
            projected(r#"UNIT["metre",1]"#)
        );
        let info = describe(3901, &wkt);
        assert_eq!(
            (info.name.as_str(), info.kind, info.units),
            ("KKJ + N60 height", CrsKind::Projected, AxisUnits::Metre)
        );
    }

    #[test]
    fn a_geocentric_system_is_other_with_its_metres() {
        let info = describe(
            3822,
            r#"GEOCCS["TWD97",DATUM["d"],PRIMEM["g",0],UNIT["metre",1]]"#,
        );
        assert_eq!((info.name.as_str(), info.kind), ("TWD97", CrsKind::Other));
        assert_eq!(
            (info.units, info.metres_per_unit),
            (AxisUnits::Metre, Some(1.0))
        );
    }

    #[test]
    fn a_definition_that_is_empty_or_unreadable_is_other_under_its_code() {
        for text in [
            "",
            "GEOGCS[",
            "not wkt",
            r#"VERT_CS["height",UNIT["metre",1]]"#,
        ] {
            let info = describe(3993, text);
            assert_eq!(info.kind, CrsKind::Other, "{text:?}");
            assert_eq!(
                (info.units, info.metres_per_unit),
                (AxisUnits::Other, None),
                "{text:?}"
            );
        }
        assert_eq!(describe(3993, "").name, "EPSG:3993");
        // A readable definition that is not a horizontal one keeps its own name.
        assert_eq!(
            describe(5, r#"VERT_CS["height",UNIT["metre",1]]"#).name,
            "height"
        );
    }

    #[test]
    fn it_serializes_to_the_engine_contract() {
        let projected = CrsInfo {
            code: 32640,
            name: "WGS 84 / UTM zone 40N".to_string(),
            kind: CrsKind::Projected,
            units: AxisUnits::Metre,
            metres_per_unit: Some(1.0),
        };
        assert_eq!(
            serde_json::to_string(&projected).unwrap(),
            r#"{"code":32640,"name":"WGS 84 / UTM zone 40N","kind":"projected","units":"m","metresPerUnit":1.0}"#
        );
        let geographic = CrsInfo {
            code: 4326,
            name: "WGS 84".to_string(),
            kind: CrsKind::Geographic,
            units: AxisUnits::Degree,
            metres_per_unit: None,
        };
        assert_eq!(
            serde_json::to_string(&geographic).unwrap(),
            r#"{"code":4326,"name":"WGS 84","kind":"geographic","units":"degree"}"#
        );
    }

    #[test]
    fn every_name_is_the_one_written_in_json() {
        for units in [
            AxisUnits::Metre,
            AxisUnits::Foot,
            AxisUnits::UsSurveyFoot,
            AxisUnits::Degree,
            AxisUnits::Other,
        ] {
            assert_eq!(
                serde_json::to_string(&units).unwrap(),
                format!("\"{}\"", units.as_str())
            );
        }
        for kind in [CrsKind::Geographic, CrsKind::Projected, CrsKind::Other] {
            assert_eq!(
                serde_json::to_string(&kind).unwrap(),
                format!("\"{}\"", kind.as_str())
            );
        }
    }

    #[test]
    fn metres_are_known_for_lengths_the_core_can_scale_and_for_nothing_else() {
        assert_eq!(AxisUnits::Metre.metres_per_unit(), Some(1.0));
        assert_eq!(AxisUnits::Foot.metres_per_unit(), Some(0.3048));
        assert_eq!(
            AxisUnits::UsSurveyFoot.metres_per_unit(),
            Some(1200.0 / 3937.0)
        );
        assert_eq!(AxisUnits::Degree.metres_per_unit(), None);
        assert_eq!(AxisUnits::Other.metres_per_unit(), None);
    }
}
