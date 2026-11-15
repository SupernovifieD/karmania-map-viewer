//! Contour lines of a triangle mesh by height: the plane at each level cut through each triangle, the cuts chained into lines.
//!
//! A triangle that has a corner at or above a level and a corner below it is cut by the plane in a segment from one of its edges to
//! another (a corner is above when its height is at or above the level, as in [`crate::contour_grid`]). Two triangles that share an
//! edge cut it at one place, so the segments are joined by the edge, named by its two vertices, with no tolerance of distance. The
//! lines are at their level exactly: their vertices are on the edges of the mesh, and their height is the level. A triangle that
//! cannot be used (a corner that does not exist or is not a finite number, a vertex used twice) puts no line in the mesh and leaves a
//! gap where it is, so a mesh that is wrong does not stop the others from being contoured.

use std::ops::Range;

use crate::contour_grid::{Contour, Vertex, chain, tidy};
use crate::contour_levels::Levels;

/// An edge of a mesh: its two vertices, the lower number first, so that the two triangles that share it name it the same way.
type Edge = (u32, u32);

fn edge(a: u32, b: u32) -> Edge {
    if a <= b { (a, b) } else { (b, a) }
}

/// The triangles of a mesh and their vertices, as they are held in a dataset: `x y z` one after the other, and three vertex numbers
/// for each triangle.
#[derive(Debug, Clone, Copy)]
pub struct Surface<'a> {
    xyz: &'a [f64],
    indices: &'a [u32],
}

impl<'a> Surface<'a> {
    /// The surface of the vertices `xyz` and the triangles `indices` (a part of a triangle at the end is not one). `None` if `xyz` is
    /// not a whole number of vertices, or there are too many vertices to be numbered with a `u32`.
    #[must_use]
    pub fn new(xyz: &'a [f64], indices: &'a [u32]) -> Option<Self> {
        (xyz.len().is_multiple_of(3) && u32::try_from(xyz.len() / 3).is_ok())
            .then_some(Self { xyz, indices })
    }

    /// How many triangles there are.
    #[must_use]
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// The place of a vertex, if it is there and all three coordinates are finite numbers.
    fn point(&self, vertex: u32) -> Option<[f64; 3]> {
        let at = (vertex as usize).checked_mul(3)?;
        let &[x, y, z] = self.xyz.get(at..at.checked_add(3)?)? else {
            return None;
        };
        (x.is_finite() && y.is_finite() && z.is_finite()).then_some([x, y, z])
    }

    /// The corners of triangle `triangle`: their numbers and places. `None` for a triangle that is not there, one that uses a vertex
    /// twice, or one with a corner that is not there or whose place is not a finite number.
    fn corners(&self, triangle: usize) -> Option<([u32; 3], [[f64; 3]; 3])> {
        let at = triangle.checked_mul(3)?;
        let &[a, b, c] = self.indices.get(at..at.checked_add(3)?)? else {
            return None;
        };
        if a == b || b == c || a == c {
            return None;
        }
        Some(([a, b, c], [self.point(a)?, self.point(b)?, self.point(c)?]))
    }

    /// The lowest and the highest height of the corners of the triangles that can be used, or `None` if there is none.
    #[must_use]
    pub fn range(&self) -> Option<(f64, f64)> {
        let mut found: Option<(f64, f64)> = None;
        for triangle in 0..self.triangle_count() {
            let Some((_, points)) = self.corners(triangle) else {
                continue;
            };
            for [_, _, z] in points {
                found = Some(match found {
                    Some((low, high)) => (low.min(z), high.max(z)),
                    None => (z, z),
                });
            }
        }
        found
    }

    /// Where a line at `level` crosses the edge `(a, b)` (`a` is the lower number): on the edge, at the height `level`.
    fn crossing(&self, (a, b): Edge, level: f64) -> Option<Vertex> {
        let (pa, pb) = (self.point(a)?, self.point(b)?);
        let t = if pb[2] == pa[2] {
            0.5
        } else {
            ((level - pa[2]) / (pb[2] - pa[2])).clamp(0.0, 1.0)
        };
        Some(Vertex {
            // (Not `pa + t * (pb - pa)`: the difference of coordinates of 1e308 and -1e308 is not a number a float holds.)
            x: pa[0] * (1.0 - t) + pb[0] * t,
            y: pa[1] * (1.0 - t) + pb[1] * t,
            z: level,
        })
    }
}

/// The pieces of the lines of every level, found triangle by triangle; a piece is the two edges that it crosses.
#[derive(Debug, Clone, Default)]
pub struct MeshScan {
    pieces: Vec<Vec<(Edge, Edge)>>,
}

impl MeshScan {
    /// A scan of `levels` with nothing found yet.
    #[must_use]
    pub fn new(levels: &Levels) -> Self {
        Self {
            pieces: vec![Vec::new(); levels.len()],
        }
    }

    /// Finds the pieces of the lines in the triangles `triangles` (numbers past the last triangle are left out), so that the work
    /// can be done in parts, with a stop between them.
    pub fn scan_triangles(
        &mut self,
        surface: &Surface<'_>,
        levels: &Levels,
        triangles: Range<usize>,
    ) {
        for triangle in triangles.start..triangles.end.min(surface.triangle_count()) {
            let Some((vertices, points)) = surface.corners(triangle) else {
                continue;
            };
            let heights = points.map(|point| point[2]);
            let low = heights.iter().copied().fold(f64::INFINITY, f64::min);
            let high = heights.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            for level in levels.crossed_by(low, high) {
                let Some(height) = levels.height(level) else {
                    continue;
                };
                let above = heights.map(|z| z >= height);
                let count = above.iter().filter(|&&is_above| is_above).count();
                // One corner is alone on its side of the level (the one above if one is, the one below if two are above); the plane
                // cuts the two edges that meet at it.
                let Some(alone) = above.iter().position(|&is_above| is_above == (count == 1))
                else {
                    continue;
                };
                let (Some(&here), Some(&next), Some(&previous)) = (
                    vertices.get(alone),
                    vertices.get((alone + 1) % 3),
                    vertices.get((alone + 2) % 3),
                ) else {
                    continue;
                };
                if let Some(found) = self.pieces.get_mut(level) {
                    found.push((edge(here, next), edge(here, previous)));
                }
            }
        }
    }

    /// The lines of the level `level` (an index of [`Levels::height`]) from the pieces found so far: the pieces that end on the same
    /// edge are one line. Open lines first, in the order of their first edge, then the ones that close.
    #[must_use]
    pub fn lines(&self, surface: &Surface<'_>, levels: &Levels, level: usize) -> Vec<Contour> {
        let (Some(pieces), Some(height)) = (self.pieces.get(level), levels.height(level)) else {
            return Vec::new();
        };
        chain(pieces)
            .into_iter()
            .filter_map(|(edges, closed)| {
                let vertices = tidy(
                    edges
                        .into_iter()
                        .filter_map(|edge| surface.crossing(edge, height))
                        .collect(),
                    closed,
                )?;
                Some(Contour {
                    level,
                    vertices,
                    closed,
                })
            })
            .collect()
    }

    /// How many pieces have been found, for every level.
    #[must_use]
    pub fn piece_count(&self) -> usize {
        self.pieces.iter().map(Vec::len).sum()
    }
}

/// The contour lines of a surface at every level, lowest level first.
#[must_use]
pub fn contour_surface(surface: &Surface<'_>, levels: &Levels) -> Vec<Contour> {
    let mut scan = MeshScan::new(levels);
    scan.scan_triangles(surface, levels, 0..surface.triangle_count());
    (0..levels.len())
        .flat_map(|level| scan.lines(surface, levels, level))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The vertices of an `nx` by `ny` lattice at one unit apart with the height `f(i, j)`, and two triangles for each square.
    fn lattice(nx: usize, ny: usize, f: impl Fn(f64, f64) -> f64) -> (Vec<f64>, Vec<u32>) {
        let mut xyz = Vec::new();
        for j in 0..ny {
            for i in 0..nx {
                xyz.extend([i as f64, j as f64, f(i as f64, j as f64)]);
            }
        }
        let at = |i: usize, j: usize| u32::try_from(j * nx + i).unwrap();
        let mut indices = Vec::new();
        for j in 0..ny - 1 {
            for i in 0..nx - 1 {
                indices.extend([at(i, j), at(i + 1, j), at(i + 1, j + 1)]);
                indices.extend([at(i, j), at(i + 1, j + 1), at(i, j + 1)]);
            }
        }
        (xyz, indices)
    }

    fn contours(xyz: &[f64], indices: &[u32], levels: &Levels) -> Vec<Contour> {
        contour_surface(&Surface::new(xyz, indices).unwrap(), levels)
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 1.0e-9
    }

    #[test]
    fn a_tilted_plane_gives_straight_evenly_spaced_lines_at_their_level() {
        let (xyz, indices) = lattice(9, 5, |i, _| i);
        let levels = Levels::for_range(0.0, 8.0, 0.0, 2.0, 5).unwrap();
        let lines = contours(&xyz, &indices, &levels);
        let at: Vec<f64> = lines
            .iter()
            .filter_map(|l| levels.height(l.level))
            .collect();
        // Level 0 has every corner at or above it; 2, 4, 6 and 8 each cut the plane in one line across.
        assert_eq!(at, [2.0, 4.0, 6.0, 8.0]);
        for line in &lines {
            let level = levels.height(line.level).unwrap();
            assert!(!line.closed);
            assert!(
                line.vertices
                    .iter()
                    .all(|v| near(v.x, level) && v.z == level)
            );
            let mut ys: Vec<f64> = line.vertices.iter().map(|v| v.y).collect();
            ys.sort_by(f64::total_cmp);
            assert_eq!(ys.first(), Some(&0.0));
            assert_eq!(ys.last(), Some(&4.0));
        }
    }

    #[test]
    fn a_cone_gives_one_closed_line_round_the_top_for_each_level() {
        let (xyz, indices) = lattice(41, 41, |i, j| {
            ((i - 20.0).powi(2) + (j - 20.0).powi(2)).sqrt()
        });
        let levels = Levels::for_range(0.0, 20.0, 0.0, 4.0, 5).unwrap();
        let lines = contours(&xyz, &indices, &levels);
        for level in 1..5 {
            let height = levels.height(level).unwrap();
            let rings: Vec<&Contour> = lines.iter().filter(|l| l.level == level).collect();
            assert_eq!(rings.len(), 1, "level {height}");
            assert!(rings[0].closed);
            assert_eq!(rings[0].vertices.first(), rings[0].vertices.last());
            for v in &rings[0].vertices {
                let radius = ((v.x - 20.0).powi(2) + (v.y - 20.0).powi(2)).sqrt();
                assert!((radius - height).abs() < 0.1, "{radius} for {height}");
            }
        }
    }

    #[test]
    fn a_missing_triangle_leaves_a_gap_that_cuts_the_lines_in_two() {
        let (xyz, mut indices) = lattice(9, 5, |i, _| i);
        // The square at i = 3, j = 1 (counted in squares) is triangles 2 * (1 * 8 + 3) and the next: take both out.
        let first = 2 * (8 + 3) * 3;
        indices.drain(first..first + 6);
        let levels = Levels::for_range(0.0, 8.0, 0.0, 2.0, 5).unwrap();
        let lines = contours(&xyz, &indices, &levels);
        let at_four: Vec<&Contour> = lines
            .iter()
            .filter(|l| levels.height(l.level) == Some(4.0))
            .collect();
        // The level 4 passes through the squares at i = 3 (from x = 3 to 4): the gap at j = 1 cuts it into the part below and the part above.
        assert_eq!(at_four.len(), 2);
        assert!(at_four.iter().all(|l| !l.closed));
        // The others are not in the squares at i = 3 and are whole.
        assert_eq!(lines.iter().filter(|l| l.level != 2).count(), 3);
    }

    #[test]
    fn a_vertex_at_a_level_is_above_it_and_a_peak_at_the_level_is_no_line() {
        // A pyramid of whole numbers on whole levels: a ring for each level below the top, and the apex alone has no line.
        let (xyz, indices) = lattice(9, 9, |i, j| 4.0 - (i - 4.0).abs().max((j - 4.0).abs()));
        let levels = Levels::for_range(0.0, 4.0, 0.0, 1.0, 5).unwrap();
        let lines = contours(&xyz, &indices, &levels);
        let heights: Vec<f64> = lines
            .iter()
            .filter_map(|l| levels.height(l.level))
            .collect();
        assert_eq!(heights, [1.0, 2.0, 3.0]);
        assert!(lines.iter().all(|l| l.closed && l.vertices.len() >= 4));
        assert!(
            lines
                .iter()
                .all(|l| l.vertices.first() == l.vertices.last())
        );
        // No point is twice in a row.
        for line in &lines {
            assert!(line.vertices.windows(2).all(|w| w[0] != w[1]));
        }
    }

    #[test]
    fn triangles_that_cannot_be_used_are_left_out_and_the_others_are_contoured() {
        let (mut xyz, mut indices) = lattice(9, 5, |i, _| i);
        let levels = Levels::for_range(0.0, 8.0, 0.0, 2.0, 5).unwrap();
        let pieces_of = |xyz: &[f64], indices: &[u32]| {
            let surface = Surface::new(xyz, indices).unwrap();
            let mut scan = MeshScan::new(&levels);
            scan.scan_triangles(&surface, &levels, 0..surface.triangle_count());
            scan.piece_count()
        };
        let whole = contours(&xyz, &indices, &levels).len();
        let whole_pieces = pieces_of(&xyz, &indices);
        // A vertex that does not exist, a triangle with a vertex twice, one whose vertex is not a number, and a part of a triangle.
        indices.extend([0, 1, 9999]);
        indices.extend([5, 5, 6]);
        xyz.extend([f64::NAN, 0.0, 1.0, 0.0, f64::INFINITY, 20.0]);
        let (nan, inf) = (xyz.len() as u32 / 3 - 2, xyz.len() as u32 / 3 - 1);
        indices.extend([0, 1, nan]);
        indices.extend([0, 2, inf]);
        indices.extend([1, 2]);
        let lines = contours(&xyz, &indices, &levels);
        assert_eq!(lines.len(), whole);
        // Not one piece comes of them (a piece of a triangle that is not used would be a loose end on an edge of the others).
        assert_eq!(pieces_of(&xyz, &indices), whole_pieces);
        // The range of the heights is that of the triangles that are used: the infinity (20) is not in it.
        assert_eq!(
            Surface::new(&xyz, &indices).unwrap().range(),
            Some((0.0, 8.0))
        );
        // A surface of vertices that are not whole, and no triangles at all.
        assert!(Surface::new(&xyz[..4], &[]).is_none());
        let empty = Surface::new(&[], &[]).unwrap();
        assert_eq!((empty.triangle_count(), empty.range()), (0, None));
        assert!(contour_surface(&empty, &levels).is_empty());
    }

    #[test]
    fn a_flat_surface_and_a_surface_wholly_at_a_level_have_no_lines() {
        let (xyz, indices) = lattice(5, 5, |_, _| 3.0);
        let levels = Levels::for_range(3.0, 3.0, 0.0, 3.0, 5).unwrap();
        assert!(contours(&xyz, &indices, &levels).is_empty());
        let levels = Levels::for_range(3.0, 3.0, 0.0, 2.0, 5).unwrap();
        assert!(contours(&xyz, &indices, &levels).is_empty());
    }

    #[test]
    fn scanning_in_parts_is_scanning_at_once_and_a_shared_edge_is_one_place() {
        let (xyz, indices) = lattice(21, 13, |i, j| (i * 0.7).sin() * 3.0 + (j * 0.4).cos() * 2.0);
        let surface = Surface::new(&xyz, &indices).unwrap();
        let (low, high) = surface.range().unwrap();
        let levels = Levels::for_range(low, high, 0.0, 0.5, 2).unwrap();
        let whole = contour_surface(&surface, &levels);
        let mut scan = MeshScan::new(&levels);
        let count = surface.triangle_count();
        for start in (0..count).step_by(37) {
            scan.scan_triangles(&surface, &levels, start..start + 37);
        }
        let parts: Vec<Contour> = (0..levels.len())
            .flat_map(|level| scan.lines(&surface, &levels, level))
            .collect();
        assert_eq!(parts, whole);
        assert_eq!(scan.piece_count(), {
            let mut all = MeshScan::new(&levels);
            all.scan_triangles(&surface, &levels, 0..count);
            all.piece_count()
        });
        // Every vertex is at its level and none is twice in a row, and a line is closed exactly when it ends where it began.
        for line in &whole {
            let level = levels.height(line.level).unwrap();
            assert!(line.vertices.iter().all(|v| v.z == level));
            assert!(line.vertices.windows(2).all(|w| w[0] != w[1]));
            assert_eq!(line.closed, line.vertices.first() == line.vertices.last());
        }
        assert!(whole.len() > 10);
    }

    /// Run when asked for, in release: `cargo test --release -p karmania-prep contour_mesh -- --ignored --nocapture`.
    #[test]
    #[ignore = "a timing, for a machine that is not busy"]
    fn timing_of_a_million_triangles_with_twenty_levels() {
        let (xyz, indices) = lattice(708, 708, |i, j| {
            ((i * 0.01).sin() + (j * 0.013).cos()) * 50.0
        });
        let started = std::time::Instant::now();
        let surface = Surface::new(&xyz, &indices).unwrap();
        let (low, high) = surface.range().unwrap();
        let levels = Levels::for_range(low, high, 0.0, (high - low) / 20.0, 5).unwrap();
        let lines = contour_surface(&surface, &levels);
        println!(
            "{} triangles, {} levels, {} lines in {:?}",
            surface.triangle_count(),
            levels.len(),
            lines.len(),
            started.elapsed()
        );
        assert!(!lines.is_empty());
    }

    #[test]
    fn a_vertex_on_an_edge_from_x_of_minus_1e308_to_1e308_is_a_number() {
        let xyz = [-1.0e308, 0.0, 0.0, 1.0e308, 0.0, 1.0, 0.0, 1.0, 1.0];
        let levels = Levels::for_range(0.0, 1.0, 0.0, 0.5, 5).unwrap();
        // The level 0.5 crosses the edges from the first vertex (and 1 is the height of the two others, which is a line along their edge).
        let lines: Vec<Contour> = contours(&xyz, &[0, 1, 2], &levels)
            .into_iter()
            .filter(|line| levels.height(line.level) == Some(0.5))
            .collect();
        assert_eq!(lines.len(), 1);
        assert!(
            lines[0]
                .vertices
                .iter()
                .all(|v| v.x.is_finite() && v.y.is_finite())
        );
        // On the edge from -1e308 to 1e308 it is at 0, and on the edge from -1e308 to 0 at -5e307.
        let mut xs: Vec<f64> = lines[0].vertices.iter().map(|v| v.x).collect();
        xs.sort_by(f64::total_cmp);
        assert_eq!(xs, [-5.0e307, 0.0]);
    }

    #[test]
    fn two_triangles_that_are_the_same_make_no_line_of_a_segment_traced_twice() {
        let (xyz, _) = lattice(3, 3, |i, _| i);
        let levels = Levels::for_range(0.0, 2.0, 0.0, 0.5, 5).unwrap();
        // One triangle that the level 0.5 cuts has a line, and the same triangle twice does not make a loop of it.
        let once = contours(&xyz, &[0, 1, 4], &levels);
        assert!(
            once.iter().all(|line| !line.closed) && !once.is_empty(),
            "{once:?}"
        );
        let twice = contours(&xyz, &[0, 1, 4, 0, 1, 4], &levels);
        assert!(
            twice
                .iter()
                .all(|line| !(line.closed && line.vertices.len() < 4)),
            "{twice:?}"
        );
    }
}
