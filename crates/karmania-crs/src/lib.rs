//! Karmania coordinate systems.
//!
//! What an EPSG code means (its name, whether it is geographic or projected, and its
//! units), searching the registry, and converting positions from one coordinate system to
//! another. The definitions live here and not in `karmania-core`, which only carries a CRS
//! identifier and does not interpret it (see `CrsRef`).
//!
//! This crate performs no I/O, contains no WebAssembly-specific code and keeps no global
//! state. Data problems are findings, never panics.
//!
//! # The EPSG Dataset
//!
//! The definitions are those of the EPSG Dataset, maintained by IOGP (<https://epsg.org>), as the
//! `crs-definitions` crate carries them (generated from the `spatial_ref_sys` table of PostGIS,
//! which derives from the EPSG Dataset). Ownership of the EPSG Dataset by IOGP must be
//! acknowledged in any publication or transmission of it, and anyone it is given to must be told
//! that the EPSG terms of use apply (<https://epsg.org/terms-of-use.html>). The EPSG Dataset is
//! provided as is, without warranty. Read the terms before redistributing the definitions; how
//! this repository meets them is in `docs/dependencies.md`.

#![forbid(unsafe_code)]

pub mod info;
pub mod lookup;
pub mod search;
pub mod wkt;

pub use info::{AxisUnits, CrsInfo, CrsKind, describe};
pub use lookup::lookup;
pub use search::{MAX_RESULTS, search};

#[cfg(test)]
mod tests {
    use karmania_core::CrsRef;

    /// The crate builds against `karmania-core` and can name its CRS types.
    #[test]
    fn it_links_against_the_core_crs_types() {
        let wgs84 = CrsRef::Epsg { code: 4326 };
        assert_eq!(wgs84, CrsRef::Epsg { code: 4326 });
        assert_ne!(wgs84, CrsRef::Epsg { code: 32640 });
    }
}
