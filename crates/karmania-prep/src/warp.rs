//! A grid in another coordinate system than the map's, drawn as a warped image.
//!
//! The picture of the cells is a mesh laid over the rectangle of one texture: every vertex has the
//! place it goes to on the map (the position of a point of the grid, converted) and the place in the
//! texture it takes its colour from. The texture is sampled nearest, so each cell keeps its own colour
//! and the mesh only decides where the cells go. The GPU interpolates linearly inside a triangle, and a
//! conversion between systems is not linear, so the mesh is made finer until it is close enough.

use karmania_core::Lattice;
use karmania_crs::Transformer;

use crate::grid::Tile;
use crate::origin::Frame;

/// How far, as a fraction of a cell, the mesh may be from the exact conversion at the middle of each
/// of its parts: a tenth of a cell.
pub const MAX_ERROR_CELLS: f64 = 0.1;

/// The most parts a tile's mesh is cut into along each side. A mesh this fine that is still further than
/// [`MAX_ERROR_CELLS`] from the conversion is as good as it gets (and is said to be rough).
pub const MAX_PARTS: u32 = 256;

/// The mesh of one tile.
#[derive(Debug, Clone, PartialEq)]
pub struct WarpTile {
    /// Where each vertex goes, `x y z` relative to the frame's origin, in map units; NaN if the
    /// conversion cannot place it.
    pub positions: Vec<f32>,
    /// Where each vertex takes its colour from: `u v` from 0 to 1 across the tile's texture, `u` along `i`.
    pub uvs: Vec<f32>,
    /// Three vertex numbers per triangle (0-based, into this tile's vertices), counter-clockwise on the map
    /// for a conversion that keeps orientation. A triangle with a vertex that has no place is left out.
    pub triangles: Vec<u32>,
    /// How many parts the tile is cut into along `i` and along `j`.
    pub parts: [u32; 2],
    /// Whether the mesh is still further than [`MAX_ERROR_CELLS`] from the conversion when it is cut as fine
    /// as it can be (parts a cell wide, or [`MAX_PARTS`] parts a side, along each of the two directions).
    pub rough: bool,
    /// How many vertices the conversion could not place.
    pub unplaced: u64,
}

/// The conversion of a point of a tile, in cells from the lattice's corner, to the map.
struct Mapping<'a> {
    lattice: &'a Lattice,
    transformer: &'a Transformer,
    elevation: f64,
}

impl Mapping<'_> {
    /// The place of the point `(a, b)` of the grid, in cells along `i` and `j` from the corner of cell
    /// `(0, 0)`, on the map: `[x, y]` in map units, NaN if it cannot be placed.
    fn at(&self, a: f64, b: f64) -> [f64; 2] {
        let [dx, dy, _] = self.lattice.spacing;
        let [x, y, _] = self.lattice.local_to_world([a * dx, b * dy, 0.0]);
        self.transformer.convert(x, y)
    }
}

/// The mesh of `tile` of a grid whose lattice is in the system `transformer` converts from, drawn at
/// `elevation` in `frame` (whose map system `transformer` converts to).
///
/// The tile is cut into `ni` by `nj` parts, along `i` and along `j`, both 1, 2, 4, ... together, as many as needed
/// for the mesh to be within [`MAX_ERROR_CELLS`] of the exact conversion at the middle of every part (its
/// centre and the middles of its four sides, as the triangles of the part would have them). Each is no more than
/// the cells of the tile along its own direction and [`MAX_PARTS`], so that a tile that is one cell wide and long
/// is cut along its length (it was cut by the shorter side, which left a strip of a cell a wide quad, 0.17 cell off
/// at the middle of its edge: found by the review of the milestone); if that is not enough the mesh is `rough`.
/// Every part has the same size within the tile, so that two neighbouring parts share their vertices exactly and
/// the picture has no cracks inside a tile. Between two tiles the two meshes follow the same curve with parts of
/// their own, so that a seam is open by at most the two errors, 0.2 cell.
#[must_use]
pub fn warp_tile(
    lattice: &Lattice,
    tile: Tile,
    elevation: f64,
    transformer: &Transformer,
    frame: &Frame,
) -> WarpTile {
    let mapping = Mapping {
        lattice,
        transformer,
        elevation,
    };
    let most = [tile.nx.clamp(1, MAX_PARTS), tile.ny.clamp(1, MAX_PARTS)];
    let mut parts = [1, 1];
    let mut rough = false;
    loop {
        if error_in_cells(&mapping, tile, parts) <= MAX_ERROR_CELLS {
            break;
        }
        if parts == most {
            // Cut as fine as a cell (or as fine as the limit) and still not close enough.
            rough = true;
            break;
        }
        parts = [(parts[0] * 2).min(most[0]), (parts[1] * 2).min(most[1])];
    }
    mesh(&mapping, tile, parts, frame, rough)
}

/// The farthest the mesh of `ni` by `nj` parts is from the exact conversion, in cells, at the middle of its
/// parts; infinite if the conversion cannot place a point it needs.
fn error_in_cells(mapping: &Mapping<'_>, tile: Tile, [ni, nj]: [u32; 2]) -> f64 {
    let (w, h) = (f64::from(tile.nx), f64::from(tile.ny));
    let (a0, b0) = (f64::from(tile.i0), f64::from(tile.j0));
    let at = |p: u32, q: u32| {
        mapping.at(
            a0 + w * f64::from(p) / f64::from(ni),
            b0 + h * f64::from(q) / f64::from(nj),
        )
    };
    let middle =
        |a: f64, b: f64| mapping.at(a0 + w * a / f64::from(ni), b0 + h * b / f64::from(nj));
    // The size of a cell on the map, from the middle of the tile: the shorter side.
    let cell = {
        let (ca, cb) = (a0 + w / 2.0, b0 + h / 2.0);
        let size_i = distance(mapping.at(ca - 0.5, cb), mapping.at(ca + 0.5, cb));
        let size_j = distance(mapping.at(ca, cb - 0.5), mapping.at(ca, cb + 0.5));
        size_i.min(size_j)
    };
    if !(cell.is_finite() && cell > 0.0) {
        return f64::INFINITY;
    }
    let mut worst: f64 = 0.0;
    // The corners of every part are computed once per row of vertices.
    let mut below: Vec<[f64; 2]> = (0..=ni).map(|p| at(p, 0)).collect();
    for q in 0..nj {
        let above: Vec<[f64; 2]> = (0..=ni).map(|p| at(p, q + 1)).collect();
        for p in 0..ni {
            let (c00, c10, c01, c11) = (
                below[p as usize],
                below[p as usize + 1],
                above[p as usize],
                above[p as usize + 1],
            );
            let (fp, fq) = (f64::from(p), f64::from(q));
            // The triangles of a part run from its (0, 0) corner to its (1, 1) corner.
            let samples = [
                (middle(fp + 0.5, fq + 0.5), mid(c00, c11)),
                (middle(fp + 0.5, fq), mid(c00, c10)),
                (middle(fp, fq + 0.5), mid(c00, c01)),
                (middle(fp + 1.0, fq + 0.5), mid(c10, c11)),
                (middle(fp + 0.5, fq + 1.0), mid(c01, c11)),
            ];
            for (exact, interpolated) in samples {
                let error = distance(exact, interpolated);
                if !error.is_finite() {
                    return f64::INFINITY;
                }
                worst = worst.max(error);
            }
        }
        below = above;
    }
    worst / cell
}

fn mid(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
}

fn distance(a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

/// The vertices and triangles of `tile` cut into `ni` by `nj` parts.
fn mesh(
    mapping: &Mapping<'_>,
    tile: Tile,
    [ni, nj]: [u32; 2],
    frame: &Frame,
    rough: bool,
) -> WarpTile {
    let side = ni as usize + 1;
    let vertices = side * (nj as usize + 1);
    let mut positions = Vec::with_capacity(vertices * 3);
    let mut uvs = Vec::with_capacity(vertices * 2);
    let mut placed = Vec::with_capacity(vertices);
    let mut unplaced = 0;
    let z = if mapping.elevation.is_finite() {
        mapping.elevation
    } else {
        0.0
    };
    for q in 0..=nj {
        for p in 0..=ni {
            let (u, v) = (f64::from(p) / f64::from(ni), f64::from(q) / f64::from(nj));
            let [x, y] = mapping.at(
                f64::from(tile.i0) + f64::from(tile.nx) * u,
                f64::from(tile.j0) + f64::from(tile.ny) * v,
            );
            let ok = x.is_finite() && y.is_finite();
            placed.push(ok);
            if ok {
                positions.extend(frame.rebase([x, y, z]));
            } else {
                unplaced += 1;
                positions.extend([f32::NAN; 3]);
            }
            uvs.extend([u as f32, v as f32]);
        }
    }
    let mut triangles = Vec::new();
    let vertex = |p: u32, q: u32| q as usize * side + p as usize;
    for q in 0..nj {
        for p in 0..ni {
            let (v00, v10, v01, v11) = (
                vertex(p, q),
                vertex(p + 1, q),
                vertex(p, q + 1),
                vertex(p + 1, q + 1),
            );
            for corners in [[v00, v10, v11], [v00, v11, v01]] {
                if corners
                    .iter()
                    .all(|&c| placed.get(c).copied().unwrap_or(false))
                {
                    triangles.extend(corners.map(|c| u32::try_from(c).unwrap_or(0)));
                }
            }
        }
    }
    WarpTile {
        positions,
        uvs,
        triangles,
        parts: [ni, nj],
        rough,
        unplaced,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::FrameSource;
    use karmania_core::CrsRef;

    fn epsg(code: u32) -> CrsRef {
        CrsRef::Epsg { code }
    }

    fn frame(crs: CrsRef, origin: [f64; 3]) -> Frame {
        Frame {
            map_crs: crs,
            origin,
            source: FrameSource::Auto,
        }
    }

    fn whole(lattice: &Lattice) -> Tile {
        Tile {
            i0: 0,
            j0: 0,
            nx: lattice.dims[0],
            ny: lattice.dims[1],
        }
    }

    fn lattice(origin: [f64; 2], cell: f64, dims: [u32; 2]) -> Lattice {
        Lattice {
            origin: [origin[0], origin[1], 0.0],
            spacing: [cell, cell, 1.0],
            dims: [dims[0], dims[1], 1],
            rotation: 0.0,
        }
    }

    #[test]
    fn a_conversion_that_changes_nothing_is_one_quad_with_the_corners_of_the_tile() {
        let l = lattice([512_000.0, 4_012_000.0], 10.0, [100, 50]);
        let same = Transformer::new(epsg(32640), epsg(32640)).unwrap();
        let w = warp_tile(
            &l,
            whole(&l),
            5.0,
            &same,
            &frame(epsg(32640), [512_000.0, 4_012_000.0, 0.0]),
        );
        assert_eq!((w.parts, w.rough, w.unplaced), ([1, 1], false, 0));
        assert_eq!(
            w.positions,
            [
                0.0, 0.0, 5.0, 1000.0, 0.0, 5.0, 0.0, 500.0, 5.0, 1000.0, 500.0, 5.0
            ]
        );
        assert_eq!(w.uvs, [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0]);
        assert_eq!(w.triangles, [0, 1, 3, 0, 3, 2]);
    }

    /// A grid of 10 m cells, 20 km across, near the edge of zone 40 (60 E), drawn on the map of zone 41: its
    /// corners are where the exact conversion puts them, and it is turned by the difference of the two
    /// grids' norths, about 2.5 degrees (the convergence is longitude difference times sin latitude, about
    /// 1.26 degrees each way at 3 degrees from a central meridian at 25 N).
    #[test]
    fn across_a_zone_change_the_corners_are_exact_and_the_grid_is_turned_by_the_convergence() {
        let l = lattice([790_000.0, 2_780_000.0], 10.0, [2_000, 2_000]);
        let t = Transformer::new(epsg(32640), epsg(32641)).unwrap();
        let origin = t.convert(790_000.0, 2_780_000.0);
        let f = frame(epsg(32641), [origin[0], origin[1], 0.0]);
        let w = warp_tile(&l, whole(&l), 0.0, &t, &f);
        assert_eq!((w.rough, w.unplaced), (false, 0));
        assert!(
            w.parts[0] >= 2,
            "a tenth of a 10 m cell is 1 m, which one part does not hold over 20 km"
        );
        let corner = |i: usize| {
            let [x, y] = t.convert(
                790_000.0 + if i % 2 == 1 { 20_000.0 } else { 0.0 },
                2_780_000.0 + if i >= 2 { 20_000.0 } else { 0.0 },
            );
            [x - origin[0], y - origin[1]]
        };
        assert_eq!(
            w.parts[0], w.parts[1],
            "a square tile is cut the same both ways"
        );
        let n = w.parts[0] as usize;
        let last = (n + 1) * (n + 1) - 1;
        for (vertex, wanted) in [
            (0, corner(0)),
            (n, corner(1)),
            (last - n, corner(2)),
            (last, corner(3)),
        ] {
            let got = [
                f64::from(w.positions[vertex * 3]),
                f64::from(w.positions[vertex * 3 + 1]),
            ];
            assert!(distance(got, wanted) < 0.01, "{vertex}: {got:?} {wanted:?}");
        }
        let (dx, dy) = (
            f64::from(w.positions[n * 3] - w.positions[0]),
            f64::from(w.positions[n * 3 + 1] - w.positions[1]),
        );
        let turned = dy.atan2(dx).to_degrees().abs();
        assert!((2.3..2.7).contains(&turned), "{turned} degrees");
        assert_eq!(w.triangles.len(), n * n * 6);
    }

    /// A grid in longitude and latitude of 600 by 400 cells of 0.01 degrees (about 1 km) on the map of zone 40: the
    /// conversion is far from linear over 6 by 4 degrees, so the mesh has to be finer, and it is within a
    /// tenth of a cell at the middles of its parts, which the test measures with the conversion itself.
    #[test]
    fn a_grid_in_degrees_is_cut_finer_until_it_is_within_a_tenth_of_a_cell() {
        let l = lattice([54.0, 22.0], 0.01, [600, 400]);
        let t = Transformer::new(epsg(4326), epsg(32640)).unwrap();
        let f = frame(epsg(32640), [500_000.0, 2_600_000.0, 0.0]);
        let w = warp_tile(&l, whole(&l), 0.0, &t, &f);
        assert!(w.parts[0] > 1 && !w.rough, "{:?} parts", w.parts);
        // With one part the mesh would not be good enough: that is why it was cut.
        assert!(
            error_in_cells(
                &Mapping {
                    lattice: &l,
                    transformer: &t,
                    elevation: 0.0
                },
                whole(&l),
                [1, 1]
            ) > MAX_ERROR_CELLS
        );
        // The triangle that holds the middle of each part gives the position within a tenth of a cell: a cell
        // is about 1 km (0.01 degrees), so 100 m. The check goes through every part, with the conversion
        // itself and not the code under test.
        let n = w.parts[0];
        let side = n as usize + 1;
        let vertex = |p: u32, q: u32| {
            let at = (q as usize * side + p as usize) * 3;
            [f64::from(w.positions[at]), f64::from(w.positions[at + 1])]
        };
        let mut worst: f64 = 0.0;
        for q in 0..n {
            for p in 0..n {
                let [x, y] = t.convert(
                    54.0 + 6.0 * (f64::from(p) + 0.5) / f64::from(n),
                    22.0 + 4.0 * (f64::from(q) + 0.5) / f64::from(n),
                );
                let exact = [x - 500_000.0, y - 2_600_000.0];
                worst = worst.max(distance(mid(vertex(p, q), vertex(p + 1, q + 1)), exact));
            }
        }
        assert!(worst < 100.0, "{worst} m at the worst of {n} x {n} parts");
    }

    #[test]
    fn what_cannot_be_placed_is_left_out_and_a_hopeless_mesh_is_rough() {
        // North of the pole the conversion has no answer.
        let beyond = lattice([57.0, 88.0], 0.5, [10, 10]);
        let t = Transformer::new(epsg(4326), epsg(32640)).unwrap();
        let f = frame(epsg(32640), [0.0; 3]);
        let w = warp_tile(&beyond, whole(&beyond), 0.0, &t, &f);
        assert!(w.unplaced > 0, "some vertices are past the pole");
        assert!(w.triangles.len() < w.parts[0] as usize * w.parts[1] as usize * 6);
        assert!(w.positions.iter().any(|c| c.is_nan()));
        // A whole world in one tile, in cells of 0.0036 degrees: no mesh of 100 parts a side is close.
        let world = lattice([-179.0, -80.0], 0.0036, [100_000, 100]);
        assert!(warp_tile(&world, whole(&world), 0.0, &t, &f).rough);
    }

    /// The worst distance, in cells, between the mesh of `w` and the conversion itself at the middle of each of
    /// its parts, measured with `Transformer::convert` and not with the code under test. The cell is the shorter
    /// side of a cell at the middle of the tile, as the code takes it, found here by the same means.
    fn worst_error_in_cells(
        l: &Lattice,
        tile: Tile,
        w: &WarpTile,
        t: &Transformer,
        origin: [f64; 2],
    ) -> f64 {
        let [ni, nj] = w.parts;
        let side = ni as usize + 1;
        let vertex = |p: u32, q: u32| {
            let at = (q as usize * side + p as usize) * 3;
            [f64::from(w.positions[at]), f64::from(w.positions[at + 1])]
        };
        let to_map = |a: f64, b: f64| {
            let [x, y, _] = l.local_to_world([a * l.spacing[0], b * l.spacing[1], 0.0]);
            let [mx, my] = t.convert(x, y);
            [mx - origin[0], my - origin[1]]
        };
        let (ca, cb) = (
            f64::from(tile.i0) + f64::from(tile.nx) / 2.0,
            f64::from(tile.j0) + f64::from(tile.ny) / 2.0,
        );
        let cell = distance(to_map(ca - 0.5, cb), to_map(ca + 0.5, cb))
            .min(distance(to_map(ca, cb - 0.5), to_map(ca, cb + 0.5)));
        let mut worst: f64 = 0.0;
        for q in 0..nj {
            for p in 0..ni {
                let exact = to_map(
                    f64::from(tile.i0) + f64::from(tile.nx) * (f64::from(p) + 0.5) / f64::from(ni),
                    f64::from(tile.j0) + f64::from(tile.ny) * (f64::from(q) + 0.5) / f64::from(nj),
                );
                worst = worst.max(distance(mid(vertex(p, q), vertex(p + 1, q + 1)), exact));
            }
        }
        worst / cell
    }

    #[test]
    fn a_tile_that_is_one_cell_wide_or_high_is_cut_along_its_length() {
        // Found by the review of the milestone: the cut was limited by the shorter side of the tile, so a strip of a cell
        // wide stayed one quad and was 0.17 cell off at the middle of its edge. Two degrees of longitude in
        // one row of cells, and two degrees of latitude in one column, from longitude and latitude to zone 40.
        let t = Transformer::new(epsg(4326), epsg(32640)).unwrap();
        for (dims, along) in [([2_000_u32, 1], 0), ([1, 4_096], 1)] {
            let l = lattice([59.0, 25.0], 0.001, dims);
            let f = frame(epsg(32640), [700_000.0, 2_800_000.0, 0.0]);
            let w = warp_tile(&l, whole(&l), 0.0, &t, &f);
            assert!(!w.rough, "{dims:?}: rough, {:?} parts", w.parts);
            assert!(
                w.parts[along] > 1,
                "{dims:?}: cut along its length: {:?}",
                w.parts
            );
            assert_eq!(
                w.parts[1 - along],
                1,
                "{dims:?}: one cell across is one part"
            );
            let error = worst_error_in_cells(&l, whole(&l), &w, &t, [700_000.0, 2_800_000.0]);
            assert!(
                error <= MAX_ERROR_CELLS * 1.05,
                "{dims:?}: {error} cell at the worst middle"
            );
        }
    }

    #[test]
    fn the_strip_beside_a_tile_is_as_good_as_the_tile() {
        // A 4,097 x 4,097 grid in textures of 4,096: a tile of 4,096 x 4,096, a strip of 1 x 4,096 and one of 4,096 x 1 and a
        // corner of one cell. Each is within a tenth of a cell at the middle of its parts.
        let t = Transformer::new(epsg(4326), epsg(32640)).unwrap();
        let l = lattice([57.0, 25.0], 0.0005, [4_097, 4_097]);
        let f = frame(epsg(32640), [500_000.0, 2_800_000.0, 0.0]);
        for tile in crate::grid::tiles(4_097, 4_097, 4_096) {
            let w = warp_tile(&l, tile, 0.0, &t, &f);
            let error = worst_error_in_cells(&l, tile, &w, &t, [500_000.0, 2_800_000.0]);
            assert!(
                !w.rough && error <= MAX_ERROR_CELLS * 1.05,
                "{tile:?}: {error} cell, {:?} parts",
                w.parts
            );
        }
    }
}
