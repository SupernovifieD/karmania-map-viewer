//! Contour lines of a dataset (brief 11.5): of a grid (here), and of a mesh (20.2), as lines with the level of each and whether it is an index line.
//!
//! A grid is contoured by the values of one column at the centres of its cells, in its first layer (the others are not drawn either); the lines
//! are put where the lattice puts its cells, rotation included, at the height that the grid has there: the interpolated height of its elevation
//! column, or the elevation of its plane. A cell with no value, or with no height, breaks the lines that would pass it.

use karmania_core::{
    Column, ColumnData, ColumnType, CrsRef, Dataset, DatasetId, Findings, Geometry, GridZ, Kind,
    Lines, Positions, Table, Value,
};
use serde::{Deserialize, Serialize};

use crate::contour_grid::{Field, contour_field};
use crate::contour_levels::{Levels, LevelsError};

/// The settings of a set of contours. In JSON: `{ "column": .., "interval": .., "base": .., "indexEvery": .. }`; `column` is only for grids and
/// is left out when it is not given (a grid then uses its first column of numbers).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContourParams {
    /// Grids only: the column the heights are in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
    /// The height between two lines, greater than 0.
    pub interval: f64,
    /// A height that has a line; the others are `base + k * interval`.
    pub base: f64,
    /// Every this many lines is an index line, the base being one; 1 or more.
    pub index_every: u32,
}

/// Why no contours were made.
#[derive(Debug, Clone, PartialEq)]
pub enum ContourError {
    /// The dataset is not a grid or a mesh: contours are made of those.
    Kind(Kind),
    /// A grid has no column named so.
    ColumnMissing(String),
    /// The column is not numbers.
    ColumnNotNumeric {
        /// Its name.
        name: String,
        /// Its type.
        column_type: ColumnType,
    },
    /// No column is named and the grid has none of numbers.
    NoNumericColumn,
    /// The column has no value that is a finite number (in the cells that have a height).
    NoValues(String),
    /// The settings do not make levels.
    Levels(LevelsError),
    /// There is no line to draw: no level is crossed by the values.
    NoLines,
}

/// Contour lines: the vertices of every line and where each starts, with the level of each and whether it is an index line.
#[derive(Debug, Clone, PartialEq)]
pub struct ContourLines {
    /// The vertices, `x`, `y`, `z` one after the other, in line order.
    pub positions: Vec<f64>,
    /// Where each line starts, and the end: one more than there are lines.
    pub offsets: Vec<u32>,
    /// The level of each line.
    pub levels: Vec<f64>,
    /// Whether each line is an index line.
    pub index: Vec<bool>,
    /// Whether the heights are real (a grid's elevation, or a mesh's) and not a flat plane at 0.
    pub has_z: bool,
}

impl ContourLines {
    /// How many lines there are.
    #[must_use]
    pub fn line_count(&self) -> usize {
        self.levels.len()
    }

    /// The lines as a dataset of lines with the columns `level` (float) and `index` (true or false), in the coordinate system `crs`. `None`
    /// only if the columns are not the same length, which cannot be (the caller made the lines here).
    #[must_use]
    pub fn into_dataset(self, name: impl Into<String>, crs: Option<CrsRef>) -> Option<Dataset> {
        let level = Column::without_nulls("level", ColumnData::Float64(self.levels));
        let index = Column::without_nulls("index", ColumnData::Bool(self.index));
        let attributes = Table::from_columns(vec![level, index], &mut Findings::new())?;
        let lines = Lines {
            positions: Positions::from_interleaved(self.positions, self.has_z),
            offsets: self.offsets,
        };
        Some(Dataset::new(
            DatasetId(0),
            name,
            crs,
            Geometry::Lines(lines),
            attributes,
        ))
    }
}

/// The name of the contours of a dataset: `Contours of <name> (every <interval>)`.
#[must_use]
pub fn contours_name(source: &str, interval: f64) -> String {
    format!("Contours of {source} (every {interval})")
}

/// The column of numbers that a grid is contoured by: the one named, or the first of numbers if none is named.
fn column_for<'a>(dataset: &'a Dataset, name: Option<&str>) -> Result<&'a Column, ContourError> {
    let numbers = |column: &Column| {
        matches!(
            column.column_type(),
            ColumnType::Float64 | ColumnType::Int64
        )
    };
    match name {
        Some(name) => {
            let column = dataset
                .attributes
                .column(name)
                .ok_or_else(|| ContourError::ColumnMissing(name.to_string()))?;
            if numbers(column) {
                Ok(column)
            } else {
                Err(ContourError::ColumnNotNumeric {
                    name: name.to_string(),
                    column_type: column.column_type(),
                })
            }
        }
        None => dataset
            .attributes
            .columns()
            .iter()
            .find(|column| numbers(column))
            .ok_or(ContourError::NoNumericColumn),
    }
}

/// The first `cells` values of a column as numbers: `NaN` for a value that is null or not a finite number.
fn numbers_of(column: &Column, cells: usize) -> Vec<f64> {
    (0..cells)
        .map(|row| match column.get(row) {
            Some(Value::Float64(value)) if value.is_finite() => value,
            #[allow(clippy::cast_precision_loss)]
            Some(Value::Int64(value)) => value as f64,
            _ => f64::NAN,
        })
        .collect()
}

/// The contour lines of a grid by the values of a column.
///
/// # Errors
///
/// [`ContourError::Kind`] for a dataset that is not a grid, [`ContourError::ColumnMissing`], [`ContourError::ColumnNotNumeric`] or
/// [`ContourError::NoNumericColumn`] for a column that cannot be contoured, [`ContourError::NoValues`], [`ContourError::Levels`] for
/// settings that make no levels or too many, and [`ContourError::NoLines`] when no level crosses the values.
pub fn contour_grid(
    dataset: &Dataset,
    params: &ContourParams,
) -> Result<ContourLines, ContourError> {
    let Geometry::Grid(grid) = &dataset.geometry else {
        return Err(ContourError::Kind(dataset.kind()));
    };
    let lattice = &grid.lattice;
    let [nx, ny, _] = lattice.dims;
    let (across, up) = (
        usize::try_from(nx).unwrap_or(usize::MAX),
        usize::try_from(ny).unwrap_or(usize::MAX),
    );
    let cells = across.checked_mul(up).ok_or(ContourError::NoLines)?;
    let column = column_for(dataset, params.column.as_deref())?;
    let mut values = numbers_of(column, cells);
    // The heights: those of the elevation column, where a cell with none is a cell with no value, or the elevation of the plane.
    let heights = match &grid.z {
        GridZ::FromColumn { name } => dataset
            .attributes
            .column(name)
            .map(|elevation| numbers_of(elevation, cells)),
        GridZ::Flat { .. } => None,
    };
    if let Some(heights) = &heights {
        for (value, height) in values.iter_mut().zip(heights) {
            if !height.is_finite() {
                *value = f64::NAN;
            }
        }
    }
    let plane = match &grid.z {
        GridZ::Flat { elevation } if elevation.is_finite() => *elevation,
        _ => 0.0,
    };
    let field = Field::new(across, up, &values).ok_or(ContourError::NoLines)?;
    let field = match &heights {
        Some(heights) => field.with_heights(heights).ok_or(ContourError::NoLines)?,
        None => field,
    };
    let (low, high) = field
        .range()
        .ok_or_else(|| ContourError::NoValues(column.name().to_string()))?;
    let levels = Levels::for_range(low, high, params.base, params.interval, params.index_every)
        .map_err(ContourError::Levels)?;
    let contours = contour_field(&field, &levels);
    if contours.is_empty() {
        return Err(ContourError::NoLines);
    }
    let [dx, dy, _] = lattice.spacing;
    let mut lines = ContourLines {
        positions: Vec::new(),
        offsets: vec![0],
        levels: Vec::with_capacity(contours.len()),
        index: Vec::with_capacity(contours.len()),
        has_z: heights.is_some() || plane != 0.0,
    };
    for contour in &contours {
        for vertex in &contour.vertices {
            // The vertex is in the index space of the cell centres: the centre of cell `(i, j)` is at `((i + 0.5) dx, (j + 0.5) dy)` in the lattice's own
            // axes, which the lattice puts in the world.
            let world = lattice.local_to_world([(vertex.x + 0.5) * dx, (vertex.y + 0.5) * dy, 0.0]);
            let z = if heights.is_some() { vertex.z } else { plane };
            lines.positions.extend([world[0], world[1], z]);
        }
        lines
            .offsets
            .push(u32::try_from(lines.positions.len() / 3).map_err(|_| ContourError::NoLines)?);
        lines
            .levels
            .push(levels.height(contour.level).unwrap_or(f64::NAN));
        lines.index.push(levels.is_index(contour.level));
    }
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    use karmania_core::{Grid, Lattice, Validity, validate};

    fn params(interval: f64, base: f64) -> ContourParams {
        ContourParams {
            column: Some("value".to_string()),
            interval,
            base,
            index_every: 5,
        }
    }

    fn grid_with(lattice: Lattice, z: GridZ, columns: Vec<Column>) -> Dataset {
        let attributes = Table::from_columns(columns, &mut Findings::new()).unwrap();
        Dataset::new(
            DatasetId(1),
            "Surface",
            Some(CrsRef::Epsg { code: 32640 }),
            Geometry::Grid(Grid { lattice, z }),
            attributes,
        )
    }

    fn lattice(nx: u32, ny: u32) -> Lattice {
        Lattice {
            origin: [1000.0, 2000.0, 0.0],
            spacing: [10.0, 5.0, 1.0],
            dims: [nx, ny, 1],
            rotation: 0.0,
        }
    }

    fn floats(name: &str, nx: u32, ny: u32, f: impl Fn(f64, f64) -> f64) -> Column {
        let data: Vec<f64> = (0..ny)
            .flat_map(|j| (0..nx).map(move |i| (i, j)))
            .map(|(i, j)| f(f64::from(i), f64::from(j)))
            .collect();
        Column::without_nulls(name, ColumnData::Float64(data))
    }

    fn vertices(lines: &ContourLines, line: usize) -> Vec<[f64; 3]> {
        let range = lines.offsets[line] as usize..lines.offsets[line + 1] as usize;
        range
            .map(|v| {
                [
                    lines.positions[3 * v],
                    lines.positions[3 * v + 1],
                    lines.positions[3 * v + 2],
                ]
            })
            .collect()
    }

    #[test]
    fn a_grid_gives_lines_where_its_cells_are_with_the_level_and_the_index_of_each() {
        let dataset = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 0.0 },
            vec![floats("value", 10, 6, |i, _| i)],
        );
        let lines = contour_grid(
            &dataset,
            &ContourParams {
                index_every: 2,
                ..params(2.0, 0.0)
            },
        )
        .unwrap();
        // The values 0 to 9 in steps of 2: levels 2, 4, 6 and 8 have lines (0 has every value at or above it); counted from 0, 4 and 8 are index lines.
        assert_eq!(lines.levels, [2.0, 4.0, 6.0, 8.0]);
        assert_eq!(lines.index, [false, true, false, true]);
        assert_eq!(lines.offsets.len(), 5);
        assert!(!lines.has_z);
        for (line, level) in lines.levels.iter().enumerate() {
            let points = vertices(&lines, line);
            assert_eq!(points.len(), 6, "one vertex for each row of cell centres");
            // The level `L` of values `i` is at index `L`, which is `(L + 0.5) * 10` from the origin across; the rows are `(j + 0.5) * 5` up.
            assert!(
                points
                    .iter()
                    .all(|p| (p[0] - (1000.0 + (level + 0.5) * 10.0)).abs() < 1e-9 && p[2] == 0.0)
            );
            let mut ys: Vec<f64> = points.iter().map(|p| p[1]).collect();
            ys.sort_by(f64::total_cmp);
            assert_eq!(ys, [2002.5, 2007.5, 2012.5, 2017.5, 2022.5, 2027.5]);
        }
    }

    #[test]
    fn a_rotated_lattice_puts_the_lines_where_it_puts_its_cells() {
        let mut turned = lattice(10, 6);
        turned.rotation = 30.0;
        let dataset = grid_with(
            turned,
            GridZ::Flat { elevation: 0.0 },
            vec![floats("value", 10, 6, |i, j| i + 0.5 * j)],
        );
        let lines = contour_grid(&dataset, &params(2.0, 0.0)).unwrap();
        assert!(lines.line_count() >= 3);
        // Every vertex is where the lattice puts a point of the index space on an edge: back in the lattice's own axes it is at
        // `((i + 0.5) dx, (j + 0.5) dy)` with a whole number on the edge, and its value there is the level.
        for (line, level) in lines.levels.iter().enumerate() {
            for point in vertices(&lines, line) {
                let (dx, dy) = (point[0] - 1000.0, point[1] - 2000.0);
                let (sin, cos) = 30.0_f64.to_radians().sin_cos();
                let (x, y) = (dx * cos + dy * sin, -dx * sin + dy * cos);
                let (fx, fy) = (x / 10.0 - 0.5, y / 5.0 - 0.5);
                assert!(
                    (fx + 0.5 * fy - level).abs() < 1e-9,
                    "{point:?} is not at {level}"
                );
            }
        }
        // The same grid not turned has the same number of lines at the same levels.
        let plain = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 0.0 },
            vec![floats("value", 10, 6, |i, j| i + 0.5 * j)],
        );
        assert_eq!(
            contour_grid(&plain, &params(2.0, 0.0)).unwrap().levels,
            lines.levels
        );
    }

    #[test]
    fn cells_with_no_value_break_the_lines_and_cells_with_no_height_too() {
        let mut flags = vec![true; 60];
        flags[2 * 10 + 4] = false;
        let data: Vec<f64> = (0..60).map(|k| f64::from(k % 10)).collect();
        let value = Column::new(
            "value",
            ColumnData::Float64(data),
            Validity::from_flags(flags),
        )
        .unwrap();
        let dataset = grid_with(lattice(10, 6), GridZ::Flat { elevation: 0.0 }, vec![value]);
        let lines = contour_grid(&dataset, &params(2.0, 0.0)).unwrap();
        // The line at 4 is cut by the hole, which is a corner of the squares it crosses in two rows: two lines at 4 (of 2 and of 3 vertices).
        let at_four: Vec<usize> = (0..lines.line_count())
            .filter(|&l| lines.levels[l] == 4.0)
            .collect();
        assert_eq!(at_four.len(), 2);
        // The height does the same: a cell with no elevation is a cell with no value.
        let mut nulls = vec![true; 60];
        nulls[2 * 10 + 4] = false;
        let z = Column::new(
            "z",
            ColumnData::Float64((0..60).map(f64::from).collect()),
            Validity::from_flags(nulls),
        )
        .unwrap();
        let surface = grid_with(
            lattice(10, 6),
            GridZ::FromColumn {
                name: "z".to_string(),
            },
            vec![floats("value", 10, 6, |i, _| i), z],
        );
        let lines = contour_grid(&surface, &params(2.0, 0.0)).unwrap();
        assert_eq!(
            (0..lines.line_count())
                .filter(|&l| lines.levels[l] == 4.0)
                .count(),
            2
        );
    }

    #[test]
    fn the_height_of_a_vertex_is_the_elevation_of_the_plane_or_the_interpolated_elevation_column() {
        let flat = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 7.5 },
            vec![floats("value", 10, 6, |i, _| i)],
        );
        let lines = contour_grid(&flat, &params(2.0, 0.0)).unwrap();
        assert!(lines.positions.chunks(3).all(|p| p[2] == 7.5));
        assert!(lines.has_z);
        let surface = grid_with(
            lattice(10, 6),
            GridZ::FromColumn {
                name: "z".to_string(),
            },
            vec![
                floats("value", 10, 6, |i, _| i),
                floats("z", 10, 6, |i, _| 10.0 * i),
            ],
        );
        let lines = contour_grid(&surface, &params(2.0, 0.0)).unwrap();
        assert!(lines.has_z);
        for (line, level) in lines.levels.iter().enumerate() {
            assert!(
                vertices(&lines, line)
                    .iter()
                    .all(|p| (p[2] - 10.0 * level).abs() < 1e-9)
            );
        }
        // The elevation of a column that is not the one contoured: the lines are where the values say, at the height there.
        let other = grid_with(
            lattice(10, 6),
            GridZ::FromColumn {
                name: "z".to_string(),
            },
            vec![
                floats("value", 10, 6, |_, j| j),
                floats("z", 10, 6, |i, _| i),
            ],
        );
        let lines = contour_grid(&other, &params(2.0, 0.0)).unwrap();
        assert!(lines.levels.iter().all(|&l| l > 0.0));
        let all: Vec<f64> = lines.positions.chunks(3).map(|p| p[2]).collect();
        assert!(all.iter().any(|&z| z > 0.0) && all.iter().all(|&z| (0.0..=9.0).contains(&z)));
    }

    #[test]
    fn the_column_is_the_one_named_or_the_first_of_numbers_and_says_why_it_is_not_one() {
        let text = Column::without_nulls("rock", ColumnData::Utf8(vec!["granite".to_string(); 60]));
        let integers = Column::without_nulls(
            "count",
            ColumnData::Int64((0..60).map(|k| k % 10).collect()),
        );
        let dataset = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 0.0 },
            vec![text, integers, floats("value", 10, 6, |_, j| j)],
        );
        let by = |column: Option<&str>| {
            contour_grid(
                &dataset,
                &ContourParams {
                    column: column.map(str::to_string),
                    ..params(2.0, 0.0)
                },
            )
        };
        // None named: the first of numbers, which is `count` (integers are numbers).
        assert_eq!(by(None).unwrap().levels, [2.0, 4.0, 6.0, 8.0]);
        assert_eq!(by(Some("count")).unwrap().levels, [2.0, 4.0, 6.0, 8.0]);
        assert_eq!(by(Some("value")).unwrap().levels, [2.0, 4.0]);
        assert_eq!(
            by(Some("nope")),
            Err(ContourError::ColumnMissing("nope".to_string()))
        );
        assert_eq!(
            by(Some("rock")),
            Err(ContourError::ColumnNotNumeric {
                name: "rock".to_string(),
                column_type: ColumnType::Utf8
            })
        );
        let only_text = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 0.0 },
            vec![Column::without_nulls(
                "rock",
                ColumnData::Utf8(vec![String::new(); 60]),
            )],
        );
        assert_eq!(
            contour_grid(
                &only_text,
                &ContourParams {
                    column: None,
                    ..params(2.0, 0.0)
                }
            ),
            Err(ContourError::NoNumericColumn)
        );
        let empty = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 0.0 },
            vec![
                Column::new(
                    "value",
                    ColumnData::Float64(vec![0.0; 60]),
                    Validity::from_flags(vec![false; 60]),
                )
                .unwrap(),
            ],
        );
        assert_eq!(
            contour_grid(&empty, &params(2.0, 0.0)),
            Err(ContourError::NoValues("value".to_string()))
        );
    }

    #[test]
    fn only_the_first_layer_of_a_grid_of_layers_is_contoured() {
        let mut layered = lattice(10, 6);
        layered.dims = [10, 6, 2];
        let data: Vec<f64> = (0..120)
            .map(|k| if k < 60 { f64::from(k % 10) } else { 100.0 })
            .collect();
        let dataset = grid_with(
            layered,
            GridZ::Flat { elevation: 0.0 },
            vec![Column::without_nulls("value", ColumnData::Float64(data))],
        );
        assert_eq!(
            contour_grid(&dataset, &params(2.0, 0.0)).unwrap().levels,
            [2.0, 4.0, 6.0, 8.0]
        );
    }

    #[test]
    fn a_dataset_that_is_not_a_grid_and_settings_that_make_no_lines_say_why() {
        let points = crate::testutil::points(
            Some(CrsRef::Epsg { code: 32640 }),
            &[(0.0, 0.0), (1.0, 1.0)],
        );
        assert_eq!(
            contour_grid(&points, &params(2.0, 0.0)),
            Err(ContourError::Kind(Kind::Points))
        );
        let dataset = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 0.0 },
            vec![floats("value", 10, 6, |i, _| i)],
        );
        assert_eq!(
            contour_grid(&dataset, &params(0.0, 0.0)),
            Err(ContourError::Levels(LevelsError::Invalid))
        );
        assert!(matches!(
            contour_grid(&dataset, &params(0.001, 0.0)),
            Err(ContourError::Levels(LevelsError::TooMany { .. }))
        ));
        // A grid that is all at one value that is the level: no value is below it, so nothing crosses.
        let flat = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 0.0 },
            vec![floats("value", 10, 6, |_, _| 5.0)],
        );
        assert_eq!(
            contour_grid(&flat, &params(5.0, 0.0)),
            Err(ContourError::NoLines)
        );
    }

    #[test]
    fn the_lines_are_a_dataset_of_lines_with_the_level_and_index_columns_that_is_valid() {
        let dataset = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 0.0 },
            vec![floats("value", 10, 6, |i, _| i)],
        );
        let lines = contour_grid(
            &dataset,
            &ContourParams {
                index_every: 2,
                ..params(2.0, 0.0)
            },
        )
        .unwrap();
        let count = lines.line_count();
        let made = lines
            .into_dataset(contours_name("Surface", 2.0), dataset.crs)
            .unwrap();
        assert_eq!(made.name, "Contours of Surface (every 2)");
        assert_eq!(made.crs, dataset.crs);
        assert_eq!(made.kind(), Kind::Lines);
        assert_eq!(made.attributes.row_count(), count);
        let level = made.attributes.column("level").unwrap();
        assert_eq!(level.column_type(), ColumnType::Float64);
        assert_eq!(level.get(1), Some(Value::Float64(4.0)));
        assert_eq!(
            made.attributes.column("index").unwrap().get(1),
            Some(Value::Bool(true))
        );
        assert_eq!(
            made.attributes.column("index").unwrap().get(0),
            Some(Value::Bool(false))
        );
        let report = validate(&made);
        assert!(
            report
                .findings()
                .all(|f| f.severity != karmania_core::Severity::Error),
            "{:?}",
            report.findings().collect::<Vec<_>>()
        );
        assert_eq!(contours_name("a", 0.5), "Contours of a (every 0.5)");
    }

    #[test]
    fn settings_have_their_names_in_json() {
        let json = serde_json::to_string(&ContourParams {
            column: None,
            interval: 2.5,
            base: 0.0,
            index_every: 5,
        })
        .unwrap();
        assert_eq!(json, r#"{"interval":2.5,"base":0.0,"indexEvery":5}"#);
        let read: ContourParams =
            serde_json::from_str(r#"{"column":"z","interval":1,"base":0.5,"indexEvery":4}"#)
                .unwrap();
        assert_eq!(
            read,
            ContourParams {
                column: Some("z".to_string()),
                interval: 1.0,
                base: 0.5,
                index_every: 4
            }
        );
    }
}
