//! What a coordinate system is: its name, whether it is geographic or projected, and the
//! unit of its horizontal axes. These are the shapes of the engine's `CrsInfo` contract.

use karmania_core::Units;
use serde::Serialize;

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

#[cfg(test)]
mod tests {
    use super::*;

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
