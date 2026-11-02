//! A small reader for the WKT text of a coordinate system definition.
//!
//! The definitions come as WKT strings such as `PROJCS["WGS 84 / UTM zone 40N",GEOGCS[...],...]`.
//! This reads the text into a tree, and has the few questions that are asked of it: the
//! system's name, the part that places 2D data, and a keyword's node. It is a reader of the
//! definitions this crate ships, not of any WKT: text it cannot read gives `None`, never a
//! panic, and nesting beyond [`MAX_DEPTH`] is refused so that no text can exhaust the stack.

/// A parsed WKT value.
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    /// A quoted string, with a doubled quote inside written as one quote.
    Text(String),
    /// A number.
    Number(f64),
    /// A bare word that is not followed by `[`, for example `NORTH` in an `AXIS`.
    Word,
    /// A keyword with arguments, for example `UNIT["metre",1]`.
    Call {
        /// The keyword as written, for example `PROJCS`.
        keyword: String,
        /// The arguments, in order.
        args: Vec<Node>,
    },
}

impl Node {
    /// The keyword of a [`Node::Call`], `None` for any other node.
    #[must_use]
    pub fn keyword(&self) -> Option<&str> {
        match self {
            Node::Call { keyword, .. } => Some(keyword),
            _ => None,
        }
    }

    /// The arguments of a [`Node::Call`], empty for any other node.
    #[must_use]
    pub fn args(&self) -> &[Node] {
        match self {
            Node::Call { args, .. } => args,
            _ => &[],
        }
    }
}

/// How deeply WKT may nest before it is refused as malformed. The deepest definition in the
/// registry nests far less.
pub const MAX_DEPTH: usize = 64;

/// Parses a WKT string. `None` if it is empty, malformed, has text after the value, or nests
/// deeper than [`MAX_DEPTH`].
#[must_use]
pub fn parse(text: &str) -> Option<Node> {
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

/// The first quoted string anywhere in the tree, which in a definition is the system's name.
#[must_use]
pub fn first_text(node: &Node) -> Option<String> {
    match node {
        Node::Text(s) => Some(s.clone()),
        Node::Call { args, .. } => args.iter().find_map(first_text),
        Node::Number(_) | Node::Word => None,
    }
}

/// The first node with this keyword, searching depth first, the node itself included.
#[must_use]
pub fn find_keyword<'a>(node: &'a Node, keyword: &str) -> Option<&'a Node> {
    if node.keyword() == Some(keyword) {
        return Some(node);
    }
    node.args().iter().find_map(|n| find_keyword(n, keyword))
}

/// The geographic, projected or geocentric part that places 2D data: the node itself, or for
/// compound and bound systems the first such part inside. `None` for anything else.
#[must_use]
pub fn horizontal_part(node: &Node) -> Option<&Node> {
    match node.keyword()? {
        "PROJCS" | "PROJCRS" | "GEOGCS" | "GEOGCRS" | "GEOCCS" => Some(node),
        "COMPD_CS" | "BOUNDCRS" | "SOURCECRS" => node.args().iter().find_map(horizontal_part),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_reads_quotes_nesting_numbers_and_bare_words() {
        let node = parse(r#"A["x ""quoted"" name",1.5,B[C["y"],word]]"#).unwrap();
        assert_eq!(node.keyword(), Some("A"));
        assert_eq!(
            node.args().first(),
            Some(&Node::Text(r#"x "quoted" name"#.to_string()))
        );
        assert_eq!(node.args().len(), 3);
        assert!(matches!(node.args().get(1), Some(Node::Number(n)) if *n == 1.5));
        let inner = node.args().get(2).unwrap();
        assert_eq!(inner.keyword(), Some("B"));
        assert_eq!(inner.args().get(1), Some(&Node::Word));
    }

    #[test]
    fn it_reads_spaces_and_line_breaks_between_the_parts() {
        let node = parse("A [ \"x\" ,\n 2 ,\tB [ ] ] ").unwrap();
        assert_eq!(node.args().len(), 3);
        assert_eq!(node.args().last().and_then(Node::keyword), Some("B"));
    }

    #[test]
    fn text_that_is_not_wkt_is_none() {
        for bad in [
            "",
            "A[",
            "A[\"unterminated]",
            "A[1,,2]",
            "]",
            "A[1] trailing",
            "A[1 2]",
            "\"",
        ] {
            assert!(parse(bad).is_none(), "accepted {bad:?}");
        }
    }

    #[test]
    fn nesting_beyond_the_limit_is_refused_and_the_limit_itself_is_read() {
        let nested = |depth: usize| format!("{}{}", "A[".repeat(depth), "]".repeat(depth));
        assert!(parse(&nested(MAX_DEPTH)).is_some());
        assert!(parse(&nested(MAX_DEPTH + 2)).is_none());
        assert!(parse(&nested(10_000)).is_none());
    }

    #[test]
    fn it_finds_the_name_a_keyword_and_the_part_that_places_data() {
        let projected =
            parse(r#"PROJCS["Grid",GEOGCS["Datum",UNIT["degree",0.0174]],UNIT["metre",1]]"#)
                .unwrap();
        assert_eq!(first_text(&projected).as_deref(), Some("Grid"));
        assert_eq!(horizontal_part(&projected), Some(&projected));
        let unit = find_keyword(&projected, "UNIT").unwrap();
        assert_eq!(unit.args().first(), Some(&Node::Text("degree".to_string())));

        let compound =
            parse(r#"COMPD_CS["Grid + height",VERT_CS["height",UNIT["metre",1]],GEOGCS["Datum"]]"#)
                .unwrap();
        let part = horizontal_part(&compound).unwrap();
        assert_eq!(part.keyword(), Some("GEOGCS"));

        let vertical = parse(r#"VERT_CS["height",UNIT["metre",1]]"#).unwrap();
        assert_eq!(horizontal_part(&vertical), None);
        assert_eq!(horizontal_part(&Node::Word), None);
        assert_eq!(find_keyword(&vertical, "PROJCS"), None);
    }

    #[test]
    fn the_questions_of_a_node_that_is_not_a_call_have_empty_answers() {
        for node in [Node::Word, Node::Number(1.0), Node::Text("t".to_string())] {
            assert_eq!(node.keyword(), None);
            assert!(node.args().is_empty());
        }
        assert_eq!(first_text(&Node::Number(1.0)), None);
    }
}
