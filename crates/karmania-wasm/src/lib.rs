//! WebAssembly bindings for Karmania.
//!
//! This crate only translates between JavaScript and the Rust kernel
//! (`karmania-core` and `karmania-io`): it converts arguments and results and
//! holds no logic of its own. Built with `scripts/build-wasm` for use from a
//! module Web Worker.
//!
//! Data problems never throw. They come back as findings in the result; the only
//! errors thrown are for misuse, such as passing something that is not a list of
//! files, or asking for a dataset that does not exist.

mod convert;
mod input;
mod kernel;
mod page;
mod preview;

pub use kernel::Kernel;
pub use preview::preview;

use wasm_bindgen::prelude::wasm_bindgen;

/// The version of the kernel, the same as this crate's package version.
#[wasm_bindgen]
#[must_use]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_version_is_the_package_version() {
        assert_eq!(version(), env!("CARGO_PKG_VERSION"));
        assert!(!version().is_empty());
    }
}
