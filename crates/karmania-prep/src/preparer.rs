//! What the worker keeps between requests to prepare: the frame, and the jobs under way.

use std::collections::BTreeMap;

use karmania_core::{CrsRef, Dataset, DatasetId};

use crate::choice::{FrameChoice, choose_frame_tracking};
use crate::job::{PrepareJob, PrepareStep};
use crate::origin::Frame;

/// The frame the map is drawn in and the preparing under way. Several can exist at once and share nothing,
/// like the kernels that hold them.
#[derive(Default)]
pub struct Preparer {
    frame: Option<Frame>,
    /// Whether the origin of `frame` was made when no dataset could be drawn in it, so that it is 0 and
    /// not the centre of a dataset (see [`choose_frame_tracking`]).
    origin_waiting: bool,
    jobs: BTreeMap<u32, (DatasetId, PrepareJob)>,
    /// The identifier the next job gets. Identifiers are never reused.
    next: u32,
}

impl Preparer {
    /// A preparer with no frame and no job.
    #[must_use]
    pub fn new() -> Self {
        Self {
            frame: None,
            origin_waiting: false,
            jobs: BTreeMap::new(),
            next: 1,
        }
    }

    /// The frame the map is in, if there is one.
    #[must_use]
    pub fn frame(&self) -> Option<&Frame> {
        self.frame.as_ref()
    }

    /// Chooses the frame for `datasets` (in the order they were loaded), keeps it, and says which are
    /// drawn: see [`choose_frame`]. The frame stays for as long as any dataset is loaded, and goes when
    /// the last is removed, so call this again after datasets are added or removed.
    pub fn choose_frame(
        &mut self,
        preferred: Option<CrsRef>,
        datasets: &[&Dataset],
    ) -> FrameChoice {
        let (choice, waiting) = choose_frame_tracking(
            self.frame.as_ref(),
            preferred,
            datasets,
            self.origin_waiting,
        );
        self.frame = choice.frame;
        self.origin_waiting = waiting;
        choice
    }

    /// What [`Preparer::choose_frame`] would answer for `preferred` and `datasets`, without keeping anything: the
    /// frame and the origin the preparer holds stay as they are, and so do the jobs. For asking what a map
    /// coordinate system a person is thinking of would do (which datasets would start or stop being drawn)
    /// before it is chosen, which `choose_frame` itself cannot, since it keeps what it answers.
    #[must_use]
    pub fn preview_frame(&self, preferred: Option<CrsRef>, datasets: &[&Dataset]) -> FrameChoice {
        choose_frame_tracking(
            self.frame.as_ref(),
            preferred,
            datasets,
            self.origin_waiting,
        )
        .0
    }

    /// Starts preparing `dataset` for drawing in `frame` and returns the job's identifier. Nothing is done
    /// until [`Preparer::step`].
    pub fn start(&mut self, dataset: &Dataset, frame: Frame, max_texture_size: u32) -> u32 {
        let id = self.next;
        self.next += 1;
        self.jobs.insert(
            id,
            (
                dataset.id,
                PrepareJob::new(dataset, frame, max_texture_size),
            ),
        );
        id
    }

    /// Does the next part of a job. `dataset` is the one it was started on, or `None` if that dataset is
    /// gone, which cancels the job. A job that is done or cancelled is forgotten with the step that says
    /// so. `None` if there is no job with that identifier (it never existed, or it is over).
    pub fn step(
        &mut self,
        job: u32,
        dataset: Option<&Dataset>,
        budget: usize,
    ) -> Option<PrepareStep> {
        let (_, running) = self.jobs.get_mut(&job)?;
        let step = match dataset {
            Some(dataset) => running.step(dataset, budget),
            None => PrepareStep::Cancelled,
        };
        if !matches!(step, PrepareStep::Progress { .. }) {
            self.jobs.remove(&job);
        }
        Some(step)
    }

    /// The dataset a job is preparing, or `None` if there is no such job.
    #[must_use]
    pub fn dataset_of(&self, job: u32) -> Option<DatasetId> {
        self.jobs.get(&job).map(|(dataset, _)| *dataset)
    }

    /// Stops a job and gives back what it holds. Returns whether there was one.
    pub fn cancel(&mut self, job: u32) -> bool {
        self.jobs.remove(&job).is_some()
    }

    /// A dataset was removed and `remaining` are loaded: stops the jobs on it, and drops the frame if it was the
    /// last, so that the next dataset starts afresh (section 9.1: the origin changes "when the last dataset is
    /// removed"). This does not wait for [`Preparer::choose_frame`] to be called with no datasets.
    pub fn removed(&mut self, dataset: DatasetId, remaining: usize) {
        self.forget_dataset(dataset);
        if remaining == 0 {
            self.frame = None;
            self.origin_waiting = false;
        }
    }

    /// Stops the jobs that are preparing `dataset`, which is being removed.
    pub fn forget_dataset(&mut self, dataset: DatasetId) {
        self.jobs.retain(|_, (id, _)| *id != dataset);
    }

    /// How many jobs are under way.
    #[must_use]
    pub fn jobs(&self) -> usize {
        self.jobs.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drawable::DrawStatus;
    use crate::origin::FrameSource;
    use crate::testutil::points;
    use karmania_core::Units;

    const UTM40: CrsRef = CrsRef::Epsg { code: 32640 };

    fn at(id: u64, xy: &[(f64, f64)]) -> Dataset {
        let mut d = points(Some(UTM40), xy);
        d.id = DatasetId(id);
        d
    }

    #[test]
    fn the_frame_is_kept_between_calls_and_goes_with_the_last_dataset() {
        let a = at(1, &[(512_000.0, 4_012_000.0)]);
        let b = at(2, &[(300_000.0, 4_000_000.0)]);
        let mut p = Preparer::new();
        assert_eq!(p.frame(), None);
        let first = p.choose_frame(None, &[&a]);
        assert_eq!(p.frame(), first.frame.as_ref());
        // A second dataset does not move it, nor does removing the first.
        assert_eq!(p.choose_frame(None, &[&a, &b]).frame, first.frame);
        assert_eq!(p.choose_frame(None, &[&b]).frame, first.frame);
        // A choice of the person's is kept too.
        let user = p.choose_frame(Some(CrsRef::Epsg { code: 32641 }), &[&b]);
        assert_eq!(
            user.frame.map(|f| (f.map_crs, f.source)),
            Some((CrsRef::Epsg { code: 32641 }, FrameSource::User))
        );
        assert_eq!(
            p.choose_frame(None, &[&b]).frame.map(|f| f.map_crs),
            Some(CrsRef::Epsg { code: 32641 })
        );
        // The last dataset goes: no frame, and the next dataset starts afresh.
        assert_eq!(p.choose_frame(None, &[]).frame, None);
        assert_eq!(p.frame(), None);
        assert_eq!(
            p.choose_frame(None, &[&b]).frame.map(|f| f.map_crs),
            Some(UTM40)
        );
    }

    #[test]
    fn a_preview_says_what_choosing_would_and_keeps_nothing() {
        let a = at(1, &[(512_000.0, 4_012_000.0)]);
        let b = at(2, &[(300_000.0, 4_000_000.0)]);
        let mut p = Preparer::new();
        // The map is in a system the person chose, which is not the one that the datasets would give it by themselves.
        let utm41 = CrsRef::Epsg { code: 32641 };
        let kept = p.choose_frame(Some(utm41), &[&a, &b]);
        assert!(
            kept.drawable
                .iter()
                .all(|entry| entry.status == DrawStatus::Drawn)
        );
        let before = p.frame().copied();
        // A local grid is a system that neither dataset can be drawn in: that is what the preview says...
        let local = CrsRef::Local {
            units: Units::Metre,
        };
        let preview = p.preview_frame(Some(local), &[&a, &b]);
        assert_eq!(
            preview.frame.map(|f| (f.map_crs, f.source)),
            Some((local, FrameSource::User))
        );
        assert!(
            preview
                .drawable
                .iter()
                .all(|entry| entry.status == DrawStatus::NotDrawn)
        );
        // ...the same as choosing it would, which is tried on a preparer of its own...
        assert_eq!(
            preview,
            Preparer::new().choose_frame(Some(local), &[&a, &b])
        );
        // ...and the preparer is as it was: the frame it holds, and what it says without a preference.
        assert_eq!(p.frame().copied(), before);
        let again = p.choose_frame(None, &[&a, &b]);
        assert_eq!((again.frame, again.drawable), (kept.frame, kept.drawable));
        // Without a preference a preview is what is kept (the person's choice, and not what the datasets would give), and with nothing
        // loaded there is nothing to show.
        assert_eq!(p.preview_frame(None, &[&a, &b]).frame, before);
        assert_eq!(
            before.map(|f| (f.map_crs, f.source)),
            Some((utm41, FrameSource::User))
        );
        assert_eq!(p.preview_frame(Some(local), &[]).frame, None);
    }

    #[test]
    fn a_preview_does_not_make_an_origin_that_is_waiting() {
        // The map is in a system in which nothing is drawn, so its origin is 0 and waits for a dataset that can be.
        let a = at(1, &[(512_000.0, 4_012_000.0)]);
        let local = CrsRef::Local {
            units: Units::Metre,
        };
        let mut p = Preparer::new();
        let waiting = p.choose_frame(Some(local), &[&a]);
        assert_eq!(waiting.frame.map(|f| f.origin), Some([0.0, 0.0, 0.0]));
        // The preview of a system the dataset is drawn in has an origin made from it...
        let preview = p.preview_frame(Some(UTM40), &[&a]);
        assert_ne!(preview.frame.map(|f| f.origin), Some([0.0, 0.0, 0.0]));
        // ...and the preparer still has the frame that waits, until a choice is made.
        assert_eq!(p.frame().copied(), waiting.frame);
        let made = p.choose_frame(Some(UTM40), &[&a]);
        assert_eq!(made.frame, preview.frame);
    }

    #[test]
    fn a_preview_of_the_map_system_whose_origin_waits_has_the_origin_a_choice_would_make() {
        let local = CrsRef::Local {
            units: Units::Metre,
        };
        let mut a = points(Some(local), &[(1.0, 1.0)]);
        a.id = DatasetId(1);
        let mut p = Preparer::new();
        p.choose_frame(None, &[&a]);
        // The person chooses a system in which nothing is drawn: the origin is 0 and waits for a dataset that is.
        let chosen = p.choose_frame(Some(UTM40), &[&a]).frame.unwrap();
        assert_eq!(chosen.origin, [0.0; 3]);
        let b = at(2, &[(512_000.01, 4_012_345.01), (512_000.02, 4_012_345.02)]);
        let preview = p.preview_frame(Some(UTM40), &[&a, &b]).frame.unwrap();
        assert_eq!(preview.origin, [512_000.0, 4_012_000.0, 0.0]);
        // It is a preview: the origin that waits is still the one that is kept, until a choice is made.
        assert_eq!(p.frame().map(|f| f.origin), Some([0.0; 3]));
        assert_eq!(
            p.choose_frame(None, &[&a, &b]).frame.map(|f| f.origin),
            Some(preview.origin)
        );
    }

    #[test]
    fn a_job_is_stepped_until_done_and_is_then_forgotten() {
        let d = at(
            1,
            &[
                (512_000.0, 4_012_000.0),
                (512_010.0, 4_012_010.0),
                (512_020.0, 4_012_020.0),
            ],
        );
        let mut p = Preparer::new();
        let frame = p.choose_frame(None, &[&d]).frame.unwrap();
        let job = p.start(&d, frame, 4096);
        assert_eq!(p.jobs(), 1);
        assert!(matches!(
            p.step(job, Some(&d), 2),
            Some(PrepareStep::Progress { .. })
        ));
        assert!(matches!(
            p.step(job, Some(&d), 2),
            Some(PrepareStep::Done(_))
        ));
        assert_eq!(
            (p.jobs(), p.step(job, Some(&d), 2)),
            (0, None),
            "forgotten once it is done"
        );
        assert_eq!(p.step(99, Some(&d), 2), None, "there is no such job");
    }

    #[test]
    fn cancelling_removing_the_dataset_and_a_step_without_it_all_stop_a_job() {
        let d = at(1, &[(512_000.0, 4_012_000.0); 10]);
        let other = at(2, &[(1.0, 1.0)]);
        let mut p = Preparer::new();
        let frame = p.choose_frame(None, &[&d]).frame.unwrap();
        let (a, b, c) = (
            p.start(&d, frame, 4096),
            p.start(&d, frame, 4096),
            p.start(&other, frame, 4096),
        );
        assert_eq!((a, b, c), (1, 2, 3), "identifiers are never reused");
        assert!(p.cancel(a));
        assert!(!p.cancel(a));
        // The dataset the job is for is gone: the step says so, and the job is forgotten.
        assert_eq!(p.step(b, None, 2), Some(PrepareStep::Cancelled));
        assert_eq!(p.step(b, Some(&d), 2), None);
        // Removing a dataset stops the jobs on it and leaves the others.
        let again = p.start(&d, frame, 4096);
        p.forget_dataset(DatasetId(1));
        assert_eq!(p.step(again, Some(&d), 2), None);
        assert_eq!(p.jobs(), 1);
        assert!(matches!(
            p.step(c, Some(&other), 1),
            Some(PrepareStep::Done(_))
        ));
    }

    #[test]
    fn a_frame_made_when_nothing_was_drawable_gets_its_origin_from_the_first_dataset_that_is() {
        // Found by the review of the milestone: a person chooses a system in which nothing is drawn (here a
        // local grid is loaded and UTM 40 is chosen), the origin is 0, and a dataset loaded later in UTM 40
        // kept that origin for good, so that points 1 cm apart came out as the same f32.
        let local = CrsRef::Local {
            units: karmania_core::Units::Metre,
        };
        let mut a = points(Some(local), &[(1.0, 1.0)]);
        a.id = DatasetId(1);
        let mut p = Preparer::new();
        p.choose_frame(None, &[&a]);
        let chosen = p.choose_frame(Some(UTM40), &[&a]).frame.unwrap();
        assert_eq!((chosen.map_crs, chosen.origin), (UTM40, [0.0; 3]));

        let b = at(2, &[(512_000.01, 4_012_345.01), (512_000.02, 4_012_345.02)]);
        let frame = p.choose_frame(None, &[&a, &b]).frame.unwrap();
        assert_eq!(frame.map_crs, UTM40);
        assert_eq!(frame.origin, [512_000.0, 4_012_000.0, 0.0]);
        assert_eq!(frame.source, FrameSource::User, "still the person's choice");
        // The two points 1 cm apart stay apart once rebased.
        let (x, y) = (
            frame.rebase([512_000.01, 4_012_345.01, 0.0]),
            frame.rebase([512_000.02, 4_012_345.02, 0.0]),
        );
        assert!(x[0] < y[0] && x[1] < y[1], "{x:?} {y:?}");

        // From then on it is kept, as the rule says: another dataset does not move it.
        let c = at(3, &[(300_000.0, 4_000_000.0)]);
        assert_eq!(p.choose_frame(None, &[&a, &b, &c]).frame, Some(frame));
        // Choosing the same system again does not move it either.
        assert_eq!(
            p.choose_frame(Some(UTM40), &[&a, &b, &c])
                .frame
                .map(|f| f.origin),
            Some(frame.origin)
        );
    }

    #[test]
    fn an_origin_that_was_made_from_a_dataset_is_never_made_again_even_if_it_is_zero() {
        // A dataset centred on the origin of its system: the origin is 0 because that is the centre, and a
        // dataset that comes later does not move it.
        let a = at(1, &[(-100.0, -100.0), (100.0, 100.0)]);
        let mut p = Preparer::new();
        let first = p.choose_frame(None, &[&a]).frame.unwrap();
        assert_eq!(first.origin, [0.0; 3]);
        let b = at(2, &[(700_000.0, 3_000_000.0)]);
        assert_eq!(p.choose_frame(None, &[&a, &b]).frame, Some(first));
    }

    #[test]
    fn removing_the_last_dataset_drops_the_frame_without_choose_frame_being_called() {
        let a = at(1, &[(512_000.0, 4_012_000.0)]);
        let mut p = Preparer::new();
        let first = p.choose_frame(None, &[&a]).frame.unwrap();
        // One of two datasets goes: the frame stays.
        p.removed(DatasetId(9), 1);
        assert_eq!(p.frame(), Some(&first));
        // The last goes: no frame, and a dataset in another zone starts afresh.
        p.removed(DatasetId(1), 0);
        assert_eq!(p.frame(), None);
        let b = points(
            Some(CrsRef::Epsg { code: 32641 }),
            &[(300_000.0, 4_000_000.0)],
        );
        let again = p.choose_frame(None, &[&b]).frame.unwrap();
        assert_eq!(
            (again.map_crs, again.origin),
            (CrsRef::Epsg { code: 32641 }, [300_000.0, 4_000_000.0, 0.0])
        );
    }
}
