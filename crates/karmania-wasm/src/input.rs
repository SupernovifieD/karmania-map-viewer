//! Reading a dataset description handed over from JavaScript.
//!
//! A description is one object: `{ kind, name, crs, ...arrays, columns }`, with
//! typed arrays for the numbers. This reads it into the plain Rust inputs of
//! `karmania_io::build`. Anything of the wrong shape (a missing field, an array of
//! the wrong type) is misuse and throws an error that names the field; a problem
//! with the data itself is not found here but by validation, as a finding.

use js_sys::{Array, BigInt64Array, Float64Array, Reflect, Symbol, Uint8Array, Uint32Array};
use karmania_core::CrsRef;
use karmania_io::build::{ColumnInput, ColumnValues, LinesInput, PointsInput};
use wasm_bindgen::{JsCast, JsError, JsValue};

/// A dataset description, read.
pub(crate) enum DatasetInput {
    /// Points.
    Points(PointsInput),
    /// Lines.
    Lines(LinesInput),
}

/// Reads a description of a dataset.
pub(crate) fn read_dataset(value: &JsValue) -> Result<DatasetInput, JsError> {
    let object = Reader::new(value, "the dataset")?;
    let kind = object.string("kind")?;
    match kind.as_str() {
        "points" => Ok(DatasetInput::Points(PointsInput {
            name: object.string("name")?,
            crs: object.crs()?,
            x: object.floats("x")?,
            y: object.floats("y")?,
            z: object.optional_floats("z")?,
            columns: object.columns("columns")?,
        })),
        "lines" => Ok(DatasetInput::Lines(LinesInput {
            name: object.string("name")?,
            crs: object.crs()?,
            x: object.floats("x")?,
            y: object.floats("y")?,
            z: object.optional_floats("z")?,
            offsets: object.unsigned("offsets")?,
            columns: object.columns("columns")?,
            vertex_columns: object.columns("vertexColumns")?,
        })),
        other => Err(JsError::new(&format!(
            "the dataset has an unknown kind: \"{other}\""
        ))),
    }
}

/// An object whose fields are being read, with a description of it for messages.
struct Reader<'a> {
    value: &'a JsValue,
    what: String,
}

impl<'a> Reader<'a> {
    fn new(value: &'a JsValue, what: &str) -> Result<Self, JsError> {
        if value.is_object() && !Array::is_array(value) {
            Ok(Self {
                value,
                what: what.to_string(),
            })
        } else {
            Err(JsError::new(&format!("{what} must be an object")))
        }
    }

    /// A field, or `None` if it is missing, `undefined` or `null`.
    fn field(&self, key: &str) -> Result<Option<JsValue>, JsError> {
        let value = Reflect::get(self.value, &JsValue::from_str(key)).map_err(|_| {
            JsError::new(&format!(
                "{} has a field `{key}` that cannot be read",
                self.what
            ))
        })?;
        Ok((!value.is_undefined() && !value.is_null()).then_some(value))
    }

    fn required(&self, key: &str) -> Result<JsValue, JsError> {
        self.field(key)?
            .ok_or_else(|| JsError::new(&format!("{} needs a `{key}`", self.what)))
    }

    fn string(&self, key: &str) -> Result<String, JsError> {
        self.required(key)?
            .as_string()
            .ok_or_else(|| JsError::new(&format!("{}: `{key}` must be a string", self.what)))
    }

    fn floats(&self, key: &str) -> Result<Vec<f64>, JsError> {
        let value = self.required(key)?;
        typed::<Float64Array>(&value, "Float64Array", &self.what, key).map(|a| a.to_vec())
    }

    fn optional_floats(&self, key: &str) -> Result<Option<Vec<f64>>, JsError> {
        self.field(key)?
            .map(|value| {
                typed::<Float64Array>(&value, "Float64Array", &self.what, key).map(|a| a.to_vec())
            })
            .transpose()
    }

    fn unsigned(&self, key: &str) -> Result<Vec<u32>, JsError> {
        let value = self.required(key)?;
        typed::<Uint32Array>(&value, "Uint32Array", &self.what, key).map(|a| a.to_vec())
    }

    /// The `crs` field: a coordinate system object, or none.
    fn crs(&self) -> Result<Option<CrsRef>, JsError> {
        self.field("crs")?
            .map(|value| {
                serde_wasm_bindgen::from_value(value).map_err(|error| {
                    JsError::new(&format!(
                        "{}: the coordinate system is not valid: {error}",
                        self.what
                    ))
                })
            })
            .transpose()
    }

    /// A list of attribute columns; none if the field is missing.
    fn columns(&self, key: &str) -> Result<Vec<ColumnInput>, JsError> {
        let Some(list) = self.field(key)? else {
            return Ok(Vec::new());
        };
        if !Array::is_array(&list) {
            return Err(JsError::new(&format!(
                "{}: `{key}` must be an array of columns",
                self.what
            )));
        }
        Array::from(&list)
            .iter()
            .enumerate()
            .map(|(index, column)| read_column(&column, &format!("{key}[{index}]")))
            .collect()
    }
}

/// Checks that `value` is a typed array of the kind named `tag`, whichever realm it
/// came from, and returns it as that type.
fn typed<T: JsCast>(value: &JsValue, tag: &str, what: &str, key: &str) -> Result<T, JsError> {
    let actual = Reflect::get(value, &Symbol::to_string_tag())
        .ok()
        .and_then(|name| name.as_string());
    if actual.as_deref() == Some(tag) {
        Ok(T::unchecked_from_js(value.clone()))
    } else {
        Err(JsError::new(&format!("{what}: `{key}` must be a {tag}")))
    }
}

/// An array of strings.
fn strings(value: &JsValue, what: &str, key: &str) -> Result<Vec<String>, JsError> {
    if !Array::is_array(value) {
        return Err(JsError::new(&format!(
            "{what}: `{key}` must be an array of strings"
        )));
    }
    Array::from(value)
        .iter()
        .map(|item| {
            item.as_string()
                .ok_or_else(|| JsError::new(&format!("{what}: `{key}` must hold only strings")))
        })
        .collect()
}

/// One attribute column: `{ name, type, values, nulls? }`, or for a category column
/// `{ name, type: "category", codes, dictionary, nulls? }`.
fn read_column(value: &JsValue, path: &str) -> Result<ColumnInput, JsError> {
    let object = Reader::new(value, &format!("column {path}"))?;
    let name = object.string("name")?;
    let values = match object.string("type")?.as_str() {
        "float" => ColumnValues::Float(object.floats("values")?),
        "int" => {
            let v = object.required("values")?;
            ColumnValues::Int(
                typed::<BigInt64Array>(&v, "BigInt64Array", &object.what, "values")?.to_vec(),
            )
        }
        "bool" => {
            let v = object.required("values")?;
            let bytes = typed::<Uint8Array>(&v, "Uint8Array", &object.what, "values")?.to_vec();
            ColumnValues::Bool(bytes.into_iter().map(|b| b != 0).collect())
        }
        "text" => ColumnValues::Text(strings(
            &object.required("values")?,
            &object.what,
            "values",
        )?),
        "category" => ColumnValues::Category {
            codes: object.unsigned("codes")?,
            dictionary: strings(&object.required("dictionary")?, &object.what, "dictionary")?,
        },
        other => {
            return Err(JsError::new(&format!(
                "{} has an unknown type: \"{other}\"",
                object.what
            )));
        }
    };
    let nulls = object
        .field("nulls")?
        .map(|v| {
            typed::<Uint8Array>(&v, "Uint8Array", &object.what, "nulls")
                .map(|a| a.to_vec().into_iter().map(|b| b != 0).collect())
        })
        .transpose()?;
    Ok(ColumnInput {
        name,
        values,
        nulls,
    })
}
