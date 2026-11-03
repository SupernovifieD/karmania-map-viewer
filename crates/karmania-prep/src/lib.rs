//! Karmania display preparation.
//!
//! Everything that stands between a loaded dataset and a picture, done in the worker and not on
//! the page: the coordinate system the map is drawn in, whether a dataset can be drawn in it,
//! positions made relative to an origin so that a 32-bit float keeps their precision, the buffers
//! a renderer uploads, and the classes a column is shown in.
//!
//! The crate depends on `karmania-core` (the data) and `karmania-crs` (reprojection). It performs
//! no I/O, contains no WebAssembly-specific code and keeps no global state. Data problems are
//! findings, never panics. Nothing here invents a value: every number is one that was given or a
//! deterministic restatement of one (reprojected, triangulated, classified for display).

#![forbid(unsafe_code)]

pub mod frame;

pub use frame::{MapCrsChoice, map_crs_for, utm_crs};

#[cfg(test)]
mod tests {
    /// The crate builds against the core and the coordinate systems.
    #[test]
    fn it_links_against_the_core_and_the_crs_crate() {
        let crs = karmania_core::CrsRef::Epsg { code: 32640 };
        assert!(karmania_crs::lookup(32640).is_some());
        assert_eq!(crs, karmania_core::CrsRef::Epsg { code: 32640 });
    }
}
