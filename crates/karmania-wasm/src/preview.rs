//! Looking at a file before importing it.

use js_sys::{Array, Reflect, Uint8Array};
use karmania_io::preview::{Sidecar, preview as preview_file};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsError, JsValue};

use crate::convert::to_js;

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
