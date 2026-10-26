//! The registry of stable finding codes.
//!
//! Every finding carries a [`FindingCode`]. A code fixes the finding's severity
//! and the wizard step that can fix it, so one code always means the same thing.
//! Codes are stable once released: never rename one or change its meaning, add
//! a new code instead. Each code is documented in `docs/validation-codes.md`,
//! and a test fails if the registry and that file disagree.

use serde::{Serialize, Serializer};

use crate::findings::{Severity, WizardStep};

/// Declares [`FindingCode`] and its lookups from one table, so a code cannot be
/// added to the enum and forgotten in `ALL`, `as_str`, `severity` or `step`.
macro_rules! finding_codes {
    ($($(#[$meta:meta])* $variant:ident => $code:literal, $severity:ident, $step:expr;)+) => {
        /// A stable identifier for one kind of finding.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub enum FindingCode {
            $($(#[$meta])* $variant,)+
        }

        impl FindingCode {
            /// Every registered code, in declaration order.
            pub const ALL: &'static [FindingCode] = &[$(FindingCode::$variant,)+];

            /// The dotted lowercase identifier, for example `table.column.name_empty`.
            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(FindingCode::$variant => $code,)+
                }
            }

            /// The severity every finding with this code has.
            #[must_use]
            pub const fn severity(self) -> Severity {
                match self {
                    $(FindingCode::$variant => Severity::$severity,)+
                }
            }

            /// The wizard step that can fix findings with this code, if any.
            #[must_use]
            pub const fn step(self) -> Option<WizardStep> {
                match self {
                    $(FindingCode::$variant => $step,)+
                }
            }
        }
    };
}

finding_codes! {
    /// Some blocks are listed more than once.
    BlocksIjkDuplicate => "blocks.ijk.duplicate", Error, None;
    /// The block list ends with an incomplete i, j, k triplet.
    BlocksIjkIncomplete => "blocks.ijk.incomplete", Error, None;
    /// Some blocks are outside the lattice.
    BlocksIjkOutOfRange => "blocks.ijk.out_of_range", Error, None;
    /// The attribute table does not have one row per element.
    DatasetAttributesRowsMismatch => "dataset.attributes.rows_mismatch", Error, None;
    /// The coordinate list ends with an incomplete x, y, z position.
    DatasetCoordinatesIncomplete => "dataset.coordinates.incomplete", Error, None;
    /// The file has no content.
    FileEmpty => "file.empty", Error, Some(WizardStep::File);
    /// The text file is not valid UTF-8 and was read as Windows-1252.
    FileEncodingFallback => "file.encoding.fallback", Warning, Some(WizardStep::File);
    /// Some UTF-16 characters could not be read.
    FileEncodingInvalidUtf16 => "file.encoding.invalid_utf16", Warning, Some(WizardStep::File);
    /// Rows have an empty or unreadable coordinate and the mapping says to stop.
    CsvCoordinateMissing => "csv.coordinate.missing", Error, Some(WizardStep::Nodata);
    /// The block centres span too many blocks along one axis.
    CsvBlocksLatticeTooLarge => "csv.blocks.lattice_too_large", Error, Some(WizardStep::Mapping);
    /// Several rows of a block-model file are the same block.
    CsvBlocksDuplicate => "csv.blocks.duplicate", Error, Some(WizardStep::File);
    /// There are no rows to build a block model from.
    CsvBlocksNone => "csv.blocks.none", Error, Some(WizardStep::File);
    /// Some block centres do not sit on the same grid as the others.
    CsvBlocksOffLattice => "csv.blocks.off_lattice", Error, Some(WizardStep::Mapping);
    /// Rows were left out because they have no line identifier.
    CsvLineIdMissing => "csv.line_id.missing", Warning, Some(WizardStep::Mapping);
    /// The rows of some lines are not next to each other in the file.
    CsvLinesScattered => "csv.lines.scattered", Info, None;
    /// Rows have a different number of values from the header.
    CsvRowsRagged => "csv.rows.ragged", Warning, Some(WizardStep::File);
    /// Rows were left out because a coordinate was empty or unreadable.
    CsvRowsSkipped => "csv.rows.skipped", Warning, Some(WizardStep::Nodata);
    /// Some values could not be read as the column's type and were left empty.
    CsvValueUnreadable => "csv.value.unreadable", Warning, Some(WizardStep::Mapping);
    /// The block size of a block model is missing.
    MappingBlockSizeMissing => "mapping.block_size.missing", Error, Some(WizardStep::Mapping);
    /// The block size is not greater than 0 in all directions.
    MappingBlockSizeInvalid => "mapping.block_size.invalid", Error, Some(WizardStep::Mapping);
    /// A coordinate column that is needed is not mapped.
    MappingCoordinateMissing => "mapping.coordinate.missing", Error, Some(WizardStep::Mapping);
    /// A coordinate column is typed as something other than a number.
    MappingCoordinateNotNumeric => "mapping.coordinate.not_numeric", Error, Some(WizardStep::Mapping);
    /// The shape cannot be built from this kind of file.
    MappingKindUnsupported => "mapping.kind.unsupported", Error, Some(WizardStep::File);
    /// No column is set as the line identifier.
    MappingLineIdMissing => "mapping.line_id.missing", Error, Some(WizardStep::Mapping);
    /// Several columns have the same role.
    MappingRoleDuplicate => "mapping.role.duplicate", Error, Some(WizardStep::Mapping);
    /// The same column is mapped more than once.
    MappingSourceDuplicate => "mapping.source.duplicate", Error, Some(WizardStep::Mapping);
    /// The mapping names a column that is not in the file.
    MappingSourceUnknown => "mapping.source.unknown", Error, Some(WizardStep::Mapping);
    /// The EPSG code is not in the list of known coordinate systems.
    CrsEpsgUnknown => "crs.epsg.unknown", Error, Some(WizardStep::Crs);
    /// X and Y fit latitude and longitude only if they are swapped.
    CrsGeographicAxesSwapped => "crs.geographic.axes_swapped", Warning, Some(WizardStep::Crs);
    /// Some coordinates are outside the range of longitude and latitude.
    CrsGeographicOutOfRange => "crs.geographic.out_of_range", Warning, Some(WizardStep::Crs);
    /// Some coordinates do not convert to valid longitudes and latitudes.
    CrsProjectedImplausible => "crs.projected.implausible", Warning, Some(WizardStep::Crs);
    /// Some coordinates are far outside the UTM zone the dataset names.
    CrsProjectedOutsideZone => "crs.projected.outside_zone", Warning, Some(WizardStep::Crs);
    /// The coordinates could not be checked because the projection is unsupported.
    CrsProjectedUnchecked => "crs.projected.unchecked", Info, None;
    /// The dataset has no coordinate reference system.
    CrsMissing => "crs.missing", Error, Some(WizardStep::Crs);
    /// The X, Y and Z coordinate lists have different lengths.
    DatasetCoordinatesLengthMismatch => "dataset.coordinates.length_mismatch", Error, None;
    /// The per-vertex table does not have one row per vertex.
    DatasetVertexAttributesRowsMismatch => "dataset.vertex_attributes.rows_mismatch", Error, None;
    /// A per-vertex table was given for a shape that does not use one.
    DatasetVertexAttributesUnsupported => "dataset.vertex_attributes.unsupported", Warning, None;
    /// The dataset has no elements at all.
    DatasetEmpty => "dataset.empty", Error, Some(WizardStep::File);
    /// The dataset has more elements than the size limit allows.
    DatasetTooLarge => "dataset.too_large", Error, None;
    /// A grid or block model has a dimension of 0 cells.
    LatticeDimsZero => "lattice.dims.zero", Error, None;
    /// The origin of a grid or block model is not made of finite numbers.
    LatticeOriginNotFinite => "lattice.origin.not_finite", Error, None;
    /// The rotation of a grid or block model is not a finite number.
    LatticeRotationNotFinite => "lattice.rotation.not_finite", Error, None;
    /// The cell size of a grid or block model is not positive and finite.
    LatticeSpacingInvalid => "lattice.spacing.invalid", Error, None;
    /// A line has fewer than two vertices.
    LinesLineTooShort => "lines.line.too_short", Warning, None;
    /// The triangle index list ends with an incomplete triangle.
    MeshIndicesIncomplete => "mesh.indices.incomplete", Error, None;
    /// Some triangles use vertex numbers that do not exist.
    MeshIndicesOutOfRange => "mesh.indices.out_of_range", Error, None;
    /// Some triangles have no area.
    MeshTriangleDegenerate => "mesh.triangle.degenerate", Warning, None;
    /// Some vertices are not used by any triangle.
    MeshVerticesUnused => "mesh.vertices.unused", Info, None;
    /// The offsets list of a line set ends at the wrong vertex.
    LinesOffsetsBadEnd => "lines.offsets.bad_end", Error, None;
    /// The offsets list of a line set does not start at 0.
    LinesOffsetsBadStart => "lines.offsets.bad_start", Error, None;
    /// Some lines end before they start.
    LinesOffsetsDecreasing => "lines.offsets.decreasing", Error, None;
    /// The offsets list of a line set is empty.
    LinesOffsetsEmpty => "lines.offsets.empty", Error, None;
    /// The offsets list that groups rings into polygons ends at the wrong ring.
    PolygonsPolygonOffsetsBadEnd => "polygons.polygon_offsets.bad_end", Error, None;
    /// The offsets list that groups rings into polygons does not start at 0.
    PolygonsPolygonOffsetsBadStart => "polygons.polygon_offsets.bad_start", Error, None;
    /// Some polygons end before they start.
    PolygonsPolygonOffsetsDecreasing => "polygons.polygon_offsets.decreasing", Error, None;
    /// The offsets list that groups rings into polygons is empty.
    PolygonsPolygonOffsetsEmpty => "polygons.polygon_offsets.empty", Error, None;
    /// Some polygons have no rings at all.
    PolygonsPolygonNoRings => "polygons.polygon.no_rings", Error, None;
    /// The offsets list that splits vertices into rings ends at the wrong vertex.
    PolygonsRingOffsetsBadEnd => "polygons.ring_offsets.bad_end", Error, None;
    /// The offsets list that splits vertices into rings does not start at 0.
    PolygonsRingOffsetsBadStart => "polygons.ring_offsets.bad_start", Error, None;
    /// Some rings end before they start.
    PolygonsRingOffsetsDecreasing => "polygons.ring_offsets.decreasing", Error, None;
    /// The offsets list that splits vertices into rings is empty.
    PolygonsRingOffsetsEmpty => "polygons.ring_offsets.empty", Error, None;
    /// Some rings have fewer than three vertices.
    PolygonsRingTooShort => "polygons.ring.too_short", Error, None;
    /// Some coordinates are not finite numbers.
    ValuesCoordinatesNotFinite => "values.coordinates.not_finite", Error, None;
    /// Some points repeat an earlier point exactly.
    ValuesPointsDuplicate => "values.points.duplicate", Warning, None;
    /// Some coordinates are so large that the units may be wrong.
    ValuesCoordinatesVeryLarge => "values.coordinates.very_large", Warning, None;
    /// Every entry of a table column is empty.
    TableColumnAllNull => "table.column.all_null", Warning, Some(WizardStep::Nodata);
    /// Some category codes in a column are outside its dictionary.
    TableColumnCategoryOutOfRange => "table.column.category_out_of_range", Error, None;
    /// A table column has a different number of rows from the first column.
    TableColumnLengthMismatch => "table.column.length_mismatch", Error, None;
    /// A table column has no name.
    TableColumnNameEmpty => "table.column.name_empty", Error, Some(WizardStep::Mapping);
    /// Two or more table columns share a name.
    TableColumnNameDuplicate => "table.column.name_duplicate", Error, Some(WizardStep::Mapping);
}

impl Serialize for FindingCode {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    const DOCS: &str = include_str!("../../../docs/validation-codes.md");

    /// One `## \`code\`` section of the docs file.
    #[derive(Default)]
    struct Entry {
        code: String,
        severity: String,
        step: String,
        message: String,
        hint: String,
        example: String,
    }

    fn parse_docs(text: &str) -> Vec<Entry> {
        let mut entries: Vec<Entry> = Vec::new();
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("## `") {
                let code = rest.trim_end_matches('`').to_string();
                entries.push(Entry {
                    code,
                    ..Entry::default()
                });
            } else if let Some(entry) = entries.last_mut() {
                let field = |prefix: &str| line.strip_prefix(prefix).map(|v| v.trim().to_string());
                if let Some(v) = field("- Severity:") {
                    entry.severity = v;
                } else if let Some(v) = field("- Step:") {
                    entry.step = v;
                } else if let Some(v) = field("- Message:") {
                    entry.message = v;
                } else if let Some(v) = field("- Hint:") {
                    entry.hint = v;
                } else if let Some(v) = field("- Example:") {
                    entry.example = v;
                }
            }
        }
        entries
    }

    fn follows_the_code_style(code: &str) -> bool {
        let segments: Vec<&str> = code.split('.').collect();
        (2..=3).contains(&segments.len())
            && segments.iter().all(|s| {
                s.chars().next().is_some_and(|c| c.is_ascii_lowercase())
                    && s.chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
            })
    }

    #[test]
    fn codes_are_unique_and_follow_the_style() {
        let mut seen = BTreeSet::new();
        for code in FindingCode::ALL {
            let text = code.as_str();
            assert!(follows_the_code_style(text), "bad code style: {text}");
            assert!(seen.insert(text), "duplicate code: {text}");
        }
    }

    #[test]
    fn a_code_serializes_as_its_string() {
        let json = serde_json::to_string(&FindingCode::DatasetTooLarge).unwrap();
        assert_eq!(json, r#""dataset.too_large""#);
    }

    #[test]
    fn every_registered_code_is_documented_and_the_docs_match() {
        let docs = parse_docs(DOCS);
        for code in FindingCode::ALL {
            let name = code.as_str();
            let entry = docs
                .iter()
                .find(|e| e.code == name)
                .unwrap_or_else(|| panic!("{name} is missing from docs/validation-codes.md"));
            assert_eq!(entry.severity, code.severity().as_str(), "{name}: severity");
            let step = code.step().map_or("none", WizardStep::as_str);
            assert_eq!(entry.step, step, "{name}: step");
            for (field, value) in [
                ("Message", &entry.message),
                ("Hint", &entry.hint),
                ("Example", &entry.example),
            ] {
                assert!(!value.is_empty(), "{name}: missing {field}");
            }
        }
    }

    #[test]
    fn the_docs_list_no_code_that_is_not_registered_and_are_sorted() {
        let docs = parse_docs(DOCS);
        let registered: BTreeSet<&str> = FindingCode::ALL.iter().map(|c| c.as_str()).collect();
        for entry in &docs {
            assert!(
                registered.contains(entry.code.as_str()),
                "stale doc: {}",
                entry.code
            );
        }
        let names: Vec<&str> = docs.iter().map(|e| e.code.as_str()).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(
            names, sorted,
            "docs must be sorted by code, without duplicates"
        );
    }
}
