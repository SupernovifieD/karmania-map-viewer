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

/// Words as a list for a message: "a", "a and b", "a, b and c".
pub(crate) fn join_and(words: &[&str]) -> String {
    match words {
        [] => String::new(),
        [only] => (*only).to_string(),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    }
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
    fn words_are_joined_with_commas_and_a_final_and() {
        assert_eq!(join_and(&[]), "");
        assert_eq!(join_and(&["a"]), "a");
        assert_eq!(join_and(&["a", "b"]), "a and b");
        assert_eq!(join_and(&["a", "b", "c"]), "a, b and c");
    }

    #[test]
    fn a_tally_counts_everything_and_keeps_a_limited_number_of_examples() {
        let mut tally =
            Tally::new(Finding::new(FindingCode::CsvRowsSkipped, "Skipped.").with_hint("A hint."));
        assert!(
            Tally::new(Finding::new(FindingCode::CsvRowsSkipped, "Skipped.").with_hint("A hint."))
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
