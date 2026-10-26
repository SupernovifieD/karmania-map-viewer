//! Converting between Rust values and JavaScript values.

use serde::Serialize;
use wasm_bindgen::{JsError, JsValue};

/// Turns a value into a plain JavaScript value.
///
/// Structs and maps become objects (never `Map`s), and a field the Rust side leaves
/// out is absent, not `undefined`, because the types are written with
/// `skip_serializing_if`. Throws only if the value cannot be represented, for
/// example a whole number too big for a JavaScript number.
pub(crate) fn to_js<T: Serialize + ?Sized>(value: &T) -> Result<JsValue, JsError> {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    value
        .serialize(&serializer)
        .map_err(|error| JsError::new(&error.to_string()))
}
