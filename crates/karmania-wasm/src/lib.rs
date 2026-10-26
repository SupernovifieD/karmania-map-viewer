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

use js_sys::{Array, Reflect, Uint8Array};
use karmania_io::kernel::Kernel as CoreKernel;
use karmania_io::mapping::ImportMapping;
use karmania_io::preview::{Sidecar, preview as preview_file};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsError, JsValue};

use convert::to_js;

/// The version of the kernel, the same as this crate's package version.
#[wasm_bindgen]
#[must_use]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// A sidecar file taken from JavaScript: `{ name: string, bytes: Uint8Array }`.
struct SidecarInput {
    name: String,
    bytes: Vec<u8>,
}

/// Reads the `sidecars` argument: an array of `{ name, bytes }` objects.
fn read_sidecars(value: &JsValue) -> Result<Vec<SidecarInput>, JsError> {
    if value.is_undefined() || value.is_null() {
        return Ok(Vec::new());
    }
    let array = value
        .dyn_ref::<Array>()
        .ok_or_else(|| JsError::new("sidecars must be an array of { name, bytes } objects"))?;
    array
        .iter()
        .map(|item| {
            let name = Reflect::get(&item, &JsValue::from_str("name"))
                .ok()
                .and_then(|name| name.as_string())
                .ok_or_else(|| JsError::new("a sidecar needs a name that is a string"))?;
            let bytes = Reflect::get(&item, &JsValue::from_str("bytes"))
                .ok()
                .and_then(|bytes| bytes.dyn_into::<Uint8Array>().ok())
                .ok_or_else(|| JsError::new("a sidecar needs bytes that are a Uint8Array"))?;
            Ok(SidecarInput {
                name,
                bytes: bytes.to_vec(),
            })
        })
        .collect()
}

/// Looks at a file before it is imported.
///
/// `sidecars` is an array of `{ name: string, bytes: Uint8Array }` for files chosen
/// with it; only a `.prj` is used. Returns the preview: format, suggested kind,
/// encoding, the layout of a delimited file with suggestions, the coordinate system
/// and where it came from, and file-level findings. A file that cannot be read gives
/// a preview with no format and a finding that says why; it does not throw.
///
/// # Errors
///
/// Throws if `sidecars` is not an array of `{ name, bytes }` objects.
#[wasm_bindgen]
pub fn preview(file_name: &str, bytes: &[u8], sidecars: JsValue) -> Result<JsValue, JsError> {
    let inputs = read_sidecars(&sidecars)?;
    let borrowed: Vec<Sidecar<'_>> = inputs
        .iter()
        .map(|input| Sidecar {
            file_name: &input.name,
            bytes: &input.bytes,
        })
        .collect();
    to_js(&preview_file(file_name, bytes, &borrowed))
}

/// The kernel: the loaded datasets and the imports in progress.
///
/// Create one with `new Kernel()` in the worker, and call `free()` to release its
/// memory. Kernels share nothing, so a page can hold several. Methods throw only for
/// misuse (an import that does not exist, a mapping of the wrong shape); problems
/// with the data come back as findings in the results.
#[wasm_bindgen]
pub struct Kernel {
    inner: CoreKernel,
}

#[wasm_bindgen]
impl Kernel {
    /// A kernel with nothing loaded.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Kernel {
        Kernel {
            inner: CoreKernel::new(),
        }
    }

    /// Starts importing a file and returns the import's id. `mapping` is an
    /// `ImportMapping` object. Nothing is read until `stepImport` is called.
    ///
    /// # Errors
    ///
    /// Throws if `mapping` does not have the shape of an `ImportMapping`.
    #[wasm_bindgen(js_name = startImport)]
    pub fn start_import(
        &mut self,
        file_name: &str,
        bytes: &[u8],
        mapping: JsValue,
    ) -> Result<u32, JsError> {
        let mapping: ImportMapping = serde_wasm_bindgen::from_value(mapping)
            .map_err(|error| JsError::new(&format!("the import mapping is not valid: {error}")))?;
        Ok(self.inner.start_import(file_name, bytes, mapping))
    }

    /// Does the next step of an import: up to `budgetRows` rows of parsing (at least
    /// one), or the validation of one dataset. Returns `{ status: "progress", phase,
    /// fraction }` or `{ status: "done", result }`, where `result` is
    /// `{ status: "loaded", summaries }` or `{ status: "blocked", findings }`. After
    /// `done` the import no longer exists.
    ///
    /// # Errors
    ///
    /// Throws if there is no import with that id: it never existed, it already
    /// finished or it was cancelled.
    #[wasm_bindgen(js_name = stepImport)]
    pub fn step_import(&mut self, import: u32, budget_rows: u32) -> Result<JsValue, JsError> {
        let budget = usize::try_from(budget_rows).unwrap_or(usize::MAX);
        match self.inner.step_import(import, budget) {
            Some(status) => to_js(&status),
            None => Err(JsError::new("there is no import with that id")),
        }
    }

    /// Stops an import and drops what it has read. Returns whether there was one.
    #[wasm_bindgen(js_name = cancelImport)]
    pub fn cancel_import(&mut self, import: u32) -> bool {
        self.inner.cancel_import(import)
    }

    /// The summaries of the loaded datasets, in the order they were loaded.
    ///
    /// # Errors
    ///
    /// Throws only if a summary cannot be turned into a JavaScript value.
    pub fn datasets(&self) -> Result<JsValue, JsError> {
        to_js(&self.inner.registry().summaries())
    }
}

impl Default for Kernel {
    fn default() -> Self {
        Self::new()
    }
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
