//! Render buffers of a grid with elevations from a column: a surface through the cell centres.
//!
//! The only elevations a grid gives are one for each cell, at its centre, so the surface has its
//! vertices there and is drawn linear between them (a triangle is flat). That is for display, and says
//! nothing about the ground between the centres. A cell with no elevation is left out: no triangle
//! uses it.

use karmania_core::{Column, CrsRef, Finding, Lattice, Positions, Value};

use crate::grid::layers_hidden;
use crate::origin::Frame;
use crate::project::{Prepared, project};

/// The buffers of a grid surface.
#[derive(Debug, Clone, PartialEq)]
pub struct SurfaceBuffers {
    /// `x y z` of the centre of every cell of the first layer, in cell order (`i` fastest), relative to the
    /// frame's origin, in map units, so the number of a vertex is the number of its cell. A cell with no
    /// elevation has NaN for its height (and its place as the others), and one that the conversion cannot
    /// place has NaN for its place: a vertex with a coordinate that is not finite is not there, and no
    /// triangle uses it.
    pub positions: Vec<f32>,
    /// Three vertex numbers (cell numbers) per triangle: every square of four neighbouring cell centres is
    /// two triangles, `(i, j) (i + 1, j) (i + 1, j + 1)` and `(i, j) (i + 1, j + 1) (i, j + 1)`, kept when
    /// all three vertices exist.
    pub triangles: Vec<u32>,
    /// For each triangle, the cell it takes its colour from: the one with the lowest number of its three
    /// corners, that is the lowest `j` and then the lowest `i`. The colour of a cell is nearest-neighbour
    /// and a triangle is flat, so a triangle has one cell; a cell at the far edge of the grid is the lowest
    /// corner of no triangle and does not show its colour except through the triangles it is a corner of.
    pub triangle_cell: Vec<u32>,
}

/// The elevation of a cell from the column, if it has one: not null and finite.
fn elevation(column: &Column, cell: usize) -> Option<f64> {
    match column.get(cell)? {
        Value::Float64(v) if v.is_finite() => Some(v),
        Value::Int64(v) => Some(v as f64),
        _ => None,
    }
}

/// Prepares a grid whose elevations come from `elevations` (one value for each cell, in cell order) as a
/// surface in `frame`. Only the first layer is drawn if there are several (`display.grid.layers_hidden`).
/// Heights are not converted: they are drawn as given.
///
/// # Errors
///
/// A `display.crs.not_convertible` finding if `own` cannot be converted to the map's system.
pub fn surface_buffers(
    lattice: &Lattice,
    elevations: &Column,
    own: CrsRef,
    frame: &Frame,
) -> Result<Prepared<SurfaceBuffers>, Finding> {
    let [nx, ny, layers] = lattice.dims;
    let cells = nx as usize * ny as usize;
    let mut xyz = Vec::with_capacity(cells * 3);
    for j in 0..ny {
        for i in 0..nx {
            let cell = j as usize * nx as usize + i as usize;
            let z = elevation(elevations, cell).unwrap_or(f64::NAN);
            let [x, y, _] = lattice.cell_centre(i, j, 0).unwrap_or([f64::NAN; 3]);
            xyz.extend([x, y, z]);
        }
    }
    let mut findings = layers_hidden(layers);
    let positions = project(
        &Positions::from_interleaved(xyz, true),
        own,
        frame,
        &mut findings,
    )?;
    let present = |cell: usize| {
        positions
            .get(cell * 3..cell * 3 + 3)
            .is_some_and(|p| p.iter().all(|c| c.is_finite()))
    };
    let mut triangles = Vec::new();
    let mut triangle_cell = Vec::new();
    for j in 1..ny as usize {
        for i in 1..nx as usize {
            let (v00, v10) = ((j - 1) * nx as usize + i - 1, (j - 1) * nx as usize + i);
            let (v01, v11) = (j * nx as usize + i - 1, j * nx as usize + i);
            for corners in [[v00, v10, v11], [v00, v11, v01]] {
                if corners.iter().all(|&c| present(c)) {
                    let numbers = corners.map(|c| u32::try_from(c).unwrap_or(u32::MAX));
                    triangles.extend(numbers);
                    triangle_cell.push(numbers.iter().copied().min().unwrap_or(0));
                }
            }
        }
    }
    Ok(Prepared {
        buffers: SurfaceBuffers {
            positions,
            triangles,
            triangle_cell,
        },
        findings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::FrameSource;
    use karmania_core::{ColumnData, Validity};

    const UTM40: CrsRef = CrsRef::Epsg { code: 32640 };

    fn frame(origin: [f64; 3]) -> Frame {
        Frame {
            map_crs: UTM40,
            origin,
            source: FrameSource::Auto,
        }
    }

    fn lattice(dims: [u32; 3], rotation: f64) -> Lattice {
        Lattice {
            origin: [1_000.0, 2_000.0, 0.0],
            spacing: [10.0, 20.0, 1.0],
            dims,
            rotation,
        }
    }

    fn column(values: &[f64]) -> Column {
        Column::without_nulls("z", ColumnData::Float64(values.to_vec()))
    }

    #[test]
    fn a_full_grid_is_two_triangles_for_every_square_of_four_centres() {
        let l = lattice([3, 2, 1], 0.0);
        let out = surface_buffers(
            &l,
            &column(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]),
            UTM40,
            &frame([1_000.0, 2_000.0, 1.0]),
        )
        .unwrap();
        let b = &out.buffers;
        // Centres of cells (i, j): (1005 + 10 i, 2010 + 20 j), with the elevation as z.
        assert_eq!(b.positions[..6], [5.0, 10.0, 0.0, 15.0, 10.0, 1.0]);
        assert_eq!(&b.positions[9..12], &[5.0, 30.0, 3.0]);
        assert_eq!(b.triangles, [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
        assert_eq!(b.triangle_cell, [0, 0, 1, 1]);
        assert!(out.findings.is_empty());
    }

    #[test]
    fn a_cell_with_no_elevation_is_left_out_with_every_triangle_that_uses_it() {
        let l = lattice([3, 3, 1], 0.0);
        let mut z = vec![1.0; 9];
        z[4] = f64::NAN;
        let centre = surface_buffers(&l, &column(&z), UTM40, &frame([0.0; 3]))
            .unwrap()
            .buffers;
        assert!(
            centre.positions[12..14].iter().all(|c| c.is_finite()) && centre.positions[14].is_nan()
        );
        assert!(centre.triangles.iter().all(|&v| v != 4));
        assert_eq!(centre.triangles.len() / 3, centre.triangle_cell.len());
        // Each of the four squares has the centre as a corner, and loses the triangles that use it: 8 - 6.
        assert_eq!(centre.triangle_cell.len(), 2);
        // A null, and an integer column.
        let nulls = Column::new(
            "z",
            ColumnData::Float64(vec![1.0; 4]),
            Validity::from_flags([true, false, true, true]),
        )
        .unwrap();
        let out =
            surface_buffers(&lattice([2, 2, 1], 0.0), &nulls, UTM40, &frame([0.0; 3])).unwrap();
        assert_eq!(out.buffers.triangles, [0, 3, 2]);
        let ints = Column::without_nulls("z", ColumnData::Int64(vec![5, 6, 7, 8]));
        let out =
            surface_buffers(&lattice([2, 2, 1], 0.0), &ints, UTM40, &frame([0.0; 3])).unwrap();
        assert_eq!(out.buffers.positions[2], 5.0);
        assert_eq!(out.buffers.triangle_cell, [0, 0]);
    }

    #[test]
    fn the_heights_are_given_not_converted_and_the_centres_are_rotated_and_converted() {
        // Rotated 90 degrees: i runs north, j runs west.
        let l = lattice([2, 2, 1], 90.0);
        let out = surface_buffers(
            &l,
            &column(&[10.0, 20.0, 30.0, 40.0]),
            UTM40,
            &frame([1_000.0, 2_000.0, 0.0]),
        )
        .unwrap();
        let p = &out.buffers.positions;
        assert_eq!(
            &p[0..3],
            &[-10.0, 5.0, 10.0],
            "cell (0, 0): 5 along i and 10 along j, turned"
        );
        assert_eq!(&p[3..6], &[-10.0, 15.0, 20.0], "cell (1, 0): further north");
        // Longitude and latitude: the heights stay, the positions go to the map.
        let f = Lattice {
            origin: [57.0, 25.0, 0.0],
            spacing: [0.1, 0.1, 1.0],
            dims: [2, 2, 1],
            rotation: 0.0,
        };
        let out = surface_buffers(
            &f,
            &column(&[100.0; 4]),
            CrsRef::Epsg { code: 4326 },
            &frame([500_000.0, 2_700_000.0, 0.0]),
        )
        .unwrap();
        assert_eq!(out.buffers.positions[2], 100.0);
        assert!(
            out.buffers.positions[0] > 4_000.0,
            "57.05 E is 0.05 degrees east of the central meridian: about 5 km"
        );
        assert_eq!(out.buffers.triangles.len(), 6);
    }

    #[test]
    fn several_layers_and_an_unconvertible_system() {
        let l = lattice([2, 2, 4], 0.0);
        let out = surface_buffers(&l, &column(&[1.0; 16]), UTM40, &frame([0.0; 3])).unwrap();
        assert_eq!(
            out.findings.as_slice()[0].code.as_str(),
            "display.grid.layers_hidden"
        );
        assert_eq!(out.buffers.positions.len(), 12, "the first layer only");
        let local = CrsRef::Local {
            units: karmania_core::Units::Metre,
        };
        let error = surface_buffers(
            &lattice([2, 2, 1], 0.0),
            &column(&[1.0; 4]),
            local,
            &frame([0.0; 3]),
        )
        .unwrap_err();
        assert_eq!(error.code.as_str(), "display.crs.not_convertible");
        // A column shorter than the grid: the cells it does not reach have no elevation.
        let short = surface_buffers(
            &lattice([2, 2, 1], 0.0),
            &column(&[1.0]),
            UTM40,
            &frame([0.0; 3]),
        )
        .unwrap();
        assert!(short.buffers.triangles.is_empty());
    }
}
