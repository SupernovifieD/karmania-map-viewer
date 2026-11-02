//! Karmania coordinate systems.
//!
//! What an EPSG code means (its name, whether it is geographic or projected, and its
//! units), searching the registry, and converting positions from one coordinate system to
//! another. The definitions live here and not in `karmania-core`, which only carries a CRS
//! identifier and does not interpret it (see `CrsRef`).
//!
//! This crate performs no I/O, contains no WebAssembly-specific code and keeps no global
//! state. Data problems are findings, never panics.

#![forbid(unsafe_code)]

pub mod info;
pub mod wkt;

pub use info::{AxisUnits, CrsInfo, CrsKind, describe};

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
