//! Reading Wavefront OBJ files as triangle meshes.
//!
//! Only the geometry is read: `v` (vertex) and `f` (face) records. Texture
//! coordinates, normals, objects, groups, smoothing and materials do not change
//! the shape and are ignored without comment. Records for lines, points and
//! curves cannot be imported and are counted in a warning. A face with more than
//! three corners is split into triangles fanning out from its first corner, and
//! counted. Everything in the file becomes one mesh, whatever its objects and
//! groups.
//!
//! Face corners are written `v`, `v/vt`, `v//vn` or `v/vt/vn`; only `v` is used.
//! It counts from 1, or from the end of the vertices defined so far if negative.
//! A positive number past the last vertex is kept as it is and left to
//! validation to report.

use std::borrow::Cow;

use karmania_core::{
    Dataset, DatasetId, Finding, FindingCode, Findings, Geometry, Location, Mesh, Positions,
    Provenance, Table, check_size,
};

use crate::numbers::{DecimalSeparator, parse_int, parse_number};
use crate::output::{ReadOutput, Tally};

/// Records that carry nothing the mesh needs. Free-form curve bookkeeping is
/// listed too, since those records only matter next to curves.
const IGNORED: [&str; 24] = [
    "vt",
    "vn",
    "vp",
    "o",
    "g",
    "s",
    "mg",
    "usemtl",
    "mtllib",
    "bevel",
    "c_interp",
    "d_interp",
    "lod",
    "shadow_obj",
    "trace_obj",
    "ctech",
    "stech",
    "cstype",
    "deg",
    "step",
    "bmat",
    "parm",
    "trim",
    "hole",
];

/// Reads an OBJ file into a mesh dataset.
///
/// The coordinate system is left unset: OBJ files do not say. Returns no dataset
/// if there are errors (a vertex without three numbers, no vertices or no faces,
/// or a mesh over the size limit).
#[must_use]
pub fn read_obj(text: &str, file_name: Option<&str>) -> ReadOutput {
    let mut findings = Findings::new();
    let dataset = read(text, file_name, &mut findings);
    ReadOutput {
        datasets: if findings.has_errors() {
            Vec::new()
        } else {
            dataset.into_iter().collect()
        },
        findings,
    }
}

/// The index of a face corner such as `3`, `3/1`, `3//2` or `-1`, counting from 0,
/// or `None` if it is zero, not a number, or before the first vertex.
fn corner(token: &str, vertices: usize) -> Option<u32> {
    let number = parse_int(token.split('/').next()?)?;
    let index = if number > 0 {
        number - 1
    } else if number < 0 {
        i64::try_from(vertices).ok()?.checked_add(number)?
    } else {
        return None;
    };
    u32::try_from(index).ok()
}

fn read(text: &str, file_name: Option<&str>, findings: &mut Findings) -> Option<Dataset> {
    let text = text.trim_start_matches('\u{feff}');
    if text.trim().is_empty() {
        findings.add(
            Finding::new(FindingCode::FileEmpty, "The file has no data in it.")
                .with_hint("Check that you chose the right file."),
        );
        return None;
    }
    let mut vertex_invalid = Tally::new(
        Finding::new(
            FindingCode::ObjVertexInvalid,
            "Some vertex lines do not have three numbers.",
        )
        .with_hint("Each vertex line is \"v\" followed by x, y and z."),
    );
    let mut extra_values = Tally::new(Finding::new(
        FindingCode::ObjVertexExtraValues,
        "Some vertices have more than three numbers (a weight or a colour); only the first three were used.",
    ));
    let mut face_invalid = Tally::new(
        Finding::new(
            FindingCode::ObjFaceInvalid,
            "Some faces have fewer than three corners or a vertex number that cannot be used, so they were left out.",
        )
        .with_hint("Vertex numbers count from 1, or from the end if negative."),
    );
    let mut triangulated = Tally::new(Finding::new(
        FindingCode::ObjFacesTriangulated,
        "Some faces have more than three corners; they were split into triangles.",
    ));
    let mut unsupported = Tally::new(
        Finding::new(
            FindingCode::ObjRecordsUnsupported,
            "Some lines are not vertices or faces (lines, points, curves or unknown records), so they were left out.",
        )
        .with_hint("Only triangle meshes can be imported."),
    );

    let (mut x, mut y, mut z): (Vec<f64>, Vec<f64>, Vec<f64>) =
        (Vec::new(), Vec::new(), Vec::new());
    let mut indices: Vec<u32> = Vec::new();
    let mut corners: Vec<u32> = Vec::new();
    let mut lines = text.lines().enumerate();
    while let Some((index, first)) = lines.next() {
        // A backslash at the end of a line continues it on the next.
        let mut line = Cow::Borrowed(first);
        while line.trim_end().ends_with('\\') {
            let Some((_, next)) = lines.next() else { break };
            let joined = format!("{} {next}", line.trim_end().trim_end_matches('\\'));
            line = Cow::Owned(joined);
        }
        let number = index as u64 + 1;
        let at = || Location::default().with_line(number);
        let content = line.split('#').next().unwrap_or("");
        let mut tokens = content.split_ascii_whitespace();
        let Some(kind) = tokens.next() else { continue };
        match kind {
            "v" => {
                let mut numbers = [0.0f64; 3];
                let (mut count, mut unreadable) = (0usize, false);
                for token in tokens {
                    let Some(value) = parse_number(token, DecimalSeparator::Point) else {
                        unreadable = true;
                        break;
                    };
                    if let Some(slot) = numbers.get_mut(count) {
                        *slot = value;
                    }
                    count += 1;
                }
                if unreadable || count < 3 {
                    vertex_invalid.hit(at());
                } else {
                    if count > 3 {
                        extra_values.hit(at());
                    }
                    x.push(numbers[0]);
                    y.push(numbers[1]);
                    z.push(numbers[2]);
                }
            }
            "f" => {
                corners.clear();
                let usable = tokens.all(|t| {
                    corner(t, x.len()).is_some_and(|c| {
                        corners.push(c);
                        true
                    })
                });
                if !usable || corners.len() < 3 {
                    face_invalid.hit(at());
                    continue;
                }
                if corners.len() > 3 {
                    triangulated.hit(at());
                }
                for pair in corners[1..].windows(2) {
                    indices.extend([corners[0], pair[0], pair[1]]);
                }
            }
            other if IGNORED.contains(&other) => {}
            _ => unsupported.hit(at()),
        }
        // Stop early rather than hold a file far over the limit.
        if !check_size(Some(x.len() as u64), "vertices", findings)
            || !check_size(Some(indices.len() as u64 / 3), "triangles", findings)
        {
            return None;
        }
    }

    for tally in [
        vertex_invalid,
        extra_values,
        face_invalid,
        triangulated,
        unsupported,
    ] {
        if let Some(finding) = tally.into_finding() {
            findings.add(finding);
        }
    }
    if findings.has_errors() {
        return None;
    }
    if x.is_empty() || indices.is_empty() {
        findings.add(
            Finding::new(
                FindingCode::ObjMeshEmpty,
                "The file has no vertices and faces to build a mesh from.",
            )
            .with_hint(
                "A mesh file needs \"v\" lines for the vertices and \"f\" lines for the faces.",
            ),
        );
        return None;
    }
    let positions = Positions::from_xyz(&x, &y, Some(&z), findings)?;
    let attributes = Table::from_columns(Vec::new(), findings)?;
    let name = file_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or("mesh")
        .to_string();
    let mut dataset = Dataset::new(
        DatasetId(0),
        name,
        None,
        Geometry::Mesh(Mesh { positions, indices }),
        attributes,
    );
    dataset.provenance = Provenance {
        source_file_name: file_name.map(str::to_string),
    };
    Some(dataset)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;
    use karmania_core::Kind;

    fn codes(out: &ReadOutput) -> Vec<&'static str> {
        out.findings.iter().map(|f| f.code.as_str()).collect()
    }

    fn mesh(out: &ReadOutput) -> &Mesh {
        assert_eq!(out.datasets.len(), 1, "findings: {:?}", codes(out));
        let Geometry::Mesh(m) = &out.datasets[0].geometry else {
            panic!("not a mesh")
        };
        m
    }

    /// Three vertices, then the given records.
    fn with_triangle(records: &str) -> String {
        format!("v 0 0 0\nv 1 0 0\nv 0 1 0\n{records}")
    }

    #[test]
    fn the_sample_pyramid_has_a_base_quad_split_into_two_triangles() {
        let out = read_obj(&fixtures::text("mesh.obj"), Some("mesh.obj"));
        assert_eq!(codes(&out), ["obj.faces.triangulated"]);
        let f = &out.findings.as_slice()[0];
        // The quad is on file line 12.
        assert_eq!((f.count, f.examples[0].line), (1, Some(12)));
        let d = &out.datasets[0];
        assert_eq!(
            (d.name.as_str(), d.kind(), d.has_z(), d.element_count()),
            ("mesh.obj", Kind::Mesh, true, Some(6))
        );
        assert_eq!(d.crs, None);
        assert_eq!(d.provenance.source_file_name.as_deref(), Some("mesh.obj"));
        let m = mesh(&out);
        assert_eq!(m.positions.get(4), Some([5.0, 5.0, 8.0]));
        assert_eq!(
            m.indices,
            [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 3, 2, 0, 2, 1]
        );
        // Only the coordinate system is missing.
        let report = karmania_core::validate(d);
        let problems: Vec<_> = report.findings().map(|f| f.code.as_str()).collect();
        assert_eq!(problems, ["crs.missing"]);
    }

    #[test]
    fn corners_may_carry_texture_and_normal_numbers() {
        let out = read_obj(
            &with_triangle("f 1/1/1 2/2/2 3/3/3\nf 1//1 2//1 3//1\nf 1/9 2/9 3/9\n"),
            None,
        );
        assert!(out.findings.is_empty());
        assert_eq!(mesh(&out).indices, [0, 1, 2, 0, 1, 2, 0, 1, 2]);
        assert_eq!(out.datasets[0].name, "mesh");
    }

    #[test]
    fn negative_numbers_count_back_from_the_vertices_defined_so_far() {
        let text = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\nv 5 5 5\nf -1 -2 -4\n";
        let out = read_obj(text, None);
        assert!(out.findings.is_empty());
        // After the fourth vertex, -1 is the fourth, -2 the third, -4 the first.
        assert_eq!(mesh(&out).indices, [0, 1, 2, 3, 2, 0]);
    }

    #[test]
    fn a_number_past_the_last_vertex_is_kept_for_validation_to_report() {
        let out = read_obj(&with_triangle("f 1 2 7\n"), None);
        assert!(out.findings.is_empty());
        assert_eq!(mesh(&out).indices, [0, 1, 6]);
        let report = karmania_core::validate(&out.datasets[0]);
        assert!(
            report
                .findings()
                .any(|f| f.code.as_str() == "mesh.indices.out_of_range")
        );
    }

    #[test]
    fn faces_that_cannot_be_used_are_left_out_and_counted_with_their_lines() {
        let text = with_triangle(
            "f 1 2 3\nf 1 2\nf 0 1 2\nf a b c\nf -9 1 2\nf 1 2 99999999999\nf\nf 1 2 3\n",
        );
        let out = read_obj(&text, None);
        assert_eq!(codes(&out), ["obj.face.invalid"]);
        let f = &out.findings.as_slice()[0];
        let lines: Vec<_> = f.examples.iter().map(|l| l.line).collect();
        assert_eq!(f.count, 6);
        assert_eq!(
            lines,
            [Some(5), Some(6), Some(7), Some(8), Some(9), Some(10)]
        );
        assert_eq!(mesh(&out).indices, [0, 1, 2, 0, 1, 2]);
    }

    #[test]
    fn a_vertex_line_that_is_not_three_numbers_is_an_error_not_a_skip() {
        let text = "v 1 2\nv a b c\nv 1 2 3 abc\nv 1 2 NaN\nv 1 2 3\nf 1 1 1\n";
        let out = read_obj(text, None);
        assert!(out.datasets.is_empty());
        assert_eq!(codes(&out), ["obj.vertex.invalid"]);
        let f = &out.findings.as_slice()[0];
        let lines: Vec<_> = f.examples.iter().map(|l| l.line).collect();
        assert_eq!(
            (f.count, lines),
            (4, vec![Some(1), Some(2), Some(3), Some(4)])
        );
    }

    #[test]
    fn extra_numbers_on_a_vertex_line_are_ignored_and_counted() {
        let text = "v 0 0 0 1\nv 1 0 0 0.5 0.5 0.5\nv 0 1 0\nf 1 2 3\n";
        let out = read_obj(text, None);
        assert_eq!(codes(&out), ["obj.vertex.extra_values"]);
        assert_eq!(out.findings.as_slice()[0].count, 2);
        assert_eq!(mesh(&out).positions.get(1), Some([1.0, 0.0, 0.0]));
    }

    #[test]
    fn comments_blank_lines_tabs_crlf_and_a_byte_order_mark_are_fine() {
        let text = "\u{feff}# a comment\r\n\r\nv\t0 0 0 # origin\r\nv 1 0 0\r\n   v 0 1 0   \r\nf 1 2 3 # one triangle\r\n";
        let out = read_obj(text, None);
        assert!(out.findings.is_empty());
        assert_eq!(mesh(&out).indices, [0, 1, 2]);
    }

    #[test]
    fn a_backslash_continues_a_line() {
        let out = read_obj(&with_triangle("f 1 \\\n 2 \\\n 3\n"), None);
        assert!(out.findings.is_empty());
        assert_eq!(mesh(&out).indices, [0, 1, 2]);
        // The line number of a problem is where the record starts.
        let out = read_obj(&with_triangle("f 1 \\\n 2\n"), None);
        assert_eq!(out.findings.as_slice()[0].examples[0].line, Some(4));
    }

    #[test]
    fn records_that_do_not_change_the_shape_are_ignored_and_others_are_counted() {
        let text = with_triangle(
            "vt 0 0\nvn 0 0 1\no thing\ng part\ns off\nusemtl red\nmtllib x.mtl\nf 1 2 3\nl 1 2\np 1\ncurv 0 1 1 2\nzzz\n",
        );
        let out = read_obj(&text, None);
        assert_eq!(codes(&out), ["obj.records.unsupported"]);
        let f = &out.findings.as_slice()[0];
        let lines: Vec<_> = f.examples.iter().map(|l| l.line).collect();
        assert_eq!(f.count, 4);
        assert_eq!(lines, [Some(12), Some(13), Some(14), Some(15)]);
        assert_eq!(mesh(&out).indices, [0, 1, 2]);
    }

    #[test]
    fn a_polygon_with_many_corners_becomes_a_fan_of_triangles() {
        let mut text = String::new();
        for i in 0..1000 {
            text.push_str(&format!("v {i} 0 0\n"));
        }
        text.push('f');
        for i in 1..=1000 {
            text.push_str(&format!(" {i}"));
        }
        text.push('\n');
        let out = read_obj(&text, None);
        assert_eq!(codes(&out), ["obj.faces.triangulated"]);
        let m = mesh(&out);
        assert_eq!(m.triangle_count(), 998);
        assert_eq!(m.triangle(0), Some([0, 1, 2]));
        assert_eq!(m.triangle(997), Some([0, 998, 999]));
    }

    #[test]
    fn a_file_without_vertices_or_faces_is_an_error() {
        for text in ["v 0 0 0\nv 1 0 0\n", "f 1 2 3\n", "# nothing\no thing\n"] {
            let out = read_obj(text, None);
            assert!(out.datasets.is_empty(), "{text}");
            assert_eq!(codes(&out), ["obj.mesh.empty"], "{text}");
        }
        for text in ["", "  \n\t\n", "\u{feff}"] {
            assert_eq!(codes(&read_obj(text, None)), ["file.empty"], "{text:?}");
        }
        // Faces that are all unusable leave no faces.
        let out = read_obj(&with_triangle("f 1 2\n"), None);
        assert_eq!(codes(&out), ["obj.face.invalid", "obj.mesh.empty"]);
    }

    #[test]
    fn extreme_coordinates_are_kept_and_reading_twice_agrees() {
        let text = "v 1e300 -1e-300 5e-324\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
        let out = read_obj(text, Some("a.obj"));
        assert_eq!(mesh(&out).positions.get(0), Some([1e300, -1e-300, 5e-324]));
        assert_eq!(out, read_obj(text, Some("a.obj")));
    }
}
