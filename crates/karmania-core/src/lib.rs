//! Karmania core: the standard data model for the six map data shapes and the
//! validator that checks them.
//!
//! This crate performs no I/O, contains no WebAssembly-specific code and keeps
//! no global state, so the same code can later be bound to other languages.

#![forbid(unsafe_code)]

pub mod codes;
pub mod column;
pub mod crs;
pub mod dataset;
pub mod findings;
pub mod lines;
pub mod mesh;
mod offsets;
pub mod polygons;
pub mod positions;
pub mod table;
pub mod text;
pub mod validity;

pub use codes::FindingCode;
pub use column::{Column, ColumnData, ColumnType, LengthMismatch, Value};
pub use crs::{CrsRef, Units};
pub use dataset::{Dataset, DatasetId, Geometry, Kind, Provenance};
pub use findings::{Finding, Findings, Location, MAX_EXAMPLES, Severity, WizardStep};
pub use lines::Lines;
pub use mesh::Mesh;
pub use polygons::Polygons;
pub use positions::Positions;
pub use table::Table;
pub use validity::Validity;

#[cfg(test)]
mod tests {
    #[test]
    fn crate_identity() {
        assert_eq!(env!("CARGO_PKG_NAME"), "karmania-core");
    }
}
