//! Render buffers of grids drawn as an image: where it goes, and how it is cut into textures.

use karmania_core::{CrsRef, Finding, FindingCode, Findings, Lattice};

use crate::origin::Frame;
use crate::project::Prepared;

/// Where an image of cells goes, in the frame: the lattice of the grid, moved to the map's units and
/// made relative to the frame's origin.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GridPlacement {
    /// The outer corner of cell `(0, 0)` (before rotation), relative to the frame's origin, in map units;
    /// z is the elevation of the grid's plane.
    pub origin: [f32; 3],
    /// The size of a cell along `i` and along `j`, in map units.
    pub spacing: [f32; 2],
    /// Degrees counter-clockwise about +Z, pivoting at `origin` (the lattice's own convention).
    pub rotation: f32,
}

/// A rectangle of cells that is one texture: `nx` by `ny` cells starting at cell `(i0, j0)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tile {
    /// The first cell along `i`.
    pub i0: u32,
    /// The first cell along `j`.
    pub j0: u32,
    /// The number of cells along `i`.
    pub nx: u32,
    /// The number of cells along `j`.
    pub ny: u32,
}

/// How a grid is placed on the map.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum GridLayout {
    /// As a rotated rectangle of square-edged cells: the grid is in the map's system, or in a local
    /// grid that is scaled to the map's units.
    Placement(GridPlacement),
}

/// The buffers of a grid drawn as an image. The values are not in them: the renderer takes one class
/// index per cell (step 13.17), cut up by `tiles`.
#[derive(Debug, Clone, PartialEq)]
pub struct GridBuffers {
    /// Where the cells go.
    pub layout: GridLayout,
    /// The number of cells along `i` and along `j`.
    pub size: [u32; 2],
    /// The textures, row by row (`j` slowest), each at most the largest texture the GPU takes on a side,
    /// together covering every cell once.
    pub tiles: Vec<Tile>,
}

/// The tiles of an `nx` by `ny` image when no texture may be more than `max_size` cells on a side
/// (a size of 0 is taken as 1): left to right and bottom to top, the last of each row and of each column
/// as many cells as are left.
#[must_use]
pub fn tiles(nx: u32, ny: u32, max_size: u32) -> Vec<Tile> {
    let step = max_size.max(1);
    let mut tiles = Vec::new();
    let mut j0 = 0;
    while j0 < ny {
        let rows = step.min(ny - j0);
        let mut i0 = 0;
        while i0 < nx {
            let columns = step.min(nx - i0);
            tiles.push(Tile {
                i0,
                j0,
                nx: columns,
                ny: rows,
            });
            i0 += columns;
        }
        j0 += rows;
    }
    tiles
}

/// How many map units one unit of the grid's system is, if the grid can be placed without warping it:
/// 1 in the map's own system, the ratio of the units between two local grids; `None` otherwise (the
/// grid is warped, step 13.11).
fn units_factor(own: CrsRef, map_crs: CrsRef) -> Option<f64> {
    match (own, map_crs) {
        (a, b) if a == b => Some(1.0),
        (CrsRef::Local { units: a }, CrsRef::Local { units: b }) => {
            Some(a.metres_per_unit() / b.metres_per_unit())
        }
        _ => None,
    }
}

/// Prepares a flat grid for drawing as an image: `lattice` in the system `own`, its plane at `elevation`
/// (not finite is taken as 0), in `frame`, cut into textures of at most `max_texture_size` cells a side.
///
/// `None` if the grid is in another coordinate system than the map's and is not a local grid: it has to
/// be warped. A grid with several layers is drawn from its first layer, with a
/// `display.grid.layers_hidden` finding.
#[must_use]
pub fn grid_image(
    lattice: &Lattice,
    elevation: f64,
    own: CrsRef,
    frame: &Frame,
    max_texture_size: u32,
) -> Option<Prepared<GridBuffers>> {
    let factor = units_factor(own, frame.map_crs)?;
    let [x, y, z] = frame.rebase([
        lattice.origin[0] * factor,
        lattice.origin[1] * factor,
        if elevation.is_finite() {
            elevation
        } else {
            0.0
        },
    ]);
    let placement = GridPlacement {
        origin: [x, y, z],
        spacing: [
            (lattice.spacing[0] * factor) as f32,
            (lattice.spacing[1] * factor) as f32,
        ],
        rotation: lattice.rotation as f32,
    };
    let [nx, ny, layers] = lattice.dims;
    let mut findings = Findings::new();
    if layers > 1 {
        findings.add(
            Finding::new(
                FindingCode::DisplayGridLayersHidden,
                format!(
                    "The grid has {} layers, and only the first is drawn.",
                    karmania_core::text::format_count(u64::from(layers))
                ),
            )
            .with_hint("Split the layers into separate grids to see the others."),
        );
    }
    Some(Prepared {
        buffers: GridBuffers {
            layout: GridLayout::Placement(placement),
            size: [nx, ny],
            tiles: tiles(nx, ny, max_texture_size),
        },
        findings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::FrameSource;
    use karmania_core::Units;

    const UTM40: CrsRef = CrsRef::Epsg { code: 32640 };

    fn lattice(dims: [u32; 3]) -> Lattice {
        Lattice {
            origin: [512_000.0, 4_012_000.0, 0.0],
            spacing: [25.0, 10.0, 1.0],
            dims,
            rotation: 30.0,
        }
    }

    fn frame(crs: CrsRef, origin: [f64; 3]) -> Frame {
        Frame {
            map_crs: crs,
            origin,
            source: FrameSource::Auto,
        }
    }

    #[test]
    fn the_cells_of_every_size_are_covered_once_by_tiles_of_at_most_the_largest_texture() {
        for (nx, ny, max) in [
            (10, 7, 4),
            (8, 8, 4),
            (1, 1, 4096),
            (5, 3, 0),
            (10_000, 5_000, 4_096),
            (7, 1, 3),
        ] {
            let tiles = tiles(nx, ny, max);
            let step = max.max(1);
            assert!(
                tiles
                    .iter()
                    .all(|t| t.nx >= 1 && t.ny >= 1 && t.nx <= step && t.ny <= step)
            );
            let cells: u64 = tiles
                .iter()
                .map(|t| u64::from(t.nx) * u64::from(t.ny))
                .sum();
            assert_eq!(cells, u64::from(nx) * u64::from(ny), "{nx}x{ny} at {max}");
            // None overlaps another and none is outside: every cell is in exactly one (small sizes only).
            if nx * ny <= 100 {
                let mut seen = vec![0_u8; (nx * ny) as usize];
                for t in &tiles {
                    for j in t.j0..t.j0 + t.ny {
                        for i in t.i0..t.i0 + t.nx {
                            seen[(j * nx + i) as usize] += 1;
                        }
                    }
                }
                assert!(seen.iter().all(|&n| n == 1), "{nx}x{ny} at {max}");
            }
        }
        assert_eq!(
            tiles(10_000, 5_000, 4_096).len(),
            6,
            "three columns and two rows"
        );
        assert_eq!(
            tiles(10, 7, 4)[..3],
            [
                Tile {
                    i0: 0,
                    j0: 0,
                    nx: 4,
                    ny: 4
                },
                Tile {
                    i0: 4,
                    j0: 0,
                    nx: 4,
                    ny: 4
                },
                Tile {
                    i0: 8,
                    j0: 0,
                    nx: 2,
                    ny: 4
                }
            ]
        );
    }

    #[test]
    fn a_grid_in_the_map_system_is_placed_relative_to_the_origin() {
        let out = grid_image(
            &lattice([4, 3, 1]),
            120.0,
            UTM40,
            &frame(UTM40, [512_000.0, 4_012_000.0, 100.0]),
            4096,
        )
        .unwrap();
        let GridLayout::Placement(p) = out.buffers.layout;
        assert_eq!(
            p,
            GridPlacement {
                origin: [0.0, 0.0, 20.0],
                spacing: [25.0, 10.0],
                rotation: 30.0
            }
        );
        assert_eq!((out.buffers.size, out.buffers.tiles.len()), ([4, 3], 1));
        assert!(out.findings.is_empty());
    }

    #[test]
    fn a_local_grid_is_scaled_to_the_units_of_the_map() {
        let feet = CrsRef::Local { units: Units::Foot };
        let metres = CrsRef::Local {
            units: Units::Metre,
        };
        let l = Lattice {
            origin: [1_000.0, 2_000.0, 0.0],
            spacing: [10.0, 10.0, 1.0],
            dims: [2, 2, 1],
            rotation: 0.0,
        };
        let out = grid_image(&l, 0.0, feet, &frame(metres, [0.0; 3]), 4096).unwrap();
        let GridLayout::Placement(p) = out.buffers.layout;
        assert_eq!(p.origin, [304.8, 609.6, 0.0]);
        assert_eq!(p.spacing, [3.048, 3.048]);
    }

    #[test]
    fn a_grid_that_has_to_be_warped_is_not_placed() {
        assert!(
            grid_image(
                &lattice([2, 2, 1]),
                0.0,
                CrsRef::Epsg { code: 4326 },
                &frame(UTM40, [0.0; 3]),
                4096
            )
            .is_none()
        );
    }

    #[test]
    fn several_layers_are_said_and_a_non_finite_elevation_is_zero() {
        let out = grid_image(
            &lattice([2, 2, 3]),
            f64::NAN,
            UTM40,
            &frame(UTM40, [0.0; 3]),
            4096,
        )
        .unwrap();
        assert_eq!(
            out.findings.as_slice()[0].code.as_str(),
            "display.grid.layers_hidden"
        );
        assert_eq!(
            out.findings.as_slice()[0].message,
            "The grid has 3 layers, and only the first is drawn."
        );
        let GridLayout::Placement(p) = out.buffers.layout;
        assert_eq!(p.origin[2], 0.0);
    }
}
