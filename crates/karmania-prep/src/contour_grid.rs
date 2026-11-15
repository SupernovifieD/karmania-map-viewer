//! Contour lines of a field of values at the points of a regular lattice: marching squares (brief 11.5).
//!
//! The field is `nx` by `ny` values, `i` fastest. A square is four neighbouring values; a level passes through it when some of them are
//! above the level and some are not (a value is above a level when it is at or above it, see [`crate::contour_levels`]), and the line
//! crosses the edges between a value that is above and one that is not, at the place that is in proportion to the values (linear).
//! Two squares that share an edge cross it at the same place, which is what makes the pieces of a line one line: the pieces are
//! joined by the edge they end on.
//!
//! * A square with a value that is not a finite number has no line: **no-value points break lines**.
//! * A saddle (the values above a level are opposite corners) is resolved by the average of the four values: if it is at or above the level
//!   the corners that are above are joined through the middle, and the line goes round the others.
//! * The vertices are in the index space of the field (point `(i, j)` is at `(i, j)`), with a height, which is the interpolated value of a
//!   second field if there is one and 0 if not. The caller puts them where the lattice puts them.
//!
//! The work is in two parts that a caller can do a bit at a time: [`Scan::scan_rows`] finds the pieces of every level in some rows of
//! squares, and [`Scan::lines`] joins those of one level.

use std::ops::Range;

use crate::contour_levels::Levels;

/// A field of values at the points of a lattice, and optionally the height of each point.
#[derive(Debug, Clone, Copy)]
pub struct Field<'a> {
    nx: usize,
    ny: usize,
    values: &'a [f64],
    heights: Option<&'a [f64]>,
}

impl<'a> Field<'a> {
    /// A field of `nx` by `ny` values, `i` fastest. `None` if `values` is not that many, or there are too many points to number
    /// the edges between them with a `u32` (two for each).
    #[must_use]
    pub fn new(nx: usize, ny: usize, values: &'a [f64]) -> Option<Self> {
        let points = nx.checked_mul(ny)?;
        let edges = points.checked_mul(2)?;
        (values.len() == points && u32::try_from(edges).is_ok()).then_some(Self {
            nx,
            ny,
            values,
            heights: None,
        })
    }

    /// The same field with a height for each point, in the same order; `None` if they are not as many.
    #[must_use]
    pub fn with_heights(self, heights: &'a [f64]) -> Option<Self> {
        (heights.len() == self.values.len()).then_some(Self {
            heights: Some(heights),
            ..self
        })
    }

    /// How many points across.
    #[must_use]
    pub fn nx(&self) -> usize {
        self.nx
    }

    /// How many points up.
    #[must_use]
    pub fn ny(&self) -> usize {
        self.ny
    }

    /// The smallest and the largest value that is a finite number, or `None` if there is none.
    #[must_use]
    pub fn range(&self) -> Option<(f64, f64)> {
        let mut found: Option<(f64, f64)> = None;
        for &value in self.values.iter().filter(|value| value.is_finite()) {
            found = Some(match found {
                Some((low, high)) => (low.min(value), high.max(value)),
                None => (value, value),
            });
        }
        found
    }

    /// The value at point `(i, j)`; `NaN` (a value that is not there) outside the field.
    fn value(&self, i: usize, j: usize) -> f64 {
        if i < self.nx && j < self.ny {
            self.values
                .get(j * self.nx + i)
                .copied()
                .unwrap_or(f64::NAN)
        } else {
            f64::NAN
        }
    }

    fn height(&self, i: usize, j: usize) -> f64 {
        self.heights
            .and_then(|heights| heights.get(j * self.nx + i))
            .copied()
            .unwrap_or(0.0)
    }

    /// The number of the edge between `(i, j)` and `(i + 1, j)`: even.
    fn horizontal(&self, i: usize, j: usize) -> u32 {
        u32::try_from((j * (self.nx - 1) + i) * 2).unwrap_or(0)
    }

    /// The number of the edge between `(i, j)` and `(i, j + 1)`: odd.
    fn vertical(&self, i: usize, j: usize) -> u32 {
        u32::try_from((j * self.nx + i) * 2 + 1).unwrap_or(1)
    }

    /// Where a line at `level` crosses the edge `edge`: the point, in the index space of the field, and its height.
    fn crossing(&self, edge: u32, level: f64) -> Vertex {
        let index = (edge >> 1) as usize;
        let (i, j, step) = if edge & 1 == 0 {
            (index % (self.nx - 1), index / (self.nx - 1), (1, 0))
        } else {
            (index % self.nx, index / self.nx, (0, 1))
        };
        let (a, b) = (self.value(i, j), self.value(i + step.0, j + step.1));
        let t = if b == a {
            0.5
        } else {
            ((level - a) / (b - a)).clamp(0.0, 1.0)
        };
        let (ha, hb) = (self.height(i, j), self.height(i + step.0, j + step.1));
        #[allow(clippy::cast_precision_loss)]
        let (x, y) = (i as f64 + t * step.0 as f64, j as f64 + t * step.1 as f64);
        Vertex {
            x,
            y,
            // (Not `ha + t * (hb - ha)`: the difference of heights of 1e308 and -1e308 is not a number a float holds, and `0 * inf` is not one.)
            z: ha * (1.0 - t) + hb * t,
        }
    }
}

/// A vertex of a contour line: where it is (in the index space of a field, or the coordinates of a mesh), and its height.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vertex {
    /// Across: in points (`i`) for a field, in the coordinate system of a mesh for a mesh.
    pub x: f64,
    /// Up: in points (`j`) for a field, in the coordinate system of a mesh for a mesh.
    pub y: f64,
    /// The height: that of the heights of the field, interpolated, or 0 for a field without.
    pub z: f64,
}

/// One contour line.
#[derive(Debug, Clone, PartialEq)]
pub struct Contour {
    /// The level it is at, as an index of [`Levels::height`].
    pub level: usize,
    /// Its vertices, in order. A closed line has the same vertex first and last.
    pub vertices: Vec<Vertex>,
    /// Whether it comes back to where it began.
    pub closed: bool,
}

/// The side of a square that a line crosses.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Side {
    Bottom,
    Right,
    Top,
    Left,
}

/// The pieces of the lines of every level, found square by square; a piece is the two edges that it crosses, as numbers.
#[derive(Debug, Clone, Default)]
pub struct Scan {
    pieces: Vec<Vec<(u32, u32)>>,
}

impl Scan {
    /// A scan of `levels` with nothing found yet.
    #[must_use]
    pub fn new(levels: &Levels) -> Self {
        Self {
            pieces: vec![Vec::new(); levels.len()],
        }
    }

    /// Finds the pieces of the lines in the squares of the rows `rows` (row `j` is the squares between the values of rows `j` and
    /// `j + 1`; rows past the last are left out).
    pub fn scan_rows(&mut self, field: &Field<'_>, levels: &Levels, rows: Range<usize>) {
        if field.nx < 2 || field.ny < 2 {
            return;
        }
        for j in rows.start..rows.end.min(field.ny - 1) {
            for i in 0..field.nx - 1 {
                let corners = [
                    field.value(i, j),
                    field.value(i + 1, j),
                    field.value(i + 1, j + 1),
                    field.value(i, j + 1),
                ];
                if corners.iter().any(|value| !value.is_finite()) {
                    continue;
                }
                let low = corners.iter().copied().fold(f64::INFINITY, f64::min);
                let high = corners.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                for level in levels.crossed_by(low, high) {
                    let Some(height) = levels.height(level) else {
                        continue;
                    };
                    let edge = |side: Side| match side {
                        Side::Bottom => field.horizontal(i, j),
                        Side::Top => field.horizontal(i, j + 1),
                        Side::Left => field.vertical(i, j),
                        Side::Right => field.vertical(i + 1, j),
                    };
                    if let Some(found) = self.pieces.get_mut(level) {
                        let (pieces, count) = pieces_of(corners, height);
                        for &(from, to) in pieces.iter().take(count) {
                            found.push((edge(from), edge(to)));
                        }
                    }
                }
            }
        }
    }

    /// The lines of the level `level` (an index of [`Levels::height`]) from the pieces found so far: the pieces that end on the same
    /// edge are one line. Open lines first, in the order of their first edge, then the ones that close.
    #[must_use]
    pub fn lines(&self, field: &Field<'_>, levels: &Levels, level: usize) -> Vec<Contour> {
        let (Some(pieces), Some(height)) = (self.pieces.get(level), levels.height(level)) else {
            return Vec::new();
        };
        chain(pieces)
            .into_iter()
            .filter_map(|(edges, closed)| {
                let vertices = tidy(
                    edges
                        .into_iter()
                        .map(|edge| field.crossing(edge, height))
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

/// The contour lines of a field at every level, lowest level first.
#[must_use]
pub fn contour_field(field: &Field<'_>, levels: &Levels) -> Vec<Contour> {
    let mut scan = Scan::new(levels);
    scan.scan_rows(field, levels, 0..field.ny.saturating_sub(1));
    (0..levels.len())
        .flat_map(|level| scan.lines(field, levels, level))
        .collect()
}

/// The pieces of the line at `level` in a square with these corner values (bottom left, bottom right, top right, top left): none, one or two
/// (a saddle), as the pieces and how many there are. No list is allocated: a grid of 4,000,000 cells at 20 levels has three million of them.
fn pieces_of(corners: [f64; 4], level: f64) -> ([(Side, Side); 2], usize) {
    let [bl, br, tr, tl] = corners;
    let above = [bl >= level, br >= level, tr >= level, tl >= level];
    let crossed = [
        (Side::Bottom, above[0] != above[1]),
        (Side::Right, above[1] != above[2]),
        (Side::Top, above[3] != above[2]),
        (Side::Left, above[0] != above[3]),
    ];
    let mut sides = [Side::Bottom; 4];
    let mut count = 0;
    for (side, is_crossed) in crossed {
        if is_crossed {
            if let Some(slot) = sides.get_mut(count) {
                *slot = side;
            }
            count += 1;
        }
    }
    let mut pieces = [(Side::Bottom, Side::Bottom); 2];
    match count {
        2 => {
            pieces[0] = (sides[0], sides[1]);
            (pieces, 1)
        }
        4 => {
            // A saddle: the average of the four values decides which pair of corners is joined through the middle, and the line goes
            // round each of the others (the corners that are not joined are cut off, each by a piece between its two sides).
            // (Each corner is divided by four before they are added: the sum of four values of 1e308 is not a number a float holds, and the quarters of them are.)
            let centre_above = bl / 4.0 + br / 4.0 + tr / 4.0 + tl / 4.0 >= level;
            let cut = |corner: usize| match corner {
                0 => (Side::Bottom, Side::Left),
                1 => (Side::Bottom, Side::Right),
                2 => (Side::Right, Side::Top),
                _ => (Side::Top, Side::Left),
            };
            let mut found = 0;
            for corner in 0..4 {
                if above.get(corner).is_some_and(|&a| a != centre_above) {
                    if let Some(slot) = pieces.get_mut(found) {
                        *slot = cut(corner);
                    }
                    found += 1;
                }
            }
            (pieces, found.min(2))
        }
        _ => (pieces, 0),
    }
}

/// The vertices of a line as they are kept. A value that is exactly at the level puts the crossings of its edges on the one point,
/// and a line through it would have that point twice in a row: once is the line. A line of one point (a peak at the level) is no
/// line, and nor is a loop of one or two points (a closed line has its first point again at its end, and three points besides): `None`.
pub(crate) fn tidy(mut vertices: Vec<Vertex>, closed: bool) -> Option<Vec<Vertex>> {
    vertices.dedup_by(|current, previous| {
        current.x == previous.x && current.y == previous.y && current.z == previous.z
    });
    // A closed line is at least a triangle and the first point again at its end: two points that are joined to each other both ways (the same segment
    // twice, which two triangles of one mesh that are the same make) are not a loop.
    (vertices.len() >= if closed { 4 } else { 2 }).then_some(vertices)
}

/// Joins pieces that end on the same edge: each line as the edges it crosses in order, and whether it is closed (the first edge is
/// then the last). An edge is any key that is the same for the two sides of it (a number for a grid, the two vertices for a mesh).
/// An edge has two pieces at most; a third end on it is left as the end of a line.
pub(crate) fn chain<E: Copy + Ord>(pieces: &[(E, E)]) -> Vec<(Vec<E>, bool)> {
    const NONE: u32 = u32::MAX;
    let count = pieces.len();
    // The edge at every end: `2 * piece` is the first edge of a piece, `2 * piece + 1` its second.
    let edges: Vec<E> = pieces
        .iter()
        .flat_map(|&(first, second)| [first, second])
        .collect();
    let Ok(ends) = u32::try_from(count * 2) else {
        return Vec::new();
    };
    let mut order: Vec<u32> = (0..ends).collect();
    order.sort_unstable_by_key(|&end| (edges.get(end as usize).copied(), end));
    // The other end on the same edge, which is in another piece (an edge has two squares at most), or none: the line ends there.
    let mut mate = vec![NONE; count * 2];
    let mut at = 0;
    while at < order.len() {
        match (order.get(at), order.get(at + 1)) {
            (Some(&a), Some(&b)) if edges.get(a as usize) == edges.get(b as usize) => {
                if let Some(slot) = mate.get_mut(a as usize) {
                    *slot = b;
                }
                if let Some(slot) = mate.get_mut(b as usize) {
                    *slot = a;
                }
                at += 2;
            }
            _ => at += 1,
        }
    }
    let mut visited = vec![false; count];
    let mut lines = Vec::new();
    // Open lines begin at an end that nothing joins, closed ones, which is what is left, at any end.
    let starts = (0..count * 2)
        .filter(|&end| mate.get(end) == Some(&NONE))
        .chain((0..count).map(|piece| piece * 2));
    for start in starts {
        if visited.get(start / 2).copied().unwrap_or(true) {
            continue;
        }
        let mut path: Vec<E> = edges.get(start).copied().into_iter().collect();
        let mut end = start;
        let closed = loop {
            if let Some(seen) = visited.get_mut(end / 2) {
                *seen = true;
            }
            let far = end ^ 1;
            path.extend(edges.get(far).copied());
            let next = mate.get(far).copied().unwrap_or(NONE);
            if next == NONE {
                break false;
            }
            end = next as usize;
            if visited.get(end / 2).copied().unwrap_or(true) {
                break true;
            }
        };
        lines.push((path, closed));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(nx: usize, ny: usize, f: impl Fn(f64, f64) -> f64) -> Vec<f64> {
        (0..ny)
            .flat_map(|j| (0..nx).map(move |i| (i, j)))
            .map(|(i, j)| f(i as f64, j as f64))
            .collect()
    }

    fn lines_of(nx: usize, ny: usize, data: &[f64], levels: &Levels) -> Vec<Contour> {
        contour_field(&Field::new(nx, ny, data).unwrap(), levels)
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 1.0e-9
    }

    #[test]
    fn a_plane_gives_straight_evenly_spaced_lines_one_for_each_level() {
        let data = values(9, 5, |i, _| i);
        let levels = Levels::for_range(0.0, 8.0, 0.0, 2.0, 5).unwrap();
        let lines = lines_of(9, 5, &data, &levels);
        // Level 0 has every value at or above it, so it has no line; the others are one line across the whole field.
        let at: Vec<f64> = lines
            .iter()
            .filter_map(|l| levels.height(l.level))
            .collect();
        assert_eq!(at, [2.0, 4.0, 6.0, 8.0]);
        for line in &lines {
            let level = levels.height(line.level).unwrap();
            assert!(!line.closed);
            assert_eq!(line.vertices.len(), 5, "one vertex for each row of points");
            assert!(
                line.vertices.iter().all(|v| near(v.x, level)),
                "straight and upright"
            );
            let mut ys: Vec<f64> = line.vertices.iter().map(|v| v.y).collect();
            ys.sort_by(f64::total_cmp);
            assert_eq!(ys, [0.0, 1.0, 2.0, 3.0, 4.0]);
        }
    }

    #[test]
    fn a_tilted_plane_gives_straight_lines_along_its_diagonal() {
        let data = values(7, 7, |i, j| i + j);
        let levels = Levels::for_range(0.0, 12.0, 0.0, 3.0, 5).unwrap();
        let lines = lines_of(7, 7, &data, &levels);
        // Level 12 is the corner (6, 6) alone, a point at the level, which is no line.
        assert_eq!(lines.len(), 3, "levels 3, 6 and 9");
        for line in &lines {
            let level = levels.height(line.level).unwrap();
            assert!(line.vertices.iter().all(|v| near(v.x + v.y, level)));
            assert!(line.vertices.len() >= 2);
        }
    }

    #[test]
    fn a_cone_gives_circles_closed_lines_at_the_radius_of_the_level() {
        let data = values(21, 21, |i, j| (i - 10.0).hypot(j - 10.0));
        let levels = Levels::for_range(0.0, 10.0, 0.0, 2.0, 5).unwrap();
        let lines = lines_of(21, 21, &data, &levels);
        let radii: Vec<f64> = lines
            .iter()
            .filter_map(|l| levels.height(l.level))
            .collect();
        assert_eq!(
            radii,
            [2.0, 4.0, 6.0, 8.0, 10.0],
            "one line for each level above 0"
        );
        for line in &lines {
            let radius = levels.height(line.level).unwrap();
            assert!(line.closed, "radius {radius}");
            assert_eq!(line.vertices.first(), line.vertices.last());
            assert!(line.vertices.len() > 8, "enough vertices to be round");
            for vertex in &line.vertices {
                let away = (vertex.x - 10.0).hypot(vertex.y - 10.0);
                assert!((away - radius).abs() < 0.05, "{away} is not {radius}");
            }
        }
        // Past the edge of the field the circles are cut by it: four arcs, which are open, at the corners.
        let wider = Levels::for_range(0.0, 14.0, 0.0, 12.0, 5).unwrap();
        let corners: Vec<Contour> = lines_of(21, 21, &data, &wider)
            .into_iter()
            .filter(|l| wider.height(l.level) == Some(12.0))
            .collect();
        assert_eq!(corners.len(), 4);
        assert!(corners.iter().all(|l| !l.closed));
    }

    #[test]
    fn a_saddle_is_resolved_by_the_average_of_the_four_values() {
        // Bottom left and top right are 1, the other two 0. At 0.5 the average is at the level, so the corners that are above are joined
        // and the line goes round the two that are not: bottom to right, and top to left.
        let data = [1.0, 0.0, 0.0, 1.0];
        let across = Levels::for_range(0.0, 1.0, 0.5, 10.0, 5).unwrap();
        let ends = |lines: &[Contour]| -> Vec<Vec<(f64, f64)>> {
            let mut all: Vec<Vec<(f64, f64)>> = lines
                .iter()
                .map(|l| {
                    let mut v: Vec<(f64, f64)> = l.vertices.iter().map(|p| (p.x, p.y)).collect();
                    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
                    v
                })
                .collect();
            all.sort_by(|a, b| a.partial_cmp(b).unwrap());
            all
        };
        assert_eq!(
            ends(&lines_of(2, 2, &data, &across)),
            [vec![(0.0, 0.5), (0.5, 1.0)], vec![(0.5, 0.0), (1.0, 0.5)]]
        );
        // At 0.6 the average is under the level, so the corners that are above are cut off, each by its own line.
        let below = Levels::for_range(0.0, 1.0, 0.6, 10.0, 5).unwrap();
        let lines = lines_of(2, 2, &data, &below);
        let got = ends(&lines);
        assert_eq!(got.len(), 2);
        let expected = [vec![(0.0, 0.4), (0.4, 0.0)], vec![(0.6, 1.0), (1.0, 0.6)]];
        for (line, want) in got.iter().zip(expected.iter()) {
            for (g, w) in line.iter().zip(want.iter()) {
                assert!(near(g.0, w.0) && near(g.1, w.1), "{got:?}");
            }
        }
    }

    #[test]
    fn a_value_that_is_not_there_breaks_the_lines_that_would_pass_it() {
        let mut data = values(9, 5, |i, _| i);
        data[2 * 9 + 4] = f64::NAN;
        let levels = Levels::for_range(0.0, 8.0, 0.0, 2.0, 5).unwrap();
        let lines = lines_of(9, 5, &data, &levels);
        let of_level = |height: f64| -> Vec<&Contour> {
            lines
                .iter()
                .filter(|l| levels.height(l.level) == Some(height))
                .collect()
        };
        // The line at 4 runs along the squares that have the hole in a corner: it is two lines, the part under it and the part over it.
        let broken = of_level(4.0);
        assert_eq!(broken.len(), 2);
        let mut ys: Vec<Vec<f64>> = broken
            .iter()
            .map(|l| {
                let mut y: Vec<f64> = l.vertices.iter().map(|v| v.y).collect();
                y.sort_by(f64::total_cmp);
                y
            })
            .collect();
        ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert_eq!(ys, [vec![0.0, 1.0], vec![3.0, 4.0]]);
        // The others are not near the hole and are whole.
        assert_eq!(of_level(2.0).len(), 1);
        assert_eq!(of_level(2.0)[0].vertices.len(), 5);
        // Infinity is not a value either.
        let mut infinite = values(9, 5, |i, _| i);
        infinite[2 * 9 + 4] = f64::INFINITY;
        assert_eq!(lines_of(9, 5, &infinite, &levels).len(), lines.len());
    }

    #[test]
    fn values_that_are_exactly_at_a_level_make_clean_lines_with_no_repeated_point_and_none_for_a_lone_peak()
     {
        // A pyramid of whole numbers with its apex 5 at the middle of 11 by 11 points: every level is the exact value of a ring of points.
        let data = values(11, 11, |i, j| {
            5.0 - (i - 5.0).abs().max((j - 5.0).abs()).min(5.0)
        });
        let levels = Levels::for_range(0.0, 5.0, 0.0, 1.0, 5).unwrap();
        let lines = lines_of(11, 11, &data, &levels);
        let heights: Vec<f64> = lines
            .iter()
            .filter_map(|l| levels.height(l.level))
            .collect();
        // Level 0 is under every value (none), level 5 is the apex alone (no line: a point is not a line), the others are one ring each.
        assert_eq!(heights, [1.0, 2.0, 3.0, 4.0]);
        for line in &lines {
            assert!(line.closed);
            assert_eq!(line.vertices.first(), line.vertices.last());
            assert!(
                line.vertices.windows(2).all(|pair| pair[0] != pair[1]),
                "a point twice in a row: {line:?}"
            );
            // The ring of the points at that value: eight points for each ring of the pyramid (a square), at its corners and the middles.
            let level = levels.height(line.level).unwrap();
            let reach = 5.0 - level + 1.0;
            let mut got: Vec<(i32, i32)> = line.vertices[1..]
                .iter()
                .map(|v| ((v.x - 5.0).round() as i32, (v.y - 5.0).round() as i32))
                .collect();
            got.sort_unstable();
            got.dedup();
            assert_eq!(
                got.len(),
                line.vertices.len() - 1,
                "level {level}: a point is not twice in the ring"
            );
            assert!(
                got.iter()
                    .all(|&(x, y)| f64::from(x.abs().max(y.abs())) == reach - 1.0
                        || f64::from(x.abs().max(y.abs())) == reach)
            );
        }
    }

    #[test]
    fn a_field_that_is_all_at_one_level_or_one_value_has_no_line() {
        let levels = Levels::for_range(0.0, 10.0, 5.0, 5.0, 5).unwrap();
        assert!(lines_of(4, 4, &[5.0; 16], &levels).is_empty());
        assert!(lines_of(4, 4, &[3.0; 16], &levels).is_empty());
        assert!(lines_of(4, 4, &[f64::NAN; 16], &levels).is_empty());
    }

    #[test]
    fn the_heights_of_the_field_are_interpolated_to_the_vertices() {
        let data = values(5, 4, |i, _| i);
        let heights = values(5, 4, |i, _| 10.0 * i);
        let field = Field::new(5, 4, &data)
            .unwrap()
            .with_heights(&heights)
            .unwrap();
        let levels = Levels::for_range(0.0, 4.0, 0.0, 1.5, 5).unwrap();
        for line in contour_field(&field, &levels) {
            let level = levels.height(line.level).unwrap();
            assert!(
                line.vertices.iter().all(|v| near(v.z, 10.0 * level)),
                "{level}"
            );
        }
        // And none where there are none, or not as many.
        let flat = contour_field(&Field::new(5, 4, &data).unwrap(), &levels);
        assert!(flat.iter().flat_map(|l| &l.vertices).all(|v| v.z == 0.0));
        assert!(
            Field::new(5, 4, &data)
                .unwrap()
                .with_heights(&heights[1..])
                .is_none()
        );
    }

    #[test]
    fn a_field_that_is_not_the_size_it_says_or_is_too_thin_or_too_large_is_none_or_has_no_lines() {
        assert!(Field::new(3, 3, &[0.0; 8]).is_none());
        assert!(Field::new(usize::MAX, 2, &[]).is_none());
        assert!(Field::new(u32::MAX as usize, 1, &[]).is_none());
        let levels = Levels::for_range(0.0, 2.0, 0.0, 1.0, 5).unwrap();
        // One row or one column of values has no square.
        assert!(lines_of(5, 1, &[0.0, 1.0, 2.0, 1.0, 0.0], &levels).is_empty());
        assert!(lines_of(1, 5, &[0.0, 1.0, 2.0, 1.0, 0.0], &levels).is_empty());
        assert!(lines_of(0, 0, &[], &levels).is_empty());
    }

    #[test]
    fn scanning_in_parts_gives_what_scanning_at_once_gives() {
        let data = values(30, 25, |i, j| (i / 4.0).sin() * (j / 5.0).cos() * 10.0);
        let field = Field::new(30, 25, &data).unwrap();
        let (low, high) = field.range().unwrap();
        let levels = Levels::for_range(low, high, 0.0, 2.5, 2).unwrap();
        let whole = contour_field(&field, &levels);
        let mut scan = Scan::new(&levels);
        for rows in [0..7, 7..8, 8..20, 20..24] {
            scan.scan_rows(&field, &levels, rows);
        }
        let parts: Vec<Contour> = (0..levels.len())
            .flat_map(|level| scan.lines(&field, &levels, level))
            .collect();
        assert_eq!(parts, whole);
        assert!(scan.piece_count() > 20);
    }

    #[test]
    fn every_vertex_is_on_its_level_on_an_edge_and_no_two_lines_share_one() {
        let data = values(60, 50, |i, j| {
            (i / 7.0).sin() * (j / 5.0).cos() * 10.0 + i * 0.05
        });
        let field = Field::new(60, 50, &data).unwrap();
        let (low, high) = field.range().unwrap();
        let levels = Levels::for_range(low, high, 0.0, 1.0, 5).unwrap();
        let lines = contour_field(&field, &levels);
        assert!(lines.len() > 20);
        let mut seen = std::collections::BTreeSet::new();
        for line in &lines {
            let level = levels.height(line.level).unwrap();
            let own = if line.closed {
                &line.vertices[1..]
            } else {
                &line.vertices[..]
            };
            for vertex in own {
                // On a horizontal edge (y is a whole number) or a vertical one, and linear between the two values there is the level.
                let (a, b, t) = if near(vertex.y, vertex.y.round()) {
                    let (i, j) = (
                        (vertex.x.floor() as usize).min(58),
                        vertex.y.round() as usize,
                    );
                    (data[j * 60 + i], data[j * 60 + i + 1], vertex.x - i as f64)
                } else {
                    let (i, j) = (vertex.x.round() as usize, vertex.y.floor() as usize);
                    (
                        data[j * 60 + i],
                        data[(j + 1) * 60 + i],
                        vertex.y - j as f64,
                    )
                };
                assert!(near(a + t * (b - a), level), "{vertex:?} is not at {level}");
                assert!(
                    seen.insert((line.level, vertex.x.to_bits(), vertex.y.to_bits())),
                    "{vertex:?} is on two lines"
                );
            }
            if line.closed {
                assert_eq!(line.vertices.first(), line.vertices.last());
                assert!(line.vertices.len() >= 4);
            }
        }
        // Done twice, it is the same.
        assert_eq!(contour_field(&field, &levels), lines);
    }

    /// The brief's target: 20 levels of a grid of 4,000,000 cells in under 2 seconds (here natively; in the browser it is measured by
    /// `pnpm perf`). Only when asked for: `cargo test --release -p karmania-prep contour_grid -- --ignored`.
    #[test]
    #[ignore = "a timing, run with --release when asked for"]
    fn twenty_levels_of_four_million_cells_are_made_in_two_seconds() {
        let side = 2000;
        let data = values(side, side, |i, j| {
            (i / 150.0).sin() * (j / 110.0).cos() * 50.0 + ((i + j) / 37.0).sin() * 4.0
        });
        let field = Field::new(side, side, &data).unwrap();
        let (low, high) = field.range().unwrap();
        let levels = Levels::for_range(low, high, 0.0, (high - low) / 19.5, 5).unwrap();
        let started = std::time::Instant::now();
        let lines = contour_field(&field, &levels);
        let took = started.elapsed();
        let vertices: usize = lines.iter().map(|l| l.vertices.len()).sum();
        assert!(
            levels.len() >= 19 && vertices > 10_000,
            "{} levels, {vertices} vertices",
            levels.len()
        );
        assert!(took.as_secs_f64() < 2.0, "{took:?} for {vertices} vertices");
    }

    #[test]
    fn the_saddle_is_resolved_by_the_average_even_when_the_sum_of_the_corners_is_not_a_float() {
        // Corners of 1e308 at the bottom left and top right, 0 at the others, at the level 6e307 (the average, 5e307, is below it): the two high corners are
        // cut off each by a line of its own. The sum of the four values is infinity, which would join them through the middle instead.
        let data = [1.0e308, 0.0, 0.0, 1.0e308];
        let levels = Levels::for_range(0.0, 1.0e308, 0.0, 2.0e307, 5).unwrap();
        let lines = lines_of(2, 2, &data, &levels);
        let at_level: Vec<Vec<(i32, i32)>> = lines
            .iter()
            .filter(|line| levels.height(line.level) == Some(6.0e307))
            .map(|line| {
                let mut points: Vec<(i32, i32)> = line
                    .vertices
                    .iter()
                    .map(|v| ((v.x * 10.0).round() as i32, (v.y * 10.0).round() as i32))
                    .collect();
                points.sort_unstable();
                points
            })
            .collect();
        // Around the bottom left corner: (0.4, 0) and (0, 0.4); around the top right: (1, 0.6) and (0.6, 1).
        assert_eq!(at_level.len(), 2);
        assert!(at_level.contains(&vec![(0, 4), (4, 0)]), "{at_level:?}");
        assert!(at_level.contains(&vec![(6, 10), (10, 6)]), "{at_level:?}");
    }

    #[test]
    fn the_height_of_a_vertex_between_heights_of_1e308_and_minus_1e308_is_a_number() {
        let values = [0.0, 1.0, 0.0, 1.0];
        let heights = [-1.0e308, 1.0e308, -1.0e308, 1.0e308];
        let field = Field::new(2, 2, &values)
            .unwrap()
            .with_heights(&heights)
            .unwrap();
        let levels = Levels::for_range(0.0, 1.0, 0.0, 0.5, 5).unwrap();
        let lines = contour_field(&field, &levels);
        let at_half: Vec<&Contour> = lines
            .iter()
            .filter(|line| levels.height(line.level) == Some(0.5))
            .collect();
        assert_eq!(at_half.len(), 1);
        assert!(at_half[0].vertices.iter().all(|v| v.z == 0.0));
    }
}
