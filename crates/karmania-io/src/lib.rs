//! Karmania file readers.
//!
//! Turns files into the standard datasets of `karmania-core`: CSV into points,
//! lines and block models, GeoJSON into points, lines and polygons, ESRI ASCII
//! grids into grids, Wavefront OBJ into meshes, and a `.prj` sidecar into a CRS.
//! Readers never panic on malformed input; every problem becomes a finding.
//!
//! This crate does no WebAssembly-specific work, so the same readers can be
//! used from other languages later.

#![forbid(unsafe_code)]

pub mod asc;
pub mod csv_blocks;
pub mod csv_import;
pub mod delimited;
pub mod detect;
#[cfg(test)]
mod fixtures;
pub mod geojson;
mod geojson_crs;
mod geojson_properties;
mod geojson_shapes;
pub mod infer;
pub mod mapping;
pub mod nodata;
pub mod numbers;
pub mod obj;
mod output;
pub mod prj;
pub mod roles;
pub mod text;

pub use output::ReadOutput;
