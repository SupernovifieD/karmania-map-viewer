//! Coordinate reference system references.
//!
//! A dataset names its CRS either by EPSG code or as a local (mine) grid with an
//! explicit length unit. A missing CRS is an error, reported by validation.
//! Looking up what an EPSG code means is a separate step, not done here.

use serde::{Deserialize, Serialize};

/// Length unit of a local grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Units {
    /// International metre.
    #[serde(rename = "m")]
    Metre,
    /// International foot, exactly 0.3048 m.
    #[serde(rename = "ft")]
    Foot,
    /// US survey foot, exactly 1200/3937 m.
    #[serde(rename = "us_ft")]
    UsSurveyFoot,
}

impl Units {
    /// The short name used in JSON: `m`, `ft` or `us_ft`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Units::Metre => "m",
            Units::Foot => "ft",
            Units::UsSurveyFoot => "us_ft",
        }
    }

    /// How many metres one of this unit is.
    #[must_use]
    pub const fn metres_per_unit(self) -> f64 {
        match self {
            Units::Metre => 1.0,
            Units::Foot => 0.3048,
            Units::UsSurveyFoot => 1200.0 / 3937.0,
        }
    }
}

/// How a dataset names its coordinate reference system.
///
/// JSON form: `{"kind":"epsg","code":32640}` or `{"kind":"local","units":"m"}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum CrsRef {
    /// A CRS from the EPSG registry, identified by its code.
    Epsg {
        /// The EPSG code, for example 4326 or 32640.
        code: u32,
    },
    /// A local grid, such as a mine grid, with an explicit length unit. Its
    /// position on the Earth is unknown, so it cannot be reprojected.
    Local {
        /// The unit of the grid's coordinates.
        units: Units,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crs_serializes_to_the_import_mapping_json_shape() {
        let epsg = serde_json::to_string(&CrsRef::Epsg { code: 32640 }).unwrap();
        assert_eq!(epsg, r#"{"kind":"epsg","code":32640}"#);
        let local = serde_json::to_string(&CrsRef::Local {
            units: Units::UsSurveyFoot,
        })
        .unwrap();
        assert_eq!(local, r#"{"kind":"local","units":"us_ft"}"#);
    }

    #[test]
    fn crs_round_trips_through_json() {
        for crs in [
            CrsRef::Epsg { code: 4326 },
            CrsRef::Local {
                units: Units::Metre,
            },
            CrsRef::Local { units: Units::Foot },
        ] {
            let json = serde_json::to_string(&crs).unwrap();
            assert_eq!(serde_json::from_str::<CrsRef>(&json).unwrap(), crs);
        }
    }

    #[test]
    fn malformed_crs_json_is_rejected_not_guessed() {
        for bad in [
            r#"{"kind":"epsg"}"#,
            r#"{"kind":"epsg","code":-1}"#,
            r#"{"kind":"epsg","code":4326.5}"#,
            r#"{"kind":"epsg","code":"4326"}"#,
            r#"{"kind":"local","units":"km"}"#,
            r#"{"kind":"local"}"#,
            r#"{"kind":"utm","zone":40}"#,
            r#"{"kind":"epsg","code":4326,"extra":1}"#,
            r#"{"code":4326}"#,
            "null",
        ] {
            assert!(
                serde_json::from_str::<CrsRef>(bad).is_err(),
                "accepted: {bad}"
            );
        }
    }

    #[test]
    fn unit_names_match_json_and_conversion_factors_are_exact() {
        for u in [Units::Metre, Units::Foot, Units::UsSurveyFoot] {
            assert_eq!(
                serde_json::to_string(&u).unwrap(),
                format!("\"{}\"", u.as_str())
            );
        }
        assert_eq!(Units::Metre.metres_per_unit(), 1.0);
        assert_eq!(Units::Foot.metres_per_unit(), 0.3048);
        let us = Units::UsSurveyFoot.metres_per_unit();
        assert!((us - 0.304_800_609_601_219_2).abs() < 1e-15);
        assert!(us > Units::Foot.metres_per_unit());
    }
}
