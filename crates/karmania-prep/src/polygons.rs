//! Render buffers of polygons: filled triangles and outlines.

use std::ops::Range;

use earcut::Earcut;
use karmania_core::{CrsRef, Finding, FindingCode, Findings, Location, Polygons};

use crate::origin::Frame;
use crate::project::{Prepared, project};

/// The most vertices of one polygon (its rings, holes included) that are triangulated: 100,000. More than
/// this is drawn as an outline only, with `display.polygons.too_detailed`.
///
/// A polygon is one step of a prepare, which cannot be cut, and the worker hears nothing, not a request to
/// stop, while `earcut` works on it. Its time depends on the shape and not on the number of vertices alone (the
/// second review of the milestone, and the ignored timing tests `the_longest_step_for_one_large_polygon` and
/// `the_longest_step_for_polygons_that_are_hard_to_fill`): natively, a smooth ring of 100,000 vertices takes
/// 30 to 340 ms, a jagged one (a star whose radius is uncorrelated from vertex to vertex) 3.3 s, a comb of 75,000
/// vertices 6.6 s; and holes cost about 4 ns for each vertex and each ring (see [`MAX_FILL_WORK`]). So this limit
/// does **not** bound the step: a pathological ring at the limit takes seconds. It is the largest size at which a
/// smooth polygon, which is nearly every polygon of a map, is filled in a third of a second or less, and
/// it keeps the nodes of `earcut` (40 bytes each under a 32-bit offset) far from the size at which it panics.
const MAX_FILLED_VERTICES: usize = 100_000;

/// The most work in one polygon, as its vertices times its rings (the exterior and the holes): 150,000,000,
/// which is 6,000 holes of four vertices. More is drawn as an outline only, with `display.polygons.too_detailed`.
/// `earcut` joins every hole to the polygon, and the time of that grows with the holes and the vertices together: natively
/// 85 ms at 10,000 vertices and 2,500 holes, 370 ms at 20,000 and 5,000, 1.5 s at 40,000 and 10,000, and 18.7 s at
/// 96,000 and 24,000 (about 4 ns for each unit of the product). The limit is about half a second for holes.
const MAX_FILL_WORK: u64 = 150_000_000;

/// How far the area of the triangles may be from the area of the polygon (as a fraction of it) before
/// the triangulation is taken to be wrong, which it is for a polygon that crosses itself.
const AREA_TOLERANCE: f64 = 1e-6;

/// The buffers of a set of polygons.
///
/// Positions are as for [`crate::PointsBuffers`]: one per vertex of the dataset, in vertex order (a
/// ring's closing vertex is not stored, so it is not repeated).
#[derive(Debug, Clone, PartialEq)]
pub struct PolygonsBuffers {
    /// `3 * vertex count` values, relative to the frame's origin, in map units.
    pub positions: Vec<f32>,
    /// Three vertex numbers (0-based, into `positions`) per triangle, counter-clockwise seen from above (as
    /// `earcut` gives them, whichever way the ring runs; a test pins it, since nothing here turns a triangle).
    /// Holes are left out of the filled area. A polygon that could not be triangulated has none.
    pub triangles: Vec<u32>,
    /// For each triangle, the number of its polygon (0-based, the row of the attribute table).
    pub triangle_polygon: Vec<u32>,
    /// Pairs of vertex numbers: one segment for every side of every ring, the closing side included, for
    /// the exterior ring and the holes. A segment with an end that has no position on the map is left out.
    pub outline: Vec<u32>,
    /// For each outline segment, the number of its polygon.
    pub outline_polygon: Vec<u32>,
}

/// Prepares `polygons`, in the system `own`, for drawing in `frame`. A polygon whose rings cross, that
/// has no area, or that has a vertex with no position on the map is not filled in: it has an outline and
/// no triangles, and one `display.polygons.outline_only` finding counts them, with the first 20 as
/// examples. Edges are straight between the converted vertices.
///
/// # Errors
///
/// A `display.crs.not_convertible` finding if `own` cannot be converted to the map's system.
pub fn polygons_buffers(
    polygons: &Polygons,
    own: CrsRef,
    frame: &Frame,
) -> Result<Prepared<PolygonsBuffers>, Finding> {
    let mut findings = Findings::new();
    let positions = project(&polygons.positions, own, frame, &mut findings)?;
    let mut fill = PolygonsFill::new(positions);
    fill.advance(polygons, usize::MAX);
    let buffers = fill.finish(&mut findings);
    Ok(Prepared { buffers, findings })
}

/// Polygons made into triangles and outlines a few at a time, so that a long list can be done in steps.
/// Done in steps of any size it gives the same buffers and finding as all at once.
pub(crate) struct PolygonsFill {
    buffers: PolygonsBuffers,
    earcut: Earcut<f64>,
    unfilled: Finding,
    too_detailed: Finding,
    /// The most vertices of a polygon that are triangulated.
    limit: usize,
    /// The most vertices times rings of a polygon that are triangulated.
    work_limit: u64,
    next: usize,
}

impl PolygonsFill {
    /// Starts with the `positions` of the vertices on the map.
    pub(crate) fn new(positions: Vec<f32>) -> Self {
        Self::with_limits(positions, MAX_FILLED_VERTICES, MAX_FILL_WORK)
    }

    /// Starts as [`PolygonsFill::new`], with polygons of more than `limit` vertices, or of more than `work_limit` vertices
    /// times rings, outlined and not filled. The words of the finding always give the real limit of vertices, whatever limit is
    /// given here, which only the tests do.
    pub(crate) fn with_limits(positions: Vec<f32>, limit: usize, work_limit: u64) -> Self {
        let mut unfilled = Finding::new(
            FindingCode::DisplayPolygonsOutlineOnly,
            "Some polygons could not be filled in, so only their outlines are drawn.",
        )
        .with_hint(
            "Check that no ring crosses itself or another ring, and that each polygon has some area.",
        );
        unfilled.count = 0;
        let mut too_detailed = Finding::new(
            FindingCode::DisplayPolygonsTooDetailed,
            format!(
                "Some polygons are too detailed to fill in (more than {} vertices, or too many holes for their size), so only their outlines are drawn.",
                karmania_core::text::format_count(MAX_FILLED_VERTICES as u64)
            ),
        )
        .with_hint("Simplify the polygons, or split them into smaller ones, to fill them in.");
        too_detailed.count = 0;
        Self {
            buffers: PolygonsBuffers {
                positions,
                triangles: Vec::new(),
                triangle_polygon: Vec::new(),
                outline: Vec::new(),
                outline_polygon: Vec::new(),
            },
            earcut: Earcut::new(),
            unfilled,
            too_detailed,
            limit,
            work_limit,
            next: 0,
        }
    }

    /// Does polygons until `budget` vertices (at least one polygon) have been done. Returns whether every
    /// polygon is done.
    pub(crate) fn advance(&mut self, polygons: &Polygons, budget: usize) -> bool {
        let count = polygons.polygon_count().unwrap_or(0);
        let mut spent = 0_usize;
        while self.next < count && spent < budget.max(1) {
            let polygon = self.next;
            self.next += 1;
            let (Some(rings), Ok(number)) = (polygons.ring_range(polygon), u32::try_from(polygon))
            else {
                continue;
            };
            let ranges: Vec<_> = rings
                .filter_map(|ring| polygons.vertex_range(ring))
                .collect();
            spent = spent.saturating_add(
                ranges
                    .iter()
                    .map(ExactSizeIterator::len)
                    .sum::<usize>()
                    .max(1),
            );
            for range in &ranges {
                outline_ring(&mut self.buffers, range.clone(), number);
            }
            let vertices: usize = ranges.iter().map(ExactSizeIterator::len).sum();
            let work = vertices as u64 * ranges.len() as u64;
            if vertices > self.limit || work > self.work_limit {
                self.too_detailed.count += 1;
                self.too_detailed
                    .add_example(Location::default().with_element(u64::from(number)));
            } else if !fill(&mut self.buffers, &mut self.earcut, &ranges, number) {
                self.unfilled.count += 1;
                self.unfilled
                    .add_example(Location::default().with_element(u64::from(number)));
            }
        }
        self.next >= count
    }

    /// The fraction of the polygons done, from 0 to 1.
    pub(crate) fn fraction(&self, polygons: &Polygons) -> f64 {
        match polygons.polygon_count() {
            Some(count) if count > 0 => self.next as f64 / count as f64,
            _ => 1.0,
        }
    }

    /// The buffers, with the finding for the polygons that were not filled in added to `findings`.
    pub(crate) fn finish(self, findings: &mut Findings) -> PolygonsBuffers {
        if self.unfilled.count > 0 {
            findings.add(self.unfilled);
        }
        if self.too_detailed.count > 0 {
            findings.add(self.too_detailed);
        }
        self.buffers
    }
}

/// The position of vertex `vertex` as `f64`, if it has one on the map.
fn at(positions: &[f32], vertex: usize) -> Option<[f64; 2]> {
    let start = vertex.checked_mul(3)?;
    let triple = <&[f32; 3]>::try_from(positions.get(start..start.checked_add(3)?)?).ok()?;
    let [x, y, z] = *triple;
    [x, y, z]
        .iter()
        .all(|c| c.is_finite())
        .then(|| [f64::from(x), f64::from(y)])
}

fn outline_ring(buffers: &mut PolygonsBuffers, ring: Range<usize>, polygon: u32) {
    for vertex in ring.clone() {
        let next = if vertex + 1 < ring.end {
            vertex + 1
        } else {
            ring.start
        };
        if let (Some(_), Some(_), Ok(a), Ok(b)) = (
            at(&buffers.positions, vertex),
            at(&buffers.positions, next),
            u32::try_from(vertex),
            u32::try_from(next),
        ) {
            buffers.outline.extend([a, b]);
            buffers.outline_polygon.push(polygon);
        }
    }
}

/// Adds the triangles of one polygon. `false` if it could not be triangulated, which leaves no triangle.
fn fill(
    buffers: &mut PolygonsBuffers,
    earcut: &mut Earcut<f64>,
    rings: &[Range<usize>],
    polygon: u32,
) -> bool {
    let (Some(first), Some(last)) = (rings.first(), rings.last()) else {
        return false;
    };
    let (start, end) = (first.start, last.end);
    // The rings of a polygon follow each other in the vertex list, and a polygon has three vertices at least.
    let contiguous = rings.windows(2).all(|pair| pair[0].end == pair[1].start);
    let size = end.saturating_sub(start);
    if !contiguous || size < 3 {
        return false;
    }
    let Some(data) = (start..end)
        .map(|vertex| at(&buffers.positions, vertex))
        .collect::<Option<Vec<[f64; 2]>>>()
    else {
        return false;
    };
    let ring_area = |ring: &Range<usize>| {
        data.get(ring.start - start..ring.end - start)
            .map_or(0.0, |vertices| signed_area(vertices).abs())
    };
    let holes: Vec<u32> = rings
        .iter()
        .skip(1)
        .filter_map(|ring| u32::try_from(ring.start - start).ok())
        .collect();
    let mut local: Vec<u32> = Vec::new();
    earcut.earcut(data.iter().copied(), &holes, &mut local);
    let polygon_area = rings
        .iter()
        .enumerate()
        .map(|(i, ring)| {
            if i == 0 {
                ring_area(ring)
            } else {
                -ring_area(ring)
            }
        })
        .sum::<f64>();
    let mut triangles = Vec::with_capacity(local.len());
    let mut triangles_area = 0.0;
    for corners in local.as_chunks::<3>().0 {
        let [a, b, c] = corners.map(|i| usize::try_from(i).ok().and_then(|i| data.get(i)).copied());
        let (Some(a), Some(b), Some(c)) = (a, b, c) else {
            return false;
        };
        triangles_area += signed_area(&[a, b, c]).abs();
        triangles.extend(*corners);
    }
    let fits = polygon_area > 0.0
        && triangles_area > 0.0
        && ((triangles_area - polygon_area) / polygon_area).abs() <= AREA_TOLERANCE;
    let Ok(offset) = u32::try_from(start) else {
        return false;
    };
    if !fits {
        return false;
    }
    buffers
        .triangle_polygon
        .extend(std::iter::repeat_n(polygon, triangles.len() / 3));
    buffers
        .triangles
        .extend(triangles.iter().map(|vertex| vertex + offset));
    true
}

/// The signed area of a ring by the shoelace formula: positive when it runs counter-clockwise.
fn signed_area(ring: &[[f64; 2]]) -> f64 {
    let next = ring.iter().cycle().skip(1);
    ring.iter()
        .zip(next)
        .map(|(a, b)| a[0] * b[1] - b[0] * a[1])
        .sum::<f64>()
        / 2.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::FrameSource;
    use karmania_core::Positions;

    const LOCAL: CrsRef = CrsRef::Local {
        units: karmania_core::Units::Metre,
    };

    fn frame() -> Frame {
        Frame {
            map_crs: LOCAL,
            origin: [0.0; 3],
            source: FrameSource::Auto,
        }
    }

    /// Polygons from rings of `(x, y)` vertices: `polygons[p][r]` is ring `r` of polygon `p`.
    fn polygons(shapes: &[&[&[(f64, f64)]]]) -> Polygons {
        let (mut x, mut y) = (Vec::new(), Vec::new());
        let (mut ring_offsets, mut polygon_offsets) = (vec![0_u32], vec![0_u32]);
        for polygon in shapes {
            for ring in *polygon {
                for &(px, py) in *ring {
                    x.push(px);
                    y.push(py);
                }
                ring_offsets.push(u32::try_from(x.len()).unwrap());
            }
            polygon_offsets.push(u32::try_from(ring_offsets.len() - 1).unwrap());
        }
        Polygons {
            positions: Positions::from_xyz(&x, &y, None, &mut Findings::new()).unwrap(),
            ring_offsets,
            polygon_offsets,
        }
    }

    const SQUARE: [(f64, f64); 4] = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
    const HOLE: [(f64, f64); 4] = [(3.0, 3.0), (3.0, 7.0), (7.0, 7.0), (7.0, 3.0)];

    fn prepare(p: &Polygons) -> Prepared<PolygonsBuffers> {
        polygons_buffers(p, LOCAL, &frame()).unwrap()
    }

    /// The area of the triangles, from the buffers.
    fn filled_area(b: &PolygonsBuffers) -> f64 {
        b.triangles
            .as_chunks::<3>()
            .0
            .iter()
            .map(|t| {
                let [a, b2, c] = t.map(|i| at(&b.positions, i as usize).unwrap());
                signed_area(&[a, b2, c])
            })
            .sum()
    }

    #[test]
    fn a_square_is_two_counter_clockwise_triangles_and_four_outline_segments() {
        let out = prepare(&polygons(&[&[&SQUARE]]));
        let b = &out.buffers;
        assert_eq!(b.triangles.len(), 6);
        assert_eq!(b.triangle_polygon, [0, 0]);
        assert_eq!(
            filled_area(b),
            100.0,
            "every triangle counts as positive: counter-clockwise"
        );
        assert_eq!(b.outline, [0, 1, 1, 2, 2, 3, 3, 0]);
        assert_eq!(b.outline_polygon, [0, 0, 0, 0]);
        assert!(out.findings.is_empty());
        // A clockwise ring is filled the same way.
        let clockwise: Vec<_> = SQUARE.iter().rev().copied().collect();
        assert_eq!(
            filled_area(&prepare(&polygons(&[&[&clockwise]])).buffers),
            100.0
        );
    }

    #[test]
    fn a_hole_is_left_out_of_the_fill_and_outlined() {
        let out = prepare(&polygons(&[&[&SQUARE, &HOLE]]));
        let b = &out.buffers;
        assert!((filled_area(b) - 84.0).abs() < 1e-9, "{}", filled_area(b));
        assert_eq!(
            b.outline.len(),
            16,
            "four sides of the ring and four of the hole"
        );
        assert!(b.triangle_polygon.iter().all(|&p| p == 0));
        assert!(b.triangles.iter().all(|&i| i < 8));
    }

    #[test]
    fn several_polygons_are_numbered_and_a_concave_one_is_filled_exactly() {
        let l_shape = [
            (0.0, 0.0),
            (6.0, 0.0),
            (6.0, 2.0),
            (2.0, 2.0),
            (2.0, 6.0),
            (0.0, 6.0),
        ];
        let shifted: Vec<_> = SQUARE.iter().map(|&(x, y)| (x + 100.0, y)).collect();
        let out = prepare(&polygons(&[&[&l_shape], &[&shifted, &[]]]));
        let b = &out.buffers;
        assert!((filled_area(b) - (20.0 + 100.0)).abs() < 1e-9);
        let seen: std::collections::BTreeSet<u32> = b.triangle_polygon.iter().copied().collect();
        assert_eq!(seen, [0, 1].into());
        assert_eq!(b.triangles.len() / 3, b.triangle_polygon.len());
        assert_eq!(b.outline.len() / 2, b.outline_polygon.len());
        // The second polygon's triangles use its own vertices (6 to 9).
        for (t, &p) in b
            .triangles
            .as_chunks::<3>()
            .0
            .iter()
            .zip(&b.triangle_polygon)
        {
            assert!(
                t.iter()
                    .all(|&i| if p == 0 { i < 6 } else { (6..10).contains(&i) }),
                "{t:?} {p}"
            );
        }
    }

    #[test]
    fn a_polygon_with_no_area_has_an_outline_and_a_warning() {
        // Collinear, a ring of a repeated point, and a symmetric bow tie that crosses itself.
        let line = [(0.0, 0.0), (5.0, 0.0), (10.0, 0.0)];
        let point = [(4.0, 4.0), (4.0, 4.0), (4.0, 4.0)];
        let bow_tie = [(0.0, 0.0), (10.0, 10.0), (10.0, 0.0), (0.0, 10.0)];
        let out = prepare(&polygons(&[&[&line], &[&SQUARE], &[&point], &[&bow_tie]]));
        let b = &out.buffers;
        assert_eq!(b.triangle_polygon, [1, 1], "only the square is filled");
        assert_eq!(
            b.outline_polygon.iter().filter(|&&p| p == 0).count(),
            3,
            "the line's own outline"
        );
        assert_eq!(b.outline_polygon.iter().filter(|&&p| p == 3).count(), 4);
        let finding = &out.findings.as_slice()[0];
        assert_eq!(finding.code.as_str(), "display.polygons.outline_only");
        assert_eq!(finding.count, 3);
        let examples: Vec<_> = finding.examples.iter().map(|e| e.element).collect();
        assert_eq!(examples, [Some(0), Some(2), Some(3)]);
    }

    #[test]
    fn a_repeated_vertex_and_a_collinear_vertex_do_not_stop_the_fill() {
        let ring = [
            (0.0, 0.0),
            (5.0, 0.0),
            (5.0, 0.0),
            (10.0, 0.0),
            (10.0, 10.0),
            (0.0, 10.0),
        ];
        let out = prepare(&polygons(&[&[&ring]]));
        assert_eq!(filled_area(&out.buffers), 100.0);
        assert!(out.findings.is_empty());
    }

    #[test]
    fn a_vertex_with_no_position_leaves_the_polygon_unfilled_and_its_sides_out() {
        let mut ring = SQUARE.to_vec();
        ring[2] = (f64::NAN, 10.0);
        let out = prepare(&polygons(&[&[&ring]]));
        assert!(out.buffers.triangles.is_empty());
        assert_eq!(
            out.buffers.outline,
            [0, 1, 3, 0],
            "the sides to vertex 2 are left out"
        );
        assert_eq!(out.findings.as_slice()[0].count, 1);
    }

    #[test]
    fn no_polygons_and_polygons_without_rings_make_nothing() {
        let none = polygons(&[]);
        assert_eq!(prepare(&none).buffers.triangles.len(), 0);
        let hollow = polygons(&[&[]]);
        let out = prepare(&hollow);
        assert!(out.buffers.triangles.is_empty() && out.buffers.outline.is_empty());
        assert_eq!(out.findings.as_slice()[0].count, 1);
        let bad = Polygons {
            positions: Positions::default(),
            ring_offsets: vec![],
            polygon_offsets: vec![],
        };
        assert!(prepare(&bad).findings.is_empty());
    }

    /// Rings of three to eight vertices on a grid of 5 x 5 points, so that vertices repeat, run along one
    /// line and make rings cross, with up to two such holes: the buffers are made for every one of them
    /// without a panic, and what is filled is a whole polygon (see `AREA_TOLERANCE`).
    #[test]
    fn thousands_of_degenerate_rings_never_panic_and_never_give_a_wrong_fill() {
        let mut seed = 12_345_u64;
        let mut next = move |below: u64| {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (seed >> 33) % below
        };
        let mut filled = 0;
        for _ in 0..3_000 {
            let mut rings: Vec<Vec<(f64, f64)>> = Vec::new();
            for _ in 0..=next(3) {
                let n = 3 + next(6);
                rings.push((0..n).map(|_| (next(5) as f64, next(5) as f64)).collect());
            }
            let refs: Vec<&[(f64, f64)]> = rings.iter().map(Vec::as_slice).collect();
            let out = prepare(&polygons(&[&refs]));
            let b = &out.buffers;
            let vertices = rings.iter().map(Vec::len).sum::<usize>();
            assert!(
                b.triangles
                    .iter()
                    .chain(&b.outline)
                    .all(|&i| (i as usize) < vertices)
            );
            assert_eq!(b.triangles.len(), b.triangle_polygon.len() * 3);
            if !b.triangles.is_empty() {
                filled += 1;
                assert!(filled_area(b) > 0.0, "{rings:?}");
            } else {
                assert_eq!(out.findings.as_slice()[0].count, 1, "{rings:?}");
            }
        }
        assert!(
            filled > 100,
            "a test of rings that are all unfilled would prove little: {filled}"
        );
    }

    #[test]
    fn the_polygons_of_another_system_are_converted_first() {
        let ring = [(57.0, 25.0), (57.2, 25.0), (57.2, 25.2), (57.0, 25.2)];
        let utm = Frame {
            map_crs: CrsRef::Epsg { code: 32640 },
            origin: [500_000.0, 2_700_000.0, 0.0],
            source: FrameSource::Auto,
        };
        let out =
            polygons_buffers(&polygons(&[&[&ring]]), CrsRef::Epsg { code: 4326 }, &utm).unwrap();
        // About 20 km by 22 km: 0.2 degrees of longitude at 25 N is 20.2 km and 0.2 of latitude 22.1 km.
        let area = filled_area(&out.buffers);
        assert!((4.2e8..4.7e8).contains(&area), "{area}");
    }

    #[test]
    fn polygons_done_a_few_vertices_at_a_time_are_those_done_all_at_once() {
        // A mix: a square, a square with a hole, a line (not filled), a bow tie (not filled), a triangle.
        let triangle = [(20.0, 0.0), (30.0, 0.0), (25.0, 8.0)];
        let line = [(0.0, 0.0), (5.0, 0.0), (10.0, 0.0)];
        let bow_tie = [(0.0, 0.0), (10.0, 10.0), (10.0, 0.0), (0.0, 10.0)];
        let p = polygons(&[
            &[&SQUARE, &HOLE],
            &[&line],
            &[&bow_tie],
            &[&triangle],
            &[&SQUARE],
        ]);
        let whole = prepare(&p);
        for budget in [0, 1, 4, 5, 13, 1_000] {
            let mut findings = Findings::new();
            let positions = project(&p.positions, LOCAL, &frame(), &mut findings).unwrap();
            let mut fill = PolygonsFill::new(positions);
            let mut steps = 0;
            while !fill.advance(&p, budget) {
                steps += 1;
                assert!(steps <= 5, "a budget of {budget} must move forward");
            }
            let buffers = fill.finish(&mut findings);
            assert_eq!(buffers, whole.buffers, "budget {budget}");
            assert_eq!(findings, whole.findings, "budget {budget}");
        }
        assert_eq!(whole.findings.as_slice()[0].count, 2);
    }

    /// A regular polygon of `n` vertices of radius 1,000 (a circle, with no area problem).
    fn circle(n: usize) -> Vec<(f64, f64)> {
        (0..n)
            .map(|i| {
                let angle = std::f64::consts::TAU * i as f64 / n as f64;
                (1_000.0 * angle.cos(), 1_000.0 * angle.sin())
            })
            .collect()
    }

    #[test]
    fn a_polygon_with_too_many_vertices_is_outlined_only_with_a_finding_of_its_own() {
        // Found by the review of the milestone: earcut takes longer than its size (0.14 s for 100,000 vertices,
        // 3.3 s for 400,000) and a polygon is one step, during which the worker hears nothing.
        let n = MAX_FILLED_VERTICES + 1;
        let out = prepare(&polygons(&[&[&SQUARE], &[&circle(n)]]));
        let b = &out.buffers;
        assert_eq!(
            b.triangle_polygon,
            [0, 0],
            "the square is filled, the circle is not"
        );
        assert_eq!(b.outline_polygon.iter().filter(|&&p| p == 1).count(), n);
        let codes: Vec<_> = out.findings.iter().map(|f| f.code.as_str()).collect();
        assert_eq!(codes, ["display.polygons.too_detailed"]);
        let finding = &out.findings.as_slice()[0];
        assert_eq!(finding.count, 1);
        assert_eq!(finding.examples[0].element, Some(1));
        assert_eq!(
            finding.message,
            "Some polygons are too detailed to fill in (more than 100,000 vertices, or too many holes for their size), so only their outlines are drawn."
        );
    }

    #[test]
    fn the_limit_is_in_vertices_of_one_polygon_holes_included_and_a_small_limit_shows_the_edge() {
        for (limit, outer, hole, filled) in [
            (8, 4, 4, true),
            (7, 4, 4, false),
            (8, 8, 0, true),
            (8, 9, 0, false),
        ] {
            let hole_ring: Vec<(f64, f64)> = HOLE.to_vec();
            let exterior = circle(outer);
            let rings: Vec<&[(f64, f64)]> = if hole == 0 {
                vec![&exterior]
            } else {
                vec![&exterior, &hole_ring]
            };
            let p = polygons(&[&rings]);
            let positions = project(&p.positions, LOCAL, &frame(), &mut Findings::new()).unwrap();
            let mut fill = PolygonsFill::with_limits(positions, limit, u64::MAX);
            fill.advance(&p, usize::MAX);
            let mut findings = Findings::new();
            let buffers = fill.finish(&mut findings);
            assert_eq!(
                !buffers.triangles.is_empty(),
                filled,
                "limit {limit}, {outer} + {hole}"
            );
        }
    }

    /// A square with `holes` small square holes, as the rings of one polygon.
    fn square_with_holes(holes: usize) -> Polygons {
        let hole_rings: Vec<Vec<(f64, f64)>> = (0..holes)
            .map(|h| {
                let (x, y) = (1.0 + (h % 50) as f64 * 2.0, 1.0 + (h / 50) as f64 * 2.0);
                vec![(x, y), (x, y + 1.0), (x + 1.0, y + 1.0), (x + 1.0, y)]
            })
            .collect();
        let exterior = vec![(0.0, 0.0), (200.0, 0.0), (200.0, 200.0), (0.0, 200.0)];
        let mut rings: Vec<&[(f64, f64)]> = vec![&exterior];
        rings.extend(hole_rings.iter().map(Vec::as_slice));
        polygons(&[&rings])
    }

    #[test]
    fn a_polygon_with_too_many_holes_for_its_size_is_outlined_only() {
        // Found by the second review of the milestone: a polygon of 96,000 vertices and 24,000 holes was filled, in 18.7 s of one
        // step, because the limit counted vertices only. The work is the vertices times the rings.
        // At the edge, with a small limit: 3 holes make 16 vertices in 4 rings, which is 64.
        for (work_limit, filled) in [(64, true), (63, false)] {
            let p = square_with_holes(3);
            let positions = project(&p.positions, LOCAL, &frame(), &mut Findings::new()).unwrap();
            let mut fill = PolygonsFill::with_limits(positions, usize::MAX, work_limit);
            fill.advance(&p, usize::MAX);
            let mut findings = Findings::new();
            let buffers = fill.finish(&mut findings);
            assert_eq!(
                !buffers.triangles.is_empty(),
                filled,
                "work limit {work_limit}"
            );
            assert_eq!(
                findings
                    .iter()
                    .any(|f| f.code.as_str() == "display.polygons.too_detailed"),
                !filled
            );
        }
        // With the real limits: 7,000 holes are 28,004 vertices in 7,001 rings, almost 200 million, over 150 million.
        let out = prepare(&square_with_holes(7_000));
        assert!(out.buffers.triangles.is_empty());
        assert_eq!(
            out.buffers.outline.len() / 2,
            28_004,
            "every side of every ring is outlined"
        );
        assert_eq!(
            out.findings.as_slice()[0].code.as_str(),
            "display.polygons.too_detailed"
        );
        // And a polygon with few holes is filled as before.
        assert!(!prepare(&square_with_holes(3)).buffers.triangles.is_empty());
    }
}
