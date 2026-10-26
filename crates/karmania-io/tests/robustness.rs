//! Malformed input against every reader.
//!
//! The readers must never panic, must say something when they produce nothing,
//! must not produce a dataset next to an error, and must give the same answer
//! for the same input. The inputs are cuts and edits of the sample files, the
//! usual troubles of real files (byte-order marks, line endings, encodings,
//! trailing delimiters, extreme numbers) and random bytes.

use karmania_core::{CrsRef, Kind, validate};
use karmania_io::ReadOutput;
use karmania_io::asc::read_asc;
use karmania_io::csv_import::{CsvOptions, read_csv};
use karmania_io::delimited::Delimiter;
use karmania_io::detect::detect_format;
use karmania_io::geojson::read_geojson;
use karmania_io::mapping::{ColumnMapping, EmptyCoordinates, ImportMapping, Nodata};
use karmania_io::numbers::DecimalSeparator;
use karmania_io::obj::read_obj;
use karmania_io::prj::read_prj;
use karmania_io::roles::Role;
use karmania_io::text::decode;

const FIXTURES: [&str; 8] = [
    "points.csv",
    "lines.csv",
    "blocks.csv",
    "mixed.geojson",
    "grid.asc",
    "mesh.obj",
    "points.prj",
    "esri.prj",
];

/// The bytes of a sample file; empty if it cannot be read, which
/// `the_sample_files_exist` reports.
fn fixture(name: &str) -> Vec<u8> {
    let path = format!("{}/../../fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(path).unwrap_or_default()
}

fn text_of(bytes: &[u8]) -> String {
    decode(bytes, &mut karmania_core::Findings::new())
        .text
        .into_owned()
}

fn column(source: &str, role: Role) -> ColumnMapping {
    ColumnMapping {
        source: source.to_string(),
        role,
        column_type: None,
        rename: None,
    }
}

/// A mapping for files whose header is `X,Y,Z,V` (plus `Line` for lines).
fn mapping(kind: Kind, skip: bool) -> ImportMapping {
    let mut columns = vec![
        column("X", Role::X),
        column("Y", Role::Y),
        column("Z", Role::Z),
        column("V", Role::Attribute),
    ];
    if kind == Kind::Lines {
        columns.push(column("Line", Role::LineId));
    }
    ImportMapping {
        dataset_name: "t".into(),
        kind,
        columns,
        nodata: Nodata {
            tokens: vec![String::new(), "NA".into()],
            numbers: vec![-999.0],
        },
        empty_coordinates: if skip {
            EmptyCoordinates::Skip
        } else {
            EmptyCoordinates::Error
        },
        block_size: (kind == Kind::Blocks).then_some([1.0, 1.0, 1.0]),
        decimal_separator: DecimalSeparator::Point,
        crs: Some(CrsRef::Epsg { code: 32640 }),
    }
}

const COMMA: CsvOptions = CsvOptions {
    delimiter: Delimiter::Comma,
    has_header: true,
};

type ReadFn = fn(&str) -> ReadOutput;
type Reader = (&'static str, ReadFn);
type BoxedReader = Box<dyn Fn(&str) -> ReadOutput>;

/// The reader, with its mapping, that suits a sample file; `None` for `.prj` files.
fn own_reader(name: &str) -> Option<BoxedReader> {
    let csv = |kind: Kind, columns: Vec<ColumnMapping>, block: Option<[f64; 3]>| {
        let mut m = mapping(kind, false);
        m.columns = columns;
        m.block_size = block;
        Some(Box::new(move |t: &str| read_csv(t, COMMA, &m, None)) as BoxedReader)
    };
    match name {
        "points.csv" => csv(
            Kind::Points,
            vec![
                column("Easting", Role::X),
                column("Northing", Role::Y),
                column("RL", Role::Z),
                column("Hole", Role::Attribute),
                column("Au_ppm", Role::Attribute),
                column("Rock", Role::Attribute),
            ],
            None,
        ),
        "lines.csv" => csv(
            Kind::Lines,
            vec![
                column("Line", Role::LineId),
                column("X", Role::X),
                column("Y", Role::Y),
                column("Z", Role::Z),
            ],
            None,
        ),
        "blocks.csv" => csv(
            Kind::Blocks,
            vec![
                column("XC", Role::X),
                column("YC", Role::Y),
                column("ZC", Role::Z),
                column("Density", Role::Attribute),
                column("Domain", Role::Attribute),
            ],
            Some([10.0, 10.0, 10.0]),
        ),
        "mixed.geojson" => Some(Box::new(|t| read_geojson(t, Some("f.geojson")))),
        "grid.asc" => Some(Box::new(|t| read_asc(t, Some("f.asc")))),
        "mesh.obj" => Some(Box::new(|t| read_obj(t, Some("f.obj")))),
        _ => None,
    }
}

/// Every reader, with CSV in each of its three kinds and both coordinate policies.
fn readers() -> Vec<Reader> {
    vec![
        ("csv points", |t| {
            read_csv(t, COMMA, &mapping(Kind::Points, false), None)
        }),
        ("csv points skip", |t| {
            read_csv(t, COMMA, &mapping(Kind::Points, true), None)
        }),
        ("csv lines", |t| {
            read_csv(t, COMMA, &mapping(Kind::Lines, false), None)
        }),
        ("csv lines skip", |t| {
            read_csv(t, COMMA, &mapping(Kind::Lines, true), None)
        }),
        ("csv blocks", |t| {
            read_csv(t, COMMA, &mapping(Kind::Blocks, false), None)
        }),
        ("csv blocks skip", |t| {
            read_csv(t, COMMA, &mapping(Kind::Blocks, true), None)
        }),
        ("geojson", |t| read_geojson(t, Some("f.geojson"))),
        ("asc", |t| read_asc(t, Some("f.asc"))),
        ("obj", |t| read_obj(t, Some("f.obj"))),
    ]
}

/// What must hold for any output of any reader.
fn check(reader: &str, input: &str, out: &ReadOutput) {
    let shown = || {
        format!(
            "{reader} on {:?}",
            input.chars().take(200).collect::<String>()
        )
    };
    if out.findings.has_errors() {
        assert!(
            out.datasets.is_empty(),
            "a dataset next to an error: {}",
            shown()
        );
    }
    if out.datasets.is_empty() {
        assert!(
            out.findings.has_errors(),
            "nothing produced and nothing said: {}",
            shown()
        );
    }
    for f in out.findings.iter() {
        assert!(!f.message.trim().is_empty(), "empty message: {}", shown());
        assert!(f.count >= 1, "count below 1: {}", shown());
        assert!(
            f.examples.len() <= karmania_core::MAX_EXAMPLES,
            "{}",
            shown()
        );
    }
    for d in &out.datasets {
        // Whatever the reader produced must be safe to validate.
        let _ = validate(d);
    }
}

/// Runs every reader on the input, checks the invariants and that a second run
/// agrees with the first.
fn all_readers(input: &str) {
    for (name, read) in readers() {
        let first = read(input);
        check(name, input, &first);
        assert_eq!(first, read(input), "{name} is not deterministic");
    }
    let prj = read_prj(input);
    assert_eq!(
        prj.crs.is_some(),
        prj.findings.is_empty(),
        "prj: crs and findings disagree"
    );
    assert_eq!(prj, read_prj(input));
}

/// A small deterministic random number generator.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() as usize) % n.max(1)
    }
}

#[test]
fn the_sample_files_exist() {
    for name in FIXTURES {
        assert!(!fixture(name).is_empty(), "{name} is missing or empty");
    }
}

#[test]
fn empty_blank_and_mark_only_files() {
    for input in [
        "",
        " ",
        "\n",
        "\r\n\r\n",
        "\t \n \t",
        "\u{feff}",
        "\u{feff}\n",
        "\0",
        "\0\0\0",
    ] {
        all_readers(input);
    }
}

#[test]
fn every_reader_on_every_sample_file() {
    for name in FIXTURES {
        all_readers(&text_of(&fixture(name)));
    }
}

#[test]
fn every_prefix_of_every_sample_file() {
    for name in FIXTURES {
        let text = text_of(&fixture(name));
        let own = own_reader(name);
        for end in text.char_indices().map(|(i, _)| i).chain([text.len()]) {
            all_readers(&text[..end]);
            if let Some(read) = &own {
                let out = read(&text[..end]);
                check(name, &text[..end], &out);
            }
        }
    }
}

#[test]
fn random_edits_of_the_sample_files() {
    let mut rng = Rng(0x00C0_FFEE);
    for name in FIXTURES {
        let original = fixture(name);
        let own = own_reader(name);
        // How many edited files each reader's own sample still imported, and not.
        let (mut imported, mut refused, mut warned) = (0, 0, 0);
        for round in 0..150 {
            let mut bytes = original.clone();
            for _ in 0..=rng.below(3) {
                let at = rng.below(bytes.len());
                match rng.below(4) {
                    0 => bytes[at] = rng.next() as u8,
                    1 => {
                        bytes.remove(at);
                    }
                    2 => {
                        let end = (at + rng.below(30)).min(bytes.len());
                        let piece = bytes[at..end].to_vec();
                        let to = rng.below(bytes.len());
                        bytes.splice(to..to, piece);
                    }
                    _ => bytes.insert(at, b"\",;\t\r\n[]{}#\\ "[rng.below(13)]),
                }
                if bytes.is_empty() {
                    bytes.push(b'x');
                }
            }
            let _ = round;
            let text = text_of(&bytes);
            all_readers(&text);
            let _ = detect_format(Some(name), &bytes);
            if let Some(read) = &own {
                let out = read(&text);
                check(name, &text, &out);
                if out.datasets.is_empty() {
                    refused += 1;
                } else {
                    imported += 1;
                    warned += usize::from(!out.findings.is_empty());
                }
            }
        }
        // The edits must reach both outcomes, or this test proves nothing.
        if own.is_some() {
            assert!(
                imported > 0 && refused > 0,
                "{name}: {imported} imported, {refused} refused"
            );
            assert!(warned > 0, "{name}: no edit produced a warning");
        }
    }
}

#[test]
fn random_bytes() {
    let mut rng = Rng(7);
    for _ in 0..400 {
        let len = rng.below(600);
        let bytes: Vec<u8> = (0..len).map(|_| rng.next() as u8).collect();
        all_readers(&text_of(&bytes));
        let _ = detect_format(None, &bytes);
        let _ = detect_format(Some("a.csv"), &bytes);
    }
}

#[test]
fn random_text_that_looks_a_little_like_data() {
    let pieces = [
        "X", "Y", "Z", "V", "Line", ",", ",", "\n", "\n", "1", "2.5", "-3", "1e3", "NA", "", "\"",
        " ", "ncols 2", "v 1 2 3", "f 1 2 3", "{", "}", "[", "]", "\"type\"", ":", "Point",
    ];
    let mut rng = Rng(99);
    for _ in 0..1500 {
        let mut text = String::from(if rng.below(2) == 0 {
            "X,Y,Z,V,Line\n"
        } else {
            ""
        });
        for _ in 0..rng.below(60) {
            text.push_str(pieces[rng.below(pieces.len())]);
        }
        all_readers(&text);
    }
}

#[test]
fn line_endings_and_marks_do_not_change_what_is_read() {
    let pairs: [(&str, ReadFn); 3] = [
        ("mixed.geojson", |t| read_geojson(t, None)),
        ("grid.asc", |t| read_asc(t, None)),
        ("mesh.obj", |t| read_obj(t, None)),
    ];
    for (name, read) in pairs {
        let bytes = fixture(name);
        let plain = read(&text_of(&bytes));
        assert!(!plain.datasets.is_empty(), "{name}");
        let crlf = String::from_utf8(bytes.clone())
            .unwrap()
            .replace('\n', "\r\n");
        assert_eq!(read(&text_of(crlf.as_bytes())), plain, "{name}: CRLF");
        let mut with_mark = vec![0xEF, 0xBB, 0xBF];
        with_mark.extend(&bytes);
        assert_eq!(read(&text_of(&with_mark)), plain, "{name}: byte-order mark");
        // UTF-16 in both byte orders.
        let text = String::from_utf8(bytes).unwrap();
        for big_endian in [false, true] {
            let mut utf16 = if big_endian {
                vec![0xFE, 0xFF]
            } else {
                vec![0xFF, 0xFE]
            };
            for unit in text.encode_utf16() {
                utf16.extend(if big_endian {
                    unit.to_be_bytes()
                } else {
                    unit.to_le_bytes()
                });
            }
            assert_eq!(
                read(&text_of(&utf16)),
                plain,
                "{name}: UTF-16 big endian {big_endian}"
            );
        }
    }
    // The CSV sample with the same treatment, read with the points mapping of the
    // sample file.
    let csv_mapping = || {
        let mut m = mapping(Kind::Points, false);
        m.columns = vec![
            column("Easting", Role::X),
            column("Northing", Role::Y),
            column("RL", Role::Z),
            column("Hole", Role::Attribute),
            column("Au_ppm", Role::Attribute),
        ];
        m
    };
    let bytes = fixture("points.csv");
    let plain = read_csv(&text_of(&bytes), COMMA, &csv_mapping(), None);
    assert_eq!(plain.datasets.len(), 1);
    let crlf = String::from_utf8(bytes.clone())
        .unwrap()
        .replace('\n', "\r\n");
    assert_eq!(
        read_csv(&text_of(crlf.as_bytes()), COMMA, &csv_mapping(), None),
        plain
    );
    let mut with_mark = vec![0xEF, 0xBB, 0xBF];
    with_mark.extend(&bytes);
    assert_eq!(
        read_csv(&text_of(&with_mark), COMMA, &csv_mapping(), None),
        plain
    );
}

#[test]
fn text_that_is_not_utf8_is_read_and_reported() {
    // Windows-1252 text with accents in an attribute value.
    let bytes = b"X,Y,Z,V\n1,2,3,Caf\xE9\n4,5,6,Zo\xEB\n";
    let mut findings = karmania_core::Findings::new();
    let decoded = decode(bytes, &mut findings);
    assert_eq!(findings.iter().count(), 1);
    let out = read_csv(&decoded.text, COMMA, &mapping(Kind::Points, false), None);
    assert_eq!(out.datasets.len(), 1, "{:?}", out.findings);
    // Bytes that are not text at all still get through decoding and the readers.
    all_readers(&text_of(&[0xFF, 0xFE, 0x00]));
    all_readers(&text_of(&[0xC3]));
    all_readers(&text_of(b"\xFF\xFF\xFF\xFF"));
}

#[test]
fn trailing_delimiters_and_ragged_rows_in_csv() {
    for text in [
        "X,Y,Z,V\n1,2,3,4,\n5,6,7,8,\n",
        "X,Y,Z,V,\n1,2,3,4,\n",
        "X,Y,Z,V\n1,2,3\n4,5\n6\n\n7,8,9,10,11,12\n",
        "X,Y,Z,V\n,,,\n,,,\n",
        "X,Y,Z,V\n\"1,2,3,4\n5,6,7,8\n",
        "X,Y,Z,V\n1,2,3,\"unterminated\n",
        ",,,,\n,,,,\n",
    ] {
        all_readers(text);
    }
}

#[test]
fn extreme_numbers_in_every_reader() {
    let numbers = [
        "1e308",
        "-1e308",
        "1.7976931348623157e308",
        "1e-308",
        "5e-324",
        "-0",
        "-0.0",
        "1e999",
        "-1e999",
        "0x10",
        "1_000",
        "١٢٣",
        "1e",
        "e5",
        ".",
        "-",
        "+",
        "1.2.3",
        "99999999999999999999999",
        "0.000000000000000000000000000000000001",
        "NaN",
        "inf",
    ];
    for n in numbers {
        all_readers(&format!("X,Y,Z,V\n{n},{n},{n},{n}\n{n},{n},{n},{n}\n"));
        all_readers(&format!(
            "Line,X,Y,Z,V\nA,{n},{n},{n},{n}\nA,{n},{n},{n},{n}\n"
        ));
        all_readers(&format!(
            "{{\"type\":\"Feature\",\"properties\":{{\"p\":{n}}},\"geometry\":{{\"type\":\"Point\",\"coordinates\":[{n},{n},{n}]}}}}"
        ));
        all_readers(&format!(
            "ncols 2\nnrows 1\nxllcorner {n}\nyllcorner {n}\ncellsize {n}\nNODATA_value {n}\n{n} {n}\n"
        ));
        all_readers(&format!(
            "ncols {n}\nnrows {n}\nxllcorner 0\nyllcorner 0\ncellsize 1\n1 2\n"
        ));
        all_readers(&format!(
            "v {n} {n} {n}\nv 1 0 0\nv 0 1 0\nf 1 2 3\nf {n} 2 3\n"
        ));
    }
}

#[test]
fn very_long_lines_and_very_many_columns() {
    let long = "x".repeat(400_000);
    all_readers(&long);
    all_readers(&format!("X,Y,Z,V\n1,2,3,{long}\n"));
    all_readers(&format!(
        "{{\"type\":\"Point\",\"coordinates\":[1,2],\"k\":\"{long}\"}}"
    ));
    let many_columns = (0..5_000)
        .map(|i| format!("c{i}"))
        .collect::<Vec<_>>()
        .join(",");
    all_readers(&format!("{many_columns}\n{}\n", "1,".repeat(5_000)));
    let many_rows = "1,2,3,4\n".repeat(20_000);
    all_readers(&format!("X,Y,Z,V\n{many_rows}"));
    // A very long run of brackets and quotes.
    all_readers(&"[".repeat(200_000));
    all_readers(&"\"".repeat(200_001));
    all_readers(&"v 1 2 3\n".repeat(10_000));
}

#[test]
fn nul_bytes_and_control_characters_inside_text() {
    for text in [
        "X,Y,Z,V\n1,2,3,\0\n",
        "X,Y,\0Z,V\n1,2,3,4\n",
        "{\"type\":\"Point\",\"coordinates\":[1,2]}\0",
        "ncols 2\0\nnrows 1\nxllcorner 0\nyllcorner 0\ncellsize 1\n1 2\n",
        "v 1 2 3\0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
        "PROJCS[\"x\",\0AUTHORITY[\"EPSG\",\"32640\"]]",
        "\u{1}\u{2}\u{3}\u{7f}\u{8}\u{b}\u{c}",
    ] {
        all_readers(text);
    }
}

#[test]
fn detection_never_panics_and_always_says_something_about_failure() {
    let mut rng = Rng(3);
    let names = [
        None,
        Some("a.csv"),
        Some("a.geojson"),
        Some("a.asc"),
        Some("a.obj"),
        Some("a.prj"),
        Some("a.shp"),
        Some("a"),
        Some(".csv"),
        Some("a."),
    ];
    for name in FIXTURES {
        let bytes = fixture(name);
        for end in 0..=bytes.len() {
            for file_name in names {
                let d = detect_format(file_name, &bytes[..end]);
                assert_eq!(
                    d.format.is_none(),
                    d.findings.has_errors(),
                    "{name} cut at {end} as {file_name:?}"
                );
            }
        }
    }
    for _ in 0..300 {
        let len = rng.below(300);
        let bytes: Vec<u8> = (0..len).map(|_| rng.next() as u8).collect();
        for file_name in names {
            let d = detect_format(file_name, &bytes);
            assert_eq!(d.format.is_none(), d.findings.has_errors());
        }
    }
}
