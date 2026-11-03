//! The map's coordinate system: which one it is, chosen from the first dataset that can be drawn.
//!
//! The map is drawn in one coordinate system, the map CRS, and every position is converted into it
//! in `f64`. The rule is deterministic: a dataset in a projected system or a local grid gives its own
//! system; a dataset in longitude and latitude gives the WGS 84 / UTM zone at the centre of its
//! extent, with a finding that says which zone and why.

use karmania_core::{BBox, CrsGeography, CrsKinds, CrsRef, Finding, FindingCode};
use karmania_crs::{CrsKind, Definitions, lookup};

/// The first EPSG code of WGS 84 / UTM, north of the equator (zone 1 is 32601).
const UTM_NORTH_BASE: u32 = 32600;
/// The first EPSG code of WGS 84 / UTM, south of the equator (zone 1 is 32701).
const UTM_SOUTH_BASE: u32 = 32700;
/// How many degrees of longitude a UTM zone covers.
const ZONE_WIDTH: f64 = 6.0;
/// How many UTM zones there are.
const ZONE_COUNT: u32 = 60;

/// The WGS 84 / UTM system for a longitude and latitude in degrees: zone
/// `floor((longitude + 180) / 6) + 1`, EPSG 326xx at the equator and north of it, 327xx south of it.
///
/// There are no special zones for Norway or Svalbard. A longitude outside -180 to 180 is wrapped
/// round the globe, and 180 is the meridian of -180, so it is in zone 1 (never a 61st zone).
/// `None` if either number is not finite.
#[must_use]
pub fn utm_crs(longitude: f64, latitude: f64) -> Option<CrsRef> {
    if !longitude.is_finite() || !latitude.is_finite() {
        return None;
    }
    let from_west = (longitude + 180.0).rem_euclid(360.0);
    // `from_west` is in [0, 360), so the zone is 1 to 60; the min only guards a rounding at 360.
    let zone = ((from_west / ZONE_WIDTH).floor() as u32 + 1).min(ZONE_COUNT);
    let base = if latitude >= 0.0 {
        UTM_NORTH_BASE
    } else {
        UTM_SOUTH_BASE
    };
    Some(CrsRef::Epsg { code: base + zone })
}

/// The map CRS a dataset's own system gives, with the finding that explains it, if there is one.
#[derive(Debug, Clone, PartialEq)]
pub struct MapCrsChoice {
    /// The coordinate system the map would be drawn in.
    pub crs: CrsRef,
    /// An info finding for a system that was chosen, not taken as it is (a UTM zone).
    pub finding: Option<Finding>,
}

/// The map CRS that the dataset in `crs`, with the extent `extent` in that system, gives; `None` if
/// its system cannot give one.
///
/// - A local grid, or a projected EPSG system that is in the definitions: its own system.
/// - A geographic EPSG system in degrees: WGS 84 / UTM at the centre of the extent ([`utm_crs`]),
///   with an info finding (`display.frame.utm_chosen`). A dataset across the antimeridian has its
///   centre on the wrong side of the globe, and gets the zone of that centre.
/// - Anything else (a code that is not in the definitions, a geocentric system, an angle in grads,
///   a system of another kind): none. Such a dataset is not drawn (see `drawable`).
#[must_use]
pub fn map_crs_for(crs: CrsRef, extent: &BBox) -> Option<MapCrsChoice> {
    let CrsRef::Epsg { code } = crs else {
        return Some(MapCrsChoice { crs, finding: None });
    };
    if Definitions.geography(code) == CrsGeography::Geographic {
        let longitude = (extent.min[0] + extent.max[0]) / 2.0;
        let latitude = (extent.min[1] + extent.max[1]) / 2.0;
        let utm = utm_crs(longitude, latitude)?;
        return Some(MapCrsChoice {
            crs: utm,
            finding: Some(utm_chosen(utm, longitude, latitude)),
        });
    }
    let info = lookup(code)?;
    (info.kind == CrsKind::Projected).then_some(MapCrsChoice { crs, finding: None })
}

fn utm_chosen(utm: CrsRef, longitude: f64, latitude: f64) -> Finding {
    let (code, name) = match utm {
        CrsRef::Epsg { code } => (code, lookup(code).map(|info| info.name)),
        CrsRef::Local { .. } => (0, None),
    };
    let name = name.unwrap_or_else(|| format!("EPSG:{code}"));
    let message = format!(
        "The map is drawn in {name} (EPSG:{code}): the data is in longitude and latitude, and its centre is at {}, {}.",
        degrees(longitude, 'E', 'W'),
        degrees(latitude, 'N', 'S'),
    );
    Finding::new(FindingCode::DisplayFrameUtmChosen, message)
        .with_hint("Change the map's coordinate system if another one suits the data better.")
}

/// A number of degrees to two decimals with its hemisphere: `57.30° E`.
fn degrees(value: f64, positive: char, negative: char) -> String {
    let hemisphere = if value < 0.0 { negative } else { positive };
    format!("{:.2}° {hemisphere}", value.abs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use karmania_core::Units;

    fn epsg(code: u32) -> CrsRef {
        CrsRef::Epsg { code }
    }

    fn extent(min: [f64; 2], max: [f64; 2]) -> BBox {
        BBox {
            min: [min[0], min[1], 0.0],
            max: [max[0], max[1], 0.0],
        }
    }

    #[test]
    fn a_projected_system_is_its_own_map_system() {
        let choice = map_crs_for(epsg(32640), &extent([500_000.0, 0.0], [600_000.0, 9.0])).unwrap();
        assert_eq!(
            choice,
            MapCrsChoice {
                crs: epsg(32640),
                finding: None
            }
        );
        // Another projected system, in feet.
        let choice = map_crs_for(epsg(2229), &extent([6e6, 2e6], [6.1e6, 2.1e6])).unwrap();
        assert_eq!(choice.crs, epsg(2229));
    }

    #[test]
    fn a_local_grid_is_its_own_map_system() {
        let local = CrsRef::Local { units: Units::Foot };
        let choice = map_crs_for(local, &extent([0.0, 0.0], [10.0, 10.0])).unwrap();
        assert_eq!(
            choice,
            MapCrsChoice {
                crs: local,
                finding: None
            }
        );
    }

    #[test]
    fn geographic_data_gets_the_utm_zone_of_the_centre_of_its_extent() {
        // The centre is 57.3 E, 25.2 N: zone floor(237.3 / 6) + 1 = 40, north.
        let choice = map_crs_for(epsg(4326), &extent([57.0, 25.0], [57.6, 25.4])).unwrap();
        assert_eq!(choice.crs, epsg(32640));
        let finding = choice.finding.unwrap();
        assert_eq!(finding.code.as_str(), "display.frame.utm_chosen");
        assert_eq!(
            finding.message,
            "The map is drawn in WGS 84 / UTM zone 40N (EPSG:32640): the data is in longitude and latitude, and its centre is at 57.30° E, 25.20° N."
        );
        // Another geographic system (NAD83) gets the same rule.
        let choice = map_crs_for(epsg(4269), &extent([-122.5, 37.0], [-122.3, 37.2])).unwrap();
        assert_eq!(choice.crs, epsg(32610));
    }

    #[test]
    fn south_of_the_equator_is_327xx_and_the_equator_is_north() {
        let south = map_crs_for(epsg(4326), &extent([151.0, -34.0], [151.4, -33.6])).unwrap();
        assert_eq!(south.crs, epsg(32756));
        assert!(
            south
                .finding
                .unwrap()
                .message
                .ends_with("151.20° E, 33.80° S.")
        );
        assert_eq!(utm_crs(10.0, 0.0), Some(epsg(32632)));
        assert_eq!(utm_crs(10.0, -0.0), Some(epsg(32632)));
        assert_eq!(utm_crs(10.0, -0.000_001), Some(epsg(32732)));
    }

    #[test]
    fn zone_edges_belong_to_the_zone_that_starts_there() {
        // Zone 1 is -180 to -174; -174 begins zone 2; 0 begins zone 31; 174 begins zone 60.
        for (longitude, zone) in [
            (-180.0, 1),
            (-174.000_001, 1),
            (-174.0, 2),
            (-0.000_001, 30),
            (0.0, 31),
            (173.999_999, 59),
            (174.0, 60),
            (179.999_999, 60),
        ] {
            assert_eq!(
                utm_crs(longitude, 10.0),
                Some(epsg(32600 + zone)),
                "{longitude}"
            );
        }
    }

    #[test]
    fn a_longitude_of_180_is_the_meridian_of_minus_180_and_wraps_round() {
        assert_eq!(utm_crs(180.0, 10.0), Some(epsg(32601)));
        assert_eq!(utm_crs(-180.0, 10.0), Some(epsg(32601)));
        assert_eq!(utm_crs(540.0, 10.0), Some(epsg(32601)));
        assert_eq!(utm_crs(-540.0, 10.0), Some(epsg(32601)));
        assert_eq!(utm_crs(190.0, 10.0), utm_crs(-170.0, 10.0));
    }

    #[test]
    fn a_position_that_is_not_finite_has_no_zone() {
        assert_eq!(utm_crs(f64::NAN, 0.0), None);
        assert_eq!(utm_crs(0.0, f64::INFINITY), None);
    }

    #[test]
    fn systems_that_cannot_give_a_map_system_give_none() {
        let any = extent([0.0, 0.0], [1.0, 1.0]);
        // Not in the definitions, geocentric, a geographic system in grads (Paris, EPSG:4807).
        for code in [99_999, 4978, 4807] {
            assert_eq!(map_crs_for(epsg(code), &any), None, "{code}");
        }
    }
}
