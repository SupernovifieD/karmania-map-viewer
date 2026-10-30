//! Structure checks: is the geometry well formed?

use super::attribute_rows;
use super::offset_lists::{self, OffsetCodes, OffsetsSpec};
use super::sparse_blocks;
use crate::codes::FindingCode;
use crate::column::ColumnType;
use crate::dataset::{Dataset, Geometry, Kind};
use crate::findings::{Finding, Findings, Location};
use crate::limits::check_size;
use crate::text::format_count;

/// Runs the structure checks.
pub(super) fn check(dataset: &Dataset, findings: &mut Findings) {
    check_not_empty(dataset, findings);
    check_position_lists(dataset, findings);
    check_line_offsets(dataset, findings);
    check_short_lines(dataset, findings);
    check_polygon_offsets(dataset, findings);
    check_polygon_rings(dataset, findings);
    check_mesh_indices(dataset, findings);
    check_mesh_triangles(dataset, findings);
    check_lattice(dataset, findings);
    check_grid_elevation(dataset, findings);
    sparse_blocks::check(dataset, findings);
    attribute_rows::check(dataset, findings);
}

/// A grid that takes its elevations from a column needs that column, and it must
/// hold numbers.
fn check_grid_elevation(dataset: &Dataset, findings: &mut Findings) {
    let Geometry::Grid(grid) = &dataset.geometry else {
        return;
    };
    let Some(name) = grid.z_column() else {
        return;
    };
    match dataset.attributes.column(name) {
        None => findings.add(
            Finding::new(
                FindingCode::GridElevationColumnMissing,
                format!(
                    "The grid takes its elevations from a column called \"{name}\", but the dataset has no such column."
                ),
            )
            .with_hint("Add a column with that name, or give the grid a flat elevation."),
        ),
        Some(column) if !matches!(column.column_type(), ColumnType::Float64 | ColumnType::Int64) => {
            findings.add(
                Finding::new(
                    FindingCode::GridElevationColumnNotNumeric,
                    format!(
                        "The grid takes its elevations from the column \"{name}\", which does not hold numbers."
                    ),
                )
                .with_hint("Use a column of numbers for the elevations."),
            );
        }
        Some(_) => {}
    }
}

/// Checks a grid's or block model's lattice: whole numbers of cells, a usable
/// cell size, a finite position, and a size within the limit.
fn check_lattice(dataset: &Dataset, findings: &mut Findings) {
    let Some(lattice) = dataset.geometry.lattice() else {
        return;
    };
    let what = match dataset.kind() {
        Kind::Grid => "grid",
        _ => "block model",
    };
    let [nx, ny, nz] = lattice.dims;
    if nx == 0 || ny == 0 || nz == 0 {
        findings.add(
            Finding::new(
                FindingCode::LatticeDimsZero,
                format!(
                    "The {what} has no cells along at least one axis ({nx} x {ny} x {nz}); every dimension must be at least 1."
                ),
            )
            .with_hint("Check the number of cells along each axis."),
        );
    }
    let [dx, dy, dz] = lattice.spacing;
    if ![dx, dy, dz].iter().all(|s| s.is_finite() && *s > 0.0) {
        findings.add(
            Finding::new(
                FindingCode::LatticeSpacingInvalid,
                format!(
                    "The cell size of the {what} must be greater than 0 on every axis, but it is {dx} x {dy} x {dz}."
                ),
            )
            .with_hint("Use a positive cell size, such as 10 for 10-metre cells."),
        );
    }
    let [ox, oy, oz] = lattice.origin;
    if ![ox, oy, oz].iter().all(|v| v.is_finite()) {
        findings.add(
            Finding::new(
                FindingCode::LatticeOriginNotFinite,
                format!(
                    "The position of the {what} must be made of numbers, but its corner is {ox}, {oy}, {oz}."
                ),
            )
            .with_hint("Give the X, Y and Z of the grid's lower corner."),
        );
    }
    if !lattice.rotation.is_finite() {
        findings.add(
            Finding::new(
                FindingCode::LatticeRotationNotFinite,
                format!(
                    "The rotation of the {what} must be a number of degrees, but it is {}.",
                    lattice.rotation
                ),
            )
            .with_hint("Use 0 for a grid aligned with north."),
        );
    }
    // A sparse block model only needs memory for the blocks it lists.
    match &dataset.geometry {
        Geometry::Blocks(blocks) if !blocks.is_dense() => {
            check_size(blocks.block_count(), "blocks", findings);
        }
        _ => {
            check_size(lattice.cell_count(), "cells", findings);
        }
    }
}

/// Warns about triangles with no area and reports vertices no triangle uses.
/// Triangles that point at missing vertices are skipped; the index check
/// reports those.
fn check_mesh_triangles(dataset: &Dataset, findings: &mut Findings) {
    let Geometry::Mesh(mesh) = &dataset.geometry else {
        return;
    };
    let vertices = mesh.vertex_count();
    let mut used = vec![0u64; vertices.div_ceil(64)];
    let mut flat = Finding::new(
        FindingCode::MeshTriangleDegenerate,
        "Some triangles have no area: two corners are the same point, or all three are in a straight line.",
    )
    .with_hint("Remove those triangles; they cannot be shaded.");
    flat.count = 0;
    // Every index entry counts as a use, even in an incomplete last triangle,
    // so a vertex is not reported as unused on top of the real error.
    for &index in &mesh.indices {
        if let Some(vertex) = usize::try_from(index).ok().filter(|&v| v < vertices)
            && let Some(word) = used.get_mut(vertex / 64)
        {
            *word |= 1u64 << (vertex % 64);
        }
    }
    for (t, triangle) in mesh.indices.as_chunks::<3>().0.iter().enumerate() {
        let corners = triangle.map(|i| usize::try_from(i).ok().filter(|&v| v < vertices));
        let [Some(a), Some(b), Some(c)] = corners else {
            continue;
        };
        if is_degenerate(mesh, [a, b, c]) {
            flat.count += 1;
            flat = flat.at(Location::default().with_element(t as u64));
        }
    }
    if flat.count > 0 {
        findings.add(flat);
    }
    let mut unused = Finding::new(
        FindingCode::MeshVerticesUnused,
        "Some vertices are not used by any triangle.",
    )
    .with_hint("They do no harm. Remove them if you do not need them.");
    unused.count = 0;
    for vertex in 0..vertices {
        let is_used = used
            .get(vertex / 64)
            .is_some_and(|w| w >> (vertex % 64) & 1 == 1);
        if !is_used {
            unused.count += 1;
            unused = unused.at(Location::default().with_vertex(vertex as u64));
        }
    }
    if unused.count > 0 {
        findings.add(unused);
    }
}

/// True when a triangle repeats a vertex or has exactly zero area. Triangles
/// with a non-finite coordinate are not judged here.
fn is_degenerate(mesh: &crate::mesh::Mesh, [a, b, c]: [usize; 3]) -> bool {
    if a == b || b == c || a == c {
        return true;
    }
    let (Some(pa), Some(pb), Some(pc)) = (
        mesh.positions.get(a),
        mesh.positions.get(b),
        mesh.positions.get(c),
    ) else {
        return false;
    };
    if ![pa, pb, pc].iter().all(|p| p.iter().all(|v| v.is_finite())) {
        return false;
    }
    let u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    let v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    let cross = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ];
    cross.iter().all(|&x| x == 0.0)
}

/// Triangle indices come in threes and must point at existing vertices.
fn check_mesh_indices(dataset: &Dataset, findings: &mut Findings) {
    let Geometry::Mesh(mesh) = &dataset.geometry else {
        return;
    };
    let count = mesh.indices.len();
    if !count.is_multiple_of(3) {
        findings.add(
            Finding::new(
                FindingCode::MeshIndicesIncomplete,
                format!(
                    "The triangle list ends with an incomplete triangle: it has {} vertex numbers, which is not a multiple of 3.",
                    format_count(count as u64)
                ),
            )
            .with_hint("Give three vertex numbers for every triangle."),
        );
    }
    let vertices = mesh.vertex_count();
    let mut outside = Finding::new(
        FindingCode::MeshIndicesOutOfRange,
        format!(
            "Some triangles use vertex numbers that do not exist: the mesh has {} vertices.",
            format_count(vertices as u64)
        ),
    )
    .with_hint("Vertex numbers start at 0 and must be lower than the number of vertices.");
    outside.count = 0;
    for (i, &index) in mesh.indices.iter().enumerate() {
        if usize::try_from(index).is_ok_and(|v| v < vertices) {
            continue;
        }
        outside.count += 1;
        outside = outside.at(Location::default()
            .with_element((i / 3) as u64)
            .with_vertex(u64::from(index)));
    }
    if outside.count > 0 {
        findings.add(outside);
    }
}

/// The two offsets lists of a polygon set: vertices into rings, rings into
/// polygons.
fn check_polygon_offsets(dataset: &Dataset, findings: &mut Findings) {
    let Geometry::Polygons(polygons) = &dataset.geometry else {
        return;
    };
    let rings = OffsetsSpec {
        codes: OffsetCodes {
            empty: FindingCode::PolygonsRingOffsetsEmpty,
            bad_start: FindingCode::PolygonsRingOffsetsBadStart,
            bad_end: FindingCode::PolygonsRingOffsetsBadEnd,
            decreasing: FindingCode::PolygonsRingOffsetsDecreasing,
        },
        list: "The list that says where each ring starts",
        item: "ring",
        target: "vertices",
    };
    offset_lists::check(
        &polygons.ring_offsets,
        polygons.vertex_count(),
        &rings,
        findings,
    );
    let polygon_spec = OffsetsSpec {
        codes: OffsetCodes {
            empty: FindingCode::PolygonsPolygonOffsetsEmpty,
            bad_start: FindingCode::PolygonsPolygonOffsetsBadStart,
            bad_end: FindingCode::PolygonsPolygonOffsetsBadEnd,
            decreasing: FindingCode::PolygonsPolygonOffsetsDecreasing,
        },
        list: "The list that says which rings belong to each polygon",
        item: "polygon",
        target: "rings",
    };
    let ring_count = polygons.ring_count().unwrap_or(0);
    offset_lists::check(
        &polygons.polygon_offsets,
        ring_count,
        &polygon_spec,
        findings,
    );
}

/// Every polygon needs an exterior ring, and every ring needs 3 vertices to
/// enclose an area. Malformed offsets are skipped; they are reported above.
fn check_polygon_rings(dataset: &Dataset, findings: &mut Findings) {
    let Geometry::Polygons(polygons) = &dataset.geometry else {
        return;
    };
    let mut short = Finding::new(
        FindingCode::PolygonsRingTooShort,
        "Some rings have fewer than 3 vertices, so they cannot enclose an area.",
    )
    .with_hint("Remove those rings or add the missing vertices.");
    short.count = 0;
    for index in 0..polygons.ring_count().unwrap_or(0) {
        if polygons.vertex_range(index).is_some_and(|r| r.len() < 3) {
            short.count += 1;
            short = short.at(Location::default().with_element(index as u64));
        }
    }
    if short.count > 0 {
        findings.add(short);
    }
    let mut bare = Finding::new(
        FindingCode::PolygonsPolygonNoRings,
        "Some polygons have no rings, so they have no outline.",
    )
    .with_hint("Remove those polygons or give each one an outer ring.");
    bare.count = 0;
    for index in 0..polygons.polygon_count().unwrap_or(0) {
        if polygons.ring_range(index).is_some_and(|r| r.is_empty()) {
            bare.count += 1;
            bare = bare.at(Location::default().with_element(index as u64));
        }
    }
    if bare.count > 0 {
        findings.add(bare);
    }
}

/// A line needs at least two vertices to be a line. Lines whose offsets are
/// malformed are skipped here; the offsets check reports those.
fn check_short_lines(dataset: &Dataset, findings: &mut Findings) {
    let Geometry::Lines(lines) = &dataset.geometry else {
        return;
    };
    let mut short = Finding::new(
        FindingCode::LinesLineTooShort,
        "Some lines have fewer than 2 vertices, so they cannot be drawn.",
    )
    .with_hint("Remove those lines or add the missing vertices.");
    short.count = 0;
    for index in 0..lines.line_count().unwrap_or(0) {
        if lines.vertex_range(index).is_some_and(|r| r.len() < 2) {
            short.count += 1;
            short = short.at(Location::default().with_element(index as u64));
        }
    }
    if short.count > 0 {
        findings.add(short);
    }
}

/// The offsets that split a line set's vertices into lines.
fn check_line_offsets(dataset: &Dataset, findings: &mut Findings) {
    let Geometry::Lines(lines) = &dataset.geometry else {
        return;
    };
    let spec = OffsetsSpec {
        codes: OffsetCodes {
            empty: FindingCode::LinesOffsetsEmpty,
            bad_start: FindingCode::LinesOffsetsBadStart,
            bad_end: FindingCode::LinesOffsetsBadEnd,
            decreasing: FindingCode::LinesOffsetsDecreasing,
        },
        list: "The list that says where each line starts",
        item: "line",
        target: "vertices",
    };
    offset_lists::check(&lines.offsets, lines.vertex_count(), &spec, findings);
}

/// A dataset must have at least one element. Grids and dense block models are
/// left to the lattice check, where an empty one means a zero dimension.
fn check_not_empty(dataset: &Dataset, findings: &mut Findings) {
    let lattice_decides = match &dataset.geometry {
        Geometry::Grid(_) => true,
        Geometry::Blocks(blocks) => blocks.is_dense(),
        _ => false,
    };
    if !lattice_decides && dataset.element_count() == Some(0) {
        let things = dataset.kind().element_name();
        findings.add(
            Finding::new(
                FindingCode::DatasetEmpty,
                format!("The dataset has no {things}."),
            )
            .with_hint("Check that the file has data rows and that you chose the right file."),
        );
    }
}

/// The interleaved coordinate list must hold whole x, y, z triples.
fn check_position_lists(dataset: &Dataset, findings: &mut Findings) {
    let Some(positions) = dataset.geometry.positions() else {
        return;
    };
    let values = positions.as_slice().len();
    if !values.is_multiple_of(3) {
        findings.add(
            Finding::new(
                FindingCode::DatasetCoordinatesIncomplete,
                format!(
                    "The coordinate list ends with an incomplete position: it has {} values, which is not a multiple of 3.",
                    format_count(values as u64)
                ),
            )
            .with_hint("Give X, Y and Z for every position."),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{blocks, codes, grid, lines, mesh, points, polygons, run};
    use super::*;
    use crate::dataset::Dataset;
    use crate::positions::Positions;

    fn check_all(dataset: &Dataset) -> Vec<&'static str> {
        codes(&run(check, dataset))
    }

    #[test]
    fn a_well_formed_dataset_of_each_kind_has_no_findings() {
        let datasets = [
            points(2),
            lines(3, &[0, 3]),
            polygons(3, &[0, 3], &[0, 1]),
            mesh(3, &[0, 1, 2]),
            grid([2, 2, 1]),
            blocks([2, 2, 2], None),
            blocks([2, 2, 2], Some(vec![0, 0, 0])),
        ];
        for d in &datasets {
            assert!(check_all(d).is_empty(), "{:?}", d.kind());
        }
    }

    #[test]
    fn valid_line_offsets_pass_and_empty_lines_are_only_a_warning() {
        assert!(check_all(&lines(5, &[0, 2, 5])).is_empty());
        assert!(check_all(&lines(4, &[0, 2, 4])).is_empty());
        // Structurally valid, but a line with no vertices is too short.
        assert_eq!(
            check_all(&lines(5, &[0, 2, 2, 5])),
            ["lines.line.too_short"]
        );
    }

    #[test]
    fn an_empty_offsets_list_is_reported_once() {
        let found = run(check, &lines(3, &[]));
        assert_eq!(codes(&found), ["lines.offsets.empty"]);
        assert_eq!(
            found.as_slice()[0].message,
            "The list that says where each line starts is empty. It must start with 0 and end with the number of vertices (3)."
        );
    }

    #[test]
    fn a_wrong_start_and_a_wrong_end_are_each_reported() {
        let found = run(check, &lines(5, &[1, 4]));
        assert_eq!(
            codes(&found),
            ["lines.offsets.bad_start", "lines.offsets.bad_end"]
        );
        assert_eq!(
            found.as_slice()[0].message,
            "The list that says where each line starts must start with 0, but it starts with 1."
        );
        assert_eq!(
            found.as_slice()[1].message,
            "The list that says where each line starts must end with the number of vertices (5), but it ends with 4."
        );
    }

    #[test]
    fn offsets_going_backwards_are_counted_with_the_first_examples() {
        let found = run(check, &lines(9, &[0, 4, 2, 6, 5, 9]));
        assert_eq!(codes(&found), ["lines.offsets.decreasing"]);
        let f = &found.as_slice()[0];
        assert_eq!(
            (f.count, f.message.as_str()),
            (2, "Some lines end before they start.")
        );
        let at: Vec<_> = f.examples.iter().map(|l| l.element).collect();
        assert_eq!(at, [Some(1), Some(3)]);
    }

    #[test]
    fn many_backwards_steps_keep_at_most_twenty_examples() {
        let mut offsets = vec![0u32];
        for i in 0..50u32 {
            offsets.push(if i % 2 == 0 { 100 } else { 50 });
        }
        offsets.push(10);
        let found = run(check, &lines(10, &offsets));
        let f = found
            .iter()
            .find(|f| f.code.as_str() == "lines.offsets.decreasing")
            .unwrap();
        // 25 drops from 100 to 50, plus the last step from 50 down to 10.
        assert_eq!(f.count, 26);
        assert_eq!(f.examples.len(), 20);
    }

    #[test]
    fn huge_offsets_are_reported_without_overflow() {
        let found = run(check, &lines(3, &[0, u32::MAX, 3]));
        assert_eq!(codes(&found), ["lines.offsets.decreasing"]);
    }

    #[test]
    fn lines_with_fewer_than_two_vertices_are_a_counted_warning() {
        let found = run(check, &lines(6, &[0, 1, 1, 4, 6]));
        assert_eq!(codes(&found), ["lines.line.too_short"]);
        let f = &found.as_slice()[0];
        assert_eq!(f.severity, crate::findings::Severity::Warning);
        assert_eq!(f.count, 2);
        let at: Vec<_> = f.examples.iter().map(|l| l.element).collect();
        assert_eq!(at, [Some(0), Some(1)]);
        assert!(
            found
                .iter()
                .all(|f| f.severity != crate::findings::Severity::Error)
        );
    }

    #[test]
    fn lines_of_two_or_more_vertices_and_malformed_offsets_are_not_short() {
        assert!(check_all(&lines(5, &[0, 2, 5])).is_empty());
        // Decreasing offsets are the offsets check's job, not "too short".
        assert!(!codes(&run(check, &lines(5, &[0, 4, 2, 5]))).contains(&"lines.line.too_short"));
    }

    #[test]
    fn valid_polygons_with_and_without_holes_pass() {
        assert!(check_all(&polygons(8, &[0, 4, 8], &[0, 2])).is_empty());
        assert!(check_all(&polygons(9, &[0, 3, 6, 9], &[0, 1, 3])).is_empty());
    }

    #[test]
    fn both_polygon_offsets_lists_get_the_same_four_checks() {
        let found = run(check, &polygons(3, &[], &[]));
        assert_eq!(
            codes(&found),
            [
                "polygons.ring_offsets.empty",
                "polygons.polygon_offsets.empty"
            ]
        );
        // Ring list starts at 1 and ends early; polygon list starts at 1 and ends early.
        let found = run(check, &polygons(9, &[1, 4, 7], &[1, 1]));
        assert_eq!(
            codes(&found),
            [
                "polygons.ring_offsets.bad_start",
                "polygons.ring_offsets.bad_end",
                "polygons.polygon_offsets.bad_start",
                "polygons.polygon_offsets.bad_end",
                // The polygon list [1, 1] is a polygon with no rings.
                "polygons.polygon.no_rings",
            ]
        );
        assert_eq!(
            found.as_slice()[3].message,
            "The list that says which rings belong to each polygon must end with the number of rings (2), but it ends with 1."
        );
    }

    #[test]
    fn rings_or_polygons_going_backwards_are_counted() {
        let found = run(check, &polygons(9, &[0, 6, 3, 9], &[0, 3, 2, 3]));
        let ring = found
            .iter()
            .find(|f| f.code.as_str() == "polygons.ring_offsets.decreasing");
        let polygon = found
            .iter()
            .find(|f| f.code.as_str() == "polygons.polygon_offsets.decreasing");
        assert_eq!(ring.map(|f| f.count), Some(1));
        assert_eq!(polygon.map(|f| f.count), Some(1));
        assert_eq!(ring.unwrap().message, "Some rings end before they start.");
    }

    #[test]
    fn rings_with_fewer_than_three_vertices_are_an_error() {
        let found = run(check, &polygons(8, &[0, 2, 5, 8], &[0, 3]));
        assert_eq!(codes(&found), ["polygons.ring.too_short"]);
        let f = &found.as_slice()[0];
        assert_eq!(f.severity, crate::findings::Severity::Error);
        assert_eq!(f.count, 1);
        assert_eq!(f.examples[0].element, Some(0));
    }

    #[test]
    fn a_polygon_without_rings_has_no_outline() {
        let found = run(check, &polygons(3, &[0, 3], &[0, 0, 1]));
        assert_eq!(codes(&found), ["polygons.polygon.no_rings"]);
        assert_eq!(found.as_slice()[0].examples[0].element, Some(0));
    }

    #[test]
    fn malformed_polygon_offsets_do_not_panic_the_ring_checks() {
        let found = run(check, &polygons(3, &[0, 9, 2], &[0, 7]));
        assert!(!found.is_empty());
        let found = run(check, &polygons(3, &[0, u32::MAX], &[u32::MAX, 0]));
        assert!(found.has_errors());
    }

    #[test]
    fn valid_mesh_indices_pass() {
        assert!(check_all(&mesh(4, &[0, 1, 2, 2, 1, 3])).is_empty());
    }

    #[test]
    fn an_incomplete_last_triangle_is_reported_with_the_count() {
        let found = run(check, &mesh(4, &[0, 1, 2, 3, 1]));
        assert_eq!(codes(&found), ["mesh.indices.incomplete"]);
        assert_eq!(
            found.as_slice()[0].message,
            "The triangle list ends with an incomplete triangle: it has 5 vertex numbers, which is not a multiple of 3."
        );
    }

    #[test]
    fn vertex_numbers_that_do_not_exist_are_counted_with_where_they_are() {
        let found = run(check, &mesh(3, &[0, 1, 2, 2, 3, 9, u32::MAX, 0, 1]));
        assert_eq!(codes(&found), ["mesh.indices.out_of_range"]);
        let f = &found.as_slice()[0];
        assert_eq!(
            f.message,
            "Some triangles use vertex numbers that do not exist: the mesh has 3 vertices."
        );
        assert_eq!(f.count, 3);
        let at: Vec<_> = f.examples.iter().map(|l| (l.element, l.vertex)).collect();
        assert_eq!(
            at,
            [
                (Some(1), Some(3)),
                (Some(1), Some(9)),
                (Some(2), Some(u64::from(u32::MAX)))
            ]
        );
    }

    #[test]
    fn every_index_is_out_of_range_when_there_are_no_vertices() {
        let found = run(check, &mesh(0, &[0, 0, 0]));
        assert!(codes(&found).contains(&"mesh.indices.out_of_range"));
    }

    #[test]
    fn real_triangles_and_used_vertices_give_no_findings() {
        assert!(check_all(&mesh(4, &[0, 1, 2, 1, 2, 3])).is_empty());
    }

    #[test]
    fn a_repeated_corner_is_a_degenerate_warning() {
        let found = run(check, &mesh(3, &[0, 1, 2, 1, 1, 2]));
        assert_eq!(codes(&found), ["mesh.triangle.degenerate"]);
        let f = &found.as_slice()[0];
        assert_eq!(
            (f.severity, f.count),
            (crate::findings::Severity::Warning, 1)
        );
        assert_eq!(f.examples[0].element, Some(1));
    }

    #[test]
    fn three_points_in_a_line_have_no_area() {
        use crate::dataset::Geometry;
        use crate::mesh::Mesh;
        use crate::positions::Positions;
        let line =
            Positions::from_interleaved(vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 2.0, 2.0, 2.0], true);
        let d = super::super::testutil::dataset(Geometry::Mesh(Mesh {
            positions: line,
            indices: vec![0, 1, 2],
        }));
        assert_eq!(codes(&run(check, &d)), ["mesh.triangle.degenerate"]);
    }

    #[test]
    fn triangles_with_missing_vertices_or_non_finite_corners_are_not_judged() {
        use crate::dataset::Geometry;
        use crate::mesh::Mesh;
        use crate::positions::Positions;
        let found = run(check, &mesh(3, &[0, 1, 9]));
        assert!(!codes(&found).contains(&"mesh.triangle.degenerate"));
        let bad = Positions::from_interleaved(
            vec![f64::NAN, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0],
            true,
        );
        let d = super::super::testutil::dataset(Geometry::Mesh(Mesh {
            positions: bad,
            indices: vec![0, 1, 2],
        }));
        assert!(check_all(&d).is_empty());
    }

    #[test]
    fn vertices_no_triangle_uses_are_an_info_finding() {
        let found = run(check, &mesh(6, &[0, 1, 2]));
        assert_eq!(codes(&found), ["mesh.vertices.unused"]);
        let f = &found.as_slice()[0];
        assert_eq!((f.severity, f.count), (crate::findings::Severity::Info, 3));
        let at: Vec<_> = f.examples.iter().map(|l| l.vertex).collect();
        assert_eq!(at, [Some(3), Some(4), Some(5)]);
    }

    #[test]
    fn a_mesh_with_no_triangles_reports_every_vertex_unused() {
        let found = run(check, &mesh(2, &[]));
        let unused = found
            .iter()
            .find(|f| f.code.as_str() == "mesh.vertices.unused")
            .unwrap();
        assert_eq!(unused.count, 2);
        // The word boundary of the usage bitmap: 70 vertices, one used triangle.
        let found = run(check, &mesh(70, &[0, 64, 69]));
        let unused = found
            .iter()
            .find(|f| f.code.as_str() == "mesh.vertices.unused")
            .unwrap();
        assert_eq!(unused.count, 67);
    }

    fn with_lattice(mut d: Dataset, change: impl FnOnce(&mut crate::lattice::Lattice)) -> Dataset {
        match &mut d.geometry {
            Geometry::Grid(g) => change(&mut g.lattice),
            Geometry::Blocks(b) => change(&mut b.lattice),
            _ => {}
        }
        d
    }

    #[test]
    fn zero_dimensions_are_an_error_named_for_the_shape() {
        let found = run(check, &grid([4, 0, 1]));
        assert_eq!(codes(&found), ["lattice.dims.zero"]);
        assert_eq!(
            found.as_slice()[0].message,
            "The grid has no cells along at least one axis (4 x 0 x 1); every dimension must be at least 1."
        );
        let found = run(check, &blocks([0, 0, 0], None));
        assert!(
            found.as_slice()[0]
                .message
                .starts_with("The block model has no cells")
        );
    }

    #[test]
    fn a_cell_size_must_be_positive_and_finite_on_every_axis() {
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            let d = with_lattice(grid([2, 2, 1]), |l| l.spacing = [1.0, bad, 1.0]);
            assert_eq!(codes(&run(check, &d)), ["lattice.spacing.invalid"], "{bad}");
        }
        let d = with_lattice(grid([2, 2, 1]), |l| l.spacing = [10.0, 0.0, 1.0]);
        assert_eq!(
            run(check, &d).as_slice()[0].message,
            "The cell size of the grid must be greater than 0 on every axis, but it is 10 x 0 x 1."
        );
    }

    #[test]
    fn the_origin_and_rotation_must_be_finite() {
        let d = with_lattice(blocks([2, 2, 2], None), |l| l.origin = [0.0, f64::NAN, 0.0]);
        assert_eq!(codes(&run(check, &d)), ["lattice.origin.not_finite"]);
        let d = with_lattice(grid([2, 2, 1]), |l| l.rotation = f64::INFINITY);
        assert_eq!(codes(&run(check, &d)), ["lattice.rotation.not_finite"]);
    }

    #[test]
    fn a_lattice_with_too_many_cells_is_rejected_before_anything_is_allocated() {
        let d = grid([1_000, 1_000, 1_000]);
        let found = run(check, &d);
        assert_eq!(codes(&found), ["dataset.too_large"]);
        assert!(found.as_slice()[0].message.contains("1,000,000,000 cells"));
        let overflow = run(check, &grid([u32::MAX, u32::MAX, u32::MAX]));
        assert_eq!(codes(&overflow), ["dataset.too_large"]);
        assert!(overflow.as_slice()[0].message.contains("far more cells"));
        assert!(check_all(&blocks([1_000, 1_000, 1_000], None)).contains(&"dataset.too_large"));
    }

    #[test]
    fn a_sparse_block_model_on_a_huge_lattice_is_fine_if_it_has_few_blocks() {
        let d = blocks([100_000, 100_000, 100_000], Some(vec![5, 5, 5]));
        assert!(check_all(&d).is_empty());
    }

    #[test]
    fn a_geometry_with_no_elements_is_reported_with_its_own_name() {
        let cases = [
            (points(0), "The dataset has no points."),
            (lines(0, &[0]), "The dataset has no lines."),
            (polygons(0, &[0], &[0]), "The dataset has no polygons."),
            (mesh(0, &[]), "The dataset has no triangles."),
            (
                blocks([2, 2, 2], Some(vec![])),
                "The dataset has no blocks.",
            ),
        ];
        for (d, message) in cases {
            let found = run(check, &d);
            assert_eq!(codes(&found), ["dataset.empty"], "{:?}", d.kind());
            assert_eq!(found.as_slice()[0].message, message);
        }
    }

    #[test]
    fn zero_dimension_lattices_get_one_finding_not_also_an_empty_dataset() {
        assert_eq!(check_all(&grid([0, 3, 1])), ["lattice.dims.zero"]);
        assert_eq!(check_all(&blocks([2, 0, 2], None)), ["lattice.dims.zero"]);
    }

    #[test]
    fn missing_offsets_are_reported_as_such_not_as_an_empty_dataset() {
        assert_eq!(check_all(&lines(0, &[])), ["lines.offsets.empty"]);
    }

    #[test]
    fn a_coordinate_list_that_is_not_whole_triples_is_reported() {
        let partial = Positions::from_interleaved(vec![1.0, 2.0, 3.0, 4.0], true);
        let kinds = [
            Geometry::Points(partial.clone()),
            Geometry::Lines(crate::lines::Lines {
                positions: partial.clone(),
                offsets: vec![0, 1],
            }),
            Geometry::Polygons(crate::polygons::Polygons {
                positions: partial.clone(),
                ring_offsets: vec![0, 1],
                polygon_offsets: vec![0, 1],
            }),
            Geometry::Mesh(crate::mesh::Mesh {
                positions: partial,
                indices: vec![0, 0, 0],
            }),
        ];
        for geometry in kinds {
            let d = super::super::testutil::dataset(geometry);
            let found = run(check, &d);
            assert!(
                codes(&found).contains(&"dataset.coordinates.incomplete"),
                "{:?}",
                d.kind()
            );
        }
        let d = super::super::testutil::dataset(Geometry::Points(Positions::from_interleaved(
            vec![0.0; 4],
            false,
        )));
        assert_eq!(
            run(check, &d).as_slice()[0].message,
            "The coordinate list ends with an incomplete position: it has 4 values, which is not a multiple of 3."
        );
    }

    #[test]
    fn a_grid_that_takes_its_elevations_from_a_column_needs_a_numeric_one() {
        use crate::column::{Column, ColumnData};
        use crate::grid::GridZ;
        use crate::table::Table;
        let with_column = |column: Option<Column>| {
            let mut d = grid([2, 2, 1]);
            if let Geometry::Grid(g) = &mut d.geometry {
                g.z = GridZ::FromColumn {
                    name: "elev".into(),
                };
            }
            if let Some(column) = column {
                d.attributes = Table::from_columns(vec![column], &mut Findings::new()).unwrap();
            }
            d
        };
        let numbers = |values: Vec<f64>| Column::without_nulls("elev", ColumnData::Float64(values));
        assert!(
            !run(check, &with_column(Some(numbers(vec![1.0; 4]))))
                .iter()
                .any(|f| f.code.as_str().starts_with("grid."))
        );
        let ints = Column::without_nulls("elev", ColumnData::Int64(vec![1, 2, 3, 4]));
        assert!(
            !run(check, &with_column(Some(ints)))
                .iter()
                .any(|f| f.code.as_str().starts_with("grid."))
        );
        let missing = run(check, &with_column(None));
        let found: Vec<_> = missing.iter().map(|f| f.code.as_str()).collect();
        assert!(found.contains(&"grid.elevation_column.missing"));
        assert!(
            missing
                .iter()
                .find(|f| f.code.as_str() == "grid.elevation_column.missing")
                .unwrap()
                .message
                .contains("called \"elev\"")
        );
        let words = Column::without_nulls(
            "elev",
            ColumnData::Utf8(vec!["a".into(), "b".into(), "c".into(), "d".into()]),
        );
        let text = run(check, &with_column(Some(words)));
        assert!(
            text.iter()
                .any(|f| f.code.as_str() == "grid.elevation_column.not_numeric")
        );
        // A flat grid is not affected, and neither is any other shape.
        assert!(
            !run(check, &grid([2, 2, 1]))
                .iter()
                .any(|f| f.code.as_str().starts_with("grid."))
        );
    }
}
