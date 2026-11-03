//! Positions of a dataset, in the map's coordinate system and relative to the frame's origin.

use karmania_core::{CrsRef, Finding, Findings, Positions};
use karmania_crs::Transformer;

use crate::drawable::not_convertible;
use crate::origin::Frame;

/// What preparing one dataset gives: the buffers, and the findings made on the way.
#[derive(Debug, Clone, PartialEq)]
pub struct Prepared<T> {
    /// The buffers for the renderer.
    pub buffers: T,
    /// What was found: positions that could not be converted (`crs.transform.not_finite`, with the first
    /// 0-based vertex numbers), and whatever the kind adds.
    pub findings: Findings,
}

/// Positions of a dataset taken to the frame a few at a time: the work of [`project`] in parts, so that a
/// long list can be done in steps (a job that can be stopped between them). Done in parts of any size it
/// gives the same numbers and the same findings as all at once.
pub struct Projector {
    transformer: Transformer,
    out: Vec<f32>,
    done: usize,
}

impl Projector {
    /// A projector from the system `own` to the frame's map system.
    ///
    /// # Errors
    ///
    /// A `display.crs.not_convertible` finding if the two systems cannot be converted between.
    pub fn new(own: CrsRef, frame: &Frame) -> Result<Self, Finding> {
        let transformer =
            Transformer::new(own, frame.map_crs).map_err(|cause| not_convertible(&cause))?;
        Ok(Self {
            transformer,
            out: Vec::new(),
            done: 0,
        })
    }

    /// Does the next `budget` positions (at least one) of `positions`, which have to be the same list each
    /// time. Returns whether every position is done.
    pub fn advance(
        &mut self,
        positions: &Positions,
        frame: &Frame,
        budget: usize,
        findings: &mut Findings,
    ) -> bool {
        let all = positions.as_slice();
        let total = positions.len();
        if self.out.capacity() == 0 {
            self.out.reserve_exact(total.saturating_mul(3));
        }
        let end = self.done.saturating_add(budget.max(1)).min(total);
        let part = all.get(self.done * 3..end * 3).unwrap_or(&[]);
        if self.transformer.is_identity() {
            self.out.extend(frame.rebase_all(part));
        } else {
            let mut xyz = part.to_vec();
            self.transformer
                .convert_chunk_in_place(&mut xyz, self.done as u64, findings);
            self.out.extend(frame.rebase_all(&xyz));
        }
        self.done = end;
        self.done >= total
    }

    /// How many positions are done.
    #[must_use]
    pub fn done(&self) -> usize {
        self.done
    }

    /// The positions done so far, relative to the origin, `x y z` interleaved: all of them once
    /// [`Projector::advance`] has said so.
    #[must_use]
    pub fn finish(self) -> Vec<f32> {
        self.out
    }
}

/// `positions` of a dataset in `own`, converted to the frame's map system in `f64` and then made
/// relative to the origin as `f32` (interleaved `x y z`, `3 * positions.len()` values, in the order of
/// the positions).
///
/// A position that is not finite, or that cannot be converted, stays in its place as NaN (so that the
/// numbers of the elements do not change), and so does a number too large for an `f32` once it is made relative to
/// the origin, which is infinite and not NaN: the renderer leaves out any coordinate that is not finite; the ones that could not be
/// converted are counted in a `crs.transform.not_finite` finding. Heights are not converted.
///
/// # Errors
///
/// A `display.crs.not_convertible` finding, if the two systems cannot be converted between (call
/// [`crate::drawable`] first, which says so before any work is done).
pub fn project(
    positions: &Positions,
    own: CrsRef,
    frame: &Frame,
    findings: &mut Findings,
) -> Result<Vec<f32>, Finding> {
    let mut projector = Projector::new(own, frame)?;
    projector.advance(positions, frame, usize::MAX, findings);
    Ok(projector.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::FrameSource;
    use karmania_core::Units;

    fn positions(xy: &[(f64, f64)]) -> Positions {
        let x: Vec<f64> = xy.iter().map(|p| p.0).collect();
        let y: Vec<f64> = xy.iter().map(|p| p.1).collect();
        Positions::from_xyz(&x, &y, None, &mut Findings::new()).unwrap()
    }

    fn frame(crs: CrsRef, origin: [f64; 3]) -> Frame {
        Frame {
            map_crs: crs,
            origin,
            source: FrameSource::Auto,
        }
    }

    const UTM40: CrsRef = CrsRef::Epsg { code: 32640 };

    #[test]
    fn the_same_system_is_only_made_relative_to_the_origin() {
        let p = positions(&[(512_345.5, 4_012_345.25), (512_000.0, 4_012_000.0)]);
        let mut findings = Findings::new();
        let out = project(
            &p,
            UTM40,
            &frame(UTM40, [512_000.0, 4_012_000.0, 100.0]),
            &mut findings,
        );
        assert_eq!(out.unwrap(), [345.5, 345.25, -100.0, 0.0, 0.0, -100.0]);
        assert!(findings.is_empty());
    }

    #[test]
    fn another_system_is_converted_in_f64_first() {
        let p = positions(&[(57.3, 25.2)]);
        let map = frame(UTM40, [530_000.0, 2_790_000.0, 0.0]);
        let mut findings = Findings::new();
        let out = project(&p, CrsRef::Epsg { code: 4326 }, &map, &mut findings).unwrap();
        let [cx, cy] = Transformer::new(CrsRef::Epsg { code: 4326 }, UTM40)
            .unwrap()
            .convert(57.3, 25.2);
        assert_eq!(
            out,
            [(cx - 530_000.0) as f32, (cy - 2_790_000.0) as f32, 0.0]
        );
        // 57.3 E is 0.3 degrees from the central meridian: easting about 530 km, northing about 2,790 km.
        assert!(out[0].abs() < 2_000.0 && out[1].abs() < 20_000.0, "{out:?}");
    }

    #[test]
    fn positions_that_cannot_be_converted_stay_as_nan_and_are_counted() {
        // Latitude 95 is not on the Earth; the second position is fine.
        let p = positions(&[(57.0, 95.0), (57.3, 25.2)]);
        let map = frame(UTM40, [530_000.0, 2_790_000.0, 0.0]);
        let mut findings = Findings::new();
        let out = project(&p, CrsRef::Epsg { code: 4326 }, &map, &mut findings).unwrap();
        assert_eq!(out.len(), 6);
        assert!(out[0].is_nan() && out[1].is_nan() && out[2] == -0.0);
        assert!(out[3].is_finite() && out[4].is_finite());
        let finding = &findings.as_slice()[0];
        assert_eq!(finding.code.as_str(), "crs.transform.not_finite");
        assert_eq!((finding.count, finding.examples[0].vertex), (1, Some(0)));
    }

    #[test]
    fn a_trailing_partial_position_is_left_out_and_a_system_that_cannot_be_converted_is_an_error() {
        let p = Positions::from_interleaved(vec![1.0, 2.0, 3.0, 4.0], true);
        let local = CrsRef::Local {
            units: Units::Metre,
        };
        let out = project(&p, local, &frame(local, [0.0; 3]), &mut Findings::new()).unwrap();
        assert_eq!(out, [1.0, 2.0, 3.0]);
        let error = project(&p, local, &frame(UTM40, [0.0; 3]), &mut Findings::new()).unwrap_err();
        assert_eq!(error.code.as_str(), "display.crs.not_convertible");
    }

    #[test]
    fn done_in_parts_of_any_size_the_positions_and_findings_are_those_of_all_at_once() {
        // 50 positions in longitude and latitude, some off the Earth, into zone 40.
        let xy: Vec<(f64, f64)> = (0..50)
            .map(|i| {
                (
                    57.0 + f64::from(i) * 0.02,
                    if i % 9 == 4 {
                        95.0
                    } else {
                        25.0 + f64::from(i) * 0.01
                    },
                )
            })
            .collect();
        let p = positions(&xy);
        let map = frame(UTM40, [530_000.0, 2_790_000.0, 0.0]);
        let geographic = CrsRef::Epsg { code: 4326 };
        let mut whole_findings = Findings::new();
        let whole = project(&p, geographic, &map, &mut whole_findings).unwrap();
        for budget in [0, 1, 4, 7, 49, 50, 1_000] {
            let mut findings = Findings::new();
            let mut projector = Projector::new(geographic, &map).unwrap();
            let mut steps = 0;
            while !projector.advance(&p, &map, budget, &mut findings) {
                steps += 1;
                assert!(steps <= 50, "a budget of {budget} must move forward");
            }
            assert_eq!(projector.done(), 50);
            let parts = projector.finish();
            assert!(
                parts
                    .iter()
                    .zip(&whole)
                    .all(|(a, b)| a.to_bits() == b.to_bits()),
                "budget {budget}"
            );
            assert_eq!(findings, whole_findings, "budget {budget}");
        }
        assert_eq!(whole_findings.as_slice()[0].count, 6);
    }

    #[test]
    fn nothing_to_do_is_done_at_once_and_a_system_that_cannot_be_converted_is_an_error() {
        let none = positions(&[]);
        let mut projector = Projector::new(UTM40, &frame(UTM40, [0.0; 3])).unwrap();
        assert!(projector.advance(&none, &frame(UTM40, [0.0; 3]), 10, &mut Findings::new()));
        assert!(projector.finish().is_empty());
        let local = CrsRef::Local {
            units: Units::Metre,
        };
        assert!(Projector::new(local, &frame(UTM40, [0.0; 3])).is_err());
    }
}
