//! Positions of a dataset, in the map's coordinate system and relative to the frame's origin.

use karmania_core::{CrsRef, Finding, Findings, Positions};
use karmania_crs::Transformer;

use crate::drawable::not_convertible;
use crate::origin::Frame;

/// What preparing one dataset gives: the buffers, and the findings made on the way.
#[derive(Debug, Clone, PartialEq)]
pub struct Prepared<T> {
    /// The buffers for the renderer.
    pub buffers: T,
    /// What was found: positions that could not be converted (`crs.transform.not_finite`, with the first
    /// 0-based vertex numbers), and whatever the kind adds.
    pub findings: Findings,
}

/// `positions` of a dataset in `own`, converted to the frame's map system in `f64` and then made
/// relative to the origin as `f32` (interleaved `x y z`, `3 * positions.len()` values, in the order of
/// the positions).
///
/// A position that is not finite, or that cannot be converted, stays in its place as NaN (so that the
/// numbers of the elements do not change) and the renderer leaves it out; the ones that could not be
/// converted are counted in a `crs.transform.not_finite` finding. Heights are not converted.
///
/// # Errors
///
/// A `display.crs.not_convertible` finding, if the two systems cannot be converted between (call
/// [`crate::drawable`] first, which says so before any work is done).
pub fn project(
    positions: &Positions,
    own: CrsRef,
    frame: &Frame,
    findings: &mut Findings,
) -> Result<Vec<f32>, Finding> {
    let transformer =
        Transformer::new(own, frame.map_crs).map_err(|cause| not_convertible(&cause))?;
    if transformer.is_identity() {
        return Ok(frame.rebase_all(positions.as_slice()));
    }
    let mut xyz = positions.as_slice().to_vec();
    transformer.convert_in_place(&mut xyz, findings);
    Ok(frame.rebase_all(&xyz))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::FrameSource;
    use karmania_core::Units;

    fn positions(xy: &[(f64, f64)]) -> Positions {
        let x: Vec<f64> = xy.iter().map(|p| p.0).collect();
        let y: Vec<f64> = xy.iter().map(|p| p.1).collect();
        Positions::from_xyz(&x, &y, None, &mut Findings::new()).unwrap()
    }

    fn frame(crs: CrsRef, origin: [f64; 3]) -> Frame {
        Frame {
            map_crs: crs,
            origin,
            source: FrameSource::Auto,
        }
    }

    const UTM40: CrsRef = CrsRef::Epsg { code: 32640 };

    #[test]
    fn the_same_system_is_only_made_relative_to_the_origin() {
        let p = positions(&[(512_345.5, 4_012_345.25), (512_000.0, 4_012_000.0)]);
        let mut findings = Findings::new();
        let out = project(
            &p,
            UTM40,
            &frame(UTM40, [512_000.0, 4_012_000.0, 100.0]),
            &mut findings,
        );
        assert_eq!(out.unwrap(), [345.5, 345.25, -100.0, 0.0, 0.0, -100.0]);
        assert!(findings.is_empty());
    }

    #[test]
    fn another_system_is_converted_in_f64_first() {
        let p = positions(&[(57.3, 25.2)]);
        let map = frame(UTM40, [530_000.0, 2_790_000.0, 0.0]);
        let mut findings = Findings::new();
        let out = project(&p, CrsRef::Epsg { code: 4326 }, &map, &mut findings).unwrap();
        let [cx, cy] = Transformer::new(CrsRef::Epsg { code: 4326 }, UTM40)
            .unwrap()
            .convert(57.3, 25.2);
        assert_eq!(
            out,
            [(cx - 530_000.0) as f32, (cy - 2_790_000.0) as f32, 0.0]
        );
        // 57.3 E is 0.3 degrees from the central meridian: easting about 530 km, northing about 2,790 km.
        assert!(out[0].abs() < 2_000.0 && out[1].abs() < 20_000.0, "{out:?}");
    }

    #[test]
    fn positions_that_cannot_be_converted_stay_as_nan_and_are_counted() {
        // Latitude 95 is not on the Earth; the second position is fine.
        let p = positions(&[(57.0, 95.0), (57.3, 25.2)]);
        let map = frame(UTM40, [530_000.0, 2_790_000.0, 0.0]);
        let mut findings = Findings::new();
        let out = project(&p, CrsRef::Epsg { code: 4326 }, &map, &mut findings).unwrap();
        assert_eq!(out.len(), 6);
        assert!(out[0].is_nan() && out[1].is_nan() && out[2] == -0.0);
        assert!(out[3].is_finite() && out[4].is_finite());
        let finding = &findings.as_slice()[0];
        assert_eq!(finding.code.as_str(), "crs.transform.not_finite");
        assert_eq!((finding.count, finding.examples[0].vertex), (1, Some(0)));
    }

    #[test]
    fn a_trailing_partial_position_is_left_out_and_a_system_that_cannot_be_converted_is_an_error() {
        let p = Positions::from_interleaved(vec![1.0, 2.0, 3.0, 4.0], true);
        let local = CrsRef::Local {
            units: Units::Metre,
        };
        let out = project(&p, local, &frame(local, [0.0; 3]), &mut Findings::new()).unwrap();
        assert_eq!(out, [1.0, 2.0, 3.0]);
        let error = project(&p, local, &frame(UTM40, [0.0; 3]), &mut Findings::new()).unwrap_err();
        assert_eq!(error.code.as_str(), "display.crs.not_convertible");
    }
}
