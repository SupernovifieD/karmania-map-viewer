//! The kernel object: the loaded datasets and the imports in progress.

use js_sys::Uint8Array;
use karmania_core::{CrsRef, DatasetId};
use karmania_crs::Definitions;
use karmania_io::kernel::Kernel as CoreKernel;
use karmania_io::mapping::ImportMapping;
use karmania_prep::{ClassBreaks, Frame, Method, Preparer, class_index_of, classify_dataset};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};

use crate::convert::{to_js, to_js_with_nulls};
use crate::input::{DatasetInput, read_dataset};
use crate::page::page_to_js;
use crate::prepare::step_to_js;

/// The kernel behind the bindings: it asks the EPSG definitions which codes are longitude and
/// latitude systems and which are not in them, so that validation checks the coordinates of
/// every geographic system and warns about a code it does not know.
fn core_kernel() -> CoreKernel {
    CoreKernel::with_kinds(Box::new(Definitions))
}

/// The coordinate system a caller prefers, from what it passed: none for `undefined` and `null`.
fn preferred_crs(preferred: JsValue) -> Result<Option<CrsRef>, JsError> {
    if preferred.is_undefined() || preferred.is_null() {
        return Ok(None);
    }
    serde_wasm_bindgen::from_value(preferred)
        .map(Some)
        .map_err(|error| {
            JsError::new(&format!(
                "the preferred coordinate system is not valid: {error}"
            ))
        })
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
    prep: Preparer,
}

#[wasm_bindgen]
impl Kernel {
    /// A kernel with nothing loaded.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Kernel {
        Kernel {
            inner: core_kernel(),
            prep: Preparer::new(),
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

    /// The summary of one loaded dataset, or `undefined` if there is no such dataset.
    ///
    /// # Errors
    ///
    /// Throws only if the summary cannot be turned into a JavaScript value.
    pub fn summary(&self, dataset: u32) -> Result<JsValue, JsError> {
        match self.inner.registry().summary(DatasetId(u64::from(dataset))) {
            Some(summary) => to_js(summary),
            None => Ok(JsValue::UNDEFINED),
        }
    }

    /// Rows `start` to `start + count` of a loaded dataset, as `{ start, count, columns
    /// }`. Each column is `{ name, values, nulls }`: the geometry columns come first
    /// (for points `X`, `Y`, `Z`; for lines `line #` and `vertex count`; ...) and then
    /// the attributes. `values` is a `Float64Array`, `Int32Array`, `Uint8Array` or an
    /// array of strings; `nulls` has a 1 for each null. A window past the end is cut
    /// short, and `count` says how many rows came back (at most 100,000).
    ///
    /// # Errors
    ///
    /// Throws if there is no dataset with that id.
    pub fn rows(&self, dataset: u32, start: u32, count: u32) -> Result<JsValue, JsError> {
        let found = self
            .inner
            .registry()
            .dataset(DatasetId(u64::from(dataset)))
            .ok_or_else(|| JsError::new("there is no dataset with that id"))?;
        page_to_js(&found.page(u64::from(start), u64::from(count)))
    }

    /// Unloads a dataset. Returns whether there was one with that id.
    pub fn remove(&mut self, dataset: u32) -> bool {
        let id = DatasetId(u64::from(dataset));
        let removed = self.inner.registry_mut().remove(id);
        self.prep.removed(id, self.inner.registry().len());
        removed
    }

    /// Chooses the coordinate system the map is drawn in and says which datasets are drawn in it, as
    /// `{ frame, drawable, findings }`: `frame` is `{ mapCrs, origin, source }` or `null` when nothing
    /// is loaded; `drawable` has `{ id, status: "drawn" | "not_drawn", reprojected, findings }` for each
    /// dataset in the order they were loaded; `findings` are about the choice itself (the UTM zone). The
    /// frame is kept: it stays while any dataset is loaded, so call this again after loading or
    /// removing. `preferred` is a `CrsRef` the person chose, or `undefined` / `null`.
    ///
    /// # Errors
    ///
    /// Throws if `preferred` is not a `CrsRef`.
    #[wasm_bindgen(js_name = chooseFrame)]
    pub fn choose_frame(&mut self, preferred: JsValue) -> Result<JsValue, JsError> {
        let preferred = preferred_crs(preferred)?;
        let datasets = self.inner.registry().datasets();
        to_js_with_nulls(&self.prep.choose_frame(preferred, &datasets))
    }

    /// What `chooseFrame(preferred)` would answer now, in the same form, **without changing anything**: the
    /// frame the kernel keeps, and its origin, stay as they are. It is for asking what a coordinate system
    /// that a person is thinking of would do to the map (which datasets would start or stop being drawn,
    /// and why) before it is chosen, which `chooseFrame` cannot say since it keeps what it answers.
    ///
    /// # Errors
    ///
    /// Throws if `preferred` is not a `CrsRef`.
    #[wasm_bindgen(js_name = previewFrame)]
    pub fn preview_frame(&self, preferred: JsValue) -> Result<JsValue, JsError> {
        let preferred = preferred_crs(preferred)?;
        let datasets = self.inner.registry().datasets();
        to_js_with_nulls(&self.prep.preview_frame(preferred, &datasets))
    }

    /// Starts preparing a dataset for drawing and returns the job's id. `frame` is the `{ mapCrs,
    /// origin, source }` that `chooseFrame` gave; `maxTextureSize` is the largest texture the graphics
    /// card takes, in cells on a side. Nothing is done until `stepPrepare`.
    ///
    /// # Errors
    ///
    /// Throws if there is no dataset with that id or `frame` does not have the shape of a frame.
    #[wasm_bindgen(js_name = startPrepare)]
    pub fn start_prepare(
        &mut self,
        dataset: u32,
        frame: JsValue,
        max_texture_size: u32,
    ) -> Result<u32, JsError> {
        let frame: Frame = serde_wasm_bindgen::from_value(frame)
            .map_err(|error| JsError::new(&format!("the frame is not valid: {error}")))?;
        let found = self
            .inner
            .registry()
            .dataset(DatasetId(u64::from(dataset)))
            .ok_or_else(|| JsError::new("there is no dataset with that id"))?;
        Ok(self.prep.start(found, frame, max_texture_size))
    }

    /// Does the next part of a prepare: up to `budget` positions, polygon vertices, cells or blocks (at
    /// least one), or a tile of a warped grid. Returns `{ status: "progress", fraction }`, `{ status:
    /// "cancelled" }` (the dataset was removed) or `{ status: "done", result }`, where `result` is `{
    /// status: "drawn", buffers, findings }` with typed arrays in `buffers`, or `{ status: "not_drawn",
    /// findings }`. After `done` or `cancelled` the job no longer exists.
    ///
    /// # Errors
    ///
    /// Throws if there is no job with that id: it never existed, it is over or it was cancelled.
    #[wasm_bindgen(js_name = stepPrepare)]
    pub fn step_prepare(&mut self, job: u32, budget: u32) -> Result<JsValue, JsError> {
        let no_job = || JsError::new("there is no prepare with that id");
        let dataset = self.prep.dataset_of(job).ok_or_else(no_job)?;
        let found = self.inner.registry().dataset(dataset);
        let budget = usize::try_from(budget).unwrap_or(usize::MAX);
        let step = self.prep.step(job, found, budget).ok_or_else(no_job)?;
        step_to_js(&step)
    }

    /// Stops a prepare and drops what it has made. Returns whether there was one.
    #[wasm_bindgen(js_name = cancelPrepare)]
    pub fn cancel_prepare(&mut self, job: u32) -> bool {
        self.prep.cancel(job)
    }

    /// Divides a column of a dataset into classes. `method` is `"equal"`, `"quantile"`, `"jenks"` or
    /// `"categories"`. Returns `{ status: "classified", breaks }`, where `breaks` is `{ kind: "ranges",
    /// column, bounds, counts, nulls, sampled? }` or `{ kind: "categories", column, values, counts,
    /// other?, nulls }`, or `{ status: "not_classified", findings }` when the column cannot be classified.
    ///
    /// # Errors
    ///
    /// Throws if there is no dataset with that id or `method` is not one of the four.
    pub fn classify(
        &self,
        dataset: u32,
        column: &str,
        method: &str,
        classes: u32,
    ) -> Result<JsValue, JsError> {
        let found = self
            .inner
            .registry()
            .dataset(DatasetId(u64::from(dataset)))
            .ok_or_else(|| JsError::new("there is no dataset with that id"))?;
        let method: Method = serde_wasm_bindgen::from_value(JsValue::from_str(method))
            .map_err(|_| JsError::new("the method is not equal, quantile, jenks or categories"))?;
        let classes = usize::try_from(classes).unwrap_or(usize::MAX);
        match classify_dataset(found, column, method, classes) {
            Ok(breaks) => to_js(&Classified::Classified { breaks }),
            Err(finding) => to_js(&Classified::NotClassified {
                findings: vec![finding],
            }),
        }
    }

    /// The class of every element of a dataset under `breaks` (what `classify` gave), as a `Uint8Array`
    /// with one byte for each element that is drawn (every element, but for a grid of several layers, of which only the
    /// first is drawn, the cells of that layer): the class, or 255 for an element with no value.
    ///
    /// # Errors
    ///
    /// Throws if there is no dataset with that id, `breaks` is not a set of class breaks, or the dataset
    /// has no column of the name the breaks give.
    #[wasm_bindgen(js_name = classIndex)]
    pub fn class_index(&self, dataset: u32, breaks: JsValue) -> Result<Uint8Array, JsError> {
        let found = self
            .inner
            .registry()
            .dataset(DatasetId(u64::from(dataset)))
            .ok_or_else(|| JsError::new("there is no dataset with that id"))?;
        let breaks: ClassBreaks = serde_wasm_bindgen::from_value(breaks)
            .map_err(|error| JsError::new(&format!("the class breaks are not valid: {error}")))?;
        let index =
            class_index_of(found, &breaks).map_err(|finding| JsError::new(&finding.message))?;
        Ok(Uint8Array::from(index.as_slice()))
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
            DatasetInput::Grid(grid) => self.inner.load_grid(grid),
            DatasetInput::Blocks(blocks) => self.inner.load_blocks(blocks),
        };
        to_js(&result)
    }
}

/// What `classify` answers.
#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum Classified {
    Classified {
        breaks: ClassBreaks,
    },
    NotClassified {
        findings: Vec<karmania_core::Finding>,
    },
}

impl Default for Kernel {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use karmania_core::{CrsRef, Kind};
    use karmania_io::build::PointsInput;
    use karmania_io::kernel::ImportStatus;
    use karmania_io::mapping::{ColumnMapping, EmptyCoordinates, Nodata};
    use karmania_io::numbers::DecimalSeparator;
    use karmania_io::registry::LoadResult;
    use karmania_io::roles::Role;

    use super::*;

    fn codes_of(result: LoadResult) -> Vec<&'static str> {
        let LoadResult::Loaded { summaries } = result else {
            panic!("expected the dataset to be loaded")
        };
        summaries[0]
            .findings
            .iter()
            .map(|finding| finding.code.as_str())
            .collect()
    }

    /// Points at 500 000 m east and 2 800 000 m north: UTM-looking numbers, not degrees.
    fn points(code: u32) -> PointsInput {
        PointsInput {
            name: "Wells".into(),
            crs: Some(CrsRef::Epsg { code }),
            x: vec![500_000.0, 500_010.0],
            y: vec![2_800_000.0, 2_800_010.0],
            z: None,
            columns: Vec::new(),
        }
    }

    #[test]
    fn points_from_arrays_are_checked_against_every_geographic_code_of_the_definitions() {
        // 4269 (NAD83) is geographic in the definitions, so these numbers cannot be right. The
        // core alone does not know the code, and says nothing: this is what the definitions add.
        let nad83 = codes_of(core_kernel().load_points(points(4269)));
        assert_eq!(nad83, ["crs.geographic.out_of_range"]);
        // The same numbers in UTM are fine.
        assert!(codes_of(core_kernel().load_points(points(32640))).is_empty());
    }

    #[test]
    fn a_code_that_is_not_in_the_definitions_is_a_warning_and_the_dataset_is_loaded() {
        let mut kernel = core_kernel();
        let codes = codes_of(kernel.load_points(points(99_999)));
        assert_eq!(codes, ["crs.code.unknown"]);
        assert_eq!(kernel.registry().len(), 1);
    }

    fn csv_mapping(code: u32) -> ImportMapping {
        let column = |source: &str, role| ColumnMapping {
            source: source.into(),
            role,
            column_type: None,
            rename: None,
        };
        ImportMapping {
            dataset_name: "Collars".into(),
            kind: Kind::Points,
            columns: vec![column("x", Role::X), column("y", Role::Y)],
            nodata: Nodata {
                tokens: vec![String::new()],
                numbers: Vec::new(),
            },
            empty_coordinates: EmptyCoordinates::Error,
            block_size: None,
            decimal_separator: DecimalSeparator::Point,
            crs: Some(CrsRef::Epsg { code }),
        }
    }

    fn imported(code: u32) -> Vec<&'static str> {
        let mut kernel = core_kernel();
        let id = kernel.start_import(
            "wells.csv",
            b"x,y\n500000,2800000\n500010,2800010\n",
            csv_mapping(code),
        );
        loop {
            match kernel.step_import(id, 100).expect("the import exists") {
                ImportStatus::Done { result } => return codes_of(result),
                ImportStatus::Progress { .. } => {}
            }
        }
    }

    #[test]
    fn an_imported_file_is_checked_the_same_way() {
        assert_eq!(imported(4269), ["crs.geographic.out_of_range"]);
        assert_eq!(imported(99_999), ["crs.code.unknown"]);
        assert!(imported(32640).is_empty());
    }
}
