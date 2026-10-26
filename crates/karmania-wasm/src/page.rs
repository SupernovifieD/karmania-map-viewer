//! Turning a page of rows into a JavaScript object with typed arrays.

use js_sys::{Array, Float64Array, Int32Array, Object, Reflect, Uint8Array};
use karmania_core::{Page, PageValues};
use wasm_bindgen::{JsError, JsValue};

fn set(object: &Object, key: &str, value: &JsValue) -> Result<(), JsError> {
    Reflect::set(object, &JsValue::from_str(key), value)
        .map(|_| ())
        .map_err(|_| JsError::new("a page could not be built"))
}

/// `{ start, count, columns: [{ name, values, nulls }] }`, where `values` is a
/// `Float64Array`, `Int32Array`, `Uint8Array` or array of strings, and `nulls` is a
/// `Uint8Array` with a 1 for each null.
pub(crate) fn page_to_js(page: &Page) -> Result<JsValue, JsError> {
    let columns = Array::new();
    for column in &page.columns {
        let values: JsValue = match &column.values {
            PageValues::Float64(v) => Float64Array::from(v.as_slice()).into(),
            PageValues::Int32(v) => Int32Array::from(v.as_slice()).into(),
            PageValues::Bool(v) => Uint8Array::from(v.as_slice()).into(),
            PageValues::Text(v) => v
                .iter()
                .map(|text| JsValue::from_str(text))
                .collect::<Array>()
                .into(),
        };
        let object = Object::new();
        set(&object, "name", &JsValue::from_str(&column.name))?;
        set(&object, "values", &values)?;
        set(&object, "nulls", &Uint8Array::from(column.nulls.as_slice()))?;
        columns.push(&object);
    }
    let object = Object::new();
    set(&object, "start", &JsValue::from_f64(page.start as f64))?;
    set(&object, "count", &JsValue::from_f64(page.count as f64))?;
    set(&object, "columns", &columns)?;
    Ok(object.into())
}
