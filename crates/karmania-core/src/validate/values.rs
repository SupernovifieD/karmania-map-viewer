//! Value checks: are the numbers and tables sensible?

use crate::codes::FindingCode;
use crate::column::ColumnData;
use crate::dataset::{Dataset, Geometry, Kind};
use crate::findings::{Finding, Findings, Location};
use crate::table::Table;

/// Coordinates larger than this (in absolute value) suggest the wrong units, for
/// example millimetres instead of metres.
const VERY_LARGE_COORDINATE: f64 = 1e8;

/// Runs the value checks.
pub(super) fn check(dataset: &Dataset, findings: &mut Findings) {
    check_finite_coordinates(dataset, findings);
    check_coordinate_magnitude(dataset, findings);
    check_duplicate_points(dataset, findings);
    check_table(&dataset.attributes, "column", findings);
    if let Some(table) = &dataset.vertex_attributes {
        check_table(table, "per-vertex column", findings);
    }
}

/// Checks every column of a table: a column with only nulls is probably a
/// mistake, and a category code outside the dictionary cannot be shown.
/// `label` names the kind of column in messages.
fn check_table(table: &Table, label: &str, findings: &mut Findings) {
    for column in table.columns() {
        let name = column.name();
        if !column.is_empty() && column.null_count() == column.len() {
            findings.add(
                Finding::new(
                    FindingCode::TableColumnAllNull,
                    format!("The {label} \"{name}\" has no values: every entry is empty."),
                )
                .with_hint("Ignore this column, or check which values you marked as no data.")
                .at(Location::default().with_column(name)),
            );
        }
        let ColumnData::Categorical { codes, dictionary } = column.data() else {
            continue;
        };
        let mut missing = Finding::new(
            FindingCode::TableColumnCategoryOutOfRange,
            format!("Some values in the {label} \"{name}\" refer to categories that do not exist."),
        )
        .with_hint("Every category code must point at one of the listed category names.");
        missing.count = 0;
        for (row, &code) in codes.iter().enumerate() {
            let in_dictionary = usize::try_from(code).is_ok_and(|c| c < dictionary.len());
            if !in_dictionary && column.validity().is_valid(row) == Some(true) {
                missing.count += 1;
                missing = missing.at(Location::default().with_column(name).with_row(row as u64));
            }
        }
        if missing.count > 0 {
            findings.add(missing);
        }
    }
}

/// Warns about points that repeat an earlier point exactly. "Exactly" means the
/// same bit pattern for x, y and z, so 0.0 and -0.0 differ and points with a
/// non-finite coordinate are skipped. Points are ordered by their bit patterns
/// instead of hashed: the result does not depend on a hash function and it
/// needs only four bytes per point.
fn check_duplicate_points(dataset: &Dataset, findings: &mut Findings) {
    let Geometry::Points(positions) = &dataset.geometry else {
        return;
    };
    // A set this big already breaks the size limit, which is reported elsewhere.
    let Ok(count) = u32::try_from(positions.len()) else {
        return;
    };
    let key = |i: u32| {
        usize::try_from(i)
            .ok()
            .and_then(|i| positions.get(i))
            .map(|p| p.map(f64::to_bits))
    };
    let mut order: Vec<u32> = (0..count)
        .filter(|&i| {
            usize::try_from(i)
                .ok()
                .and_then(|i| positions.get(i))
                .is_some_and(|p| p.iter().all(|c| c.is_finite()))
        })
        .collect();
    order.sort_unstable_by_key(|&i| (key(i), i));
    let mut repeats: Vec<u32> = order
        .windows(2)
        .filter_map(|pair| match *pair {
            [first, second] if key(first) == key(second) => Some(second),
            _ => None,
        })
        .collect();
    if repeats.is_empty() {
        return;
    }
    repeats.sort_unstable();
    let mut same = Finding::new(
        FindingCode::ValuesPointsDuplicate,
        "Some points are repeated at exactly the same position.",
    )
    .with_hint("Remove the repeated points if they are mistakes.");
    same.count = repeats.len() as u64;
    for index in repeats {
        same = same.at(Location::default().with_element(u64::from(index)));
    }
    findings.add(same);
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
        "Some coordinates are not valid numbers (empty, not a number, or infinite), so those positions cannot be placed on a map.",
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
    fn distinct_points_have_no_duplicates() {
        assert!(run(check, &points(50)).is_empty());
        // Same x and y but different z are different points.
        let d = points_from(vec![1.0, 1.0, 1.0, 1.0, 1.0, 2.0]);
        assert!(run(check, &d).is_empty());
    }

    #[test]
    fn repeated_points_are_counted_after_the_first_copy() {
        let d = points_from(vec![
            1.0, 2.0, 3.0, //
            9.0, 9.0, 9.0, //
            1.0, 2.0, 3.0, //
            1.0, 2.0, 3.0, //
            9.0, 9.0, 9.0,
        ]);
        let f = run(check, &d);
        assert_eq!(codes(&f), ["values.points.duplicate"]);
        let one = &f.as_slice()[0];
        assert_eq!(
            (one.severity, one.count),
            (crate::findings::Severity::Warning, 3)
        );
        let at: Vec<_> = one.examples.iter().map(|l| l.element).collect();
        assert_eq!(at, [Some(2), Some(3), Some(4)]);
    }

    #[test]
    fn exact_means_the_same_bits_so_negative_zero_is_different() {
        let d = points_from(vec![0.0, 0.0, 0.0, -0.0, 0.0, 0.0]);
        assert!(run(check, &d).is_empty());
    }

    #[test]
    fn points_with_non_finite_coordinates_are_not_compared() {
        let nan = f64::NAN;
        let d = points_from(vec![nan, 0.0, 0.0, nan, 0.0, 0.0]);
        assert_eq!(codes(&run(check, &d)), ["values.coordinates.not_finite"]);
    }

    #[test]
    fn many_copies_are_all_counted_and_only_twenty_examples_are_kept() {
        let xyz: Vec<f64> = (0..1_000).flat_map(|_| [4.0, 5.0, 6.0]).collect();
        let f = run(check, &points_from(xyz));
        let one = &f.as_slice()[0];
        assert_eq!((one.count, one.examples.len()), (999, 20));
        assert_eq!(one.examples[0].element, Some(1));
    }

    #[test]
    fn other_shapes_are_not_checked_for_duplicate_points() {
        let f = run(check, &lines(4, &[0, 4]));
        assert!(!codes(&f).contains(&"values.points.duplicate"));
    }

    fn with_columns(mut d: Dataset, columns: Vec<crate::column::Column>) -> Dataset {
        d.attributes = Table::from_columns(columns, &mut Findings::new()).unwrap();
        d
    }

    fn floats_with_nulls(name: &str, flags: &[bool]) -> crate::column::Column {
        let data = ColumnData::Float64(vec![0.0; flags.len()]);
        let validity = crate::validity::Validity::from_flags(flags.iter().copied());
        crate::column::Column::new(name, data, validity).unwrap()
    }

    fn category(
        name: &str,
        codes: Vec<u32>,
        dictionary: &[&str],
        flags: &[bool],
    ) -> crate::column::Column {
        let dictionary = dictionary.iter().map(|s| (*s).to_string()).collect();
        let data = ColumnData::Categorical { codes, dictionary };
        let validity = crate::validity::Validity::from_flags(flags.iter().copied());
        crate::column::Column::new(name, data, validity).unwrap()
    }

    #[test]
    fn a_column_with_every_entry_empty_is_a_warning_that_points_at_nodata() {
        let d = with_columns(
            points(3),
            vec![
                floats_with_nulls("au", &[true, false, true]),
                floats_with_nulls("ag", &[false; 3]),
            ],
        );
        let f = run(check, &d);
        assert_eq!(codes(&f), ["table.column.all_null"]);
        let one = &f.as_slice()[0];
        assert_eq!(
            one.message,
            "The column \"ag\" has no values: every entry is empty."
        );
        assert_eq!(one.step, Some(crate::findings::WizardStep::Nodata));
        assert_eq!(one.severity, crate::findings::Severity::Warning);
        assert_eq!(one.examples[0].column.as_deref(), Some("ag"));
    }

    #[test]
    fn a_column_with_no_rows_at_all_is_not_all_null() {
        let d = with_columns(points(0), vec![floats_with_nulls("x", &[])]);
        assert!(!codes(&run(check, &d)).contains(&"table.column.all_null"));
    }

    #[test]
    fn category_codes_outside_the_dictionary_are_counted_per_column() {
        let c = category(
            "rock",
            vec![0, 1, 7, 2, u32::MAX],
            &["granite", "basalt"],
            &[true; 5],
        );
        let f = run(check, &with_columns(points(5), vec![c]));
        assert_eq!(codes(&f), ["table.column.category_out_of_range"]);
        let one = &f.as_slice()[0];
        assert_eq!(one.count, 3);
        let rows: Vec<_> = one.examples.iter().map(|l| l.row).collect();
        assert_eq!(rows, [Some(2), Some(3), Some(4)]);
        assert_eq!(one.severity, crate::findings::Severity::Error);
    }

    #[test]
    fn a_null_category_entry_is_never_checked_even_with_a_junk_code() {
        let c = category("rock", vec![0, 99], &["granite"], &[true, false]);
        assert!(run(check, &with_columns(points(2), vec![c])).is_empty());
    }

    #[test]
    fn per_vertex_columns_are_checked_and_named_as_such() {
        let mut d = lines(2, &[0, 2]);
        let table = Table::from_columns(
            vec![floats_with_nulls("z", &[false, false])],
            &mut Findings::new(),
        )
        .unwrap();
        d.vertex_attributes = Some(table);
        let f = run(check, &d);
        assert_eq!(
            f.as_slice()[0].message,
            "The per-vertex column \"z\" has no values: every entry is empty."
        );
    }

    #[test]
    fn a_trailing_partial_triple_is_left_to_the_structure_check() {
        assert!(run(check, &points_from(vec![0.0, 0.0, 0.0, f64::NAN, 1.0])).is_empty());
    }
}
