//! Render buffers of lines.

use karmania_core::{CrsRef, Finding, Findings, Lines};

use crate::origin::Frame;
use crate::project::{Prepared, project};

/// The buffers of a set of lines, as segments between vertices.
///
/// Positions are as for [`crate::PointsBuffers`]: one per vertex of the dataset, in vertex order.
#[derive(Debug, Clone, PartialEq)]
pub struct LinesBuffers {
    /// `3 * vertex count` values, relative to the frame's origin, in map units.
    pub positions: Vec<f32>,
    /// Pairs of vertex numbers (0-based, into `positions`): `2 * segment count` values. Each pair joins
    /// two neighbouring vertices of one line, so a line of `n` vertices has `n - 1` segments, and a
    /// line of fewer than two vertices has none. A segment with an end that has no position on the map
    /// (NaN) is left out, which breaks the line there.
    pub segments: Vec<u32>,
    /// For each segment, the number of its line (0-based, the row of the attribute table).
    pub segment_line: Vec<u32>,
}

/// Prepares `lines`, in the system `own`, for drawing in `frame`. Lines are straight between their
/// converted vertices: long edges are not densified.
///
/// # Errors
///
/// A `display.crs.not_convertible` finding if `own` cannot be converted to the map's system.
pub fn lines_buffers(
    lines: &Lines,
    own: CrsRef,
    frame: &Frame,
) -> Result<Prepared<LinesBuffers>, Finding> {
    let mut findings = Findings::new();
    let positions = project(&lines.positions, own, frame, &mut findings)?;
    let present = |vertex: usize| {
        vertex
            .checked_mul(3)
            .and_then(|start| Some(start..start.checked_add(3)?))
            .and_then(|range| positions.get(range))
            .is_some_and(|p| p.iter().all(|c| c.is_finite()))
    };
    let mut segments = Vec::new();
    let mut segment_line = Vec::new();
    for line in 0..lines.line_count().unwrap_or(0) {
        let (Some(range), Ok(number)) = (lines.vertex_range(line), u32::try_from(line)) else {
            continue;
        };
        for vertex in range.clone().skip(1) {
            let from = vertex - 1;
            if let (true, true, Ok(a), Ok(b)) = (
                present(from),
                present(vertex),
                u32::try_from(from),
                u32::try_from(vertex),
            ) {
                segments.extend([a, b]);
                segment_line.push(number);
            }
        }
    }
    Ok(Prepared {
        buffers: LinesBuffers {
            positions,
            segments,
            segment_line,
        },
        findings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::FrameSource;
    use karmania_core::Positions;

    const UTM40: CrsRef = CrsRef::Epsg { code: 32640 };

    fn frame() -> Frame {
        Frame {
            map_crs: UTM40,
            origin: [0.0; 3],
            source: FrameSource::Auto,
        }
    }

    fn lines(xy: &[(f64, f64)], offsets: &[u32]) -> Lines {
        let x: Vec<f64> = xy.iter().map(|p| p.0).collect();
        let y: Vec<f64> = xy.iter().map(|p| p.1).collect();
        Lines {
            positions: Positions::from_xyz(&x, &y, None, &mut Findings::new()).unwrap(),
            offsets: offsets.to_vec(),
        }
    }

    #[test]
    fn a_line_of_n_vertices_has_n_minus_1_segments_numbered_by_line() {
        // Line 0 has three vertices, line 1 has two, line 2 has one (no segment).
        let l = lines(
            &[
                (0.0, 0.0),
                (1.0, 0.0),
                (1.0, 1.0),
                (5.0, 5.0),
                (6.0, 5.0),
                (9.0, 9.0),
            ],
            &[0, 3, 5, 6],
        );
        let out = lines_buffers(&l, UTM40, &frame()).unwrap().buffers;
        assert_eq!(out.positions.len(), 18);
        assert_eq!(out.segments, [0, 1, 1, 2, 3, 4]);
        assert_eq!(out.segment_line, [0, 0, 1]);
    }

    #[test]
    fn a_vertex_with_no_position_breaks_the_line_there() {
        let l = lines(
            &[
                (0.0, 0.0),
                (1.0, 0.0),
                (f64::NAN, 0.0),
                (3.0, 0.0),
                (4.0, 0.0),
            ],
            &[0, 5],
        );
        let out = lines_buffers(&l, UTM40, &frame()).unwrap().buffers;
        // 0-1 and 3-4 are kept; 1-2 and 2-3 touch the missing vertex.
        assert_eq!(out.segments, [0, 1, 3, 4]);
        assert_eq!(out.segment_line, [0, 0]);
    }

    #[test]
    fn positions_are_relative_to_the_origin_and_converted() {
        let l = lines(&[(57.0, 25.0), (57.6, 25.4)], &[0, 2]);
        let origin = Frame {
            origin: [500_000.0, 2_700_000.0, 0.0],
            ..frame()
        };
        let out = lines_buffers(&l, CrsRef::Epsg { code: 4326 }, &origin).unwrap();
        // 57 E is the central meridian of zone 40: easting 500,000 m, so x is 0 for the first vertex.
        assert!(
            out.buffers.positions[0].abs() < 1.0,
            "{:?}",
            out.buffers.positions
        );
        assert_eq!(out.buffers.segments, [0, 1]);
        assert!(out.findings.is_empty());
    }

    #[test]
    fn no_lines_and_malformed_offsets_make_nothing() {
        let none = lines_buffers(&lines(&[], &[0]), UTM40, &frame())
            .unwrap()
            .buffers;
        assert!(none.segments.is_empty() && none.segment_line.is_empty());
        let bad = lines(&[(0.0, 0.0), (1.0, 1.0)], &[0, 9]);
        assert!(
            lines_buffers(&bad, UTM40, &frame())
                .unwrap()
                .buffers
                .segments
                .is_empty()
        );
        let empty_offsets = lines(&[(0.0, 0.0)], &[]);
        assert!(
            lines_buffers(&empty_offsets, UTM40, &frame())
                .unwrap()
                .buffers
                .segments
                .is_empty()
        );
    }
}
