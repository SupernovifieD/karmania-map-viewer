//! Looking up an EPSG code.

use crate::info::{CrsInfo, describe};

/// Looks up an EPSG code. `None` if the code is not in the definitions: a code that is not in
/// the registry, or one above 65535, which the definitions cannot hold (every code in use is
/// below it).
#[must_use]
pub fn lookup(code: u32) -> Option<CrsInfo> {
    let definition = crate::registry::get(u16::try_from(code).ok()?)?;
    Some(describe(code, definition.wkt))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::info::{AxisUnits, CrsKind};

    fn info(code: u32) -> CrsInfo {
        lookup(code).unwrap_or_else(|| panic!("EPSG:{code} should be in the definitions"))
    }

    #[test]
    fn wgs_84_is_geographic_in_degrees() {
        let wgs84 = info(4326);
        assert_eq!(wgs84.name, "WGS 84");
        assert_eq!(
            (wgs84.kind, wgs84.units),
            (CrsKind::Geographic, AxisUnits::Degree)
        );
        assert_eq!(wgs84.metres_per_unit, None);
        assert_eq!(wgs84.code, 4326);
    }

    #[test]
    fn a_utm_zone_is_projected_in_metres() {
        let utm = info(32640);
        assert_eq!(utm.name, "WGS 84 / UTM zone 40N");
        assert_eq!(
            (utm.kind, utm.units),
            (CrsKind::Projected, AxisUnits::Metre)
        );
        assert_eq!(utm.metres_per_unit, Some(1.0));
    }

    #[test]
    fn a_state_plane_zone_in_us_survey_feet_has_its_foot() {
        let california = info(2229);
        assert_eq!(california.name, "NAD83 / California zone 5 (ftUS)");
        assert_eq!(
            (california.kind, california.units),
            (CrsKind::Projected, AxisUnits::UsSurveyFoot)
        );
        assert_eq!(california.metres_per_unit, Some(1200.0 / 3937.0));
    }

    #[test]
    fn the_british_national_grid_is_projected_in_metres() {
        let grid = info(27700);
        assert_eq!(grid.name, "OSGB 1936 / British National Grid");
        assert_eq!(
            (grid.kind, grid.units),
            (CrsKind::Projected, AxisUnits::Metre)
        );
    }

    #[test]
    fn geocentric_systems_are_other_with_their_metres() {
        for (code, name) in [(4978, "WGS 84"), (3822, "TWD97")] {
            let geocentric = info(code);
            assert_eq!(geocentric.name, name, "{code}");
            assert_eq!(
                (geocentric.kind, geocentric.units),
                (CrsKind::Other, AxisUnits::Metre),
                "{code}"
            );
            assert_eq!(geocentric.metres_per_unit, Some(1.0), "{code}");
        }
    }

    #[test]
    fn an_entry_without_a_definition_is_other_under_its_code() {
        let empty = info(3993);
        assert_eq!(empty.name, "EPSG:3993");
        assert_eq!(
            (empty.kind, empty.units, empty.metres_per_unit),
            (CrsKind::Other, AxisUnits::Other, None)
        );
    }

    #[test]
    fn compound_bound_and_newer_style_definitions_are_read_too() {
        let compound = info(3901);
        assert_eq!(
            compound.name,
            "KKJ / Finland Uniform Coordinate System + N60 height"
        );
        assert_eq!(
            (compound.kind, compound.units),
            (CrsKind::Projected, AxisUnits::Metre)
        );
        let bound = info(3823);
        assert_eq!(
            (bound.name.as_str(), bound.kind),
            ("TWD97", CrsKind::Geographic)
        );
        let three_d = info(4327);
        assert_eq!(
            (three_d.name.as_str(), three_d.kind, three_d.units),
            ("WGS 84 (3D)", CrsKind::Geographic, AxisUnits::Degree)
        );
        assert_eq!(info(4269).kind, CrsKind::Geographic);
    }

    #[test]
    fn unknown_codes_are_none_including_ones_the_definitions_cannot_hold() {
        for code in [0, 1, 99, 99_999, 65_536, u32::MAX] {
            assert_eq!(lookup(code), None, "{code}");
        }
    }

    #[test]
    fn every_definition_of_the_registry_is_described_and_the_counts_are_those_of_this_version() {
        let mut tally: BTreeMap<(&str, &str), u32> = BTreeMap::new();
        for code in 0..=u16::MAX {
            let Some(described) = lookup(u32::from(code)) else {
                continue;
            };
            assert_eq!(described.code, u32::from(code));
            assert!(!described.name.is_empty(), "{code}");
            // Degrees belong to geographic systems only, and a system has its metres exactly when
            // the unit is one the core can scale.
            if described.units == AxisUnits::Degree {
                assert_eq!(described.kind, CrsKind::Geographic, "{code}");
            }
            assert_eq!(
                described.metres_per_unit.is_some(),
                matches!(
                    described.units,
                    AxisUnits::Metre | AxisUnits::Foot | AxisUnits::UsSurveyFoot
                ),
                "{code}"
            );
            *tally
                .entry((described.kind.as_str(), described.units.as_str()))
                .or_insert(0) += 1;
        }
        // If `crs-definitions` is updated, or the reading of units changes, these change: look at
        // which entries moved before updating the numbers.
        let expected: BTreeMap<(&str, &str), u32> = [
            (("geographic", "degree"), 754),
            (("geographic", "other"), 9),
            (("other", "m"), 196),
            (("other", "other"), 8),
            (("projected", "ft"), 155),
            (("projected", "m"), 4157),
            (("projected", "other"), 32),
            (("projected", "us_ft"), 873),
        ]
        .into_iter()
        .collect();
        assert_eq!(tally, expected);
    }
}
