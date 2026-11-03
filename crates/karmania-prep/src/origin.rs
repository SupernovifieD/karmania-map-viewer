//! The frame: the map's coordinate system and the origin that positions are made relative to.
//!
//! A position is converted into the map CRS in `f64`, and what is sent to the GPU is `position -
//! origin`, as `f32`. A 32-bit float has about seven digits, so a UTM easting such as 512,345.12 m
//! (or a northing of 4,012,345.67 m) loses centimetres, while the same position 345.12 m from an origin
//! keeps them. The origin is a round number near the data, so that it is the same whenever it is
//! worked out from the same extent.

use karmania_core::{CrsGeography, CrsKinds, CrsRef};
use karmania_crs::Definitions;
use serde::{Deserialize, Serialize};

/// What the origin of x and y is rounded to, in map units (metres or feet).
const XY_STEP: f64 = 1_000.0;
/// What the origin of z is rounded to, in map units.
const Z_STEP: f64 = 100.0;
/// What the origin of x and y is rounded to when the map is in longitude and latitude: a whole
/// degree. A step of 1,000 would put the origin at 0, and an `f32` at 100 degrees is 0.85 m coarse.
const DEGREE_STEP: f64 = 1.0;

/// How the map's coordinate system was chosen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameSource {
    /// By Karmania, from the first dataset that can be drawn.
    Auto,
    /// By the person, in the map CRS dialog.
    User,
}

/// The map's coordinate system and the origin of what is drawn.
///
/// JSON form: `{"mapCrs":{"kind":"epsg","code":32640},"origin":[512000,4012000,0],"source":"auto"}`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    /// The coordinate system the map is drawn in.
    pub map_crs: CrsRef,
    /// A point in map units: every position sent to the GPU is relative to it.
    pub origin: [f64; 3],
    /// How the map CRS was chosen.
    pub source: FrameSource,
}

impl Frame {
    /// A frame whose origin is [`origin_near`] the centre of the extent of the first drawable dataset
    /// (`centre`, in the map CRS).
    #[must_use]
    pub fn new(map_crs: CrsRef, centre: [f64; 3], source: FrameSource) -> Self {
        Self {
            map_crs,
            origin: origin_near(map_crs, centre),
            source,
        }
    }

    /// The position relative to the origin, as `f32`: `(position - origin)` is worked out in `f64`
    /// and then rounded once. A coordinate that is not finite stays not finite.
    #[must_use]
    pub fn rebase(&self, position: [f64; 3]) -> [f32; 3] {
        let [x, y, z] = position;
        let [ox, oy, oz] = self.origin;
        [(x - ox) as f32, (y - oy) as f32, (z - oz) as f32]
    }

    /// Interleaved `x y z` positions relative to the origin, as `f32` (see [`Frame::rebase`]). A
    /// trailing incomplete triple is left out.
    #[must_use]
    pub fn rebase_all(&self, xyz: &[f64]) -> Vec<f32> {
        let mut out = Vec::with_capacity(xyz.len() - xyz.len() % 3);
        for position in xyz.as_chunks::<3>().0 {
            out.extend(self.rebase(*position));
        }
        out
    }
}

/// The origin for a map in `map_crs` whose first drawable dataset is centred at `centre`: x and y
/// rounded to the nearest multiple of 1,000 map units, z to the nearest 100 (halves away from zero).
/// For a map in longitude and latitude x and y are rounded to a whole degree instead, since 1,000
/// degrees is no origin at all. A centre that is not finite gives 0 on that axis.
#[must_use]
pub fn origin_near(map_crs: CrsRef, centre: [f64; 3]) -> [f64; 3] {
    let geographic = matches!(
        map_crs,
        CrsRef::Epsg { code } if Definitions.geography(code) == CrsGeography::Geographic
    );
    let xy = if geographic { DEGREE_STEP } else { XY_STEP };
    let [x, y, z] = centre;
    [round_to(x, xy), round_to(y, xy), round_to(z, Z_STEP)]
}

fn round_to(value: f64, step: f64) -> f64 {
    let rounded = (value / step).round() * step;
    if rounded.is_finite() { rounded } else { 0.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    const UTM40: CrsRef = CrsRef::Epsg { code: 32640 };

    #[test]
    fn the_origin_is_the_centre_rounded_to_1000_and_z_to_100() {
        let origin = origin_near(UTM40, [512_345.12, 4_012_345.67, 249.0]);
        assert_eq!(origin, [512_000.0, 4_012_000.0, 200.0]);
        let origin = origin_near(UTM40, [512_500.0, 4_012_999.99, 250.0]);
        assert_eq!(origin, [513_000.0, 4_013_000.0, 300.0]);
        // Negative coordinates round to the nearest multiple too, halves away from zero.
        let origin = origin_near(UTM40, [-1_500.0, -499.99, -50.0]);
        assert_eq!(origin, [-2_000.0, -0.0, -100.0]);
    }

    #[test]
    fn a_map_in_degrees_has_its_origin_at_a_whole_degree() {
        let wgs84 = CrsRef::Epsg { code: 4326 };
        assert_eq!(
            origin_near(wgs84, [57.3, -25.7, 120.0]),
            [57.0, -26.0, 100.0]
        );
    }

    #[test]
    fn a_centre_that_is_not_finite_gives_zero() {
        let origin = origin_near(UTM40, [f64::NAN, f64::INFINITY, f64::NEG_INFINITY]);
        assert_eq!(origin, [0.0, 0.0, 0.0]);
    }

    #[test]
    fn the_frame_serializes_in_the_form_of_the_contract() {
        let frame = Frame::new(UTM40, [512_345.0, 4_012_345.0, 0.0], FrameSource::Auto);
        let json = serde_json::to_string(&frame).unwrap();
        assert_eq!(
            json,
            r#"{"mapCrs":{"kind":"epsg","code":32640},"origin":[512000.0,4012000.0,0.0],"source":"auto"}"#
        );
        assert_eq!(serde_json::from_str::<Frame>(&json).unwrap(), frame);
    }

    /// The precision promise of section 9.1: within 100,000 map units of the origin, positions keep
    /// 1 cm, and points 1 cm apart at UTM-sized coordinates stay apart.
    #[test]
    fn points_a_centimetre_apart_stay_apart_up_to_100_km_from_the_origin() {
        let frame = Frame::new(UTM40, [512_345.0, 4_012_345.0, 0.0], FrameSource::Auto);
        for distance in [0.0, 1.0, 345.123, 1_000.0, 25_000.0, 50_000.0, 99_999.0] {
            for sign in [1.0, -1.0] {
                let x = frame.origin[0] + sign * distance + 0.123;
                let y = frame.origin[1] + sign * distance + 0.456;
                let a = frame.rebase([x, y, 12.34]);
                let b = frame.rebase([x + 0.01, y + 0.01, 12.34]);
                assert!(a[0] < b[0] && a[1] < b[1], "apart at {distance}");
                // Each is within half a centimetre of where it should be, so a centimetre
                // is kept (the grid of an f32 at 131,072 is 7.8 mm).
                let back = f64::from(a[0]) + frame.origin[0];
                assert!((back - x).abs() < 0.005, "{distance}: {back} vs {x}");
                assert!(((f64::from(a[2]) + frame.origin[2]) - 12.34).abs() < 0.005);
            }
        }
    }

    #[test]
    fn the_same_points_run_together_in_f32_without_the_origin() {
        // At a northing of 4,012,345 m an f32 can only say 0.25 m: this is what rebasing is for.
        let a = (4_012_345.10_f64) as f32;
        let b = (4_012_345.11_f64) as f32;
        assert_eq!(a, b);
        let frame = Frame::new(UTM40, [512_000.0, 4_012_345.0, 0.0], FrameSource::Auto);
        let (c, d) = (
            frame.rebase([512_000.0, 4_012_345.10, 0.0]),
            frame.rebase([512_000.0, 4_012_345.11, 0.0]),
        );
        assert!(c[1] < d[1]);
    }

    #[test]
    fn many_positions_are_rebased_in_order_and_a_partial_triple_is_dropped() {
        let frame = Frame {
            map_crs: UTM40,
            origin: [1_000.0, 2_000.0, 100.0],
            source: FrameSource::User,
        };
        let out = frame.rebase_all(&[1_001.5, 1_998.0, 100.25, 1_000.0, 2_000.0, 100.0, 7.0]);
        assert_eq!(out, [1.5, -2.0, 0.25, 0.0, 0.0, 0.0]);
        assert!(frame.rebase([f64::NAN, 2_000.0, 100.0])[0].is_nan());
    }
}
