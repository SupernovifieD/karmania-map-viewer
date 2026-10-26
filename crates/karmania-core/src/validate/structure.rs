//! Structure checks: is the geometry well formed?

use super::offset_lists::{self, OffsetCodes, OffsetsSpec};
use crate::codes::FindingCode;
use crate::dataset::{Dataset, Geometry};
use crate::findings::{Finding, Findings, Location};
use crate::text::format_count;

/// Runs the structure checks.
pub(super) fn check(dataset: &Dataset, findings: &mut Findings) {
    check_not_empty(dataset, findings);
    check_position_lists(dataset, findings);
    check_line_offsets(dataset, findings);
    check_short_lines(dataset, findings);
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
    fn zero_dimension_lattices_are_left_to_the_lattice_check() {
        assert!(check_all(&grid([0, 3, 1])).is_empty());
        assert!(check_all(&blocks([2, 0, 2], None)).is_empty());
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
}
