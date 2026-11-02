//! The definitions as the answer to `karmania_core::CrsKinds`.

use karmania_core::{CrsGeography, CrsKinds};

use crate::info::CrsKind;
use crate::lookup::lookup;

/// The EPSG definitions, as the core's validation wants to ask them: is this code a longitude
/// and latitude system? Give it to `karmania_core::validate_with`.
///
/// A code that is in the definitions is [`CrsGeography::Geographic`] when it is a geographic
/// system and [`CrsGeography::NotGeographic`] otherwise (a projected or geocentric system, or one
/// with no definition); a code that is not in them is [`CrsGeography::Unknown`].
#[derive(Debug, Clone, Copy, Default)]
pub struct Definitions;

impl CrsKinds for Definitions {
    fn geography(&self, code: u32) -> CrsGeography {
        match lookup(code) {
            Some(info) if info.kind == CrsKind::Geographic => CrsGeography::Geographic,
            Some(_) => CrsGeography::NotGeographic,
            None => CrsGeography::Unknown,
        }
    }
}

#[cfg(test)]
mod tests {
    use karmania_core::{
        CrsRef, Dataset, DatasetId, Findings, Geometry, Positions, Table, validate, validate_with,
    };

    use super::*;

    #[test]
    fn geographic_systems_are_geographic_and_the_rest_that_exist_are_not() {
        for code in [4326, 4269, 4258, 4277, 4327, 3823] {
            assert_eq!(
                Definitions.geography(code),
                CrsGeography::Geographic,
                "{code}"
            );
        }
        // Projected, geocentric, and one with no definition.
        for code in [32640, 3857, 27700, 2229, 4978, 3822, 3993] {
            assert_eq!(
                Definitions.geography(code),
                CrsGeography::NotGeographic,
                "{code}"
            );
        }
    }

    #[test]
    fn a_code_that_is_not_in_the_definitions_is_unknown() {
        for code in [0, 1, 99, 99_999, 65_536, u32::MAX] {
            assert_eq!(Definitions.geography(code), CrsGeography::Unknown, "{code}");
        }
    }

    #[test]
    fn it_agrees_with_lookup_for_every_code_of_the_registry() {
        let mut geographic = 0;
        for code in 0..=u32::from(u16::MAX) {
            let expected = match lookup(code) {
                Some(info) if info.kind == CrsKind::Geographic => CrsGeography::Geographic,
                Some(_) => CrsGeography::NotGeographic,
                None => CrsGeography::Unknown,
            };
            let answer = Definitions.geography(code);
            assert_eq!(answer, expected, "{code}");
            geographic += usize::from(answer == CrsGeography::Geographic);
        }
        // The 754 + 9 geographic systems counted at step 12.3.
        assert_eq!(geographic, 763);
    }

    fn points(code: u32, x: f64, y: f64) -> Dataset {
        let positions = Positions::from_xyz(&[x], &[y], None, &mut Findings::new()).unwrap();
        let mut dataset = Dataset::new(
            DatasetId(1),
            "p",
            None,
            Geometry::Points(positions),
            Table::empty(),
        );
        dataset.crs = Some(CrsRef::Epsg { code });
        dataset
    }

    fn codes(report: &karmania_core::ValidationReport) -> Vec<&'static str> {
        report
            .findings()
            .map(|finding| finding.code.as_str())
            .collect()
    }

    #[test]
    fn validation_with_the_definitions_checks_every_geographic_code() {
        // Projected-looking numbers labelled NAD83: the core alone cannot tell they are wrong.
        let nad83 = points(4269, 500_000.0, 2_800_000.0);
        assert!(codes(&validate(&nad83)).is_empty());
        assert_eq!(
            codes(&validate_with(&nad83, &Definitions)),
            ["crs.geographic.out_of_range"]
        );
        // The same numbers in UTM, or in a code that is not known, are not range-checked.
        for code in [32640, 99_999] {
            let d = points(code, 500_000.0, 2_800_000.0);
            assert!(codes(&validate_with(&d, &Definitions)).is_empty(), "{code}");
        }
        // EPSG:4326 is still checked.
        let wgs84 = points(4326, 500_000.0, 2_800_000.0);
        assert_eq!(
            codes(&validate_with(&wgs84, &Definitions)),
            ["crs.geographic.out_of_range"]
        );
    }
}
