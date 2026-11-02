//! Searching the registry by code or by name.

use crate::info::{CrsInfo, describe};
use crate::lookup::lookup;

/// The most results a search gives, whatever limit is asked for.
pub const MAX_RESULTS: usize = 50;

/// Searches the definitions for a code or a name.
///
/// The results are, in this order: the system whose code is the query (a number, with or without
/// an `EPSG:` before it); then the systems whose name starts with the query; then those whose
/// name contains it. Names are compared without regard to case, and inside each group the
/// results are in order of code, so the same query always gives the same list. An empty query,
/// or a limit of 0, gives no results; a limit above [`MAX_RESULTS`] gives [`MAX_RESULTS`].
#[must_use]
pub fn search(query: &str, limit: usize) -> Vec<CrsInfo> {
    let limit = limit.min(MAX_RESULTS);
    let query = query.trim();
    if limit == 0 || query.is_empty() {
        return Vec::new();
    }
    let exact = code_of(query).and_then(|code| lookup(code).map(|info| (code, info)));
    let needle = query.to_lowercase();
    let mut starting = Vec::new();
    let mut containing = Vec::new();
    for code in 0..=u16::MAX {
        let Some(definition) = crs_definitions::from_code(code) else {
            continue;
        };
        if exact
            .as_ref()
            .is_some_and(|(found, _)| *found == u32::from(code))
        {
            continue;
        }
        let name = name_of(u32::from(code), definition.wkt).to_lowercase();
        if name.starts_with(&needle) {
            starting.push(code);
        } else if name.contains(&needle) {
            containing.push(code);
        }
    }
    let mut results: Vec<CrsInfo> = exact.map(|(_, info)| info).into_iter().collect();
    for code in starting.into_iter().chain(containing) {
        if results.len() >= limit {
            break;
        }
        if let Some(info) = lookup(u32::from(code)) {
            results.push(info);
        }
    }
    results.truncate(limit);
    results
}

/// The code a query names: digits, with or without `EPSG:` before them.
fn code_of(query: &str) -> Option<u32> {
    let digits = match query.get(..5) {
        Some(prefix) if prefix.eq_ignore_ascii_case("epsg:") => query.get(5..)?.trim_start(),
        _ => query,
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// The name of a definition, the same as `describe` gives. Reading the whole definition of every
/// entry for every search would take about twenty times as long (50 ms against 2.5 ms, natively,
/// in a release build), which a search box would feel, so the name is taken from the text as the
/// first quoted string, and only an entry where that is not enough (a quote inside the name, or
/// no quoted string) is read in full.
fn name_of(code: u32, wkt: &str) -> String {
    quick_name(wkt).map_or_else(|| describe(code, wkt).name, str::to_string)
}

/// The first quoted string of a definition, `None` if there is none or it holds a doubled quote.
fn quick_name(wkt: &str) -> Option<&str> {
    let rest = wkt.get(wkt.find('"')? + 1..)?;
    let close = rest.find('"')?;
    if rest.as_bytes().get(close + 1) == Some(&b'"') {
        return None;
    }
    rest.get(..close)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(results: &[CrsInfo]) -> Vec<u32> {
        results.iter().map(|info| info.code).collect()
    }

    /// The code and the full name of every definition, read once.
    fn registry() -> Vec<(u32, String)> {
        (0..=u32::from(u16::MAX))
            .filter_map(|code| lookup(code).map(|info| (code, info.name)))
            .collect()
    }

    /// The ranking written out in the plain way, over the names read in full.
    fn expected(registry: &[(u32, String)], query: &str, limit: usize) -> Vec<u32> {
        let needle = query.trim().to_lowercase();
        let digits = needle.strip_prefix("epsg:").unwrap_or(&needle).trim();
        let exact: Option<u32> = digits
            .parse()
            .ok()
            .filter(|code| registry.iter().any(|(known, _)| known == code));
        let mut starting = Vec::new();
        let mut containing = Vec::new();
        for (code, name) in registry {
            if Some(*code) == exact {
                continue;
            }
            let name = name.to_lowercase();
            if name.starts_with(&needle) {
                starting.push(*code);
            } else if name.contains(&needle) {
                containing.push(*code);
            }
        }
        exact
            .into_iter()
            .chain(starting)
            .chain(containing)
            .take(limit.min(MAX_RESULTS))
            .collect()
    }

    #[test]
    fn a_code_finds_its_system_first_with_or_without_epsg_before_it() {
        for query in ["4326", " 4326 ", "EPSG:4326", "epsg:4326", "Epsg: 4326"] {
            let found = search(query, 10);
            assert_eq!(found.first().map(|info| info.code), Some(4326), "{query:?}");
            assert_eq!(found.first().map(|info| info.name.as_str()), Some("WGS 84"));
        }
    }

    #[test]
    fn a_code_is_followed_by_the_names_that_start_with_and_then_contain_it() {
        // 2229 is a code, and "2229" is also inside no name, so only the code is found.
        assert_eq!(codes(&search("2229", 10)), vec![2229]);
        // A number that is a code and also part of names (SIRGAS 2000, for one): the code is first, the
        // names after it.
        let found = codes(&search("2000", 10));
        assert_eq!(found, expected(&registry(), "2000", 10));
        assert_eq!(found[0], 2000);
        assert!(found.len() > 1);
        assert!(
            search("2000", 10)[1..]
                .iter()
                .all(|info| info.name.contains("2000")),
            "{found:?}"
        );
    }

    #[test]
    fn names_that_start_with_the_query_come_before_names_that_contain_it() {
        let found = search("OSGB 1936", 50);
        let starts: Vec<bool> = found
            .iter()
            .map(|info| info.name.to_lowercase().starts_with("osgb 1936"))
            .collect();
        assert!(starts.contains(&true));
        // Once a name that does not start with the query has come, none that does follows.
        let first_other = starts
            .iter()
            .position(|starts| !starts)
            .unwrap_or(starts.len());
        assert!(starts[first_other..].iter().all(|starts| !starts));
        let contained = codes(&search("British National Grid", 50));
        assert!(contained.contains(&27700));
    }

    #[test]
    fn it_ignores_case_and_spaces_around_the_query() {
        assert_eq!(codes(&search("wgs 84 / utm zone 40n", 5)), vec![32640]);
        assert_eq!(codes(&search("  WGS 84 / UTM ZONE 40N ", 5)), vec![32640]);
    }

    #[test]
    fn the_results_are_those_of_the_plain_ranking_for_many_queries() {
        let registry = registry();
        for query in [
            "84",
            "utm",
            "utm zone 40",
            "zone 1",
            "nad",
            "british",
            "4326",
            "epsg:2229",
            "é",
            "a",
            "/",
            "ft",
            "WGS",
            "3993",
            "epsg:3993",
            "no such system",
            "99999",
        ] {
            assert_eq!(
                codes(&search(query, 50)),
                expected(&registry, query, 50),
                "{query:?}"
            );
            assert_eq!(
                codes(&search(query, 7)),
                expected(&registry, query, 7),
                "{query:?} limited"
            );
        }
    }

    #[test]
    fn a_system_without_a_definition_is_found_by_its_code_and_by_its_name() {
        assert_eq!(codes(&search("3993", 5)), vec![3993]);
        assert_eq!(codes(&search("EPSG:3993", 5)), vec![3993]);
    }

    #[test]
    fn the_limit_is_kept_and_never_goes_over_fifty() {
        assert_eq!(search("a", 5).len(), 5);
        assert_eq!(search("a", 1_000).len(), MAX_RESULTS);
        assert_eq!(search("a", usize::MAX).len(), MAX_RESULTS);
        assert!(search("a", 0).is_empty());
        assert_eq!(
            codes(&search("a", 5)),
            codes(&search("a", 50))[..5].to_vec()
        );
    }

    #[test]
    fn nothing_is_found_for_an_empty_query_or_a_code_and_name_that_are_not_there() {
        for query in [
            "",
            "   ",
            "\t\n",
            "no such system",
            "99999",
            "epsg:99999",
            "EPSG:-1",
        ] {
            assert!(search(query, 10).is_empty(), "{query:?}");
        }
    }

    #[test]
    fn epsg_with_a_colon_finds_the_systems_that_are_named_by_their_code() {
        // The entries with no definition are named `EPSG:<code>`, and contain the query.
        let found = search("epsg:", 50);
        assert!(!found.is_empty());
        assert!(
            found
                .iter()
                .all(|info| info.name == format!("EPSG:{}", info.code))
        );
    }

    #[test]
    fn the_same_query_gives_the_same_list() {
        assert_eq!(search("zone", 50), search("zone", 50));
    }

    #[test]
    fn the_quick_name_is_the_name_describe_gives_for_every_definition() {
        let mut slow = 0;
        for code in 0..=u16::MAX {
            let Some(definition) = crs_definitions::from_code(code) else {
                continue;
            };
            let described = describe(u32::from(code), definition.wkt).name;
            assert_eq!(
                name_of(u32::from(code), definition.wkt),
                described,
                "{code}"
            );
            if quick_name(definition.wkt).is_none() {
                slow += 1;
            }
        }
        // Only entries without a definition (and their `EPSG:` name) need the full reading.
        assert!(slow < 20, "{slow}");
    }

    #[test]
    fn the_quick_name_reads_the_first_quoted_string_and_gives_up_on_quotes_inside() {
        assert_eq!(quick_name(r#"PROJCS["A name",X["y"]]"#), Some("A name"));
        assert_eq!(quick_name(r#"PROJCS["A ""quoted"" name"]"#), None);
        assert_eq!(quick_name(""), None);
        assert_eq!(quick_name("PROJCS["), None);
        assert_eq!(quick_name(r#"PROJCS["unterminated"#), None);
    }
}
