//! The kernel object: the loaded datasets and the imports in progress.

use karmania_io::kernel::Kernel as CoreKernel;
use karmania_io::mapping::ImportMapping;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};

use crate::convert::to_js;
use crate::input::{DatasetInput, read_dataset};

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

    /// Loads a dataset made from arrays. `input` is one object: `{ kind, name, crs,
    /// ... }` with typed arrays for the numbers, in the shape the engine builds (see
    /// the `KernelDataset` type). Returns the same result as an import: `{ status:
    /// "loaded", summaries }` or `{ status: "blocked", findings }`.
    ///
    /// # Errors
    ///
    /// Throws, naming the field, if `input` is not of the right shape: a missing
    /// field, an unknown kind, an array of the wrong type.
    pub fn load(&mut self, input: &JsValue) -> Result<JsValue, JsError> {
        let result = match read_dataset(input)? {
            DatasetInput::Points(points) => self.inner.load_points(points),
            DatasetInput::Lines(lines) => self.inner.load_lines(lines),
            DatasetInput::Polygons(polygons) => self.inner.load_polygons(polygons),
            DatasetInput::Mesh(mesh) => self.inner.load_mesh(mesh),
        };
        to_js(&result)
    }
}

impl Default for Kernel {
    fn default() -> Self {
        Self::new()
    }
}
