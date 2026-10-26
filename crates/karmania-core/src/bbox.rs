//! Axis-aligned bounding boxes.

use serde::Serialize;

/// An axis-aligned box in the dataset's CRS units, Z up. Always built from
/// finite coordinates, so `min <= max` on every axis.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct BBox {
    /// The smallest `[x, y, z]` of the box.
    pub min: [f64; 3],
    /// The largest `[x, y, z]` of the box.
    pub max: [f64; 3],
}

impl BBox {
    /// The smallest box containing every point whose three coordinates are all
    /// finite. Points with a NaN or infinite coordinate are skipped (validation
    /// reports them). `None` if no point is finite.
    pub fn from_points(points: impl IntoIterator<Item = [f64; 3]>) -> Option<Self> {
        let mut bbox: Option<BBox> = None;
        for point in points {
            if !point.iter().all(|c| c.is_finite()) {
                continue;
            }
            match &mut bbox {
                None => {
                    bbox = Some(BBox {
                        min: point,
                        max: point,
                    });
                }
                Some(b) => {
                    for ((lo, hi), c) in b.min.iter_mut().zip(b.max.iter_mut()).zip(point) {
                        *lo = lo.min(c);
                        *hi = hi.max(c);
                    }
                }
            }
        }
        bbox
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_box_spans_every_finite_point() {
        let b = BBox::from_points([[1.0, -2.0, 3.0], [-4.0, 5.0, 0.5], [0.0, 0.0, 9.0]]).unwrap();
        assert_eq!(b.min, [-4.0, -2.0, 0.5]);
        assert_eq!(b.max, [1.0, 5.0, 9.0]);
    }

    #[test]
    fn one_point_makes_a_zero_size_box() {
        let b = BBox::from_points([[7.0, 8.0, 9.0]]).unwrap();
        assert_eq!((b.min, b.max), ([7.0, 8.0, 9.0], [7.0, 8.0, 9.0]));
    }

    #[test]
    fn points_with_a_non_finite_coordinate_are_skipped() {
        let points = [
            [f64::NAN, 0.0, 0.0],
            [1.0, 2.0, 3.0],
            [0.0, f64::INFINITY, 0.0],
            [0.0, 0.0, f64::NEG_INFINITY],
            [5.0, 6.0, 7.0],
        ];
        let b = BBox::from_points(points).unwrap();
        assert_eq!((b.min, b.max), ([1.0, 2.0, 3.0], [5.0, 6.0, 7.0]));
    }

    #[test]
    fn no_finite_point_means_no_box() {
        assert_eq!(BBox::from_points([]), None);
        assert_eq!(BBox::from_points([[f64::NAN; 3], [f64::INFINITY; 3]]), None);
    }

    #[test]
    fn precise_negative_coordinates_are_kept_exactly() {
        let p = [
            -123.456_789_012_345,
            0.000_000_000_001,
            -9_999_999.999_999_999_999,
        ];
        let b = BBox::from_points([p, p]).unwrap();
        assert_eq!((b.min, b.max), (p, p));
    }

    #[test]
    fn a_box_serializes_as_min_and_max_arrays() {
        let b = BBox::from_points([[0.0, 1.0, 2.0], [3.0, 4.0, 5.0]]).unwrap();
        assert_eq!(
            serde_json::to_string(&b).unwrap(),
            r#"{"min":[0.0,1.0,2.0],"max":[3.0,4.0,5.0]}"#
        );
    }
}
