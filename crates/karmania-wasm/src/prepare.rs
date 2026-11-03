//! Turning what preparing gives into JavaScript values: the buffers as typed arrays.
//!
//! Every typed array made here is a copy in the JavaScript heap with an `ArrayBuffer` of its own, not a
//! view of the module's memory, so the worker can post it as a transferable and hand it to the page
//! without a second copy.

use js_sys::{Array, Float32Array, Object, Reflect, Uint32Array};
use karmania_prep::{GridLayout, PrepareResult, PrepareStep, RenderBuffers};
use wasm_bindgen::{JsError, JsValue};

use crate::convert::to_js;

fn floats(values: &[f32]) -> JsValue {
    Float32Array::from(values).into()
}

fn indices(values: &[u32]) -> JsValue {
    Uint32Array::from(values).into()
}

fn numbers(values: &[f32]) -> JsValue {
    values
        .iter()
        .map(|v| JsValue::from_f64(f64::from(*v)))
        .collect::<Array>()
        .into()
}

/// An object with the given fields.
fn object(fields: &[(&str, JsValue)]) -> Result<JsValue, JsError> {
    let out = Object::new();
    for (name, value) in fields {
        Reflect::set(&out, &JsValue::from_str(name), value)
            .map_err(|_| JsError::new("could not make a result object"))?;
    }
    Ok(out.into())
}

fn kind(name: &str) -> (&'static str, JsValue) {
    ("kind", JsValue::from_str(name))
}

/// The buffers of a dataset, as the contract of the engine gives them: `{ kind: "points", positions }`,
/// `{ kind: "lines", positions, segments, segmentLine }`, and so on, every array a typed array.
pub(crate) fn buffers_to_js(buffers: &RenderBuffers) -> Result<JsValue, JsError> {
    match buffers {
        RenderBuffers::Points(b) => object(&[kind("points"), ("positions", floats(&b.positions))]),
        RenderBuffers::Lines(b) => object(&[
            kind("lines"),
            ("positions", floats(&b.positions)),
            ("segments", indices(&b.segments)),
            ("segmentLine", indices(&b.segment_line)),
        ]),
        RenderBuffers::Polygons(b) => object(&[
            kind("polygons"),
            ("positions", floats(&b.positions)),
            ("triangles", indices(&b.triangles)),
            ("trianglePolygon", indices(&b.triangle_polygon)),
            ("outline", indices(&b.outline)),
            ("outlinePolygon", indices(&b.outline_polygon)),
        ]),
        RenderBuffers::Mesh(b) => object(&[
            kind("mesh"),
            ("positions", floats(&b.positions)),
            ("triangles", indices(&b.triangles)),
        ]),
        RenderBuffers::Grid(b) => {
            let layout = match &b.layout {
                GridLayout::Placement(p) => (
                    "placement",
                    object(&[
                        ("origin", numbers(&p.origin)),
                        ("spacing", numbers(&p.spacing)),
                        ("rotation", JsValue::from_f64(f64::from(p.rotation))),
                    ])?,
                ),
                GridLayout::Warp(w) => (
                    "warp",
                    object(&[
                        ("positions", floats(&w.positions)),
                        ("uvs", floats(&w.uvs)),
                        ("triangles", indices(&w.triangles)),
                        ("tileTriangles", indices(&w.tile_triangles)),
                    ])?,
                ),
            };
            let size: Array = b
                .size
                .iter()
                .map(|n| JsValue::from_f64(f64::from(*n)))
                .collect();
            object(&[
                kind("grid"),
                layout,
                ("size", size.into()),
                ("tiles", to_js(&b.tiles)?),
            ])
        }
        RenderBuffers::Surface(b) => object(&[
            kind("surface"),
            ("positions", floats(&b.positions)),
            ("triangles", indices(&b.triangles)),
            ("triangleCell", indices(&b.triangle_cell)),
        ]),
        RenderBuffers::Blocks(b) => object(&[
            kind("blocks"),
            ("centres", floats(&b.centres)),
            ("spacing", numbers(&b.spacing)),
            ("rotation", JsValue::from_f64(f64::from(b.rotation))),
        ]),
    }
}

/// What a step of preparing did: `{ status: "progress", fraction }`, `{ status: "cancelled" }` or `{
/// status: "done", result }`, where `result` is `{ status: "drawn", buffers, findings }` or `{ status:
/// "not_drawn", findings }`.
pub(crate) fn step_to_js(step: &PrepareStep) -> Result<JsValue, JsError> {
    let status = |name: &str| ("status", JsValue::from_str(name));
    match step {
        PrepareStep::Progress { fraction } => object(&[
            status("progress"),
            ("fraction", JsValue::from_f64(*fraction)),
        ]),
        PrepareStep::Cancelled => object(&[status("cancelled")]),
        PrepareStep::Done(PrepareResult::Drawn { buffers, findings }) => {
            let result = object(&[
                status("drawn"),
                ("buffers", buffers_to_js(buffers)?),
                ("findings", to_js(findings)?),
            ])?;
            object(&[status("done"), ("result", result)])
        }
        PrepareStep::Done(PrepareResult::NotDrawn { findings }) => {
            let result = object(&[status("not_drawn"), ("findings", to_js(findings)?)])?;
            object(&[status("done"), ("result", result)])
        }
    }
}
