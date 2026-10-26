//! Findings: plain-language reports about problems and facts found in data.
//!
//! Data problems are never panics. They become findings, and nothing is fixed
//! silently: every conversion, skip or default produces a finding with a count.

use std::collections::BTreeMap;

use serde::{Serialize, Serializer};

/// The most example locations a single finding keeps.
pub const MAX_EXAMPLES: usize = 20;

/// How serious a finding is. Ordered most severe first, so sorting puts errors
/// before warnings before info.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// The shape cannot be represented or drawn correctly. Nothing is loaded.
    Error,
    /// The data loads, but something looks off or was changed.
    Warning,
    /// A neutral fact, for example "created 3 datasets".
    Info,
}

/// The import wizard step where the user can fix a finding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WizardStep {
    /// Choosing the file, its format and its kind.
    File,
    /// Assigning column roles, types and names.
    Mapping,
    /// Choosing which values mean "no data".
    Nodata,
    /// Choosing the coordinate reference system.
    Crs,
}

/// Where in the source data a finding occurred. Every part is optional.
///
/// `line` is 1-based because it is what users see in a text editor (the header
/// counts as line 1). All other indices are 0-based.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Location {
    /// 1-based line number in the source file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u64>,
    /// 0-based data row, not counting a header.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row: Option<u64>,
    /// 0-based element index (point, line, polygon, triangle, cell or block).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element: Option<u64>,
    /// 0-based vertex index.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertex: Option<u64>,
    /// Column name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
    /// 0-based cell index `[i, j, k]` in a lattice.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell: Option<[u32; 3]>,
}

impl Location {
    /// Sets the 1-based source line.
    #[must_use]
    pub fn with_line(mut self, line: u64) -> Self {
        self.line = Some(line);
        self
    }

    /// Sets the 0-based data row.
    #[must_use]
    pub fn with_row(mut self, row: u64) -> Self {
        self.row = Some(row);
        self
    }

    /// Sets the 0-based element index.
    #[must_use]
    pub fn with_element(mut self, element: u64) -> Self {
        self.element = Some(element);
        self
    }

    /// Sets the 0-based vertex index.
    #[must_use]
    pub fn with_vertex(mut self, vertex: u64) -> Self {
        self.vertex = Some(vertex);
        self
    }

    /// Sets the column name.
    #[must_use]
    pub fn with_column(mut self, column: impl Into<String>) -> Self {
        self.column = Some(column.into());
        self
    }

    /// Sets the 0-based lattice cell `[i, j, k]`.
    #[must_use]
    pub fn with_cell(mut self, cell: [u32; 3]) -> Self {
        self.cell = Some(cell);
        self
    }
}

/// One kind of problem or fact, possibly aggregated over many occurrences.
///
/// The `message` says what is wrong and where, in plain language with no jargon.
/// The `hint` says what the user can do about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Finding {
    /// Stable dotted lowercase identifier, for example `crs.missing`.
    pub code: &'static str,
    /// How serious the finding is.
    pub severity: Severity,
    /// What is wrong and where, in plain language.
    pub message: String,
    /// What the user can do about it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    /// Number of occurrences, at least 1.
    pub count: u64,
    /// Where it happened, in order of occurrence, at most [`MAX_EXAMPLES`].
    pub examples: Vec<Location>,
    /// The wizard step that can fix it, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<WizardStep>,
}

impl Finding {
    /// Creates a finding with one occurrence and no examples.
    #[must_use]
    pub fn new(code: &'static str, severity: Severity, message: impl Into<String>) -> Self {
        Self {
            code,
            severity,
            message: message.into(),
            hint: None,
            count: 1,
            examples: Vec::new(),
            step: None,
        }
    }

    /// Sets what the user can do about the finding.
    #[must_use]
    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    /// Sets the wizard step that can fix the finding.
    #[must_use]
    pub fn with_step(mut self, step: WizardStep) -> Self {
        self.step = Some(step);
        self
    }

    /// Adds an example location, ignored once [`MAX_EXAMPLES`] are kept.
    #[must_use]
    pub fn at(mut self, location: Location) -> Self {
        if self.examples.len() < MAX_EXAMPLES {
            self.examples.push(location);
        }
        self
    }
}

/// An ordered collection of findings that merges repeats.
///
/// Two findings with the same code and the same message are one finding: their
/// counts add up and their examples are appended, keeping at most
/// [`MAX_EXAMPLES`]. Output order is the order of each finding's first
/// occurrence, so the same input always gives the same list.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Findings {
    items: Vec<Finding>,
    index: BTreeMap<(&'static str, String), usize>,
}

impl Findings {
    /// Creates an empty collection.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a finding, merging it into an earlier one with the same code and
    /// message. A count of 0 is treated as 1. When merged, the more severe
    /// severity wins and a missing hint or step is filled in.
    pub fn add(&mut self, mut finding: Finding) {
        finding.count = finding.count.max(1);
        let key = (finding.code, finding.message.clone());
        let Some(&at) = self.index.get(&key) else {
            self.index.insert(key, self.items.len());
            finding.examples.truncate(MAX_EXAMPLES);
            self.items.push(finding);
            return;
        };
        let Some(existing) = self.items.get_mut(at) else {
            return;
        };
        existing.count = existing.count.saturating_add(finding.count);
        existing.severity = existing.severity.min(finding.severity);
        let room = MAX_EXAMPLES.saturating_sub(existing.examples.len());
        existing
            .examples
            .extend(finding.examples.into_iter().take(room));
        if existing.hint.is_none() {
            existing.hint = finding.hint;
        }
        if existing.step.is_none() {
            existing.step = finding.step;
        }
    }

    /// Adds every finding of `other`, in its order, merging repeats.
    pub fn extend(&mut self, other: Findings) {
        for finding in other.items {
            self.add(finding);
        }
    }

    /// Number of distinct findings (after merging).
    #[must_use]
    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// True when there are no findings.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// True when at least one finding is an error.
    #[must_use]
    pub fn has_errors(&self) -> bool {
        self.items.iter().any(|f| f.severity == Severity::Error)
    }

    /// The findings in order of first occurrence.
    #[must_use]
    pub fn as_slice(&self) -> &[Finding] {
        &self.items
    }

    /// Iterates over the findings in order of first occurrence.
    pub fn iter(&self) -> std::slice::Iter<'_, Finding> {
        self.items.iter()
    }

    /// Consumes the collection and returns the findings in order.
    #[must_use]
    pub fn into_vec(self) -> Vec<Finding> {
        self.items
    }
}

impl<'a> IntoIterator for &'a Findings {
    type Item = &'a Finding;
    type IntoIter = std::slice::Iter<'a, Finding>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl IntoIterator for Findings {
    type Item = Finding;
    type IntoIter = std::vec::IntoIter<Finding>;

    fn into_iter(self) -> Self::IntoIter {
        self.items.into_iter()
    }
}

impl Serialize for Findings {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.items.serialize(serializer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn severity_sorts_most_severe_first() {
        let mut all = [Severity::Info, Severity::Error, Severity::Warning];
        all.sort();
        assert_eq!(all, [Severity::Error, Severity::Warning, Severity::Info]);
    }

    #[test]
    fn new_finding_has_one_occurrence_and_no_examples() {
        let f = Finding::new("crs.missing", Severity::Error, "No CRS.");
        assert_eq!(f.count, 1);
        assert!(f.examples.is_empty());
        assert_eq!((f.hint, f.step), (None, None));
    }

    #[test]
    fn examples_are_capped_and_keep_occurrence_order() {
        let mut f = Finding::new("x.y", Severity::Info, "m");
        for row in 0..30 {
            f = f.at(Location::default().with_row(row));
        }
        assert_eq!(f.examples.len(), MAX_EXAMPLES);
        assert_eq!(f.examples.first().and_then(|l| l.row), Some(0));
        assert_eq!(f.examples.last().and_then(|l| l.row), Some(19));
    }

    #[test]
    fn full_finding_serializes_to_the_documented_json_shape() {
        let f = Finding::new("crs.missing", Severity::Error, "No CRS.")
            .with_hint("Choose one.")
            .with_step(WizardStep::Crs)
            .at(Location::default().with_line(1203).with_column("Easting"))
            .at(Location::default().with_cell([1, 2, 3]));
        let json = serde_json::to_string(&f).unwrap();
        assert_eq!(
            json,
            r#"{"code":"crs.missing","severity":"error","message":"No CRS.","hint":"Choose one.","count":1,"examples":[{"line":1203,"column":"Easting"},{"cell":[1,2,3]}],"step":"crs"}"#
        );
    }

    #[test]
    fn minimal_finding_omits_optional_fields() {
        let f = Finding::new("a.b", Severity::Warning, "m");
        let json = serde_json::to_string(&f).unwrap();
        assert_eq!(
            json,
            r#"{"code":"a.b","severity":"warning","message":"m","count":1,"examples":[]}"#
        );
    }

    #[test]
    fn every_location_part_serializes_when_set() {
        let l = Location::default()
            .with_line(1)
            .with_row(2)
            .with_element(3)
            .with_vertex(4)
            .with_column("c")
            .with_cell([5, 6, 7]);
        let json = serde_json::to_string(&l).unwrap();
        assert_eq!(
            json,
            r#"{"line":1,"row":2,"element":3,"vertex":4,"column":"c","cell":[5,6,7]}"#
        );
    }

    fn at_row(code: &'static str, message: &str, row: u64) -> Finding {
        Finding::new(code, Severity::Warning, message).at(Location::default().with_row(row))
    }

    #[test]
    fn repeats_merge_into_one_finding_with_a_count() {
        let mut all = Findings::new();
        for row in [4, 9, 11] {
            all.add(at_row("values.null", "Empty value.", row));
        }
        assert_eq!(all.len(), 1);
        let f = &all.as_slice()[0];
        assert_eq!(f.count, 3);
        let rows: Vec<_> = f.examples.iter().map(|l| l.row).collect();
        assert_eq!(rows, [Some(4), Some(9), Some(11)]);
    }

    #[test]
    fn examples_stay_capped_across_merges() {
        let mut all = Findings::new();
        for row in 0..50 {
            all.add(at_row("values.null", "Empty value.", row));
        }
        let f = &all.as_slice()[0];
        assert_eq!(f.count, 50);
        assert_eq!(f.examples.len(), MAX_EXAMPLES);
        assert_eq!(f.examples.last().and_then(|l| l.row), Some(19));
    }

    #[test]
    fn different_code_or_message_stays_separate_in_first_seen_order() {
        let mut all = Findings::new();
        all.add(at_row("b.code", "Same.", 0));
        all.add(at_row("a.code", "Same.", 1));
        all.add(at_row("b.code", "Other message.", 2));
        all.add(at_row("b.code", "Same.", 3));
        let order: Vec<_> = all
            .iter()
            .map(|f| (f.code, f.message.as_str(), f.count))
            .collect();
        assert_eq!(
            order,
            [
                ("b.code", "Same.", 2),
                ("a.code", "Same.", 1),
                ("b.code", "Other message.", 1)
            ]
        );
    }

    #[test]
    fn merging_keeps_the_worst_severity_and_fills_missing_hint_and_step() {
        let mut all = Findings::new();
        all.add(Finding::new("x.y", Severity::Info, "m"));
        all.add(
            Finding::new("x.y", Severity::Error, "m")
                .with_hint("Fix.")
                .with_step(WizardStep::Crs),
        );
        let f = &all.as_slice()[0];
        assert_eq!(f.severity, Severity::Error);
        assert_eq!(f.hint.as_deref(), Some("Fix."));
        assert_eq!(f.step, Some(WizardStep::Crs));
        assert!(all.has_errors());
    }

    #[test]
    fn a_zero_count_is_treated_as_one_and_counts_never_overflow() {
        let mut all = Findings::new();
        let mut zero = Finding::new("x.y", Severity::Info, "m");
        zero.count = 0;
        all.add(zero);
        assert_eq!(all.as_slice()[0].count, 1);
        let mut huge = Finding::new("x.y", Severity::Info, "m");
        huge.count = u64::MAX;
        all.add(huge);
        all.add(Finding::new("x.y", Severity::Info, "m"));
        assert_eq!(all.as_slice()[0].count, u64::MAX);
    }

    #[test]
    fn oversized_example_lists_are_trimmed_on_first_add() {
        let mut f = Finding::new("x.y", Severity::Info, "m");
        f.examples = vec![Location::default(); 40];
        let mut all = Findings::new();
        all.add(f);
        assert_eq!(all.as_slice()[0].examples.len(), MAX_EXAMPLES);
    }

    #[test]
    fn extend_merges_another_collection_in_order() {
        let mut a = Findings::new();
        a.add(at_row("x.y", "m", 0));
        let mut b = Findings::new();
        b.add(at_row("x.y", "m", 7));
        b.add(at_row("z.z", "n", 8));
        a.extend(b);
        let summary: Vec<_> = a.iter().map(|f| (f.code, f.count)).collect();
        assert_eq!(summary, [("x.y", 2), ("z.z", 1)]);
        assert!(!a.has_errors() && !a.is_empty());
    }

    #[test]
    fn a_collection_serializes_as_a_json_array() {
        let mut all = Findings::new();
        assert_eq!(serde_json::to_string(&all).unwrap(), "[]");
        all.add(Finding::new("a.b", Severity::Info, "m"));
        assert_eq!(
            serde_json::to_string(&all).unwrap(),
            r#"[{"code":"a.b","severity":"info","message":"m","count":1,"examples":[]}]"#
        );
    }
}
