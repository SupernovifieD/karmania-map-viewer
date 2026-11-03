//! Render buffers of block models.

use karmania_core::{Blocks, CrsRef, Finding, Findings};

use crate::drawable::blocks_other_crs;
use crate::origin::Frame;
use crate::project::Prepared;

/// The buffers of a block model: instanced boxes.
#[derive(Debug, Clone, PartialEq)]
pub struct BlocksBuffers {
    /// `x y z` of the centre of every block, in block order (the row of its attributes), relative to the
    /// frame's origin, in map units, with the rotation of the lattice already applied. A block that is
    /// not in the lattice (validation refuses those) has NaN and is left out by the renderer.
    pub centres: Vec<f32>,
    /// The size of a block along its own axes, `[dx, dy, dz]`, in map units.
    pub spacing: [f32; 3],
    /// Degrees counter-clockwise about +Z that each box is turned by, about its own centre.
    pub rotation: f32,
}

/// Prepares a block model for drawing in `frame`. Blocks are not warped in phase 2: they are drawn only
/// in the map's own coordinate system.
///
/// # Errors
///
/// A `display.blocks.other_crs` finding if `own` is not the map's system.
pub fn blocks_buffers(
    blocks: &Blocks,
    own: CrsRef,
    frame: &Frame,
) -> Result<Prepared<BlocksBuffers>, Finding> {
    if own != frame.map_crs {
        return Err(blocks_other_crs(own, frame.map_crs));
    }
    let count = usize::try_from(blocks.block_count().unwrap_or(0)).unwrap_or(0);
    let mut centres = Vec::with_capacity(count.saturating_mul(3));
    for block in 0..count {
        let centre = blocks
            .block_ijk(block)
            .and_then(|[i, j, k]| blocks.lattice.cell_centre(i, j, k));
        centres.extend(centre.map_or([f32::NAN; 3], |c| frame.rebase(c)));
    }
    let [dx, dy, dz] = blocks.lattice.spacing;
    Ok(Prepared {
        buffers: BlocksBuffers {
            centres,
            spacing: [dx as f32, dy as f32, dz as f32],
            rotation: blocks.lattice.rotation as f32,
        },
        findings: Findings::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::FrameSource;
    use karmania_core::{Lattice, Units};

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

    fn lattice(dims: [u32; 3], rotation: f64) -> Lattice {
        Lattice {
            origin: [100.0, 200.0, 50.0],
            spacing: [10.0, 20.0, 5.0],
            dims,
            rotation,
        }
    }

    #[test]
    fn a_dense_model_has_a_centre_for_every_cell_in_lattice_order() {
        let b = Blocks {
            lattice: lattice([2, 2, 2], 0.0),
            ijk: None,
        };
        let out = blocks_buffers(&b, LOCAL, &frame([100.0, 200.0, 50.0]))
            .unwrap()
            .buffers;
        assert_eq!(out.spacing, [10.0, 20.0, 5.0]);
        assert_eq!(out.rotation, 0.0);
        assert_eq!(out.centres.len(), 24);
        // Block 0 is cell (0, 0, 0): the centre is half a block from the corner. Block 1 is (1, 0, 0),
        // block 2 is (0, 1, 0), block 4 is (0, 0, 1).
        assert_eq!(out.centres[..3], [5.0, 10.0, 2.5]);
        assert_eq!(out.centres[3..6], [15.0, 10.0, 2.5]);
        assert_eq!(out.centres[6..9], [5.0, 30.0, 2.5]);
        assert_eq!(out.centres[12..15], [5.0, 10.0, 7.5]);
    }

    #[test]
    fn a_sparse_model_has_a_centre_for_each_block_given_in_the_order_given() {
        let b = Blocks {
            lattice: lattice([4, 4, 4], 0.0),
            ijk: Some(vec![3, 3, 3, 0, 1, 2, 9, 9, 9, 1, 0]),
        };
        let out = blocks_buffers(&b, LOCAL, &frame([0.0; 3])).unwrap().buffers;
        // Three whole triplets (a partial one is not a block); the third is not in the lattice.
        assert_eq!(out.centres.len(), 9);
        assert_eq!(out.centres[..3], [135.0, 270.0, 67.5]);
        assert_eq!(out.centres[3..6], [105.0, 230.0, 62.5]);
        assert!(out.centres[6..9].iter().all(|c| c.is_nan()));
    }

    #[test]
    fn the_rotation_is_applied_to_the_centres_and_given_for_the_boxes() {
        let b = Blocks {
            lattice: lattice([2, 1, 1], 90.0),
            ijk: None,
        };
        let out = blocks_buffers(&b, LOCAL, &frame([100.0, 200.0, 50.0]))
            .unwrap()
            .buffers;
        // Turned a quarter: 5 along i is 5 north, and 10 along j is 10 west.
        assert_eq!(out.rotation, 90.0);
        assert_eq!(out.centres[..3], [-10.0, 5.0, 2.5]);
        assert_eq!(out.centres[3..6], [-10.0, 15.0, 2.5]);
    }

    #[test]
    fn only_the_map_system_and_nothing_gives_nothing() {
        let b = Blocks {
            lattice: lattice([2, 2, 2], 0.0),
            ijk: None,
        };
        let utm = Frame {
            map_crs: CrsRef::Epsg { code: 32640 },
            ..frame([0.0; 3])
        };
        let error = blocks_buffers(&b, LOCAL, &utm).unwrap_err();
        assert_eq!(error.code.as_str(), "display.blocks.other_crs");
        let none = Blocks {
            lattice: lattice([2, 2, 2], 0.0),
            ijk: Some(vec![]),
        };
        assert!(
            blocks_buffers(&none, LOCAL, &frame([0.0; 3]))
                .unwrap()
                .buffers
                .centres
                .is_empty()
        );
    }
}
