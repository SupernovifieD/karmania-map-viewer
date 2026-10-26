//! Vertex positions: interleaved x, y, z in the dataset's CRS units, Z up.

use crate::codes::FindingCode;
use crate::findings::{Finding, Findings};
use crate::text::format_count;

/// A list of positions stored as interleaved `x0 y0 z0 x1 y1 z1 ...` values.
///
/// Coordinates are in the units of the dataset's CRS with Z up. If the source
/// has no Z, every z is 0.0 and [`Positions::has_z`] is false. Values are kept
/// exactly as given, including NaN and infinities; validation reports them.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Positions {
    xyz: Vec<f64>,
    has_z: bool,
}

impl Positions {
    /// Builds positions from separate coordinate lists.
    ///
    /// Without `z`, every z becomes 0.0 and `has_z` is false. If the lists have
    /// different lengths a finding is added and `None` is returned. The caller
    /// applies the dataset size limit before building the lists.
    pub fn from_xyz(
        x: &[f64],
        y: &[f64],
        z: Option<&[f64]>,
        findings: &mut Findings,
    ) -> Option<Self> {
        let z_len = z.map(<[f64]>::len);
        if x.len() != y.len() || z_len.is_some_and(|n| n != x.len()) {
            let mut message = format!(
                "The coordinate lists have different lengths: X has {} values, Y has {}",
                format_count(x.len() as u64),
                format_count(y.len() as u64),
            );
            if let Some(n) = z_len {
                message.push_str(&format!(", Z has {}", format_count(n as u64)));
            }
            message.push('.');
            findings.add(
                Finding::new(FindingCode::DatasetCoordinatesLengthMismatch, message)
                    .with_hint("Give X, Y and Z (if used) the same number of values."),
            );
            return None;
        }
        let mut xyz = Vec::with_capacity(x.len().saturating_mul(3));
        for (i, (&xi, &yi)) in x.iter().zip(y).enumerate() {
            let zi = z.and_then(|z| z.get(i)).copied().unwrap_or(0.0);
            xyz.extend_from_slice(&[xi, yi, zi]);
        }
        Some(Self {
            xyz,
            has_z: z.is_some(),
        })
    }

    /// Wraps already interleaved values. The length is not checked here: a
    /// length that is not a multiple of 3 is reported by validation.
    #[must_use]
    pub fn from_interleaved(xyz: Vec<f64>, has_z: bool) -> Self {
        Self { xyz, has_z }
    }

    /// Whether the source had real Z values (otherwise every z is 0.0).
    #[must_use]
    pub fn has_z(&self) -> bool {
        self.has_z
    }

    /// Number of complete positions (a trailing partial triple is not counted).
    #[must_use]
    pub fn len(&self) -> usize {
        self.xyz.len() / 3
    }

    /// True when there are no complete positions.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The raw interleaved values.
    #[must_use]
    pub fn as_slice(&self) -> &[f64] {
        &self.xyz
    }

    /// The position at `index` as `[x, y, z]`, or `None` if out of range.
    #[must_use]
    pub fn get(&self, index: usize) -> Option<[f64; 3]> {
        let start = index.checked_mul(3)?;
        let triple = self.xyz.get(start..start.checked_add(3)?)?;
        Some([*triple.first()?, *triple.get(1)?, *triple.get(2)?])
    }

    /// Iterates over complete positions as `[x, y, z]`.
    pub fn iter(&self) -> impl Iterator<Item = [f64; 3]> + '_ {
        self.xyz.as_chunks::<3>().0.iter().copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(x: &[f64], y: &[f64], z: Option<&[f64]>) -> (Option<Positions>, Findings) {
        let mut findings = Findings::new();
        (Positions::from_xyz(x, y, z, &mut findings), findings)
    }

    #[test]
    fn coordinates_are_interleaved_in_order() {
        let (p, findings) = build(&[1.0, 4.0], &[2.0, 5.0], Some(&[3.0, 6.0]));
        let p = p.unwrap();
        assert!(findings.is_empty() && p.has_z());
        assert_eq!(p.as_slice(), [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        assert_eq!(
            (p.len(), p.get(1), p.get(2)),
            (2, Some([4.0, 5.0, 6.0]), None)
        );
    }

    #[test]
    fn missing_z_is_filled_with_zero_and_flagged() {
        let (p, _) = build(&[1.0, 2.0], &[3.0, 4.0], None);
        let p = p.unwrap();
        assert!(!p.has_z());
        assert_eq!(p.as_slice(), [1.0, 3.0, 0.0, 2.0, 4.0, 0.0]);
    }

    #[test]
    fn different_lengths_give_a_finding_and_no_positions() {
        let (p, findings) = build(&[1.0; 1_204], &[1.0; 5], None);
        assert!(p.is_none());
        let f = &findings.as_slice()[0];
        assert_eq!(f.code.as_str(), "dataset.coordinates.length_mismatch");
        assert_eq!(
            f.message,
            "The coordinate lists have different lengths: X has 1,204 values, Y has 5."
        );
        let (p, findings) = build(&[1.0; 2], &[1.0; 2], Some(&[1.0; 3]));
        assert!(p.is_none());
        assert_eq!(
            findings.as_slice()[0].message,
            "The coordinate lists have different lengths: X has 2 values, Y has 2, Z has 3."
        );
    }

    #[test]
    fn empty_lists_make_empty_positions() {
        let (p, findings) = build(&[], &[], Some(&[]));
        let p = p.unwrap();
        assert!(findings.is_empty() && p.is_empty() && p.has_z());
        assert_eq!((p.len(), p.get(0)), (0, None));
    }

    #[test]
    fn non_finite_values_are_kept_as_given() {
        let (p, _) = build(&[f64::NAN], &[f64::INFINITY], Some(&[f64::NEG_INFINITY]));
        let [x, y, z] = p.unwrap().get(0).unwrap();
        assert!(x.is_nan() && y == f64::INFINITY && z == f64::NEG_INFINITY);
    }

    #[test]
    fn a_trailing_partial_triple_is_not_a_position() {
        let p = Positions::from_interleaved(vec![1.0, 2.0, 3.0, 4.0, 5.0], true);
        assert_eq!((p.len(), p.as_slice().len()), (1, 5));
        assert_eq!(p.iter().collect::<Vec<_>>(), [[1.0, 2.0, 3.0]]);
        assert_eq!(p.get(1), None);
        assert_eq!(p.get(usize::MAX), None);
    }
}
