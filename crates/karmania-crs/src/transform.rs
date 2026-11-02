//! Converting positions from one coordinate system to another.

use karmania_core::{CrsRef, Finding, FindingCode};
use proj4rs::Proj;
use proj4rs::errors::Error;
use proj4rs::transform::transform;

/// Converts the horizontal positions of one coordinate system into another.
///
/// Positions are `x` (east, or longitude) and `y` (north, or latitude) in the units of their
/// system: metres or feet for a map system, **degrees** for a geographic one. Heights are not
/// converted (they are never reprojected). A position that cannot be converted comes back as
/// `[NaN, NaN]`, and so does any non-finite position given to it.
///
/// Build one with [`Transformer::new`]. It reads the definitions of both systems once, so
/// convert many positions with one transformer.
pub struct Transformer {
    how: How,
}

enum How {
    /// The same system: nothing changes.
    Identity,
    /// Two local grids, taken to be the same grid in different units.
    Scale(f64),
    /// Two EPSG systems, through their PROJ definitions.
    Projection(Box<Projection>),
}

struct Projection {
    from: Proj,
    to: Proj,
}

impl Transformer {
    /// Builds the conversion from `from` to `to`.
    ///
    /// - The same system, or two local grids in the same units: nothing changes.
    /// - Two local grids in different units: positions are scaled by the units, and the grids are
    ///   taken to be the same grid.
    /// - Two EPSG systems: the positions are converted with the definitions of both, on the
    ///   straight path through longitude and latitude. A datum shift that needs grid files is not
    ///   possible (see `crs.transform.unsupported`).
    ///
    /// # Errors
    ///
    /// A finding, never a panic: `crs.transform.local_grid` for a local grid and an EPSG system
    /// (they have no common place on the Earth), `crs.transform.code_unknown` for an EPSG code
    /// that is not in the definitions, and `crs.transform.unsupported` for a known system that
    /// cannot be used, with the reason in the message.
    pub fn new(from: CrsRef, to: CrsRef) -> Result<Self, Finding> {
        let how = match (from, to) {
            (a, b) if a == b => How::Identity,
            (CrsRef::Local { units: a }, CrsRef::Local { units: b }) => {
                How::Scale(a.metres_per_unit() / b.metres_per_unit())
            }
            (CrsRef::Local { .. }, CrsRef::Epsg { code })
            | (CrsRef::Epsg { code }, CrsRef::Local { .. }) => return Err(local_grid(code)),
            (CrsRef::Epsg { code: a }, CrsRef::Epsg { code: b }) => {
                How::Projection(Box::new(Projection {
                    from: build(a)?,
                    to: build(b)?,
                }))
            }
        };
        Ok(Self { how })
    }

    /// Whether the conversion leaves every position as it is.
    #[must_use]
    pub fn is_identity(&self) -> bool {
        matches!(self.how, How::Identity)
    }

    /// Converts one position. `[NaN, NaN]` if it cannot be converted.
    #[must_use]
    pub fn convert(&self, x: f64, y: f64) -> [f64; 2] {
        match &self.how {
            How::Identity => [x, y],
            How::Scale(factor) => [x * factor, y * factor],
            How::Projection(projection) => projection.convert(x, y),
        }
    }
}

impl Projection {
    fn convert(&self, x: f64, y: f64) -> [f64; 2] {
        // proj4rs takes and gives longitude and latitude in radians.
        let (x, y) = if self.from.is_latlong() {
            (x.to_radians(), y.to_radians())
        } else {
            (x, y)
        };
        let mut point = (x, y);
        if transform(&self.from, &self.to, &mut point).is_err() {
            return [f64::NAN, f64::NAN];
        }
        if self.to.is_latlong() {
            [point.0.to_degrees(), point.1.to_degrees()]
        } else {
            [point.0, point.1]
        }
    }
}

/// The PROJ definition of an EPSG code, built.
fn build(code: u32) -> Result<Proj, Finding> {
    let definition = u16::try_from(code)
        .ok()
        .and_then(crs_definitions::from_code)
        .ok_or_else(|| code_unknown(code))?;
    if definition.proj4.is_empty() {
        return Err(unsupported(code, "it has no definition"));
    }
    let proj = Proj::from_proj_string(definition.proj4)
        .map_err(|error| unsupported(code, reason(&error)))?;
    if proj.is_geocent() {
        return Err(unsupported(
            code,
            "it is geocentric, not a map coordinate system",
        ));
    }
    Ok(proj)
}

/// Why `proj4rs` could not build a definition, in words for a person.
fn reason(error: &Error) -> &'static str {
    match error {
        Error::NadGridNotAvailable | Error::NadGridParentNotFound | Error::GridFileNotFound(_) => {
            "it needs files for shifting between datums, which are not available"
        }
        Error::ProjectionNotFound => "its projection is not supported",
        _ => "its definition cannot be used",
    }
}

fn local_grid(code: u32) -> Finding {
    Finding::new(
        FindingCode::CrsTransformLocalGrid,
        format!(
            "A local grid has no known place on the Earth, so its positions cannot be converted to or from EPSG:{code}."
        ),
    )
    .with_hint("Draw it with other local grids, or give the data a coordinate system by its EPSG code.")
}

fn code_unknown(code: u32) -> Finding {
    Finding::new(
        FindingCode::CrsTransformCodeUnknown,
        format!(
            "EPSG:{code} is not one of the coordinate systems Karmania knows, so positions cannot be converted to or from it."
        ),
    )
    .with_hint("Check the code of the data, or choose another coordinate system for the map.")
}

fn unsupported(code: u32, reason: &str) -> Finding {
    Finding::new(
        FindingCode::CrsTransformUnsupported,
        format!("Positions cannot be converted to or from EPSG:{code}: {reason}."),
    )
    .with_hint(
        "Choose another coordinate system for the map; the positions of the data are kept as they are.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use karmania_core::Units;

    const DOCS: &str = include_str!("../../../docs/validation-codes.md");

    fn epsg(code: u32) -> CrsRef {
        CrsRef::Epsg { code }
    }

    fn local(units: Units) -> CrsRef {
        CrsRef::Local { units }
    }

    fn transformer(from: CrsRef, to: CrsRef) -> Transformer {
        Transformer::new(from, to).unwrap_or_else(|f| panic!("{from:?} to {to:?}: {}", f.message))
    }

    fn failure(from: CrsRef, to: CrsRef) -> Finding {
        match Transformer::new(from, to) {
            Err(finding) => finding,
            Ok(_) => panic!("{from:?} to {to:?} should not be possible"),
        }
    }

    #[test]
    fn the_same_system_changes_nothing() {
        for system in [epsg(4326), epsg(32640), local(Units::Foot)] {
            let same = transformer(system, system);
            assert!(same.is_identity());
            assert_eq!(same.convert(512_345.25, -4_012.5), [512_345.25, -4_012.5]);
        }
        // An unknown code to itself has nothing to convert either.
        assert!(transformer(epsg(99_999), epsg(99_999)).is_identity());
    }

    #[test]
    fn local_grids_are_scaled_by_their_units() {
        let to_feet = transformer(local(Units::Metre), local(Units::Foot));
        assert!(!to_feet.is_identity());
        let [x, y] = to_feet.convert(3_048.0, 1_524.0);
        assert!((x - 10_000.0).abs() < 1e-9 && (y - 5_000.0).abs() < 1e-9);
        let to_metres = transformer(local(Units::Foot), local(Units::Metre));
        assert_eq!(to_metres.convert(10_000.0, 5_000.0), [3_048.0, 1_524.0]);
        // A US survey foot is 1200/3937 m, a little longer than the international foot.
        let survey_to_foot = transformer(local(Units::UsSurveyFoot), local(Units::Foot));
        let expected = 1_200.0 / 3_937.0 / 0.3048;
        assert!((survey_to_foot.convert(1.0, 2.0)[0] - expected).abs() < 1e-15);
        assert!((survey_to_foot.convert(1.0, 2.0)[1] - 2.0 * expected).abs() < 1e-15);
        assert!((expected - 1.000_002).abs() < 1e-8);
    }

    #[test]
    fn a_local_grid_and_an_epsg_system_cannot_be_converted_either_way() {
        for (from, to) in [
            (local(Units::Metre), epsg(32640)),
            (epsg(32640), local(Units::UsSurveyFoot)),
        ] {
            let finding = failure(from, to);
            assert_eq!(finding.code, FindingCode::CrsTransformLocalGrid);
            assert!(
                finding
                    .message
                    .ends_with("converted to or from EPSG:32640."),
                "{}",
                finding.message
            );
            assert!(
                finding
                    .hint
                    .as_deref()
                    .is_some_and(|hint| hint.contains("EPSG code"))
            );
        }
    }

    #[test]
    fn a_code_that_is_not_known_is_a_finding_that_names_it() {
        for (from, to, named) in [
            (epsg(4326), epsg(99_999), 99_999),
            (epsg(99_999), epsg(4326), 99_999),
            (epsg(70_000), epsg(99_999), 70_000),
            (epsg(4326), epsg(65_536), 65_536),
        ] {
            let finding = failure(from, to);
            assert_eq!(finding.code, FindingCode::CrsTransformCodeUnknown);
            assert!(
                finding
                    .message
                    .starts_with(&format!("EPSG:{named} is not one of")),
                "{}",
                finding.message
            );
            assert!(finding.hint.is_some());
        }
    }

    #[test]
    fn a_known_system_that_cannot_be_used_says_why() {
        let grids = failure(epsg(4326), epsg(2085));
        assert_eq!(grids.code, FindingCode::CrsTransformUnsupported);
        assert_eq!(
            grids.message,
            "Positions cannot be converted to or from EPSG:2085: it needs files for shifting between datums, which are not available."
        );
        let geocentric = failure(epsg(4978), epsg(4326));
        assert_eq!(geocentric.code, FindingCode::CrsTransformUnsupported);
        assert!(
            geocentric
                .message
                .ends_with("it is geocentric, not a map coordinate system."),
            "{}",
            geocentric.message
        );
        assert!(geocentric.hint.is_some() && grids.hint.is_some());
    }

    #[test]
    fn the_examples_of_the_docs_are_what_the_transformer_says() {
        for finding in [
            failure(local(Units::Metre), epsg(32640)),
            failure(epsg(4326), epsg(99_999)),
            failure(epsg(4326), epsg(2085)),
        ] {
            let code = finding.code.as_str();
            let section = DOCS
                .split("\n## `")
                .find(|section| section.starts_with(code))
                .unwrap_or_else(|| panic!("{code} is not in the docs"));
            assert!(
                section.contains(&format!("- Example: {}", finding.message)),
                "{code}: {}",
                finding.message
            );
            let hint = finding.hint.as_deref().unwrap_or_default();
            assert!(
                section.contains(&format!("- Hint: {hint}")),
                "{code}: {hint}"
            );
        }
    }

    #[test]
    fn longitude_and_latitude_go_to_utm_and_back() {
        let to_utm = transformer(epsg(4326), epsg(32640));
        // The central meridian of zone 40 is 57 degrees east: easting 500 000 m there.
        let [x, y] = to_utm.convert(57.0, 0.0);
        assert!((x - 500_000.0).abs() < 1e-6 && y.abs() < 1e-6, "{x} {y}");
        let [x, _] = to_utm.convert(57.0, 45.0);
        assert!((x - 500_000.0).abs() < 1e-6, "{x}");
        let back = transformer(epsg(32640), epsg(4326));
        for i in 0..=60 {
            for j in 0..=70 {
                let (lon, lat) = (54.0 + f64::from(i) * 0.1, -10.0 + f64::from(j));
                let [x, y] = to_utm.convert(lon, lat);
                let [lon2, lat2] = back.convert(x, y);
                assert!(
                    (lon2 - lon).abs() < 1e-11 && (lat2 - lat).abs() < 1e-11,
                    "{lon} {lat}"
                );
            }
        }
    }

    #[test]
    fn a_geographic_target_is_in_degrees_and_a_foot_system_is_in_feet() {
        // Both are on the same datum, so the position hardly moves, and it is in degrees.
        let to_nad83 = transformer(epsg(4326), epsg(4269));
        let [lon, lat] = to_nad83.convert(10.5, 20.25);
        assert!(
            (lon - 10.5).abs() < 1e-9 && (lat - 20.25).abs() < 1e-9,
            "{lon} {lat}"
        );
        // California zone 5 in US survey feet (2229) and in metres (26945): the same place,
        // apart from the two systems' false origins, which differ by 0.0001016 m.
        let feet = transformer(epsg(4326), epsg(2229)).convert(-118.25, 34.05);
        let metres = transformer(epsg(4326), epsg(26_945)).convert(-118.25, 34.05);
        for axis in 0..2 {
            let feet_in_metres = feet[axis] * 1_200.0 / 3_937.0;
            assert!(
                (feet_in_metres - metres[axis]).abs() < 1e-3,
                "{axis}: {feet_in_metres} {}",
                metres[axis]
            );
        }
        assert!(feet[0] > 6.0e6 && feet[1] > 1.5e6, "{feet:?}");
    }

    #[test]
    fn a_position_that_cannot_be_converted_comes_back_as_not_a_number() {
        let to_utm = transformer(epsg(4326), epsg(32640));
        for (x, y) in [
            (57.0, 95.0),
            (f64::NAN, 1.0),
            (1.0, f64::INFINITY),
            (f64::NEG_INFINITY, f64::NAN),
        ] {
            let [cx, cy] = to_utm.convert(x, y);
            assert!(cx.is_nan() && cy.is_nan(), "{x} {y}: {cx} {cy}");
        }
        // Huge values are not a panic either, whatever they give.
        let [cx, cy] = to_utm.convert(1e300, -1e300);
        assert!(cx.is_nan() == cy.is_nan());
    }
}
