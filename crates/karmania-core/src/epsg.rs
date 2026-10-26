//! EPSG lookup: what an EPSG code means.
//!
//! Definitions come from the `crs-definitions` crate as PROJ and WKT strings.
//! This module reads the WKT for the parts people need: the name, whether the
//! system is geographic (longitude and latitude) or projected (easting and
//! northing), and the unit. Compound and bound systems report their horizontal
//! part, because that is what places 2D data.

use serde::Serialize;

/// Whether a coordinate system uses angles on the Earth or a flat map grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CrsKind {
    /// Longitude and latitude, in angular units.
    Geographic,
    /// Easting and northing on a map projection, in length units.
    Projected,
    /// Anything else: geocentric systems, or an entry with no usable definition.
    Other,
}

impl CrsKind {
    /// The lowercase name used in JSON: `geographic`, `projected` or `other`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            CrsKind::Geographic => "geographic",
            CrsKind::Projected => "projected",
            CrsKind::Other => "other",
        }
    }
}

/// The unit of a coordinate system's axes.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CrsUnit {
    /// The unit's name as the registry writes it, for example `metre`,
    /// `US survey foot` or `degree`.
    pub name: String,
    /// How many metres (for lengths) or radians (for angles) one unit is.
    pub factor: f64,
}

/// What an EPSG code means.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CrsInfo {
    /// The EPSG code.
    pub code: u32,
    /// The system's name, for example `WGS 84 / UTM zone 40N`. For a compound
    /// system it is the full compound name; for a few entries without a
    /// definition it is `EPSG:<code>`.
    pub name: String,
    /// Geographic, projected or other.
    pub kind: CrsKind,
    /// The axis unit, if the definition states one.
    pub unit: Option<CrsUnit>,
}

/// Looks up an EPSG code. `None` if the code is not in the definitions.
#[must_use]
pub fn lookup(code: u32) -> Option<CrsInfo> {
    let def = crs_definitions::from_code(u16::try_from(code).ok()?)?;
    Some(describe(code, def.wkt))
}

/// The PROJ string for an EPSG code, used to convert coordinates.
pub(crate) fn proj4(code: u32) -> Option<&'static str> {
    let def = crs_definitions::from_code(u16::try_from(code).ok()?)?;
    Some(def.proj4)
}

/// Builds the description of one definition from its WKT.
fn describe(code: u32, wkt: &str) -> CrsInfo {
    let fallback = || CrsInfo {
        code,
        name: format!("EPSG:{code}"),
        kind: CrsKind::Other,
        unit: None,
    };
    let Some(root) = parse(wkt) else {
        return fallback();
    };
    let name = first_text(&root).unwrap_or_else(|| format!("EPSG:{code}"));
    let Some(core) = horizontal_part(&root) else {
        return CrsInfo { name, ..fallback() };
    };
    let kind = match core.keyword() {
        Some("PROJCS" | "PROJCRS") => CrsKind::Projected,
        Some("GEOGCS" | "GEOGCRS") => CrsKind::Geographic,
        _ => CrsKind::Other,
    };
    CrsInfo {
        code,
        name,
        kind,
        unit: unit_of(core, kind),
    }
}

/// A parsed WKT value.
#[derive(Debug)]
enum Node {
    Text(String),
    Number(f64),
    Word,
    Call { keyword: String, args: Vec<Node> },
}

impl Node {
    fn keyword(&self) -> Option<&str> {
        match self {
            Node::Call { keyword, .. } => Some(keyword),
            _ => None,
        }
    }

    fn args(&self) -> &[Node] {
        match self {
            Node::Call { args, .. } => args,
            _ => &[],
        }
    }
}

/// How deeply WKT may nest before it is rejected as malformed.
const MAX_DEPTH: usize = 64;

/// Parses a WKT string. `None` if it is empty or malformed.
fn parse(text: &str) -> Option<Node> {
    let mut parser = Parser { text, pos: 0 };
    let node = parser.value(0)?;
    parser.skip_space();
    (parser.pos == text.len()).then_some(node)
}

struct Parser<'a> {
    text: &'a str,
    pos: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.text.as_bytes().get(self.pos).copied()
    }

    fn skip_space(&mut self) {
        while self.peek().is_some_and(|b| b.is_ascii_whitespace()) {
            self.pos += 1;
        }
    }

    fn value(&mut self, depth: usize) -> Option<Node> {
        if depth > MAX_DEPTH {
            return None;
        }
        self.skip_space();
        if self.peek()? == b'"' {
            return self.string();
        }
        let start = self.pos;
        while self
            .peek()
            .is_some_and(|b| !matches!(b, b'[' | b']' | b',' | b'"') && !b.is_ascii_whitespace())
        {
            self.pos += 1;
        }
        let token = self.text.get(start..self.pos)?;
        if token.is_empty() {
            return None;
        }
        self.skip_space();
        if self.peek() != Some(b'[') {
            return Some(token.parse::<f64>().map_or(Node::Word, Node::Number));
        }
        self.pos += 1;
        let mut args = Vec::new();
        loop {
            self.skip_space();
            if self.peek()? == b']' {
                self.pos += 1;
                break;
            }
            args.push(self.value(depth + 1)?);
            self.skip_space();
            match self.peek()? {
                b',' => self.pos += 1,
                b']' => {}
                _ => return None,
            }
        }
        Some(Node::Call {
            keyword: token.to_string(),
            args,
        })
    }

    /// A quoted string; a doubled quote inside stands for one quote.
    fn string(&mut self) -> Option<Node> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let rest = self.text.get(self.pos..)?;
            let quote = rest.find('"')?;
            out.push_str(rest.get(..quote)?);
            self.pos += quote + 1;
            if self.peek() == Some(b'"') {
                out.push('"');
                self.pos += 1;
            } else {
                return Some(Node::Text(out));
            }
        }
    }
}

/// The first quoted string anywhere in the tree, which is the system's name.
fn first_text(node: &Node) -> Option<String> {
    match node {
        Node::Text(s) => Some(s.clone()),
        Node::Call { args, .. } => args.iter().find_map(first_text),
        Node::Number(_) | Node::Word => None,
    }
}

/// The geographic, projected or geocentric part that places 2D data: the node
/// itself, or for compound and bound systems the first such part inside.
fn horizontal_part(node: &Node) -> Option<&Node> {
    match node.keyword()? {
        "PROJCS" | "PROJCRS" | "GEOGCS" | "GEOGCRS" | "GEOCCS" => Some(node),
        "COMPD_CS" | "BOUNDCRS" | "SOURCECRS" => node.args().iter().find_map(horizontal_part),
        _ => None,
    }
}

/// The unit of a system's own axes: its direct `UNIT` child. Geographic systems
/// written in the newer style keep it in an `ANGLEUNIT` instead.
fn unit_of(core: &Node, kind: CrsKind) -> Option<CrsUnit> {
    let direct = core
        .args()
        .iter()
        .find(|n| matches!(n.keyword(), Some("UNIT" | "LENGTHUNIT" | "ANGLEUNIT")));
    let node = direct.or_else(|| {
        (kind == CrsKind::Geographic)
            .then(|| find_keyword(core, "ANGLEUNIT"))
            .flatten()
    })?;
    let [Node::Text(name), Node::Number(factor), ..] = node.args() else {
        return None;
    };
    Some(CrsUnit {
        name: name.clone(),
        factor: *factor,
    })
}

/// The first node with this keyword, searching depth first.
fn find_keyword<'a>(node: &'a Node, keyword: &str) -> Option<&'a Node> {
    if node.keyword() == Some(keyword) {
        return Some(node);
    }
    node.args().iter().find_map(|n| find_keyword(n, keyword))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(code: u32) -> CrsInfo {
        lookup(code).unwrap_or_else(|| panic!("EPSG:{code} should exist"))
    }

    #[test]
    fn a_geographic_system_reports_degrees() {
        let wgs84 = info(4326);
        assert_eq!(
            (wgs84.name.as_str(), wgs84.kind),
            ("WGS 84", CrsKind::Geographic)
        );
        let unit = wgs84.unit.unwrap();
        assert_eq!(unit.name, "degree");
        assert!((unit.factor - 0.017_453_292_519_943_3).abs() < 1e-15);
    }

    #[test]
    fn projected_systems_report_their_length_unit() {
        let utm = info(32640);
        assert_eq!(utm.name, "WGS 84 / UTM zone 40N");
        assert_eq!(utm.kind, CrsKind::Projected);
        assert_eq!(
            utm.unit,
            Some(CrsUnit {
                name: "metre".to_string(),
                factor: 1.0
            })
        );
        let feet = info(2227);
        assert_eq!(feet.kind, CrsKind::Projected);
        let unit = feet.unit.unwrap();
        assert_eq!(unit.name, "US survey foot");
        assert!((unit.factor - 0.304_800_609_601_219_2).abs() < 1e-12);
        assert_eq!(info(3857).kind, CrsKind::Projected);
        assert_eq!(info(27700).name, "OSGB 1936 / British National Grid");
    }

    #[test]
    fn newer_style_geographic_definitions_use_their_angle_unit() {
        let three_d = info(4327);
        assert_eq!(three_d.name, "WGS 84 (3D)");
        assert_eq!(three_d.kind, CrsKind::Geographic);
        assert_eq!(three_d.unit.unwrap().name, "degree");
    }

    #[test]
    fn compound_and_bound_systems_report_their_horizontal_part() {
        let compound = info(3901);
        assert_eq!(
            compound.name,
            "KKJ / Finland Uniform Coordinate System + N60 height"
        );
        assert_eq!(compound.kind, CrsKind::Projected);
        assert_eq!(compound.unit.unwrap().name, "metre");
        let bound = info(3823);
        assert_eq!(
            (bound.name.as_str(), bound.kind),
            ("TWD97", CrsKind::Geographic)
        );
    }

    #[test]
    fn geocentric_and_definition_less_entries_are_other() {
        let geocentric = info(3822);
        assert_eq!(
            (geocentric.name.as_str(), geocentric.kind),
            ("TWD97", CrsKind::Other)
        );
        assert_eq!(geocentric.unit.unwrap().name, "metre");
        let empty = info(3993);
        assert_eq!(empty.name, "EPSG:3993");
        assert_eq!((empty.kind, empty.unit), (CrsKind::Other, None));
    }

    #[test]
    fn unknown_codes_are_none_including_ones_that_do_not_fit_the_definitions() {
        for code in [0, 1, 99, 99_999, 65_536, u32::MAX] {
            assert_eq!(lookup(code), None, "{code}");
        }
    }

    #[test]
    fn every_definition_in_the_registry_can_be_described_without_panicking() {
        let (mut geographic, mut projected, mut other) = (0, 0, 0);
        for code in 0..=u16::MAX {
            let Some(def) = crs_definitions::from_code(code) else {
                continue;
            };
            let described = info(u32::from(code));
            assert!(!described.name.is_empty(), "{code}");
            assert_eq!(described.code, u32::from(def.code));
            match described.kind {
                CrsKind::Geographic => {
                    geographic += 1;
                    assert!(described.unit.is_some(), "geographic {code} has no unit");
                }
                CrsKind::Projected => {
                    projected += 1;
                    assert!(described.unit.is_some(), "projected {code} has no unit");
                }
                CrsKind::Other => other += 1,
            }
        }
        assert!(
            geographic > 500 && projected > 4_900 && other > 10,
            "{geographic} {projected} {other}"
        );
    }

    #[test]
    fn the_wkt_reader_handles_quotes_nesting_and_garbage() {
        let node = parse(r#"A["x ""quoted"" name",1.5,B[C["y"],word]]"#).unwrap();
        assert_eq!(first_text(&node).as_deref(), Some(r#"x "quoted" name"#));
        assert!(matches!(node.args().get(1), Some(Node::Number(n)) if *n == 1.5));
        for bad in [
            "",
            "A[",
            "A[\"unterminated]",
            "A[1,,2]",
            "]",
            "A[1] trailing",
            "A[1 2]",
        ] {
            assert!(parse(bad).is_none(), "accepted {bad:?}");
        }
        let deep = format!("{}{}", "A[".repeat(200), "]".repeat(200));
        assert!(parse(&deep).is_none());
    }

    #[test]
    fn kinds_serialize_as_lowercase_names() {
        for kind in [CrsKind::Geographic, CrsKind::Projected, CrsKind::Other] {
            assert_eq!(
                serde_json::to_string(&kind).unwrap(),
                format!("\"{}\"", kind.as_str())
            );
        }
        let json = serde_json::to_string(&info(4326)).unwrap();
        assert!(json.starts_with(
            r#"{"code":4326,"name":"WGS 84","kind":"geographic","unit":{"name":"degree""#
        ));
    }
}
