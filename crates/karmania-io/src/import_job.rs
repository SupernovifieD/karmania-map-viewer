//! Running an import in steps.
//!
//! A big file should not freeze the page while it is read. An [`ImportJob`] does
//! a bounded amount of work per [`ImportJob::step`] and says how far it has got,
//! so the caller can draw a progress bar, stay responsive, and stop by dropping the
//! job. A CSV file is read a number of rows at a time. The other readers parse a
//! whole file in one go, so their jobs finish in a single step.
//!
//! A job owns its text and mapping, so it can be kept between calls.

use karmania_core::Findings;

use crate::asc::read_asc;
use crate::csv_import::{CsvImport, CsvOptions};
use crate::geojson::read_geojson;
use crate::mapping::ImportMapping;
use crate::obj::read_obj;
use crate::output::ReadOutput;

/// How far a job has got.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Progress {
    /// Data rows read so far.
    pub rows_read: u64,
    /// About how many data rows there are (see [`CsvImport::estimated_rows`]).
    pub rows_total: u64,
}

impl Progress {
    /// The share done, from 0 to 1.
    #[must_use]
    pub fn fraction(&self) -> f64 {
        if self.rows_total == 0 {
            1.0
        } else {
            (self.rows_read as f64 / self.rows_total as f64).min(1.0)
        }
    }
}

/// What a step did.
#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    /// There is more to read.
    Progress(Progress),
    /// The import is finished. This is returned once; the job is then spent.
    Done(ReadOutput),
}

enum Work {
    Csv(Option<Box<CsvImport<'static>>>),
    Once(Option<Box<dyn FnOnce() -> ReadOutput>>),
}

/// An import in progress. Create one for a format, call [`ImportJob::step`] until
/// it returns [`Step::Done`], and drop it to cancel.
pub struct ImportJob {
    work: Work,
}

impl ImportJob {
    /// A CSV import. The text and mapping are kept by the job.
    #[must_use]
    pub fn csv(
        text: String,
        options: CsvOptions,
        mapping: ImportMapping,
        file_name: Option<&str>,
    ) -> Self {
        Self {
            work: Work::Csv(Some(Box::new(CsvImport::owned(
                text, options, mapping, file_name,
            )))),
        }
    }

    /// A GeoJSON import, done in one step.
    #[must_use]
    pub fn geojson(text: String, file_name: Option<&str>) -> Self {
        let name = file_name.map(str::to_string);
        Self::once(move || read_geojson(&text, name.as_deref()))
    }

    /// An ESRI ASCII grid import, done in one step.
    #[must_use]
    pub fn ascii_grid(text: String, file_name: Option<&str>) -> Self {
        let name = file_name.map(str::to_string);
        Self::once(move || read_asc(&text, name.as_deref()))
    }

    /// An OBJ mesh import, done in one step.
    #[must_use]
    pub fn obj(text: String, file_name: Option<&str>) -> Self {
        let name = file_name.map(str::to_string);
        Self::once(move || read_obj(&text, name.as_deref()))
    }

    fn once(run: impl FnOnce() -> ReadOutput + 'static) -> Self {
        Self {
            work: Work::Once(Some(Box::new(run))),
        }
    }

    /// Does up to `budget_rows` rows of work (at least one, so a budget of 0 cannot
    /// stall a caller that loops until done). Readers that cannot be split ignore
    /// the budget and finish at once.
    ///
    /// After [`Step::Done`] has been returned the job is spent: further calls
    /// return `Done` with no datasets and no findings.
    pub fn step(&mut self, budget_rows: usize) -> Step {
        match &mut self.work {
            Work::Csv(slot) => {
                let Some(import) = slot.as_mut() else {
                    return Step::Done(spent());
                };
                if import.step(budget_rows.max(1)) {
                    Step::Done(slot.take().map_or_else(spent, |import| import.finish()))
                } else {
                    Step::Progress(Progress {
                        rows_read: import.rows_read(),
                        rows_total: import.estimated_rows(),
                    })
                }
            }
            Work::Once(slot) => Step::Done(slot.take().map_or_else(spent, |run| run())),
        }
    }

    /// Whether the job has finished, so that [`ImportJob::step`] has nothing left.
    #[must_use]
    pub fn is_finished(&self) -> bool {
        match &self.work {
            Work::Csv(slot) => slot.is_none(),
            Work::Once(slot) => slot.is_none(),
        }
    }

    /// Runs the job to the end and returns its result.
    #[must_use]
    pub fn run(mut self) -> ReadOutput {
        loop {
            if let Step::Done(output) = self.step(10_000) {
                return output;
            }
        }
    }
}

/// What a finished job gives when asked again.
fn spent() -> ReadOutput {
    ReadOutput {
        datasets: Vec::new(),
        findings: Findings::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::csv_import::read_csv;
    use crate::delimited::Delimiter;
    use crate::fixtures;
    use crate::mapping::{ColumnMapping, EmptyCoordinates, Nodata};
    use crate::numbers::DecimalSeparator;
    use crate::roles::Role;
    use karmania_core::{CrsRef, Kind};

    const COMMA: CsvOptions = CsvOptions {
        delimiter: Delimiter::Comma,
        has_header: true,
    };

    fn collars() -> ImportMapping {
        let column = |source: &str, role| ColumnMapping {
            source: source.into(),
            role,
            column_type: None,
            rename: None,
        };
        ImportMapping {
            dataset_name: "Collars".into(),
            kind: Kind::Points,
            columns: vec![
                column("Easting", Role::X),
                column("Northing", Role::Y),
                column("RL", Role::Z),
                column("Hole", Role::Attribute),
                column("Au_ppm", Role::Attribute),
                column("Rock", Role::Attribute),
            ],
            nodata: Nodata {
                tokens: vec![String::new()],
                numbers: vec![-999.0],
            },
            empty_coordinates: EmptyCoordinates::Error,
            block_size: None,
            decimal_separator: DecimalSeparator::Point,
            crs: Some(CrsRef::Epsg { code: 32640 }),
        }
    }

    fn csv_job(text: String) -> ImportJob {
        ImportJob::csv(text, COMMA, collars(), Some("points.csv"))
    }

    #[test]
    fn a_csv_job_reports_progress_a_few_rows_at_a_time_and_ends_with_the_result() {
        let text = fixtures::text("points.csv");
        let whole = read_csv(&text, COMMA, &collars(), Some("points.csv"));
        let mut job = csv_job(text);
        let mut seen = Vec::new();
        let output = loop {
            match job.step(3) {
                Step::Progress(p) => seen.push((p.rows_read, p.rows_total)),
                Step::Done(output) => break output,
            }
        };
        assert_eq!(seen, [(3, 8), (6, 8)]);
        assert_eq!(output, whole);
        assert!(job.is_finished());
    }

    #[test]
    fn the_fraction_rises_to_one_and_never_leaves_the_range() {
        let mut job = csv_job(fixtures::text("points.csv"));
        let mut last = 0.0;
        while let Step::Progress(p) = job.step(1) {
            let fraction = p.fraction();
            assert!(fraction > last && fraction <= 1.0, "{fraction}");
            last = fraction;
        }
        assert_eq!(
            Progress {
                rows_read: 0,
                rows_total: 0
            }
            .fraction(),
            1.0
        );
        assert_eq!(
            Progress {
                rows_read: 9,
                rows_total: 8
            }
            .fraction(),
            1.0
        );
        assert_eq!(
            Progress {
                rows_read: 2,
                rows_total: 8
            }
            .fraction(),
            0.25
        );
    }

    #[test]
    fn a_budget_of_zero_still_moves_forward() {
        let mut job = csv_job(fixtures::text("points.csv"));
        let Step::Progress(p) = job.step(0) else {
            panic!("expected progress")
        };
        assert_eq!(p.rows_read, 1);
    }

    #[test]
    fn the_other_readers_finish_in_one_step_with_what_the_reader_gives() {
        let geojson = fixtures::text("mixed.geojson");
        let grid = fixtures::text("grid.asc");
        let mesh = fixtures::text("mesh.obj");
        let cases = [
            (
                ImportJob::geojson(geojson.clone(), Some("a.geojson")),
                read_geojson(&geojson, Some("a.geojson")),
            ),
            (
                ImportJob::ascii_grid(grid.clone(), Some("a.asc")),
                read_asc(&grid, Some("a.asc")),
            ),
            (
                ImportJob::obj(mesh.clone(), Some("a.obj")),
                read_obj(&mesh, Some("a.obj")),
            ),
        ];
        for (mut job, direct) in cases {
            assert!(!job.is_finished());
            // The budget makes no difference.
            let Step::Done(output) = job.step(1) else {
                panic!("expected the job to finish in one step")
            };
            assert_eq!(output, direct);
            assert!(!output.datasets.is_empty());
            assert!(job.is_finished());
        }
    }

    #[test]
    fn a_spent_job_gives_nothing_and_says_it_is_finished() {
        for mut job in [
            csv_job(fixtures::text("points.csv")),
            ImportJob::obj(fixtures::text("mesh.obj"), None),
        ] {
            while let Step::Progress(_) = job.step(100) {}
            assert!(job.is_finished());
            let Step::Done(again) = job.step(100) else {
                panic!("expected Done")
            };
            assert_eq!(again, spent());
        }
    }

    #[test]
    fn a_problem_found_at_the_start_ends_the_job_in_its_first_step() {
        // The mapping names a column the file does not have.
        let mut job = csv_job("A,B\n1,2\n".to_string());
        let Step::Done(output) = job.step(1) else {
            panic!("expected Done")
        };
        assert!(output.datasets.is_empty() && output.findings.has_errors());
        let Step::Done(empty) = csv_job(String::new()).step(1) else {
            panic!("expected Done")
        };
        assert_eq!(empty.findings.as_slice()[0].code.as_str(), "file.empty");
    }

    #[test]
    fn run_gives_the_same_result_as_reading_at_once() {
        let text = fixtures::text("points.csv");
        let whole = read_csv(&text, COMMA, &collars(), Some("points.csv"));
        assert_eq!(csv_job(text).run(), whole);
    }

    #[test]
    fn a_big_file_is_read_in_bounded_steps() {
        let mut text = String::from("Easting,Northing,RL,Hole,Au_ppm,Rock\n");
        for i in 0..20_000 {
            text.push_str(&format!(
                "{i},{},{},H{},{},rock\n",
                i * 2,
                i % 50,
                i % 7,
                i % 13
            ));
        }
        let whole = read_csv(&text, COMMA, &collars(), Some("points.csv"));
        let mut job = csv_job(text);
        let (mut steps, mut previous) = (0, 0);
        let output = loop {
            match job.step(1_000) {
                Step::Progress(p) => {
                    assert!(p.rows_read - previous <= 1_000);
                    previous = p.rows_read;
                    steps += 1;
                }
                Step::Done(output) => break output,
            }
        };
        assert_eq!(steps, 20);
        assert_eq!(output, whole);
        assert_eq!(output.datasets[0].element_count(), Some(20_000));
    }
}
