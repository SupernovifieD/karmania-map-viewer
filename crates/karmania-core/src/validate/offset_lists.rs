//! Checks for offsets lists, shared by lines and polygons.

use crate::codes::FindingCode;
use crate::findings::{Finding, Findings, Location};
use crate::text::format_count;

/// The four finding codes one offsets list can produce.
pub(super) struct OffsetCodes {
    pub empty: FindingCode,
    pub bad_start: FindingCode,
    pub bad_end: FindingCode,
    pub decreasing: FindingCode,
}

/// How to describe an offsets list in messages.
pub(super) struct OffsetsSpec {
    pub codes: OffsetCodes,
    /// The list in words, as the start of a sentence: "The list that says where
    /// each line starts".
    pub list: &'static str,
    /// What the list divides up, singular: "line".
    pub item: &'static str,
    /// What the list points into, plural: "vertices".
    pub target: &'static str,
}

/// Checks that `offsets` is a valid offsets list: not empty, starting at 0,
/// ending at `expected_end` and never going backwards. Each problem gives one
/// finding; backwards steps are counted and the first few are shown as examples.
pub(super) fn check(
    offsets: &[u32],
    expected_end: usize,
    spec: &OffsetsSpec,
    findings: &mut Findings,
) {
    let target = spec.target;
    let end_text = format_count(expected_end as u64);
    let hint = format!("Start with 0, end with the number of {target}, and never go backwards.");
    let (Some(&first), Some(&last)) = (offsets.first(), offsets.last()) else {
        findings.add(
            Finding::new(
                spec.codes.empty,
                format!(
                    "{} is empty. It must start with 0 and end with the number of {target} ({end_text}).",
                    spec.list
                ),
            )
            .with_hint(hint),
        );
        return;
    };
    if first != 0 {
        findings.add(
            Finding::new(
                spec.codes.bad_start,
                format!(
                    "{} must start with 0, but it starts with {}.",
                    spec.list,
                    format_count(u64::from(first))
                ),
            )
            .with_hint(hint.clone()),
        );
    }
    if usize::try_from(last).ok() != Some(expected_end) {
        findings.add(
            Finding::new(
                spec.codes.bad_end,
                format!(
                    "{} must end with the number of {target} ({end_text}), but it ends with {}.",
                    spec.list,
                    format_count(u64::from(last))
                ),
            )
            .with_hint(hint.clone()),
        );
    }
    let mut backwards = Finding::new(
        spec.codes.decreasing,
        format!("Some {}s end before they start.", spec.item),
    )
    .with_hint(hint);
    backwards.count = 0;
    for (i, pair) in offsets.windows(2).enumerate() {
        if let [from, to] = *pair
            && to < from
        {
            backwards.count += 1;
            backwards = backwards.at(Location::default().with_element(i as u64));
        }
    }
    if backwards.count > 0 {
        findings.add(backwards);
    }
}
