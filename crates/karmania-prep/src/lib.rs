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

pub mod blocks;
pub mod choice;
pub mod classify;
pub mod drawable;
pub mod frame;
pub mod grid;
pub mod jenks;
pub mod lines;
pub mod mesh;
pub mod origin;
pub mod points;
pub mod polygons;
pub mod project;
pub mod stats;
pub mod surface;
#[cfg(test)]
mod testutil;
pub mod warp;

pub use blocks::{BlocksBuffers, blocks_buffers};
pub use choice::{DrawableEntry, FrameChoice, choose_frame};
pub use classify::{ClassBreaks, MAX_CATEGORIES, MAX_CLASSES, Method, class_of, classify};
pub use drawable::{DrawStatus, Drawability, drawable};
pub use frame::{MapCrsChoice, map_crs_for, utm_crs};
pub use grid::{
    GridBuffers, GridLayout, GridPlacement, GridWarp, Tile, grid_buffers, grid_image, tiles,
};
pub use lines::{LinesBuffers, lines_buffers};
pub use mesh::{MeshBuffers, mesh_buffers};
pub use origin::{Frame, FrameSource, origin_near};
pub use points::{PointsBuffers, points_buffers};
pub use polygons::{PolygonsBuffers, polygons_buffers};
pub use project::{Prepared, project};
pub use stats::{
    Category, ColumnStats, DISTINCT_LIMIT, Distinct, column_stats, column_stats_with_limit,
};
pub use surface::{SurfaceBuffers, surface_buffers};

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
