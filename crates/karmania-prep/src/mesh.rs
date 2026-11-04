//! Render buffers of meshes.

use karmania_core::{CrsRef, Finding, Findings, Mesh};

use crate::origin::Frame;
use crate::project::{Prepared, project};

/// The buffers of a triangle mesh.
///
/// Positions are as for [`crate::PointsBuffers`]: one per vertex, in vertex order.
#[derive(Debug, Clone, PartialEq)]
pub struct MeshBuffers {
    /// `3 * vertex count` values, relative to the frame's origin, in map units.
    pub positions: Vec<f32>,
    /// Three vertex numbers (0-based, into `positions`) per triangle, as the dataset gives them, in
    /// triangle order: triangle `t` is the row `t` of the attribute table. A triangle that cannot be
    /// drawn (a vertex number that does not exist, or a corner with no position on the map) keeps its
    /// place as `0, 0, 0`, which has no area, so that no number changes; validation refuses datasets with
    /// numbers that do not exist, and `crs.transform.not_finite` counts the corners that could not be placed.
    pub triangles: Vec<u32>,
}

/// Prepares `mesh`, in the system `own`, for drawing in `frame`. Edges are straight between the
/// converted vertices. The colour is one per triangle, and flat shading is the renderer's.
///
/// # Errors
///
/// A `display.crs.not_convertible` finding if `own` cannot be converted to the map's system.
pub fn mesh_buffers(
    mesh: &Mesh,
    own: CrsRef,
    frame: &Frame,
) -> Result<Prepared<MeshBuffers>, Finding> {
    let mut findings = Findings::new();
    let positions = project(&mesh.positions, own, frame, &mut findings)?;
    let triangles = mesh_triangles(mesh, &positions);
    Ok(Prepared {
        buffers: MeshBuffers {
            positions,
            triangles,
        },
        findings,
    })
}

/// The triangles of `mesh` (see [`MeshBuffers`]), given the `positions` of the vertices on the map.
pub(crate) fn mesh_triangles(mesh: &Mesh, positions: &[f32]) -> Vec<u32> {
    let present = |vertex: u32| {
        usize::try_from(vertex)
            .ok()
            .and_then(|v| v.checked_mul(3))
            .and_then(|start| Some(start..start.checked_add(3)?))
            .and_then(|range| positions.get(range))
            .is_some_and(|p| p.iter().all(|c| c.is_finite()))
    };
    let mut triangles = Vec::with_capacity(mesh.triangle_count() * 3);
    for corners in mesh.indices.as_chunks::<3>().0 {
        if corners.iter().all(|&vertex| present(vertex)) {
            triangles.extend(corners);
        } else {
            triangles.extend([0, 0, 0]);
        }
    }
    triangles
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::FrameSource;
    use karmania_core::{Positions, Units};

    const LOCAL: CrsRef = CrsRef::Local {
        units: Units::Metre,
    };

    fn frame(origin: [f64; 3]) -> Frame {
        Frame {
            map_crs: LOCAL,
            origin,
            source: FrameSource::Auto,
        }
    }

    fn mesh(xyz: &[[f64; 3]], indices: &[u32]) -> Mesh {
        let (x, (y, z)): (Vec<f64>, (Vec<f64>, Vec<f64>)) =
            xyz.iter().map(|p| (p[0], (p[1], p[2]))).unzip();
        Mesh {
            positions: Positions::from_xyz(&x, &y, Some(&z), &mut Findings::new()).unwrap(),
            indices: indices.to_vec(),
        }
    }

    const QUAD: [[f64; 3]; 4] = [
        [0.0, 0.0, 1.0],
        [10.0, 0.0, 2.0],
        [10.0, 10.0, 3.0],
        [0.0, 10.0, 4.0],
    ];

    #[test]
    fn positions_are_rebased_with_their_height_and_triangles_are_as_given() {
        let m = mesh(&QUAD, &[0, 1, 2, 0, 2, 3]);
        let out = mesh_buffers(&m, LOCAL, &frame([5.0, 5.0, 1.0])).unwrap();
        assert_eq!(
            out.buffers.positions,
            [
                -5.0, -5.0, 0.0, 5.0, -5.0, 1.0, 5.0, 5.0, 2.0, -5.0, 5.0, 3.0
            ]
        );
        assert_eq!(out.buffers.triangles, [0, 1, 2, 0, 2, 3]);
        assert!(out.findings.is_empty());
    }

    #[test]
    fn a_triangle_that_cannot_be_drawn_keeps_its_place_as_a_degenerate_one() {
        // The second triangle names a vertex that does not exist; the third has a vertex with no position;
        // a partial triangle at the end is left out.
        let mut quad = QUAD;
        quad[3][0] = f64::NAN;
        let m = mesh(&quad, &[0, 1, 2, 0, 1, 9, 0, 2, 3, 1, 2]);
        let out = mesh_buffers(&m, LOCAL, &frame([0.0; 3])).unwrap();
        assert_eq!(out.buffers.triangles, [0, 1, 2, 0, 0, 0, 0, 0, 0]);
        assert_eq!(out.buffers.triangles.len() / 3, m.triangle_count());
    }

    #[test]
    fn an_empty_mesh_and_a_mesh_in_another_system() {
        let none = mesh_buffers(&mesh(&[], &[]), LOCAL, &frame([0.0; 3])).unwrap();
        assert!(none.buffers.positions.is_empty() && none.buffers.triangles.is_empty());
        let utm = Frame {
            map_crs: CrsRef::Epsg { code: 32640 },
            ..frame([500_000.0, 2_700_000.0, 0.0])
        };
        let geographic = mesh(
            &[[57.0, 25.0, 0.0], [57.1, 25.0, 0.0], [57.0, 25.1, 0.0]],
            &[0, 1, 2],
        );
        let out = mesh_buffers(&geographic, CrsRef::Epsg { code: 4326 }, &utm).unwrap();
        // 57 E is the central meridian of zone 40, so x of the first vertex is 0.
        assert!(out.buffers.positions[0].abs() < 1.0);
        assert!(
            out.buffers.positions[3] > 10_000.0,
            "0.1 degrees of longitude at 25 N is about 10 km"
        );
        assert_eq!(out.buffers.triangles, [0, 1, 2]);
        assert!(mesh_buffers(&geographic, LOCAL, &utm).is_err());
    }
}
