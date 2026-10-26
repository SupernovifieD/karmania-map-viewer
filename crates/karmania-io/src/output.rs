//! What every reader returns, and counting problems as it goes.

use karmania_core::{Dataset, Finding, Findings, Location};

/// What a reader produced: the datasets (none if there were errors) and every
/// finding along the way.
#[derive(Debug, Clone, PartialEq)]
pub struct ReadOutput {
    /// The datasets. Their ids are all zero; whoever holds the datasets assigns
    /// real ones.
    pub datasets: Vec<Dataset>,
    /// What was found.
    pub findings: Findings,
}

/// One finding being counted as rows go by.
pub(crate) struct Tally(Finding);

impl Tally {
    /// Starts counting at zero.
    pub(crate) fn new(finding: Finding) -> Self {
        let mut finding = finding;
        finding.count = 0;
        Self(finding)
    }

    /// Counts one more, keeping `at` as an example while there is room.
    pub(crate) fn hit(&mut self, at: Location) {
        self.0.count += 1;
        self.0.add_example(at);
    }

    /// The finding, or `None` if nothing was counted.
    pub(crate) fn into_finding(self) -> Option<Finding> {
        (self.0.count > 0).then_some(self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use karmania_core::{FindingCode, MAX_EXAMPLES};

    #[test]
    fn a_tally_counts_everything_and_keeps_a_limited_number_of_examples() {
        let mut tally = Tally::new(Finding::new(FindingCode::CsvRowsSkipped, "Skipped."));
        assert!(
            Tally::new(Finding::new(FindingCode::CsvRowsSkipped, "Skipped."))
                .into_finding()
                .is_none()
        );
        for line in 0..(MAX_EXAMPLES as u64 + 5) {
            tally.hit(Location::default().with_line(line));
        }
        let finding = tally.into_finding().unwrap();
        assert_eq!(finding.count, MAX_EXAMPLES as u64 + 5);
        assert_eq!(finding.examples.len(), MAX_EXAMPLES);
        assert_eq!(finding.examples[0].line, Some(0));
    }
}
