//! Render buffers of grids drawn as an image: where it goes, and how it is cut into textures.

use karmania_core::{CrsRef, Finding, FindingCode, Findings, Lattice};
use karmania_crs::Transformer;
use serde::Serialize;

use crate::drawable::not_convertible;
use crate::origin::Frame;
use crate::project::Prepared;
use crate::warp::{WarpTile, warp_tile};

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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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
#[derive(Debug, Clone, PartialEq)]
pub enum GridLayout {
    /// As a rotated rectangle of square-edged cells: the grid is in the map's system, or in a local
    /// grid that is scaled to the map's units.
    Placement(GridPlacement),
    /// As a mesh that carries the cells to where the conversion puts them: the grid is in another system.
    Warp(GridWarp),
}

/// The meshes of a warped grid, one for each tile, one after another.
#[derive(Debug, Clone, PartialEq)]
pub struct GridWarp {
    /// `x y z` of every vertex of every tile, relative to the frame's origin, in map units; NaN where the
    /// conversion cannot place it.
    pub positions: Vec<f32>,
    /// `u v` of every vertex, from 0 to 1 across the texture of its tile.
    pub uvs: Vec<f32>,
    /// Three vertex numbers (0-based, into the lists above, for all the tiles) per triangle.
    pub triangles: Vec<u32>,
    /// How many triangles each tile has, in the order of `tiles`: the triangles of tile `t` are the next
    /// `tile_triangles[t]` after those of the tiles before it.
    pub tile_triangles: Vec<u32>,
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

/// The finding for a grid of several layers, which are drawn from the first only.
pub(crate) fn layers_hidden(layers: u32) -> Findings {
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
    findings
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
    findings.extend(layers_hidden(layers));
    Some(Prepared {
        buffers: GridBuffers {
            layout: GridLayout::Placement(placement),
            size: [nx, ny],
            tiles: tiles(nx, ny, max_texture_size),
        },
        findings,
    })
}

/// Prepares a flat grid for drawing: as an image if it is in the map's system or a local grid (see
/// [`grid_image`]), otherwise as a warped image, a mesh for each tile (see [`crate::warp::warp_tile`]).
///
/// A tile whose mesh cannot be within a tenth of a cell of the conversion is said to be rough in one
/// `display.grid.warp_rough` finding; vertices that cannot be placed are counted by
/// `crs.transform.not_finite`, with no examples, and the triangles that use them are left out.
///
/// # Errors
///
/// A `display.crs.not_convertible` finding if `own` cannot be converted to the map's system.
pub fn grid_buffers(
    lattice: &Lattice,
    elevation: f64,
    own: CrsRef,
    frame: &Frame,
    max_texture_size: u32,
) -> Result<Prepared<GridBuffers>, Finding> {
    if let Some(image) = grid_image(lattice, elevation, own, frame, max_texture_size) {
        return Ok(image);
    }
    let transformer =
        Transformer::new(own, frame.map_crs).map_err(|cause| not_convertible(&cause))?;
    let tiles = tiles(lattice.dims[0], lattice.dims[1], max_texture_size);
    let mut warp = WarpBuilder::new();
    for tile in &tiles {
        warp.add(warp_tile(lattice, *tile, elevation, &transformer, frame));
    }
    Ok(warp.finish(lattice, tiles))
}

/// The meshes of a warped grid put together one tile at a time, so that a long list of tiles can be done
/// in steps. Done in any number of steps it gives the same buffers and findings as all at once.
pub(crate) struct WarpBuilder {
    warp: GridWarp,
    rough: bool,
    unplaced: u64,
}

impl WarpBuilder {
    /// Starts with no tile.
    pub(crate) fn new() -> Self {
        Self {
            warp: GridWarp {
                positions: Vec::new(),
                uvs: Vec::new(),
                triangles: Vec::new(),
                tile_triangles: Vec::new(),
            },
            rough: false,
            unplaced: 0,
        }
    }

    /// How many tiles are added.
    pub(crate) fn added(&self) -> usize {
        self.warp.tile_triangles.len()
    }

    /// Adds the mesh of the next tile after those already added.
    pub(crate) fn add(&mut self, part: WarpTile) {
        let warp = &mut self.warp;
        let first = u32::try_from(warp.positions.len() / 3).unwrap_or(u32::MAX);
        warp.triangles
            .extend(part.triangles.iter().map(|v| v.saturating_add(first)));
        warp.tile_triangles
            .push(u32::try_from(part.triangles.len() / 3).unwrap_or(u32::MAX));
        warp.positions.extend(part.positions);
        warp.uvs.extend(part.uvs);
        self.rough |= part.rough;
        self.unplaced += part.unplaced;
    }

    /// The buffers and findings of the grid whose tiles these are.
    pub(crate) fn finish(self, lattice: &Lattice, tiles: Vec<Tile>) -> Prepared<GridBuffers> {
        let [nx, ny, layers] = lattice.dims;
        let mut findings = layers_hidden(layers);
        if self.rough {
            findings.add(
                Finding::new(
                    FindingCode::DisplayGridWarpRough,
                    "The grid is warped so much that its picture may be off by more than a tenth of a cell.",
                )
                .with_hint("Change the map's coordinate system to the one this dataset is in."),
            );
        }
        if self.unplaced > 0 {
            let mut finding = karmania_crs::transform::not_finite();
            finding.count = self.unplaced;
            findings.add(finding);
        }
        Prepared {
            buffers: GridBuffers {
                layout: GridLayout::Warp(self.warp),
                size: [nx, ny],
                tiles,
            },
            findings,
        }
    }
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

    fn placement(buffers: &GridBuffers) -> GridPlacement {
        match &buffers.layout {
            GridLayout::Placement(p) => *p,
            GridLayout::Warp(_) => panic!("warped, not placed"),
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
        let p = placement(&out.buffers);
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
        let p = placement(&out.buffers);
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
        let p = placement(&out.buffers);
        assert_eq!(p.origin[2], 0.0);
    }

    fn warp(buffers: &GridBuffers) -> &GridWarp {
        match &buffers.layout {
            GridLayout::Warp(w) => w,
            GridLayout::Placement(_) => panic!("placed, not warped"),
        }
    }

    #[test]
    fn a_grid_in_another_system_is_warped_one_mesh_per_tile() {
        // 600 by 400 cells of 0.01 degrees, in tiles of 256: three columns and two rows.
        let l = Lattice {
            origin: [54.0, 22.0, 0.0],
            spacing: [0.01, 0.01, 1.0],
            dims: [600, 400, 1],
            rotation: 0.0,
        };
        let f = frame(UTM40, [500_000.0, 2_600_000.0, 0.0]);
        let out = grid_buffers(&l, 0.0, CrsRef::Epsg { code: 4326 }, &f, 256).unwrap();
        assert!(out.findings.is_empty(), "{:?}", out.findings);
        let w = warp(&out.buffers);
        assert_eq!(out.buffers.tiles.len(), 6);
        assert_eq!(w.tile_triangles.len(), 6);
        assert_eq!(
            w.tile_triangles.iter().map(|&n| n as usize).sum::<usize>() * 3,
            w.triangles.len()
        );
        let vertices = w.positions.len() / 3;
        assert_eq!(w.uvs.len() / 2, vertices);
        assert!(w.triangles.iter().all(|&v| (v as usize) < vertices));
        // The meshes follow one another: every vertex a tile's triangles use comes after every vertex the
        // triangles of the tile before it use.
        let mut start = 0;
        let mut last_largest = None;
        for &count in &w.tile_triangles {
            let end = start + count as usize * 3;
            let used = &w.triangles[start..end];
            let (smallest, largest) = (used.iter().min().unwrap(), used.iter().max().unwrap());
            assert!(last_largest.is_none_or(|before| before < *smallest));
            last_largest = Some(*largest);
            start = end;
        }
    }

    #[test]
    fn a_grid_that_needs_no_warp_is_still_an_image_and_one_that_cannot_be_placed_is_an_error() {
        let l = lattice([2, 2, 1]);
        let image = grid_buffers(&l, 0.0, UTM40, &frame(UTM40, [0.0; 3]), 4096).unwrap();
        assert!(matches!(image.buffers.layout, GridLayout::Placement(_)));
        let local = CrsRef::Local {
            units: Units::Metre,
        };
        let error = grid_buffers(&l, 0.0, local, &frame(UTM40, [0.0; 3]), 4096)
            .map(|_| ())
            .unwrap_err();
        assert_eq!(error.code.as_str(), "display.crs.not_convertible");
    }

    #[test]
    fn what_cannot_be_placed_is_counted_and_a_hopeless_mesh_is_said_to_be_rough() {
        let f = frame(UTM40, [0.0; 3]);
        let beyond = Lattice {
            origin: [57.0, 88.0, 0.0],
            spacing: [0.5, 0.5, 1.0],
            dims: [10, 10, 1],
            rotation: 0.0,
        };
        let out = grid_buffers(&beyond, 0.0, CrsRef::Epsg { code: 4326 }, &f, 4096).unwrap();
        let finding = out
            .findings
            .as_slice()
            .iter()
            .find(|f| f.code.as_str() == "crs.transform.not_finite")
            .unwrap();
        assert!(finding.count > 0);
        let world = Lattice {
            origin: [-179.0, -80.0, 0.0],
            spacing: [0.0036, 0.0036, 1.0],
            dims: [100_000, 100, 1],
            rotation: 0.0,
        };
        let out = grid_buffers(&world, 0.0, CrsRef::Epsg { code: 4326 }, &f, 200_000).unwrap();
        assert!(
            out.findings
                .as_slice()
                .iter()
                .any(|f| f.code.as_str() == "display.grid.warp_rough")
        );
    }
}
