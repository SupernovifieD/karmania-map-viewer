//! Render buffers of points.

use karmania_core::{CrsRef, Finding, Findings, Positions};

use crate::origin::Frame;
use crate::project::{Prepared, project};

/// The buffers of a set of points: one position per point, in point order, so that the number of a
/// point is the number of its row in the attribute table.
///
/// Positions are `f32`, relative to the frame's origin, in map units, `x y z` interleaved. A point that
/// has no position on the map (not finite, or not convertible) is NaN, and the renderer leaves it out. A
/// number too large for an `f32` once it is made relative to the origin is infinite and not NaN, so the
/// renderer takes any coordinate that is not finite (`isFinite`) to be no position.
#[derive(Debug, Clone, PartialEq)]
pub struct PointsBuffers {
    /// `3 * point count` values.
    pub positions: Vec<f32>,
}

/// Prepares `points`, in the system `own`, for drawing in `frame`.
///
/// # Errors
///
/// A `display.crs.not_convertible` finding if `own` cannot be converted to the map's system (see
/// [`crate::drawable`], which says so beforehand).
pub fn points_buffers(
    points: &Positions,
    own: CrsRef,
    frame: &Frame,
) -> Result<Prepared<PointsBuffers>, Finding> {
    let mut findings = Findings::new();
    let positions = project(points, own, frame, &mut findings)?;
    Ok(Prepared {
        buffers: PointsBuffers { positions },
        findings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::FrameSource;
    use karmania_core::Units;

    const UTM40: CrsRef = CrsRef::Epsg { code: 32640 };

    fn frame() -> Frame {
        Frame {
            map_crs: UTM40,
            origin: [512_000.0, 4_012_000.0, 0.0],
            source: FrameSource::Auto,
        }
    }

    fn positions(xy: &[(f64, f64)]) -> Positions {
        let x: Vec<f64> = xy.iter().map(|p| p.0).collect();
        let y: Vec<f64> = xy.iter().map(|p| p.1).collect();
        Positions::from_xyz(&x, &y, None, &mut Findings::new()).unwrap()
    }

    #[test]
    fn one_position_per_point_in_point_order() {
        let p = positions(&[(512_001.0, 4_012_002.0), (511_000.0, 4_011_000.0)]);
        let out = points_buffers(&p, UTM40, &frame()).unwrap();
        assert_eq!(
            out.buffers.positions,
            [1.0, 2.0, 0.0, -1000.0, -1000.0, 0.0]
        );
        assert!(out.findings.is_empty());
    }

    #[test]
    fn points_of_another_system_are_converted_and_the_failures_are_counted() {
        let p = positions(&[(57.3, 25.2), (57.0, 95.0)]);
        let out = points_buffers(
            &p,
            CrsRef::Epsg { code: 4326 },
            &Frame {
                origin: [530_000.0, 2_790_000.0, 0.0],
                ..frame()
            },
        )
        .unwrap();
        let b = &out.buffers.positions;
        assert_eq!(b.len(), 6);
        assert!(b[0].is_finite() && b[1].is_finite() && b[3].is_nan() && b[4].is_nan());
        assert_eq!(
            out.findings.as_slice()[0].code.as_str(),
            "crs.transform.not_finite"
        );
    }

    #[test]
    fn no_points_make_no_positions_and_an_unconvertible_system_is_an_error() {
        let out = points_buffers(&positions(&[]), UTM40, &frame()).unwrap();
        assert!(out.buffers.positions.is_empty());
        let local = CrsRef::Local {
            units: Units::Metre,
        };
        let error = points_buffers(&positions(&[(1.0, 1.0)]), local, &frame()).unwrap_err();
        assert_eq!(error.code.as_str(), "display.crs.not_convertible");
    }
}
