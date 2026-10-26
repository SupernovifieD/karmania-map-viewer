//! Structure checks: is the geometry well formed?

use crate::codes::FindingCode;
use crate::dataset::{Dataset, Geometry};
use crate::findings::{Finding, Findings};
use crate::text::format_count;

/// Runs the structure checks.
pub(super) fn check(dataset: &Dataset, findings: &mut Findings) {
    check_not_empty(dataset, findings);
    check_position_lists(dataset, findings);
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
    fn malformed_offsets_do_not_count_as_empty() {
        assert!(check_all(&lines(0, &[])).is_empty());
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
