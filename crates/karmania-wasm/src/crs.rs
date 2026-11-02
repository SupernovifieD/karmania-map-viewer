//! Looking up and searching EPSG codes.

use karmania_crs::{lookup, search};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};

use crate::convert::to_js;

/// What an EPSG code means: `{ code, name, kind, units, metresPerUnit? }`, where `kind` is
/// `"geographic"`, `"projected"` or `"other"`, `units` is `"m"`, `"ft"`, `"us_ft"`, `"degree"` or
/// `"other"`, and `metresPerUnit` is left out for degrees and other units. `undefined` if the code
/// is not in the definitions.
///
/// # Errors
///
/// Throws only if the answer cannot be turned into a JavaScript value.
#[wasm_bindgen(js_name = crsInfo)]
pub fn crs_info(code: u32) -> Result<JsValue, JsError> {
    match lookup(code) {
        Some(info) => to_js(&info),
        None => Ok(JsValue::UNDEFINED),
    }
}

/// Searches the EPSG definitions for a code or a name: an array of what `crsInfo` gives, the
/// system whose code is the query first, then names that start with it, then names that contain
/// it, in order of code inside each group, at most `limit` and never more than 50. An empty query
/// gives an empty array.
///
/// # Errors
///
/// Throws only if the answer cannot be turned into a JavaScript value.
#[wasm_bindgen(js_name = searchCrs)]
pub fn search_crs(query: &str, limit: u32) -> Result<JsValue, JsError> {
    to_js(&search(query, usize::try_from(limit).unwrap_or(usize::MAX)))
}
