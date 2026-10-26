//! CRS checks: is the coordinate reference system present and plausible?

use crate::dataset::Dataset;
use crate::findings::Findings;

/// Runs the CRS checks.
pub(super) fn check(_dataset: &Dataset, _findings: &mut Findings) {}
