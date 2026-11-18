//! Contour lines of a dataset (brief 11.5): of a grid, and of a mesh, as lines with the level of each and whether it is an index line.
//!
//! A grid is contoured by the values of one column at the centres of its cells, in its first layer (the others are not drawn either); the lines
//! are put where the lattice puts its cells, rotation included, at the height that the grid has there: the interpolated height of its elevation
//! column, or the elevation of its plane. A cell with no value, or with no height, breaks the lines that would pass it. A mesh is contoured
//! by the heights of its vertices, in its own coordinates; the lines are at their level exactly.

use crate::contour_grid::{Contour, Field, Vertex, contour_field};
use crate::contour_levels::{Levels, LevelsError, MAX_LEVELS, default_interval};
use crate::contour_mesh::{Surface, contour_surface};
pub use karmania_core::ContourParams;
use karmania_core::text::format_count;
use karmania_core::{
    Column, ColumnData, ColumnType, CrsRef, Dataset, DatasetId, Finding, FindingCode, Findings,
    Geometry, GridZ, Kind, Lattice, Lines, Mesh, Positions, Table, Value,
};

/// Every this many lines is an index line unless the settings say otherwise.
pub const DEFAULT_INDEX_EVERY: u32 = 5;

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
    /// A mesh has no heights: its vertices have no Z, or no triangle that can be used has a finite one.
    NoHeights,
    /// The settings do not make levels.
    Levels(LevelsError),
    /// There is no line to draw: no level is crossed by the values.
    NoLines,
}

impl ContourError {
    /// The finding that says why no contours were made, in words for a person (documented in `docs/validation-codes.md`).
    #[must_use]
    pub fn finding(&self) -> Finding {
        let (code, message, hint) = match self {
            Self::Kind(kind) => (
                FindingCode::ContoursKindUnsupported,
                format!(
                    "Contour lines can only be made from a grid or a mesh, and this dataset is made of {}.",
                    match kind {
                        Kind::Points => "points",
                        Kind::Lines => "lines",
                        Kind::Polygons => "polygons",
                        Kind::Blocks => "blocks",
                        Kind::Grid => "a grid",
                        Kind::Mesh => "a mesh",
                    }
                ),
                "Make contour lines from a grid or a mesh.",
            ),
            Self::ColumnMissing(name) => (
                FindingCode::ContoursColumnMissing,
                format!("The dataset has no column named {name}, so contour lines cannot be made from it."),
                "Make contour lines from a column the dataset has.",
            ),
            Self::ColumnNotNumeric { name, column_type } => (
                FindingCode::ContoursColumnNotNumeric,
                format!(
                    "The column {name} is {}, not numbers, so contour lines cannot be made from it.",
                    match column_type {
                        ColumnType::Utf8 => "text",
                        ColumnType::Bool => "true or false",
                        _ => "categories",
                    }
                ),
                "Make contour lines from a column of numbers.",
            ),
            Self::NoNumericColumn => (
                FindingCode::ContoursColumnNoNumbers,
                "The dataset has no column of numbers to make contour lines from.".to_string(),
                "Add a column of numbers, such as heights, and make contour lines from it.",
            ),
            Self::NoValues(name) => (
                FindingCode::ContoursColumnNoValues,
                format!("The column {name} has no value that contour lines can be made from: every entry is empty or not a number."),
                "Make contour lines from another column.",
            ),
            Self::NoHeights => (
                FindingCode::ContoursHeightsNone,
                "The mesh has no heights to make contour lines from: none of its points has a height that is a number.".to_string(),
                "Make contour lines from a mesh whose points have heights, or from a grid.",
            ),
            Self::Levels(LevelsError::TooFar) => (
                FindingCode::ContoursBaseTooFar,
                "The values are too many intervals away from the base for the contour lines to be worked out.".to_string(),
                "Set the base near the values, or use a larger interval.",
            ),
            Self::Levels(LevelsError::Invalid) => (
                FindingCode::ContoursIntervalInvalid,
                "The settings of the contour lines cannot be used: the interval must be a number above 0, the base must be a number, and an index line must come every 1 line or more.".to_string(),
                "Give an interval above 0 and a number for the base, and let an index line come every 1 line or more.",
            ),
            Self::Levels(LevelsError::TooMany { count }) => (
                FindingCode::ContoursLevelsTooMany,
                format!(
                    "These settings make about {} contour lines, and the most is {}.",
                    format_count(*count),
                    format_count(MAX_LEVELS as u64)
                ),
                "Use a larger interval.",
            ),
            Self::Levels(LevelsError::NoRange) | Self::NoLines => (
                FindingCode::ContoursLevelsNone,
                "No contour line was made, because the values never cross a level of these settings.".to_string(),
                "Try a smaller interval, or another base.",
            ),
        };
        Finding::new(code, message).with_hint(hint)
    }
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

/// What a grid is contoured from: the values of one column for the cells of its first layer, and the heights of the cells.
pub(crate) struct GridValues {
    across: usize,
    up: usize,
    /// The name of the column of the values.
    pub(crate) column: String,
    /// The value of each cell, `NaN` for a cell with none (no value, or no height).
    values: Vec<f64>,
    /// The height of each cell if the grid has an elevation column.
    pub(crate) heights: Option<Vec<f64>>,
    /// The elevation of a grid that has no elevation column: 0 if it has none that is a number.
    pub(crate) plane: f64,
}

impl GridValues {
    pub(crate) fn of(dataset: &Dataset, column: Option<&str>) -> Result<Self, ContourError> {
        let Geometry::Grid(grid) = &dataset.geometry else {
            return Err(ContourError::Kind(dataset.kind()));
        };
        let [nx, ny, _] = grid.lattice.dims;
        let (across, up) = (
            usize::try_from(nx).unwrap_or(usize::MAX),
            usize::try_from(ny).unwrap_or(usize::MAX),
        );
        let cells = across.checked_mul(up).ok_or(ContourError::NoLines)?;
        let column = column_for(dataset, column)?;
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
        Ok(Self {
            across,
            up,
            column: column.name().to_string(),
            values,
            heights,
            plane,
        })
    }

    pub(crate) fn field(&self) -> Result<Field<'_>, ContourError> {
        let field = Field::new(self.across, self.up, &self.values).ok_or(ContourError::NoLines)?;
        match &self.heights {
            Some(heights) => field.with_heights(heights).ok_or(ContourError::NoLines),
            None => Ok(field),
        }
    }

    /// The lowest and the highest value of the cells that have one.
    pub(crate) fn range(&self, field: &Field<'_>) -> Result<(f64, f64), ContourError> {
        field
            .range()
            .ok_or_else(|| ContourError::NoValues(self.column.clone()))
    }
}

/// The surface of a mesh and the lowest and the highest height of its triangles.
pub(crate) fn surface_of(mesh: &Mesh) -> Result<(Surface<'_>, f64, f64), ContourError> {
    if !mesh.positions.has_z() {
        return Err(ContourError::NoHeights);
    }
    let surface =
        Surface::new(mesh.positions.as_slice(), &mesh.indices).ok_or(ContourError::NoLines)?;
    let (low, high) = surface.range().ok_or(ContourError::NoHeights)?;
    Ok((surface, low, high))
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
    let input = GridValues::of(dataset, params.column.as_deref())?;
    let field = input.field()?;
    let (low, high) = input.range(&field)?;
    let levels = Levels::for_range(low, high, params.base, params.interval, params.index_every)
        .map_err(ContourError::Levels)?;
    let contours = contour_field(&field, &levels);
    let (has_heights, plane) = (input.heights.is_some(), input.plane);
    lines_of(
        &contours,
        &levels,
        has_heights || plane != 0.0,
        grid_places(lattice, has_heights, plane),
    )
}

/// Where a vertex of a grid's contours is in the world: a vertex of the index space `(x, y)` is at `((x + 0.5) dx, (y + 0.5) dy)` in the
/// lattice's own axes (the centre of cell `(i, j)` is at `((i + 0.5) dx, (j + 0.5) dy)`), which the lattice puts in the world; its height is
/// its own if the grid has an elevation column and the elevation of the plane if it has not.
pub(crate) fn grid_places(
    lattice: &Lattice,
    has_heights: bool,
    plane: f64,
) -> impl Fn(&Vertex) -> [f64; 3] + '_ {
    let [dx, dy, _] = lattice.spacing;
    move |vertex: &Vertex| {
        let world = lattice.local_to_world([(vertex.x + 0.5) * dx, (vertex.y + 0.5) * dy, 0.0]);
        [
            world[0],
            world[1],
            if has_heights { vertex.z } else { plane },
        ]
    }
}

/// The contour lines of a mesh by the heights of its vertices: the settings' `column` is not used (a mesh has one height). The lines
/// are in the coordinates of the mesh, and at their level.
///
/// # Errors
///
/// [`ContourError::Kind`] for a dataset that is not a mesh, [`ContourError::NoHeights`] for a mesh without Z or with no finite one,
/// [`ContourError::Levels`] for settings that make no levels or too many, and [`ContourError::NoLines`] when no level crosses it.
pub fn contour_mesh(
    dataset: &Dataset,
    params: &ContourParams,
) -> Result<ContourLines, ContourError> {
    let Geometry::Mesh(mesh) = &dataset.geometry else {
        return Err(ContourError::Kind(dataset.kind()));
    };
    let (surface, low, high) = surface_of(mesh)?;
    let levels = Levels::for_range(low, high, params.base, params.interval, params.index_every)
        .map_err(ContourError::Levels)?;
    let contours = contour_surface(&surface, &levels);
    lines_of(&contours, &levels, true, |vertex| {
        [vertex.x, vertex.y, vertex.z]
    })
}

/// The settings that a set of contours starts with (brief 11.5): the column (a grid's: the one named, or its first of numbers; a mesh
/// has none), the default interval for the range of the values, a base of 0 (the multiple of the interval below the values if they are too many intervals
/// from 0 for levels to be counted), and an index line every 5.
///
/// # Errors
///
/// [`ContourError::Kind`] for a dataset that is not a grid or a mesh, the errors of the column or the heights as in
/// [`contour_grid`] and [`contour_mesh`], and [`ContourError::NoLines`] when the values are all one number (no interval makes a line).
pub fn default_params(
    dataset: &Dataset,
    column: Option<&str>,
) -> Result<ContourParams, ContourError> {
    let (column, low, high) = match &dataset.geometry {
        Geometry::Grid(_) => {
            let input = GridValues::of(dataset, column)?;
            let (low, high) = input.range(&input.field()?)?;
            (Some(input.column), low, high)
        }
        Geometry::Mesh(mesh) => {
            let (_, low, high) = surface_of(mesh)?;
            (None, low, high)
        }
        other => return Err(ContourError::Kind(other.kind())),
    };
    let interval = default_interval(low, high).ok_or(ContourError::NoLines)?;
    // A base of 0, unless the values are so many intervals from it that no level can be counted (a thousand million: values of ten thousand million
    // with an interval of 1): then the multiple of the interval at or below the lowest value, so that the settings that are offered work.
    let base = match Levels::for_range(low, high, 0.0, interval, DEFAULT_INDEX_EVERY) {
        Err(LevelsError::TooFar) => {
            let near = (low / interval).floor() * interval;
            if near.is_finite() { near } else { 0.0 }
        }
        _ => 0.0,
    };
    Ok(ContourParams {
        column,
        interval,
        base,
        index_every: DEFAULT_INDEX_EVERY,
    })
}

/// The contour lines of a dataset that is a grid or a mesh.
///
/// # Errors
///
/// [`ContourError::Kind`] for any other dataset, and those of [`contour_grid`] and [`contour_mesh`].
pub fn contours_of(
    dataset: &Dataset,
    params: &ContourParams,
) -> Result<ContourLines, ContourError> {
    match dataset.kind() {
        Kind::Grid => contour_grid(dataset, params),
        Kind::Mesh => contour_mesh(dataset, params),
        other => Err(ContourError::Kind(other)),
    }
}

/// The lines as vertices in the world, with the level of each and whether it is an index line; `place` puts a vertex of the kernel.
pub(crate) fn lines_of(
    contours: &[Contour],
    levels: &Levels,
    has_z: bool,
    place: impl Fn(&Vertex) -> [f64; 3],
) -> Result<ContourLines, ContourError> {
    if contours.is_empty() {
        return Err(ContourError::NoLines);
    }
    let mut lines = ContourLines {
        positions: Vec::new(),
        offsets: vec![0],
        levels: Vec::with_capacity(contours.len()),
        index: Vec::with_capacity(contours.len()),
        has_z,
    };
    for contour in contours {
        for vertex in &contour.vertices {
            lines.positions.extend(place(vertex));
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
    use karmania_core::{Grid, Lattice, Mesh, Validity, validate};

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

    /// A mesh of `nx` by `ny` vertices at 10 by 5 apart from (1000, 2000) with the height `f(i, j)`, two triangles to a square.
    fn mesh_with(nx: usize, ny: usize, has_z: bool, f: impl Fn(f64, f64) -> f64) -> Dataset {
        let mut xyz = Vec::new();
        for j in 0..ny {
            for i in 0..nx {
                let (i, j) = (i as f64, j as f64);
                xyz.extend([1000.0 + 10.0 * i, 2000.0 + 5.0 * j, f(i, j)]);
            }
        }
        let at = |i: usize, j: usize| u32::try_from(j * nx + i).unwrap();
        let mut indices = Vec::new();
        for j in 0..ny - 1 {
            for i in 0..nx - 1 {
                indices.extend([at(i, j), at(i + 1, j), at(i + 1, j + 1)]);
                indices.extend([at(i, j), at(i + 1, j + 1), at(i, j + 1)]);
            }
        }
        Dataset::new(
            DatasetId(2),
            "Pit",
            Some(CrsRef::Epsg { code: 32640 }),
            Geometry::Mesh(Mesh {
                positions: Positions::from_interleaved(xyz, has_z),
                indices,
            }),
            Table::empty(),
        )
    }

    #[test]
    fn a_mesh_gives_lines_in_its_own_coordinates_at_their_level_with_the_index_of_each() {
        let dataset = mesh_with(6, 4, true, |i, _| 3.0 * i);
        let lines = contour_mesh(
            &dataset,
            &ContourParams {
                index_every: 2,
                ..params(6.0, 0.0)
            },
        )
        .unwrap();
        // Heights 0 to 15 in steps of 6: 6 and 12 have lines; counted from 0, 12 is an index line.
        assert_eq!(lines.levels, [6.0, 12.0]);
        assert_eq!(lines.index, [false, true]);
        assert!(lines.has_z);
        for (line, level) in lines.levels.iter().enumerate() {
            let points = vertices(&lines, line);
            // The height `3 i` is the level at `i = level / 3`, which is `1000 + 10 i` across.
            assert!(
                points
                    .iter()
                    .all(|p| (p[0] - (1000.0 + 10.0 * level / 3.0)).abs() < 1e-9 && p[2] == *level)
            );
            let ys: Vec<f64> = points.iter().map(|p| p[1]).collect();
            assert!(ys.iter().all(|y| (2000.0..=2015.0).contains(y)));
            assert_eq!(
                (
                    ys.iter().copied().fold(f64::INFINITY, f64::min),
                    ys.iter().copied().fold(f64::NEG_INFINITY, f64::max)
                ),
                (2000.0, 2015.0)
            );
        }
        // The column of the settings is for grids: a mesh has one height.
        let named = ContourParams {
            column: Some("nope".to_string()),
            ..params(6.0, 0.0)
        };
        assert_eq!(contour_mesh(&dataset, &named).unwrap().levels, [6.0, 12.0]);
    }

    #[test]
    fn a_mesh_with_no_heights_and_settings_or_data_that_make_no_lines_say_why() {
        assert_eq!(
            contour_mesh(&mesh_with(6, 4, false, |_, _| 0.0), &params(6.0, 0.0)),
            Err(ContourError::NoHeights)
        );
        assert_eq!(
            contour_mesh(&mesh_with(6, 4, true, |_, _| f64::NAN), &params(6.0, 0.0)),
            Err(ContourError::NoHeights)
        );
        let tilted = mesh_with(6, 4, true, |i, _| 3.0 * i);
        assert_eq!(
            contour_mesh(&tilted, &params(0.0, 0.0)),
            Err(ContourError::Levels(LevelsError::Invalid))
        );
        assert!(matches!(
            contour_mesh(&tilted, &params(0.001, 0.0)),
            Err(ContourError::Levels(LevelsError::TooMany { .. }))
        ));
        assert_eq!(
            contour_mesh(&mesh_with(6, 4, true, |_, _| 5.0), &params(5.0, 0.0)),
            Err(ContourError::NoLines)
        );
    }

    #[test]
    fn one_entry_point_takes_a_grid_or_a_mesh_and_says_so_of_any_other_dataset() {
        let grid = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 0.0 },
            vec![floats("value", 10, 6, |i, _| i)],
        );
        let mesh = mesh_with(6, 4, true, |i, _| 3.0 * i);
        let points = crate::testutil::points(
            Some(CrsRef::Epsg { code: 32640 }),
            &[(0.0, 0.0), (1.0, 1.0)],
        );
        assert_eq!(
            contours_of(&grid, &params(2.0, 0.0)),
            contour_grid(&grid, &params(2.0, 0.0))
        );
        assert_eq!(
            contours_of(&mesh, &params(6.0, 0.0)),
            contour_mesh(&mesh, &params(6.0, 0.0))
        );
        assert!(
            contours_of(&mesh, &params(6.0, 0.0)).is_ok()
                && contours_of(&grid, &params(2.0, 0.0)).is_ok()
        );
        assert_eq!(
            contours_of(&points, &params(2.0, 0.0)),
            Err(ContourError::Kind(Kind::Points))
        );
        // Each of the two says what it is given when it is given the other.
        assert_eq!(
            contour_grid(&mesh, &params(6.0, 0.0)),
            Err(ContourError::Kind(Kind::Mesh))
        );
        assert_eq!(
            contour_mesh(&grid, &params(2.0, 0.0)),
            Err(ContourError::Kind(Kind::Grid))
        );
    }

    #[test]
    fn the_lines_of_a_mesh_are_a_valid_dataset_in_its_system() {
        let mesh = mesh_with(6, 4, true, |i, _| 3.0 * i);
        let lines = contour_mesh(&mesh, &params(6.0, 0.0)).unwrap();
        let made = lines
            .into_dataset(contours_name("Pit", 6.0), mesh.crs)
            .unwrap();
        assert_eq!(
            (made.name.as_str(), made.crs, made.kind()),
            ("Contours of Pit (every 6)", mesh.crs, Kind::Lines)
        );
        assert!(made.has_z());
        assert_eq!(made.attributes.row_count(), 2);
        let report = validate(&made);
        assert!(
            report
                .findings()
                .all(|f| f.severity != karmania_core::Severity::Error),
            "{:?}",
            report.findings().collect::<Vec<_>>()
        );
    }

    const DOCS: &str = include_str!("../../../docs/validation-codes.md");

    /// A reason for no contours, the code of its finding, and the values of the names in the documented message.
    type Case<'a> = (ContourError, &'a str, &'a [(&'a str, &'a str)]);

    /// A field of the documented finding of a code (`Message` or `Hint`), with its `{name}`s still in it.
    fn documented(code: &str, field: &str) -> String {
        let section = DOCS
            .split("\n## `")
            .find(|section| section.starts_with(&format!("{code}`")))
            .unwrap_or_else(|| panic!("{code} is not in docs/validation-codes.md"));
        section
            .lines()
            .find_map(|line| line.strip_prefix(&format!("- {field}: ")))
            .unwrap_or_else(|| panic!("{code} has no {field}"))
            .to_string()
    }

    #[test]
    fn every_reason_for_no_contours_is_a_finding_that_says_what_the_docs_say() {
        let cases: [Case; 12] = [
            (
                ContourError::Kind(Kind::Points),
                "contours.kind.unsupported",
                &[("{shape}", "points")],
            ),
            (
                ContourError::Kind(Kind::Blocks),
                "contours.kind.unsupported",
                &[("{shape}", "blocks")],
            ),
            (
                ContourError::ColumnMissing("elevation".into()),
                "contours.column.missing",
                &[("{name}", "elevation")],
            ),
            (
                ContourError::ColumnNotNumeric {
                    name: "rock".into(),
                    column_type: ColumnType::Utf8,
                },
                "contours.column.not_numeric",
                &[("{name}", "rock"), ("{type}", "text")],
            ),
            (
                ContourError::ColumnNotNumeric {
                    name: "ok".into(),
                    column_type: ColumnType::Bool,
                },
                "contours.column.not_numeric",
                &[("{name}", "ok"), ("{type}", "true or false")],
            ),
            (
                ContourError::NoNumericColumn,
                "contours.column.no_numbers",
                &[],
            ),
            (
                ContourError::NoValues("elevation".into()),
                "contours.column.no_values",
                &[("{name}", "elevation")],
            ),
            (ContourError::NoHeights, "contours.heights.none", &[]),
            (
                ContourError::Levels(LevelsError::Invalid),
                "contours.interval.invalid",
                &[],
            ),
            (
                ContourError::Levels(LevelsError::TooFar),
                "contours.base.too_far",
                &[],
            ),
            (
                ContourError::Levels(LevelsError::TooMany { count: 12_500 }),
                "contours.levels.too_many",
                &[("{count}", "12,500"), ("{limit}", "1,000")],
            ),
            (ContourError::NoLines, "contours.levels.none", &[]),
        ];
        for (error, code, fills) in cases {
            let finding = error.finding();
            assert_eq!(finding.code.as_str(), code);
            let mut template = documented(code, "Message");
            for (name, value) in fills {
                template = template.replace(name, value);
            }
            assert!(
                !template.contains('{'),
                "{code}: a name is not filled: {template}"
            );
            assert_eq!(finding.message, template, "{code}");
            assert_eq!(
                finding.hint.as_deref(),
                Some(documented(code, "Hint").as_str()),
                "{code}"
            );
        }
        // The two reasons that are one thing to a person say the same, and a range that cannot be one is not a matter of the interval.
        assert_eq!(
            ContourError::Levels(LevelsError::NoRange).finding(),
            ContourError::NoLines.finding()
        );
        // The limit is an error and "no line" is not.
        assert_eq!(
            ContourError::Levels(LevelsError::TooMany { count: 2_000 })
                .finding()
                .severity,
            karmania_core::Severity::Error
        );
        assert_eq!(
            ContourError::NoLines.finding().severity,
            karmania_core::Severity::Warning
        );
        // The finding of a real call: too many levels names how many.
        let dataset = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 0.0 },
            vec![floats("value", 10, 6, |i, _| i)],
        );
        let error = contour_grid(&dataset, &params(0.001, 0.0)).unwrap_err();
        assert_eq!(
            error.finding().message,
            "These settings make about 9,000 contour lines, and the most is 1,000."
        );
    }

    #[test]
    fn the_settings_that_a_set_of_contours_starts_with_are_the_default_interval_a_base_of_0_and_an_index_every_5()
     {
        let grid = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 0.0 },
            vec![
                Column::without_nulls("rock", ColumnData::Utf8(vec![String::new(); 60])),
                floats("value", 10, 6, |i, j| 10.0 * i + j),
            ],
        );
        // The values go from 0 to 95: the largest nice interval that gives ten levels is 5.
        let found = default_params(&grid, None).unwrap();
        assert_eq!(
            found,
            ContourParams {
                column: Some("value".into()),
                interval: 5.0,
                base: 0.0,
                index_every: 5
            }
        );
        assert_eq!(default_params(&grid, Some("value")).unwrap(), found);
        // With the settings it gives, the contours are made, and have 10 to 20 levels.
        let lines = contours_of(&grid, &found).unwrap();
        assert!((10..=20).contains(&lines.levels.len()));
        let mesh = mesh_with(6, 4, true, |i, _| 3.0 * i);
        assert_eq!(
            default_params(&mesh, Some("ignored")).unwrap(),
            ContourParams {
                column: None,
                interval: 1.0,
                base: 0.0,
                index_every: 5
            }
        );
        assert!(contours_of(&mesh, &default_params(&mesh, None).unwrap()).is_ok());
        // What stops it: another shape, a column that cannot be used, a mesh with no heights, and values that are all one number.
        let points = crate::testutil::points(Some(CrsRef::Epsg { code: 32640 }), &[(0.0, 0.0)]);
        assert_eq!(
            default_params(&points, None),
            Err(ContourError::Kind(Kind::Points))
        );
        assert_eq!(
            default_params(&grid, Some("rock")),
            Err(ContourError::ColumnNotNumeric {
                name: "rock".into(),
                column_type: ColumnType::Utf8
            })
        );
        assert_eq!(
            default_params(&grid, Some("nope")),
            Err(ContourError::ColumnMissing("nope".into()))
        );
        assert_eq!(
            default_params(&mesh_with(6, 4, false, |_, _| 0.0), None),
            Err(ContourError::NoHeights)
        );
        assert_eq!(
            default_params(&mesh_with(6, 4, true, |_, _| 7.0), None),
            Err(ContourError::NoLines)
        );
    }

    /// Run when asked for, in release: `cargo test --release -p karmania-prep contours::tests::timing_of_the_grid_of_the_perf_fixture -- --ignored --nocapture`.
    /// The grid of `scripts/generate-fixtures` (2,000 by 2,000 cells, a sawtooth: 64,000 lines and three million vertices at 20 levels), by the phases.
    #[test]
    #[ignore = "a timing, for a machine that is not busy"]
    fn timing_of_the_grid_of_the_perf_fixture() {
        use std::time::Instant;
        let (columns, rows) = (2000_u32, 2000_u32);
        let values: Vec<f64> = (0..rows * columns)
            .map(|cell| {
                let (row, column) = (cell / columns, cell % columns);
                if (cell + 1) % 97 == 0 {
                    f64::NAN
                } else {
                    f64::from((row * 7 + column * 13) % 1000) / 10.0
                }
            })
            .collect();
        let dataset = grid_with(
            Lattice {
                origin: [500_000.0, 2_765_000.0, 0.0],
                spacing: [10.0, 10.0, 1.0],
                dims: [columns, rows, 1],
                rotation: 0.0,
            },
            GridZ::Flat { elevation: 0.0 },
            vec![Column::without_nulls("value", ColumnData::Float64(values))],
        );
        let params = params(5.0, 0.0);
        {
            // The kernel's two parts: the scan of the squares, and the joining of the pieces of each level into lines.
            let input = GridValues::of(&dataset, None).unwrap();
            let field = input.field().unwrap();
            let (low, high) = input.range(&field).unwrap();
            let levels = Levels::for_range(low, high, 0.0, 5.0, 5).unwrap();
            let mut scan = crate::contour_grid::Scan::new(&levels);
            let started = Instant::now();
            scan.scan_rows(&field, &levels, 0..field.ny() - 1);
            let scanned = started.elapsed();
            let started = Instant::now();
            let vertices: usize = (0..levels.len())
                .map(|level| {
                    scan.lines(&field, &levels, level)
                        .iter()
                        .map(|line| line.vertices.len())
                        .sum::<usize>()
                })
                .sum();
            println!(
                "scan {scanned:?} ({} pieces), joined {:?} ({vertices} vertices)",
                scan.piece_count(),
                started.elapsed()
            );
        }
        let started = Instant::now();
        let lines = contours_of(&dataset, &params).unwrap();
        let made = started.elapsed();
        let (count, vertices) = (lines.line_count(), lines.positions.len() / 3);
        let started = Instant::now();
        let made_dataset = lines.into_dataset("Contours", dataset.crs).unwrap();
        let into = started.elapsed();
        let started = Instant::now();
        let report = validate(&made_dataset);
        let checked = started.elapsed();
        let started = Instant::now();
        let summary = made_dataset.summary(Findings::new());
        let summarised = started.elapsed();
        println!(
            "{count} lines, {vertices} vertices: lines {made:?}, dataset {into:?}, validate {checked:?} ({} findings), summary {summarised:?} ({:?})",
            report.findings().count(),
            summary.vertex_count
        );
    }

    #[test]
    fn the_starting_settings_work_for_values_that_are_far_from_0_by_taking_a_base_near_them() {
        // Values from 10,000,000,000 to 10,000,000,009: the default interval is 0.5, and a base of 0 is twenty thousand million intervals away.
        let near = |name: &str| {
            let data: Vec<f64> = (0..60).map(|k| 1.0e10 + f64::from(k % 10)).collect();
            grid_with(
                lattice(10, 6),
                GridZ::Flat { elevation: 0.0 },
                vec![Column::without_nulls(name, ColumnData::Float64(data))],
            )
        };
        let dataset = near("value");
        assert_eq!(
            contours_of(&dataset, &params(0.5, 0.0)),
            Err(ContourError::Levels(LevelsError::TooFar))
        );
        let found = default_params(&dataset, None).unwrap();
        assert_eq!((found.interval, found.base), (0.5, 1.0e10));
        let lines = contours_of(&dataset, &found).unwrap();
        assert!(
            (10..=20).contains(&lines.levels.len()),
            "{:?}",
            lines.levels
        );
        // And a dataset that is not far has a base of 0, as before.
        let plain = grid_with(
            lattice(10, 6),
            GridZ::Flat { elevation: 0.0 },
            vec![floats("value", 10, 6, |i, _| i)],
        );
        assert_eq!(default_params(&plain, None).unwrap().base, 0.0);
    }
}
