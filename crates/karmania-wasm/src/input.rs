//! Reading a dataset description handed over from JavaScript.
//!
//! A description is one object: `{ kind, name, crs, ...arrays, columns }`, with
//! typed arrays for the numbers. This reads it into the plain Rust inputs of
//! `karmania_io::build`. Anything of the wrong shape (a missing field, an array of
//! the wrong type) is misuse and throws an error that names the field; a problem
//! with the data itself is not found here but by validation, as a finding.

use js_sys::{Array, BigInt64Array, Float64Array, Reflect, Symbol, Uint8Array, Uint32Array};
use karmania_core::CrsRef;
use karmania_io::build::{
    ColumnInput, ColumnValues, GridInput, LatticeInput, LinesInput, MeshInput, PointsInput,
    PolygonsInput,
};
use wasm_bindgen::{JsCast, JsError, JsValue};

/// A dataset description, read.
pub(crate) enum DatasetInput {
    /// Points.
    Points(PointsInput),
    /// Lines.
    Lines(LinesInput),
    /// Polygons.
    Polygons(PolygonsInput),
    /// A triangle mesh.
    Mesh(MeshInput),
    /// A regular grid.
    Grid(GridInput),
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
        "polygons" => Ok(DatasetInput::Polygons(PolygonsInput {
            name: object.string("name")?,
            crs: object.crs()?,
            x: object.floats("x")?,
            y: object.floats("y")?,
            z: object.optional_floats("z")?,
            ring_offsets: object.unsigned("ringOffsets")?,
            polygon_offsets: object.unsigned("polygonOffsets")?,
            columns: object.columns("columns")?,
        })),
        "mesh" => Ok(DatasetInput::Mesh(MeshInput {
            name: object.string("name")?,
            crs: object.crs()?,
            x: object.floats("x")?,
            y: object.floats("y")?,
            z: object.floats("z")?,
            indices: object.unsigned("indices")?,
            columns: object.columns("columns")?,
            vertex_columns: object.columns("vertexColumns")?,
        })),
        "grid" => {
            let elevation = object.optional_number("elevation")?;
            let elevation_column = object.optional_string("elevationColumn")?;
            if elevation.is_some() && elevation_column.is_some() {
                return Err(JsError::new(
                    "the dataset can have an `elevation` or an `elevationColumn`, not both",
                ));
            }
            Ok(DatasetInput::Grid(GridInput {
                name: object.string("name")?,
                crs: object.crs()?,
                lattice: object.lattice()?,
                elevation,
                elevation_column,
                columns: object.columns("columns")?,
            }))
        }
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

    /// A number, or none if the field is missing.
    fn optional_number(&self, key: &str) -> Result<Option<f64>, JsError> {
        self.field(key)?
            .map(|value| {
                value.as_f64().ok_or_else(|| {
                    JsError::new(&format!("{}: `{key}` must be a number", self.what))
                })
            })
            .transpose()
    }

    /// A string, or none if the field is missing.
    fn optional_string(&self, key: &str) -> Result<Option<String>, JsError> {
        self.field(key)?
            .map(|value| {
                value.as_string().ok_or_else(|| {
                    JsError::new(&format!("{}: `{key}` must be a string", self.what))
                })
            })
            .transpose()
    }

    /// Three numbers, as a `Float64Array` or a plain array.
    fn triple(&self, key: &str) -> Result<[f64; 3], JsError> {
        let value = self.required(key)?;
        let numbers: Vec<f64> = if Array::is_array(&value) {
            Array::from(&value)
                .iter()
                .map(|item| {
                    item.as_f64().ok_or_else(|| {
                        JsError::new(&format!("{}: `{key}` must hold only numbers", self.what))
                    })
                })
                .collect::<Result<_, _>>()?
        } else {
            typed::<Float64Array>(&value, "Float64Array", &self.what, key)?.to_vec()
        };
        <[f64; 3]>::try_from(numbers)
            .map_err(|_| JsError::new(&format!("{}: `{key}` must have 3 numbers", self.what)))
    }

    /// Three whole numbers of 0 or more, as a `Uint32Array` or a plain array.
    fn dims(&self, key: &str) -> Result<[u32; 3], JsError> {
        let value = self.required(key)?;
        let numbers: Vec<u32> = if Array::is_array(&value) {
            Array::from(&value)
                .iter()
                .map(|item| {
                    item.as_f64()
                        .filter(|n| n.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(n))
                        .map(|n| n as u32)
                        .ok_or_else(|| {
                            JsError::new(&format!(
                                "{}: `{key}` must hold only whole numbers of 0 or more",
                                self.what
                            ))
                        })
                })
                .collect::<Result<_, _>>()?
        } else {
            typed::<Uint32Array>(&value, "Uint32Array", &self.what, key)?.to_vec()
        };
        <[u32; 3]>::try_from(numbers)
            .map_err(|_| JsError::new(&format!("{}: `{key}` must have 3 numbers", self.what)))
    }

    /// The lattice fields: `origin`, `spacing`, `dims` and an optional `rotation`.
    fn lattice(&self) -> Result<LatticeInput, JsError> {
        Ok(LatticeInput {
            origin: self.triple("origin")?,
            spacing: self.triple("spacing")?,
            dims: self.dims("dims")?,
            rotation: self.optional_number("rotation")?.unwrap_or(0.0),
        })
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
