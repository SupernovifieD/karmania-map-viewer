//! Access to the sample files in the repository's `fixtures/` directory.

use std::path::PathBuf;

/// Every fixture file, one or more per format.
pub(crate) const ALL: [&str; 8] = [
    "points.csv",
    "lines.csv",
    "blocks.csv",
    "mixed.geojson",
    "grid.asc",
    "mesh.obj",
    "points.prj",
    "esri.prj",
];

fn directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

/// The bytes of a fixture file.
pub(crate) fn bytes(name: &str) -> Vec<u8> {
    let path = directory().join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("fixture {} unreadable: {e}", path.display()))
}

/// The text of a fixture file.
pub(crate) fn text(name: &str) -> String {
    String::from_utf8(bytes(name)).unwrap_or_else(|e| panic!("fixture {name} is not UTF-8: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_format_has_a_small_utf8_sample() {
        for name in ALL {
            let size = bytes(name).len();
            assert!(size > 0 && size < 50 * 1024, "{name} is {size} bytes");
            assert!(!text(name).is_empty());
        }
    }

    #[test]
    fn the_fixtures_directory_holds_exactly_the_listed_files() {
        let mut found: Vec<String> = std::fs::read_dir(directory())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| !n.starts_with('.'))
            .collect();
        found.sort();
        let mut listed: Vec<String> = ALL.iter().map(|s| (*s).to_string()).collect();
        listed.sort();
        assert_eq!(found, listed);
    }

    #[test]
    fn the_two_prj_samples_differ_in_whether_they_name_an_epsg_code() {
        assert!(text("points.prj").contains(r#"AUTHORITY["EPSG","32640"]"#));
        assert!(!text("esri.prj").contains("AUTHORITY"));
    }
}
