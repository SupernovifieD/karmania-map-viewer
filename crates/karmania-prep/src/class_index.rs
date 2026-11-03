//! The class of every element: one byte each, for the renderer to look a colour up by.

use karmania_core::{Column, Dataset, Finding};

use crate::classify::{ClassBreaks, class_of, column_missing, drawn_rows};
use crate::stats::category_at;

/// The class index of an element that has no value to put in a class.
pub const NO_VALUE: u8 = 255;

/// The class of each row of `column` under `breaks`, one byte a row, in row order.
///
/// A range is the class `class_of` says (the one the counts of `classify` used, so the legend's numbers
/// are those of the picture). A category is the place of its value in the list, and "Other" (the place
/// after the list) for any other value if there is an "Other" class. A row with no value, a column that
/// is not of the kind the breaks are for, and a value in no class give [`NO_VALUE`].
#[must_use]
pub fn class_index(column: &Column, breaks: &ClassBreaks) -> Vec<u8> {
    class_index_rows(column, breaks, column.len())
}

/// As [`class_index`], for the first `rows` rows of the column.
#[must_use]
pub fn class_index_rows(column: &Column, breaks: &ClassBreaks, rows: usize) -> Vec<u8> {
    let byte = |class: usize| u8::try_from(class).unwrap_or(NO_VALUE);
    (0..rows.min(column.len()))
        .map(|row| match breaks {
            ClassBreaks::Ranges { bounds, .. } => match category_at(column, row) {
                Some(crate::stats::Category::Number(value)) => {
                    class_of(bounds, value).map_or(NO_VALUE, byte)
                }
                _ => NO_VALUE,
            },
            ClassBreaks::Categories { values, other, .. } => category_at(column, row)
                .map(
                    |value| match values.iter().position(|shown| *shown == value) {
                        Some(class) => byte(class),
                        None if other.is_some() => byte(values.len()),
                        None => NO_VALUE,
                    },
                )
                .unwrap_or(NO_VALUE),
        })
        .collect()
}

/// The class of each element of `dataset` under `breaks`, by the column the breaks are of. An attribute
/// table has one row for each element, whatever the shape, so this is one byte per point, line, polygon,
/// triangle, cell (in lattice order, `i` fastest) or block.
///
/// # Errors
///
/// `classes.column.missing` if the dataset has no column of that name.
pub fn class_index_of(dataset: &Dataset, breaks: &ClassBreaks) -> Result<Vec<u8>, Finding> {
    let name = match breaks {
        ClassBreaks::Ranges { column, .. } | ClassBreaks::Categories { column, .. } => column,
    };
    let column = dataset
        .attributes
        .column(name)
        .ok_or_else(|| column_missing(name))?;
    Ok(class_index_rows(column, breaks, drawn_rows(dataset)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::classify::{Method, classify};
    use crate::testutil::{blocks, grid, points};
    use karmania_core::{ColumnData, DatasetId, Geometry, Mesh, Positions, Table, Validity};
    use karmania_core::{Findings, Lines, Polygons};

    fn column(values: &[f64]) -> Column {
        Column::without_nulls("v", ColumnData::Float64(values.to_vec()))
    }

    /// How many rows of `index` have each class, 0 to `classes`, and how many have none.
    fn tally(index: &[u8], classes: usize) -> (Vec<u64>, u64) {
        let mut counts = vec![0; classes];
        let mut none = 0;
        for &i in index {
            match counts.get_mut(usize::from(i)) {
                Some(n) => *n += 1,
                None => none += 1,
            }
        }
        (counts, none)
    }

    #[test]
    fn ranges_are_classed_by_class_of_and_rows_without_a_value_are_255() {
        let c = Column::new(
            "v",
            ColumnData::Float64(vec![0.0, 5.0, 10.0, f64::NAN, 3.0, 99.0, 9.99]),
            Validity::from_flags([true, true, true, true, true, false, true]),
        )
        .unwrap();
        let breaks = classify(&c, Method::Equal, 2).unwrap();
        // The bounds are 0, 5, 10: a value on a bound starts the class above it, and 10 is in the last.
        assert_eq!(class_index(&c, &breaks), [0, 1, 1, 255, 0, 255, 1]);
    }

    #[test]
    fn categories_are_the_place_in_the_list_other_after_it_and_none_without_other() {
        let text = |items: &[&str]| {
            Column::without_nulls(
                "rock",
                ColumnData::Utf8(items.iter().map(|s| (*s).to_string()).collect()),
            )
        };
        let c = text(&["a", "b", "a", "c", "a", "b", "d"]);
        let breaks = classify(&c, Method::Categories, 2).unwrap();
        // a (3) and b (2) are shown; c and d are Other, which is class 2.
        assert_eq!(class_index(&c, &breaks), [0, 1, 0, 2, 0, 1, 2]);
        let all = classify(&c, Method::Categories, 20).unwrap();
        assert_eq!(
            class_index(&c, &all),
            [0, 1, 0, 2, 0, 1, 3],
            "no Other: every value its own class"
        );
        // Breaks of another column: a value that is in no class has none when there is no Other.
        let strangers = text(&["a", "zzz"]);
        assert_eq!(class_index(&strangers, &all), [0, 255]);
        assert_eq!(class_index(&strangers, &breaks), [0, 2]);
    }

    #[test]
    fn the_counts_of_the_legend_are_the_counts_of_the_picture_for_every_method() {
        // A deterministic mix, with values that repeat, a null, and non-finite numbers.
        let values: Vec<f64> = (0..500)
            .map(|i| match i % 50 {
                7 => f64::NAN,
                _ => f64::from((i * 37) % 23) + f64::from(i % 3) * 0.5,
            })
            .collect();
        let valid: Vec<bool> = (0..500).map(|i| i % 41 != 0).collect();
        let c = Column::new(
            "v",
            ColumnData::Float64(values),
            Validity::from_flags(valid),
        )
        .unwrap();
        for method in [
            Method::Equal,
            Method::Quantile,
            Method::Jenks,
            Method::Categories,
        ] {
            for classes in [1, 3, 5, 12] {
                let breaks = classify(&c, method, classes).unwrap();
                let (index, expected_nulls, expected) = (
                    class_index(&c, &breaks),
                    match &breaks {
                        ClassBreaks::Ranges { nulls, .. }
                        | ClassBreaks::Categories { nulls, .. } => *nulls,
                    },
                    match &breaks {
                        ClassBreaks::Ranges { counts, .. } => counts.clone(),
                        ClassBreaks::Categories { counts, other, .. } => {
                            let mut all = counts.clone();
                            all.extend(*other);
                            all
                        }
                    },
                );
                let (counted, none) = tally(&index, expected.len());
                assert_eq!(counted, expected, "{method:?} {classes}");
                assert_eq!(none, expected_nulls, "{method:?} {classes}");
            }
        }
    }

    #[test]
    fn every_kind_has_one_byte_for_each_element_by_the_column_of_the_breaks() {
        let table = |n: usize| {
            let column = Column::without_nulls(
                "grade",
                ColumnData::Float64((0..n).map(|i| i as f64).collect()),
            );
            Table::from_columns(vec![column], &mut Findings::new()).unwrap()
        };
        let mut datasets = vec![
            points(None, &[(0.0, 0.0), (1.0, 1.0), (2.0, 2.0)]),
            grid(None),
            blocks(None),
        ];
        let line_positions = Positions::from_interleaved(vec![0.0; 12], false);
        let lines = Lines {
            positions: line_positions.clone(),
            offsets: vec![0, 2, 4],
        };
        let polygons = Polygons {
            positions: line_positions.clone(),
            ring_offsets: vec![0, 4],
            polygon_offsets: vec![0, 1],
        };
        let mesh = Mesh {
            positions: line_positions,
            indices: vec![0, 1, 2, 1, 2, 3],
        };
        for (id, geometry) in [
            Geometry::Lines(lines),
            Geometry::Polygons(polygons),
            Geometry::Mesh(mesh),
        ]
        .into_iter()
        .enumerate()
        {
            datasets.push(Dataset::new(
                DatasetId(10 + id as u64),
                "shape",
                None,
                geometry,
                Table::empty(),
            ));
        }
        let mut kinds = Vec::new();
        for mut dataset in datasets {
            let elements = usize::try_from(dataset.element_count().unwrap()).unwrap();
            dataset.attributes = table(elements);
            let breaks = classify(
                dataset.attributes.column("grade").unwrap(),
                Method::Equal,
                3,
            )
            .unwrap();
            let index = class_index_of(&dataset, &breaks).unwrap();
            assert_eq!(index.len(), elements, "{:?}", dataset.kind());
            assert!(index.iter().all(|&c| c < 3));
            kinds.push(dataset.kind());
        }
        assert_eq!(kinds.len(), 6);
        let distinct: std::collections::BTreeSet<_> = kinds.iter().map(|k| k.as_str()).collect();
        assert_eq!(distinct.len(), 6, "all six shapes");
    }

    #[test]
    fn a_column_the_dataset_does_not_have_is_a_finding() {
        let dataset = points(None, &[(0.0, 0.0)]);
        let breaks = classify(&column(&[1.0, 2.0]), Method::Equal, 2).unwrap();
        let error = class_index_of(&dataset, &breaks).unwrap_err();
        assert_eq!(error.code.as_str(), "classes.column.missing");
        assert_eq!(
            error.message,
            "The dataset has no column named v, so nothing can be coloured by it."
        );
    }

    #[test]
    fn a_grid_with_several_layers_is_classified_by_its_first_layer_the_one_that_is_drawn() {
        // Found by the review of the milestone: a 2 x 2 x 2 grid was classified over its 8 rows, and its class index had 8
        // entries, while only the first layer (4 cells) is drawn, so the counts of the legend were not the picture's.
        let values = [1.0, 2.0, 3.0, 4.0, 100.0, 200.0, 300.0, 400.0];
        let table = Table::from_columns(
            vec![Column::without_nulls(
                "v",
                ColumnData::Float64(values.to_vec()),
            )],
            &mut Findings::new(),
        )
        .unwrap();
        let lattice = karmania_core::Lattice {
            origin: [0.0; 3],
            spacing: [1.0; 3],
            dims: [2, 2, 2],
            rotation: 0.0,
        };
        let grid = karmania_core::Grid {
            lattice,
            z: karmania_core::GridZ::Flat { elevation: 0.0 },
        };
        let dataset = Dataset::new(DatasetId(1), "g", None, Geometry::Grid(grid), table);
        let breaks = crate::classify::classify_dataset(&dataset, "v", Method::Equal, 2).unwrap();
        let ClassBreaks::Ranges {
            bounds,
            counts,
            nulls,
            ..
        } = &breaks
        else {
            panic!("ranges")
        };
        assert_eq!(
            (bounds.as_slice(), counts.as_slice(), *nulls),
            ([1.0, 2.5, 4.0].as_slice(), [2, 2].as_slice(), 0)
        );
        let index = class_index_of(&dataset, &breaks).unwrap();
        assert_eq!(index, [0, 0, 1, 1], "one byte for each cell that is drawn");
        // By categories too: the four values of the first layer, and none of the others.
        let cats =
            crate::classify::classify_dataset(&dataset, "v", Method::Categories, 20).unwrap();
        let ClassBreaks::Categories { values, counts, .. } = &cats else {
            panic!("categories")
        };
        assert_eq!((values.len(), counts.iter().sum::<u64>()), (4, 4));
        assert_eq!(class_index_of(&dataset, &cats).unwrap().len(), 4);
        // A grid of one layer, and every other shape, are as before: every row.
        let flat = Dataset::new(
            DatasetId(2),
            "p",
            None,
            Geometry::Points(Positions::from_interleaved(vec![0.0; 24], false)),
            Table::from_columns(
                vec![Column::without_nulls(
                    "v",
                    ColumnData::Float64(values.to_vec()),
                )],
                &mut Findings::new(),
            )
            .unwrap(),
        );
        let breaks = crate::classify::classify_dataset(&flat, "v", Method::Equal, 2).unwrap();
        assert_eq!(class_index_of(&flat, &breaks).unwrap().len(), 8);
    }
}
