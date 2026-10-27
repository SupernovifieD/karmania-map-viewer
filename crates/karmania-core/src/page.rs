//! A window of rows of a dataset, for showing in a table.
//!
//! A page starts with columns derived from the geometry, which say what each row is,
//! followed by the attribute columns. Numbers that name a row, a cell or a vertex are
//! shown counting from 1, as a person counts; inside the kernel they count from 0.
//!
//! | Shape | Geometry columns |
//! | --- | --- |
//! | points | `X`, `Y` and, if the points have elevations, `Z` |
//! | lines | `line #`, `vertex count` |
//! | polygons | `polygon #`, `ring count`, `vertex count` |
//! | mesh | `triangle #`, `v1`, `v2`, `v3` (vertex numbers) |
//! | grid | `i`, `j`, `k` if there is more than one layer, `cell centre X`, `cell centre Y` |
//! | blocks | `i`, `j`, `k`, `centre X`, `centre Y`, `centre Z` |

use crate::column::{ColumnData, Value};
use crate::dataset::{Dataset, Geometry};
use crate::lines::Lines;
use crate::polygons::Polygons;

/// The most rows a page holds, whatever is asked for.
pub const MAX_PAGE_ROWS: u64 = 100_000;

/// The values of one column of a page.
#[derive(Debug, Clone, PartialEq)]
pub enum PageValues {
    /// Decimal numbers: coordinates, cell centres, decimal and whole-number
    /// attributes. (A whole number beyond 2^53 loses its last digits here.)
    Float64(Vec<f64>),
    /// Whole numbers that fit 32 bits: counts, and the numbers of rows, cells and
    /// vertices, which count from 1.
    Int32(Vec<i32>),
    /// True (1) or false (0).
    Bool(Vec<u8>),
    /// Text, and the text of categories.
    Text(Vec<String>),
}

impl PageValues {
    /// How many values there are.
    #[must_use]
    pub fn len(&self) -> usize {
        match self {
            PageValues::Float64(v) => v.len(),
            PageValues::Int32(v) => v.len(),
            PageValues::Bool(v) => v.len(),
            PageValues::Text(v) => v.len(),
        }
    }

    /// Whether there are no values.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// One column of a page.
#[derive(Debug, Clone, PartialEq)]
pub struct PageColumn {
    /// The column's name.
    pub name: String,
    /// Its values, one per row of the page. A null has a placeholder here (0, 0.0 or
    /// an empty string); `nulls` says which.
    pub values: PageValues,
    /// One byte per row: 1 for a null, 0 otherwise.
    pub nulls: Vec<u8>,
}

/// A window of rows.
#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    /// The first row, counting from 0 (an offset, not a number shown to anyone). At
    /// most the number of rows.
    pub start: u64,
    /// How many rows the page holds: as many as were asked for, fewer at the end of
    /// the dataset and never more than [`MAX_PAGE_ROWS`].
    pub count: u64,
    /// The geometry columns, then the attribute columns, each with `count` values.
    pub columns: Vec<PageColumn>,
}

fn int32(value: usize) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

/// A 0-based position as it is shown to people: counting from 1.
fn one_based(zero_based: usize) -> i32 {
    int32(zero_based.saturating_add(1))
}

fn derived_ints(name: &str, values: Vec<i32>) -> PageColumn {
    let nulls = vec![0; values.len()];
    PageColumn {
        name: name.to_string(),
        values: PageValues::Int32(values),
        nulls,
    }
}

fn derived_floats(name: &str, values: Vec<f64>) -> PageColumn {
    let nulls = vec![0; values.len()];
    PageColumn {
        name: name.to_string(),
        values: PageValues::Float64(values),
        nulls,
    }
}

/// The vertices of polygon `index`, rings counted: `(rings, vertices)`.
fn polygon_sizes(polygons: &Polygons, index: usize) -> (usize, usize) {
    let rings = polygons.ring_range(index).unwrap_or(0..0);
    let vertices = rings
        .clone()
        .map(|ring| polygons.vertex_range(ring).map_or(0, |range| range.len()))
        .sum();
    (rings.len(), vertices)
}

fn line_size(lines: &Lines, index: usize) -> usize {
    lines.vertex_range(index).map_or(0, |range| range.len())
}

/// The geometry columns for rows `rows` of the dataset.
fn geometry_columns(dataset: &Dataset, rows: std::ops::Range<usize>) -> Vec<PageColumn> {
    match &dataset.geometry {
        Geometry::Points(positions) => {
            let at: Vec<[f64; 3]> = rows
                .map(|row| positions.get(row).unwrap_or([0.0; 3]))
                .collect();
            let mut columns = vec![
                derived_floats("X", at.iter().map(|p| p[0]).collect()),
                derived_floats("Y", at.iter().map(|p| p[1]).collect()),
            ];
            if positions.has_z() {
                columns.push(derived_floats("Z", at.iter().map(|p| p[2]).collect()));
            }
            columns
        }
        Geometry::Lines(lines) => vec![
            derived_ints("line #", rows.clone().map(one_based).collect()),
            derived_ints(
                "vertex count",
                rows.map(|row| int32(line_size(lines, row))).collect(),
            ),
        ],
        Geometry::Polygons(polygons) => {
            let sizes: Vec<(usize, usize)> = rows
                .clone()
                .map(|row| polygon_sizes(polygons, row))
                .collect();
            vec![
                derived_ints("polygon #", rows.map(one_based).collect()),
                derived_ints("ring count", sizes.iter().map(|s| int32(s.0)).collect()),
                derived_ints("vertex count", sizes.iter().map(|s| int32(s.1)).collect()),
            ]
        }
        Geometry::Mesh(mesh) => {
            let triangles: Vec<[u32; 3]> = rows
                .clone()
                .map(|row| mesh.triangle(row).unwrap_or([0; 3]))
                .collect();
            let corner = |n: usize| triangles.iter().map(|t| one_based(t[n] as usize)).collect();
            vec![
                derived_ints("triangle #", rows.map(one_based).collect()),
                derived_ints("v1", corner(0)),
                derived_ints("v2", corner(1)),
                derived_ints("v3", corner(2)),
            ]
        }
        Geometry::Grid(grid) => {
            let cells: Vec<([u32; 3], [f64; 3])> = rows
                .map(|row| cell(&grid.lattice, row as u64, None))
                .collect();
            let mut columns = vec![
                derived_ints(
                    "i",
                    cells.iter().map(|c| one_based(c.0[0] as usize)).collect(),
                ),
                derived_ints(
                    "j",
                    cells.iter().map(|c| one_based(c.0[1] as usize)).collect(),
                ),
            ];
            if grid.lattice.dims[2] > 1 {
                columns.push(derived_ints(
                    "k",
                    cells.iter().map(|c| one_based(c.0[2] as usize)).collect(),
                ));
            }
            columns.push(derived_floats(
                "cell centre X",
                cells.iter().map(|c| c.1[0]).collect(),
            ));
            columns.push(derived_floats(
                "cell centre Y",
                cells.iter().map(|c| c.1[1]).collect(),
            ));
            columns
        }
        Geometry::Blocks(blocks) => {
            let cells: Vec<([u32; 3], [f64; 3])> = rows
                .map(|row| {
                    let stored = blocks.block_ijk(row);
                    cell(&blocks.lattice, row as u64, stored)
                })
                .collect();
            vec![
                derived_ints(
                    "i",
                    cells.iter().map(|c| one_based(c.0[0] as usize)).collect(),
                ),
                derived_ints(
                    "j",
                    cells.iter().map(|c| one_based(c.0[1] as usize)).collect(),
                ),
                derived_ints(
                    "k",
                    cells.iter().map(|c| one_based(c.0[2] as usize)).collect(),
                ),
                derived_floats("centre X", cells.iter().map(|c| c.1[0]).collect()),
                derived_floats("centre Y", cells.iter().map(|c| c.1[1]).collect()),
                derived_floats("centre Z", cells.iter().map(|c| c.1[2]).collect()),
            ]
        }
    }
}

/// The `[i, j, k]` of cell number `index` (or the given `stored` one) and its centre.
fn cell(
    lattice: &crate::lattice::Lattice,
    index: u64,
    stored: Option<[u32; 3]>,
) -> ([u32; 3], [f64; 3]) {
    let ijk = stored.or_else(|| lattice.ijk(index)).unwrap_or([0; 3]);
    let centre = lattice
        .cell_centre(ijk[0], ijk[1], ijk[2])
        .unwrap_or([0.0; 3]);
    (ijk, centre)
}

/// The attribute column `column` for rows `rows`. A null shows a placeholder.
fn attribute_column(column: &crate::column::Column, rows: std::ops::Range<usize>) -> PageColumn {
    // A category whose code is not in the dictionary has no text to show, so it counts
    // as null here (validation rejects such a dataset before it is loaded).
    let shown = |row: usize| match column.get(row) {
        None | Some(Value::Category { label: None, .. }) => false,
        Some(_) => true,
    };
    let nulls: Vec<u8> = rows.clone().map(|row| u8::from(!shown(row))).collect();
    let valid = shown;
    let values = match column.data() {
        ColumnData::Float64(v) => PageValues::Float64(
            rows.map(|row| match v.get(row) {
                Some(n) if valid(row) => *n,
                _ => 0.0,
            })
            .collect(),
        ),
        ColumnData::Int64(v) => PageValues::Float64(
            rows.map(|row| match v.get(row) {
                Some(n) if valid(row) => *n as f64,
                _ => 0.0,
            })
            .collect(),
        ),
        ColumnData::Bool(v) => PageValues::Bool(
            rows.map(|row| u8::from(valid(row) && v.get(row).copied().unwrap_or(false)))
                .collect(),
        ),
        ColumnData::Utf8(v) => PageValues::Text(
            rows.map(|row| match v.get(row) {
                Some(text) if valid(row) => text.clone(),
                _ => String::new(),
            })
            .collect(),
        ),
        ColumnData::Categorical { .. } => PageValues::Text(
            rows.map(|row| match column.get(row) {
                Some(Value::Category {
                    label: Some(text), ..
                }) => text.to_string(),
                _ => String::new(),
            })
            .collect(),
        ),
    };
    PageColumn {
        name: column.name().to_string(),
        values,
        nulls,
    }
}

impl Dataset {
    /// Rows `start` to `start + count` of the dataset, with the geometry columns
    /// first and then the attribute columns. A start past the end gives an empty page;
    /// a count that runs past the end, or past [`MAX_PAGE_ROWS`], is cut short, and
    /// the page says how many rows it holds.
    #[must_use]
    pub fn page(&self, start: u64, count: u64) -> Page {
        let total = self.element_count().unwrap_or(0);
        let start = start.min(total);
        let count = count.min(MAX_PAGE_ROWS).min(total - start);
        let first = usize::try_from(start).unwrap_or(usize::MAX);
        let rows = first..first.saturating_add(usize::try_from(count).unwrap_or(0));
        let mut columns = geometry_columns(self, rows.clone());
        columns.extend(
            self.attributes
                .columns()
                .iter()
                .map(|column| attribute_column(column, rows.clone())),
        );
        Page {
            start,
            count,
            columns,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blocks::Blocks;
    use crate::column::Column;
    use crate::crs::{CrsRef, Units};
    use crate::dataset::DatasetId;
    use crate::findings::Findings;
    use crate::grid::{Grid, GridZ};
    use crate::lattice::Lattice;
    use crate::mesh::Mesh;
    use crate::positions::Positions;
    use crate::table::Table;
    use crate::validity::Validity;

    fn dataset(geometry: Geometry, columns: Vec<Column>) -> Dataset {
        Dataset::new(
            DatasetId(1),
            "t",
            Some(CrsRef::Local {
                units: Units::Metre,
            }),
            geometry,
            Table::from_columns(columns, &mut Findings::new()).unwrap(),
        )
    }

    fn names(page: &Page) -> Vec<&str> {
        page.columns.iter().map(|c| c.name.as_str()).collect()
    }

    fn ints(page: &Page, name: &str) -> Vec<i32> {
        match &page.columns.iter().find(|c| c.name == name).unwrap().values {
            PageValues::Int32(v) => v.clone(),
            other => panic!("{name} is {other:?}"),
        }
    }

    fn floats(page: &Page, name: &str) -> Vec<f64> {
        match &page.columns.iter().find(|c| c.name == name).unwrap().values {
            PageValues::Float64(v) => v.clone(),
            other => panic!("{name} is {other:?}"),
        }
    }

    fn points(with_z: bool) -> Dataset {
        let xyz = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0];
        let attributes = vec![
            Column::new(
                "au",
                ColumnData::Float64(vec![0.5, 1.5, 2.5]),
                Validity::from_flags([true, false, true]),
            )
            .unwrap(),
            Column::without_nulls("count", ColumnData::Int64(vec![10, 20, 30])),
            Column::new(
                "ok",
                ColumnData::Bool(vec![true, false, true]),
                Validity::from_flags([true, true, false]),
            )
            .unwrap(),
            Column::without_nulls(
                "note",
                ColumnData::Utf8(vec!["a".into(), "b".into(), "c".into()]),
            ),
            Column::new(
                "rock",
                ColumnData::Categorical {
                    codes: vec![1, 0, 7],
                    dictionary: vec!["ore".into(), "waste".into()],
                },
                Validity::from_flags([true, true, true]),
            )
            .unwrap(),
        ];
        dataset(
            Geometry::Points(Positions::from_interleaved(xyz, with_z)),
            attributes,
        )
    }

    #[test]
    fn points_give_x_y_and_z_then_the_attributes_with_their_nulls() {
        let page = points(true).page(0, 10);
        assert_eq!((page.start, page.count), (0, 3));
        assert_eq!(
            names(&page),
            ["X", "Y", "Z", "au", "count", "ok", "note", "rock"]
        );
        assert_eq!(floats(&page, "X"), [1.0, 4.0, 7.0]);
        assert_eq!(floats(&page, "Z"), [3.0, 6.0, 9.0]);
        let au = &page.columns[3];
        assert_eq!(au.values, PageValues::Float64(vec![0.5, 0.0, 2.5]));
        assert_eq!(au.nulls, [0, 1, 0]);
        // Whole numbers come out as decimals.
        assert_eq!(
            page.columns[4].values,
            PageValues::Float64(vec![10.0, 20.0, 30.0])
        );
        let ok = &page.columns[5];
        assert_eq!(
            (&ok.values, &ok.nulls),
            (&PageValues::Bool(vec![1, 0, 0]), &vec![0, 0, 1])
        );
        assert_eq!(
            page.columns[6].values,
            PageValues::Text(vec!["a".into(), "b".into(), "c".into()])
        );
        // A category shows its text; a code outside the dictionary shows as null.
        let rock = &page.columns[7];
        assert_eq!(
            rock.values,
            PageValues::Text(vec!["waste".into(), "ore".into(), String::new()])
        );
        assert_eq!(rock.nulls, [0, 0, 1]);
        assert!(
            page.columns
                .iter()
                .all(|c| c.values.len() == 3 && c.nulls.len() == 3)
        );
    }

    #[test]
    fn points_without_elevations_have_no_z_column() {
        assert_eq!(names(&points(false).page(0, 3))[..3], ["X", "Y", "au"]);
    }

    #[test]
    fn a_window_is_cut_to_the_rows_that_exist_and_to_the_page_limit() {
        let d = points(true);
        let middle = d.page(1, 1);
        assert_eq!((middle.start, middle.count), (1, 1));
        assert_eq!(floats(&middle, "X"), [4.0]);
        let tail = d.page(2, 50);
        assert_eq!((tail.start, tail.count), (2, 1));
        let past = d.page(3, 5);
        assert_eq!((past.start, past.count), (3, 0));
        assert!(
            past.columns
                .iter()
                .all(|c| c.values.is_empty() && c.nulls.is_empty())
        );
        assert!(!past.columns.is_empty());
        let beyond = d.page(u64::MAX, u64::MAX);
        assert_eq!((beyond.start, beyond.count), (3, 0));
        assert_eq!(d.page(0, u64::MAX).count, 3);
        assert_eq!(d.page(0, 0).count, 0);

        let mut big = points(false);
        big.geometry = Geometry::Points(Positions::from_interleaved(
            vec![0.0; 3 * (MAX_PAGE_ROWS as usize + 5)],
            false,
        ));
        big.attributes = Table::empty();
        assert_eq!(big.page(0, u64::MAX).count, MAX_PAGE_ROWS);
        assert_eq!(big.page(MAX_PAGE_ROWS, u64::MAX).count, 5);
    }

    #[test]
    fn pages_put_end_to_end_make_the_whole() {
        let d = points(true);
        let whole = d.page(0, 3);
        for size in 1..=3 {
            let mut x = Vec::new();
            let mut rock = Vec::new();
            let mut start = 0;
            while start < 3 {
                let page = d.page(start, size);
                x.extend(floats(&page, "X"));
                if let PageValues::Text(t) = &page.columns[7].values {
                    rock.extend(t.clone());
                }
                start += page.count;
            }
            assert_eq!(x, floats(&whole, "X"), "pages of {size}");
            assert_eq!(rock, ["waste", "ore", ""], "pages of {size}");
        }
    }

    #[test]
    fn lines_give_their_number_and_vertex_count() {
        let lines = crate::lines::Lines {
            positions: Positions::from_interleaved(vec![0.0; 15], true),
            offsets: vec![0, 3, 5],
        };
        let page = dataset(Geometry::Lines(lines), vec![]).page(0, 5);
        assert_eq!(names(&page), ["line #", "vertex count"]);
        assert_eq!(ints(&page, "line #"), [1, 2]);
        assert_eq!(ints(&page, "vertex count"), [3, 2]);
    }

    #[test]
    fn polygons_give_their_number_ring_count_and_vertex_count() {
        let polygons = Polygons {
            positions: Positions::from_interleaved(vec![0.0; 33], true),
            ring_offsets: vec![0, 4, 8, 11],
            polygon_offsets: vec![0, 2, 3],
        };
        let page = dataset(Geometry::Polygons(polygons), vec![]).page(0, 5);
        assert_eq!(names(&page), ["polygon #", "ring count", "vertex count"]);
        assert_eq!(ints(&page, "polygon #"), [1, 2]);
        assert_eq!(ints(&page, "ring count"), [2, 1]);
        assert_eq!(ints(&page, "vertex count"), [8, 3]);
    }

    #[test]
    fn a_mesh_gives_each_triangle_its_three_vertex_numbers() {
        let mesh = Mesh {
            positions: Positions::from_interleaved(vec![0.0; 12], true),
            indices: vec![0, 1, 2, 1, 2, 3],
        };
        let page = dataset(Geometry::Mesh(mesh), vec![]).page(1, 5);
        assert_eq!(names(&page), ["triangle #", "v1", "v2", "v3"]);
        assert_eq!((page.start, page.count), (1, 1));
        assert_eq!(ints(&page, "triangle #"), [2]);
        // The second triangle is 1, 2, 3 (counting from 0), shown as 2, 3, 4.
        assert_eq!((ints(&page, "v1"), ints(&page, "v3")), (vec![2], vec![4]));
    }

    fn lattice(dims: [u32; 3], rotation: f64) -> Lattice {
        Lattice {
            origin: [100.0, 200.0, 0.0],
            spacing: [10.0, 10.0, 5.0],
            dims,
            rotation,
        }
    }

    #[test]
    fn a_grid_gives_cell_indices_and_centres_and_k_only_with_layers() {
        let grid = |dims| Grid {
            lattice: lattice(dims, 0.0),
            z: GridZ::Flat { elevation: 0.0 },
        };
        let values = vec![Column::without_nulls(
            "v",
            ColumnData::Float64(vec![0.0; 6]),
        )];
        let page = dataset(Geometry::Grid(grid([2, 3, 1])), values).page(0, 6);
        assert_eq!(
            names(&page),
            ["i", "j", "cell centre X", "cell centre Y", "v"]
        );
        assert_eq!(ints(&page, "i"), [1, 2, 1, 2, 1, 2]);
        assert_eq!(ints(&page, "j"), [1, 1, 2, 2, 3, 3]);
        assert_eq!(floats(&page, "cell centre X")[..2], [105.0, 115.0]);
        assert_eq!(floats(&page, "cell centre Y")[..3], [205.0, 205.0, 215.0]);

        let layered = dataset(Geometry::Grid(grid([2, 1, 2])), vec![]).page(0, 4);
        assert_eq!(
            names(&layered),
            ["i", "j", "k", "cell centre X", "cell centre Y"]
        );
        assert_eq!(ints(&layered, "k"), [1, 1, 2, 2]);
    }

    #[test]
    fn a_rotated_grid_has_rotated_centres() {
        let grid = Grid {
            lattice: lattice([1, 1, 1], 90.0),
            z: GridZ::Flat { elevation: 0.0 },
        };
        let page = dataset(Geometry::Grid(grid), vec![]).page(0, 1);
        // Centre (5, 5) turned a quarter turn about the origin (100, 200).
        assert!((floats(&page, "cell centre X")[0] - 95.0).abs() < 1e-9);
        assert!((floats(&page, "cell centre Y")[0] - 205.0).abs() < 1e-9);
    }

    #[test]
    fn blocks_give_their_cell_and_centre_dense_or_sparse() {
        let dense = Blocks {
            lattice: lattice([2, 2, 2], 0.0),
            ijk: None,
        };
        let page = dataset(Geometry::Blocks(dense), vec![]).page(5, 2);
        assert_eq!(
            names(&page),
            ["i", "j", "k", "centre X", "centre Y", "centre Z"]
        );
        assert_eq!(ints(&page, "i"), [2, 1]);
        assert_eq!(ints(&page, "j"), [1, 2]);
        assert_eq!(ints(&page, "k"), [2, 2]);
        assert_eq!(floats(&page, "centre Z"), [7.5, 7.5]);

        let sparse = Blocks {
            lattice: lattice([2, 2, 2], 0.0),
            ijk: Some(vec![1, 1, 0, 0, 0, 1]),
        };
        let page = dataset(Geometry::Blocks(sparse), vec![]).page(0, 2);
        assert_eq!(ints(&page, "i"), [2, 1]);
        assert_eq!(ints(&page, "k"), [1, 2]);
        assert_eq!(floats(&page, "centre X"), [115.0, 105.0]);
    }

    #[test]
    fn an_empty_dataset_gives_an_empty_page_that_still_names_its_columns() {
        let empty = dataset(
            Geometry::Points(Positions::from_interleaved(vec![], false)),
            vec![],
        );
        let page = empty.page(0, 10);
        assert_eq!((page.count, names(&page)), (0, vec!["X", "Y"]));
    }
}
