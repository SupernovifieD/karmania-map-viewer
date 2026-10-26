//! Reading the coordinate system from a `.prj` sidecar file.
//!
//! A `.prj` file holds a coordinate system as well-known text (WKT). Only the
//! EPSG code is taken from it, and only the one the root of the text carries:
//! `AUTHORITY["EPSG","32640"]` at the end of a WKT 1 `PROJCS[...]`, or
//! `ID["EPSG",32640]` in a WKT 2 `PROJCRS[...]`. The geographic system inside a
//! projected one has an authority of its own (4326 for WGS 84), which must not be
//! mistaken for the file's. Files without a root authority, such as those written
//! by ESRI software, are reported as unrecognized, so the user is asked to choose.

use karmania_core::{CrsRef, Finding, FindingCode, Findings};

/// Brackets nested deeper than this are not a coordinate system.
const MAX_DEPTH: usize = 40;

/// What a `.prj` file says about the coordinate system.
#[derive(Debug, Clone, PartialEq)]
pub struct PrjInfo {
    /// The EPSG coordinate system, if the file names one.
    pub crs: Option<CrsRef>,
    /// The name of the coordinate system, if the text could be read and has one.
    pub name: Option<String>,
    /// A warning if no EPSG code was found; empty otherwise.
    pub findings: Findings,
}

/// A piece of well-known text.
#[derive(Debug)]
enum Node {
    /// A quoted string.
    Text(String),
    /// A number or bare word such as `EAST`.
    Word(String),
    /// `KEYWORD[arguments]`, or with round brackets.
    Item { keyword: String, args: Vec<Node> },
}

struct Parser<'a> {
    text: &'a str,
    pos: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.text.as_bytes().get(self.pos).copied()
    }

    fn skip_whitespace(&mut self) {
        while self.peek().is_some_and(|b| b.is_ascii_whitespace()) {
            self.pos += 1;
        }
    }

    /// A quoted string, after its opening quote. `""` is a quote inside it.
    fn quoted(&mut self) -> Option<String> {
        let mut out = String::new();
        loop {
            let rest = self.text.get(self.pos..)?;
            let end = rest.find('"')?;
            out.push_str(rest.get(..end)?);
            self.pos += end + 1;
            if self.peek() == Some(b'"') {
                out.push('"');
                self.pos += 1;
            } else {
                return Some(out);
            }
        }
    }

    /// A run of characters up to whitespace or punctuation.
    fn word(&mut self) -> Option<&str> {
        let start = self.pos;
        while self
            .peek()
            .is_some_and(|b| !b.is_ascii_whitespace() && !b"[](),\"".contains(&b))
        {
            self.pos += 1;
        }
        self.text.get(start..self.pos).filter(|w| !w.is_empty())
    }

    fn node(&mut self, depth: usize) -> Option<Node> {
        if depth > MAX_DEPTH {
            return None;
        }
        self.skip_whitespace();
        if self.peek()? == b'"' {
            self.pos += 1;
            return self.quoted().map(Node::Text);
        }
        let word = self.word()?.to_string();
        self.skip_whitespace();
        let Some(open @ (b'[' | b'(')) = self.peek() else {
            return Some(Node::Word(word));
        };
        self.pos += 1;
        let close = if open == b'[' { b']' } else { b')' };
        let mut args = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(close) {
            self.pos += 1;
        } else {
            loop {
                args.push(self.node(depth + 1)?);
                self.skip_whitespace();
                match self.peek()? {
                    b',' => self.pos += 1,
                    c if c == close => {
                        self.pos += 1;
                        break;
                    }
                    _ => return None,
                }
            }
        }
        Some(Node::Item {
            keyword: word.to_ascii_uppercase(),
            args,
        })
    }
}

/// The text of a quoted string or bare word.
fn text_of(node: Option<&Node>) -> Option<&str> {
    match node? {
        Node::Text(s) | Node::Word(s) => Some(s),
        Node::Item { .. } => None,
    }
}

/// The EPSG code among the direct children of a root node, if there is one.
fn epsg_code(args: &[Node]) -> Option<u32> {
    args.iter().find_map(|child| {
        let Node::Item { keyword, args } = child else {
            return None;
        };
        if keyword != "AUTHORITY" && keyword != "ID" {
            return None;
        }
        if !text_of(args.first())?.eq_ignore_ascii_case("epsg") {
            return None;
        }
        text_of(args.get(1))?
            .trim()
            .parse::<u32>()
            .ok()
            .filter(|&code| code > 0)
    })
}

fn unrecognized(message: String) -> Findings {
    let mut findings = Findings::new();
    findings.add(
        Finding::new(FindingCode::PrjUnrecognized, message)
            .with_hint("Choose the coordinate system yourself."),
    );
    findings
}

/// Reads a `.prj` file.
///
/// Anything but a root EPSG code gives `crs: None` and a warning, never an error:
/// the sidecar is optional help, and the user can always choose the coordinate
/// system.
#[must_use]
pub fn read_prj(text: &str) -> PrjInfo {
    let text = text
        .trim_start_matches('\u{feff}')
        .trim_matches(['\0', ' ', '\t', '\r', '\n']);
    if text.is_empty() {
        return PrjInfo {
            crs: None,
            name: None,
            findings: unrecognized(
                "The projection file is empty, so the coordinate system could not be set."
                    .to_string(),
            ),
        };
    }
    // Some tools write just the code.
    if let Some(code) = text
        .get(..5)
        .filter(|prefix| prefix.eq_ignore_ascii_case("epsg:"))
        .and_then(|_| text.get(5..))
        .and_then(|code| code.trim().parse::<u32>().ok())
        .filter(|&code| code > 0)
    {
        return PrjInfo {
            crs: Some(CrsRef::Epsg { code }),
            name: None,
            findings: Findings::new(),
        };
    }
    let root = Parser { text, pos: 0 }.node(0);
    let Some(Node::Item { args, .. }) = root else {
        return PrjInfo {
            crs: None,
            name: None,
            findings: unrecognized(
                "The projection file could not be read, so the coordinate system could not be set."
                    .to_string(),
            ),
        };
    };
    let name = text_of(args.first()).map(|n| n.chars().take(80).collect::<String>());
    match epsg_code(&args) {
        Some(code) => PrjInfo {
            crs: Some(CrsRef::Epsg { code }),
            name,
            findings: Findings::new(),
        },
        None => {
            let message = match &name {
                Some(name) => format!(
                    "The projection file describes \"{name}\" but does not give an EPSG code, so the coordinate system could not be set."
                ),
                None => "The projection file does not give an EPSG code, so the coordinate system could not be set.".to_string(),
            };
            PrjInfo {
                crs: None,
                name,
                findings: unrecognized(message),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;

    fn epsg(code: u32) -> Option<CrsRef> {
        Some(CrsRef::Epsg { code })
    }

    fn codes(info: &PrjInfo) -> Vec<&'static str> {
        info.findings.iter().map(|f| f.code.as_str()).collect()
    }

    #[test]
    fn the_projected_samples_own_code_is_found_not_the_geographic_one_inside_it() {
        let info = read_prj(&fixtures::text("points.prj"));
        assert_eq!(info.crs, epsg(32640));
        assert_eq!(info.name.as_deref(), Some("WGS 84 / UTM zone 40N"));
        assert!(info.findings.is_empty());
    }

    #[test]
    fn a_file_without_a_root_authority_is_unrecognized_even_if_nested_parts_have_one() {
        let info = read_prj(&fixtures::text("esri.prj"));
        assert_eq!(info.crs, None);
        assert_eq!(info.name.as_deref(), Some("WGS_1984_UTM_Zone_40N"));
        assert_eq!(codes(&info), ["prj.unrecognized"]);
        assert_eq!(
            info.findings.as_slice()[0].message,
            "The projection file describes \"WGS_1984_UTM_Zone_40N\" but does not give an EPSG code, so the coordinate system could not be set."
        );

        // The same text with authorities on the parts but none on the root.
        let nested = r#"PROJCS["Local",GEOGCS["WGS 84",DATUM["WGS_1984",AUTHORITY["EPSG","6326"]],AUTHORITY["EPSG","4326"]],PROJECTION["Transverse_Mercator"],UNIT["metre",1,AUTHORITY["EPSG","9001"]]]"#;
        assert_eq!(read_prj(nested).crs, None);
    }

    #[test]
    fn a_geographic_system_has_its_own_code_at_the_root() {
        let wkt = r#"GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]"#;
        assert_eq!(read_prj(wkt).crs, epsg(4326));
    }

    #[test]
    fn wkt2_takes_the_id_at_the_root() {
        let wkt = r#"PROJCRS["WGS 84 / UTM zone 40N",
            BASEGEOGCRS["WGS 84",DATUM["World Geodetic System 1984",ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]]],ID["EPSG",4326]],
            CONVERSION["UTM zone 40N",METHOD["Transverse Mercator",ID["EPSG",9807]],PARAMETER["Latitude of natural origin",0,ANGLEUNIT["degree",0.0174532925199433]]],
            CS[Cartesian,2],AXIS["(E)",east,ORDER[1]],AXIS["(N)",north,ORDER[2]],LENGTHUNIT["metre",1],
            USAGE[SCOPE["Engineering survey"],AREA["World"],BBOX[0,54,84,60]],
            ID["EPSG",32640]]"#;
        let info = read_prj(wkt);
        assert_eq!(info.crs, epsg(32640));
        assert_eq!(info.name.as_deref(), Some("WGS 84 / UTM zone 40N"));
    }

    #[test]
    fn keywords_brackets_codes_and_spacing_are_flexible() {
        for wkt in [
            r#"projcs["x",authority["epsg","32640"]]"#,
            r#"PROJCS("x",AUTHORITY("EPSG","32640"))"#,
            r#"PROJCS[ "x" , AUTHORITY[ "EPSG" , "32640" ] ]"#,
            "PROJCS[\"x\",\r\n  ID[\"EPSG\",32640]\r\n]\r\n",
            "\u{feff}PROJCS[\"x\",ID[\"EPSG\",32640]]\0\0",
        ] {
            assert_eq!(read_prj(wkt).crs, epsg(32640), "{wkt:?}");
        }
        assert_eq!(read_prj("EPSG:32640\n").crs, epsg(32640));
        assert_eq!(read_prj("epsg: 4326").crs, epsg(4326));
    }

    #[test]
    fn quotes_inside_names_do_not_break_the_reading() {
        let wkt = r#"PROJCS["A ""quoted"" name",AUTHORITY["EPSG","32640"]]"#;
        let info = read_prj(wkt);
        assert_eq!(info.crs, epsg(32640));
        assert_eq!(info.name.as_deref(), Some("A \"quoted\" name"));
    }

    #[test]
    fn other_authorities_and_bad_codes_are_unrecognized() {
        for wkt in [
            r#"PROJCS["x",AUTHORITY["ESRI","102100"]]"#,
            r#"PROJCS["x",AUTHORITY["EPSG","0"]]"#,
            r#"PROJCS["x",AUTHORITY["EPSG","abc"]]"#,
            r#"PROJCS["x",AUTHORITY["EPSG","-5"]]"#,
            r#"PROJCS["x",AUTHORITY["EPSG"]]"#,
            r#"PROJCS["x",AUTHORITY[]]"#,
            r#"PROJCS["x"]"#,
            r#"PROJCS[]"#,
            "EPSG:abc",
            "EPSG:0",
        ] {
            let info = read_prj(wkt);
            assert_eq!(info.crs, None, "{wkt}");
            assert_eq!(codes(&info), ["prj.unrecognized"], "{wkt}");
        }
        // A name is kept for the message when there is one.
        assert!(
            read_prj(r#"PROJCS["x"]"#).findings.as_slice()[0]
                .message
                .contains("\"x\"")
        );
        assert!(
            !read_prj("PROJCS[]").findings.as_slice()[0]
                .message
                .contains('"')
        );
    }

    #[test]
    fn empty_and_unreadable_files_say_so() {
        for text in ["", "   \n", "\0\0", "\u{feff}"] {
            let info = read_prj(text);
            assert_eq!(info.crs, None);
            assert!(
                info.findings.as_slice()[0]
                    .message
                    .starts_with("The projection file is empty"),
                "{text:?}"
            );
        }
        for text in [
            "hello",
            "PROJCS[\"x\"",
            "PROJCS[\"x\",",
            "PROJCS[\"x\" AUTHORITY]",
            "\"just a string\"",
            "]]]",
            "PROJCS[\"unterminated",
            "{\"json\": true}",
        ] {
            let info = read_prj(text);
            assert_eq!(info.crs, None, "{text:?}");
            assert_eq!(codes(&info), ["prj.unrecognized"], "{text:?}");
            assert!(
                info.findings.as_slice()[0]
                    .message
                    .starts_with("The projection file could not be read")
                    || info.findings.as_slice()[0]
                        .message
                        .contains("does not give"),
                "{text:?}"
            );
        }
    }

    #[test]
    fn absurd_nesting_and_binary_junk_do_not_crash() {
        let deep = format!("{}{}", "A[".repeat(100_000), "]".repeat(100_000));
        let info = read_prj(&deep);
        assert_eq!(info.crs, None);
        assert_eq!(codes(&info), ["prj.unrecognized"]);
        let junk: String = (0u8..=255).map(char::from).collect();
        assert_eq!(read_prj(&junk).crs, None);
        let long_name = format!("PROJCS[\"{}\"]", "x".repeat(10_000));
        assert_eq!(read_prj(&long_name).name.unwrap().chars().count(), 80);
    }
}
