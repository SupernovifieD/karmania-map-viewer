//! Attribute columns handed over from JavaScript as typed arrays.

use karmania_core::CrsRef;
use karmania_io::build::{ColumnInput, ColumnValues};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};

/// A set of attribute columns for a dataset being built from arrays.
///
/// Create one with `new ColumnSet()`, add a column for each attribute with the
/// `add...` method for its type, and pass it to one of the `load...` methods of the
/// kernel, which uses it up. Every column needs one value for each element of the
/// dataset (each point, line, ...). `nulls`, when given, has one byte for each value:
/// 1 for a null, 0 otherwise.
#[wasm_bindgen]
#[derive(Default)]
pub struct ColumnSet {
    columns: Vec<ColumnInput>,
}

impl ColumnSet {
    /// The columns, in the order they were added.
    pub(crate) fn into_columns(self) -> Vec<ColumnInput> {
        self.columns
    }

    fn push(&mut self, name: &str, values: ColumnValues, nulls: Option<Vec<u8>>) {
        self.columns.push(ColumnInput {
            name: name.to_string(),
            values,
            nulls: nulls.map(|flags| flags.into_iter().map(|flag| flag != 0).collect()),
        });
    }
}

#[wasm_bindgen]
impl ColumnSet {
    /// An empty set of columns.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> ColumnSet {
        ColumnSet::default()
    }

    /// Adds a column of decimal numbers (a `Float64Array`).
    #[wasm_bindgen(js_name = addFloat)]
    pub fn add_float(&mut self, name: &str, values: Vec<f64>, nulls: Option<Vec<u8>>) {
        self.push(name, ColumnValues::Float(values), nulls);
    }

    /// Adds a column of whole numbers (a `BigInt64Array`, so none is lost beyond 2^53).
    #[wasm_bindgen(js_name = addInt)]
    pub fn add_int(&mut self, name: &str, values: Vec<i64>, nulls: Option<Vec<u8>>) {
        self.push(name, ColumnValues::Int(values), nulls);
    }

    /// Adds a column of true and false (a `Uint8Array` of 1 and 0).
    #[wasm_bindgen(js_name = addBool)]
    pub fn add_bool(&mut self, name: &str, values: Vec<u8>, nulls: Option<Vec<u8>>) {
        let values = values.into_iter().map(|value| value != 0).collect();
        self.push(name, ColumnValues::Bool(values), nulls);
    }

    /// Adds a column of text (an array of strings).
    #[wasm_bindgen(js_name = addText)]
    pub fn add_text(&mut self, name: &str, values: Vec<String>, nulls: Option<Vec<u8>>) {
        self.push(name, ColumnValues::Text(values), nulls);
    }

    /// Adds a column of text from a short list: `codes` (a `Uint32Array`) holds, for
    /// each value, the index of its text in `dictionary` (an array of strings).
    #[wasm_bindgen(js_name = addCategory)]
    pub fn add_category(
        &mut self,
        name: &str,
        codes: Vec<u32>,
        dictionary: Vec<String>,
        nulls: Option<Vec<u8>>,
    ) {
        self.push(name, ColumnValues::Category { codes, dictionary }, nulls);
    }
}

/// Reads a coordinate system argument: `{ kind: "epsg", code }`, `{ kind: "local",
/// units }`, or `null` or `undefined` for none (which validation reports).
pub(crate) fn read_crs(value: &JsValue) -> Result<Option<CrsRef>, JsError> {
    if value.is_undefined() || value.is_null() {
        return Ok(None);
    }
    serde_wasm_bindgen::from_value(value.clone())
        .map(Some)
        .map_err(|error| JsError::new(&format!("the coordinate system is not valid: {error}")))
}
