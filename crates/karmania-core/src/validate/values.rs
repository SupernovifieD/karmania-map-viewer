//! Value checks: are the numbers and tables sensible?

use crate::codes::FindingCode;
use crate::dataset::{Dataset, Kind};
use crate::findings::{Finding, Findings, Location};

/// Coordinates larger than this (in absolute value) suggest the wrong units, for
/// example millimetres instead of metres.
const VERY_LARGE_COORDINATE: f64 = 1e8;

/// Runs the value checks.
pub(super) fn check(dataset: &Dataset, findings: &mut Findings) {
    check_finite_coordinates(dataset, findings);
    check_coordinate_magnitude(dataset, findings);
}

/// Where a position is reported: points have elements, other shapes vertices.
fn at_position(kind: Kind, index: usize) -> Location {
    let index = index as u64;
    match kind {
        Kind::Points => Location::default().with_element(index),
        _ => Location::default().with_vertex(index),
    }
}

/// Every position needs real numbers for x, y and z. Empty cells, NaN and
/// infinities cannot be placed on a map.
fn check_finite_coordinates(dataset: &Dataset, findings: &mut Findings) {
    let Some(positions) = dataset.geometry.positions() else {
        return;
    };
    let mut bad = Finding::new(
        FindingCode::ValuesCoordinatesNotFinite,
        "Some coordinates are not valid numbers (empty, NaN or infinite), so those positions cannot be placed on a map.",
    )
    .with_hint("Fix or remove those rows.");
    bad.count = 0;
    for (index, position) in positions.iter().enumerate() {
        if !position.iter().all(|c| c.is_finite()) {
            bad.count += 1;
            bad = bad.at(at_position(dataset.kind(), index));
        }
    }
    if bad.count > 0 {
        findings.add(bad);
    }
}

/// Warns about coordinates above [`VERY_LARGE_COORDINATE`]. Non-finite values
/// are left to the finite check. For a grid or block model the lattice's extent
/// is checked as one unit.
fn check_coordinate_magnitude(dataset: &Dataset, findings: &mut Findings) {
    let mut large = Finding::new(
        FindingCode::ValuesCoordinatesVeryLarge,
        "Some coordinates are larger than 100,000,000. The units may be wrong, for example millimetres instead of metres.",
    )
    .with_hint("Check the units of the coordinates and the coordinate system you chose.");
    large.count = 0;
    let too_large = |p: [f64; 3]| {
        p.iter()
            .any(|c| c.is_finite() && c.abs() > VERY_LARGE_COORDINATE)
    };
    if let Some(positions) = dataset.geometry.positions() {
        for (index, position) in positions.iter().enumerate() {
            if too_large(position) {
                large.count += 1;
                large = large.at(at_position(dataset.kind(), index));
            }
        }
    } else if let Some(bbox) = dataset.bbox()
        && (too_large(bbox.min) || too_large(bbox.max))
    {
        large.count = 1;
    }
    if large.count > 0 {
        findings.add(large);
    }
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{codes, dataset, grid, lines, mesh, points, run};
    use super::*;
    use crate::dataset::Geometry;
    use crate::positions::Positions;

    fn points_from(xyz: Vec<f64>) -> Dataset {
        dataset(Geometry::Points(Positions::from_interleaved(xyz, true)))
    }

    #[test]
    fn finite_coordinates_pass_for_every_shape_with_positions() {
        for d in [
            points(3),
            lines(3, &[0, 3]),
            mesh(3, &[0, 1, 2]),
            grid([2, 2, 1]),
        ] {
            assert!(run(check, &d).is_empty(), "{:?}", d.kind());
        }
    }

    #[test]
    fn nan_and_infinite_coordinates_are_one_counted_error() {
        let d = points_from(vec![
            0.0,
            0.0,
            0.0, //
            f64::NAN,
            1.0,
            1.0, //
            2.0,
            f64::INFINITY,
            2.0, //
            3.0,
            3.0,
            f64::NEG_INFINITY, //
            4.0,
            4.0,
            4.0,
        ]);
        let f = run(check, &d);
        assert_eq!(codes(&f), ["values.coordinates.not_finite"]);
        let one = &f.as_slice()[0];
        assert_eq!(one.count, 3);
        let at: Vec<_> = one.examples.iter().map(|l| l.element).collect();
        assert_eq!(at, [Some(1), Some(2), Some(3)]);
        assert_eq!(one.severity, crate::findings::Severity::Error);
    }

    #[test]
    fn a_position_with_several_bad_coordinates_counts_once() {
        let f = run(check, &points_from(vec![f64::NAN, f64::NAN, f64::NAN]));
        assert_eq!(f.as_slice()[0].count, 1);
    }

    #[test]
    fn lines_and_meshes_report_the_vertex_number() {
        let mut d = lines(3, &[0, 3]);
        if let Geometry::Lines(l) = &mut d.geometry {
            l.positions = Positions::from_interleaved(
                vec![0.0, 0.0, 0.0, 1.0, f64::NAN, 1.0, 2.0, 2.0, 2.0],
                true,
            );
        }
        let f = run(check, &d);
        assert_eq!(f.as_slice()[0].examples[0].vertex, Some(1));
        assert_eq!(f.as_slice()[0].examples[0].element, None);
    }

    #[test]
    fn at_most_twenty_examples_are_kept_but_every_bad_position_is_counted() {
        let xyz: Vec<f64> = (0..100).flat_map(|_| [f64::NAN, 0.0, 0.0]).collect();
        let f = run(check, &points_from(xyz));
        let one = &f.as_slice()[0];
        assert_eq!((one.count, one.examples.len()), (100, 20));
    }

    #[test]
    fn coordinates_up_to_and_including_the_limit_pass_in_either_direction() {
        assert!(run(check, &points_from(vec![1e8, -1e8, 0.0])).is_empty());
        assert!(run(check, &points_from(vec![500_000.0, 6_000_000.0, 1_500.0])).is_empty());
    }

    #[test]
    fn a_coordinate_above_the_limit_on_any_axis_is_a_counted_warning() {
        let d = points_from(vec![
            1e8 + 1.0,
            0.0,
            0.0, //
            0.0,
            -2e9,
            0.0, //
            0.0,
            0.0,
            3e8, //
            5.0,
            5.0,
            5.0,
        ]);
        let f = run(check, &d);
        assert_eq!(codes(&f), ["values.coordinates.very_large"]);
        let one = &f.as_slice()[0];
        assert_eq!(
            (one.severity, one.count),
            (crate::findings::Severity::Warning, 3)
        );
        let at: Vec<_> = one.examples.iter().map(|l| l.element).collect();
        assert_eq!(at, [Some(0), Some(1), Some(2)]);
    }

    #[test]
    fn non_finite_values_are_not_called_very_large() {
        let f = run(check, &points_from(vec![f64::INFINITY, f64::NAN, 1.0]));
        assert_eq!(codes(&f), ["values.coordinates.not_finite"]);
    }

    #[test]
    fn a_lattice_far_from_the_origin_is_one_warning() {
        use crate::dataset::Geometry;
        use crate::grid::{Grid, GridZ};
        let mut lattice = super::super::testutil::lattice([2, 2, 1]);
        lattice.origin = [5e8, 0.0, 0.0];
        let grid = Grid {
            lattice,
            z: GridZ::Flat { elevation: 0.0 },
        };
        let f = run(check, &dataset(Geometry::Grid(grid)));
        assert_eq!(codes(&f), ["values.coordinates.very_large"]);
        assert_eq!(f.as_slice()[0].count, 1);
        assert!(run(check, &grid_default()).is_empty());
    }

    fn grid_default() -> Dataset {
        super::super::testutil::grid([2, 2, 1])
    }

    #[test]
    fn a_trailing_partial_triple_is_left_to_the_structure_check() {
        assert!(run(check, &points_from(vec![0.0, 0.0, 0.0, f64::NAN, 1.0])).is_empty());
    }
}
