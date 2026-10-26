//! A short description of a dataset, for lists and panels.

use serde::Serialize;

use crate::bbox::BBox;
use crate::column::ColumnType;
use crate::crs::CrsRef;
use crate::dataset::{Dataset, DatasetId, Kind};
use crate::findings::Findings;

/// One attribute column, described without its values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSummary {
    /// The column's name.
    pub name: String,
    /// The type of its values. In JSON: `float`, `int`, `bool`, `text` or `category`.
    #[serde(rename = "type")]
    pub column_type: ColumnType,
    /// How many of its values are null.
    pub null_count: u64,
}

/// What a dataset is, without its data.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// The dataset's identifier.
    pub id: DatasetId,
    /// The dataset's name.
    pub name: String,
    /// Its shape.
    pub kind: Kind,
    /// How many points, lines, polygons, triangles, cells or blocks it has (one
    /// attribute row each).
    pub element_count: u64,
    /// How many vertices it has, for lines, polygons and meshes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertex_count: Option<u64>,
    /// Its coordinate reference system, if it has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crs: Option<CrsRef>,
    /// Whether it has real elevations.
    pub has_z: bool,
    /// The smallest box around it, if there is anything finite to measure.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bbox: Option<BBox>,
    /// Its attribute columns, in order.
    pub columns: Vec<ColumnSummary>,
    /// What was found about it: warnings and info (errors keep a dataset from
    /// being loaded at all).
    pub findings: Findings,
}

impl Dataset {
    /// Describes the dataset, attaching `findings` (what was found about it).
    ///
    /// A count that cannot be worked out, which only happens for a dataset that
    /// validation would reject, is reported as 0.
    #[must_use]
    pub fn summary(&self, findings: Findings) -> Summary {
        Summary {
            id: self.id,
            name: self.name.clone(),
            kind: self.kind(),
            element_count: self.element_count().unwrap_or(0),
            vertex_count: self.geometry.vertex_count(),
            crs: self.crs,
            has_z: self.has_z(),
            bbox: self.bbox(),
            columns: self
                .attributes
                .columns()
                .iter()
                .map(|column| ColumnSummary {
                    name: column.name().to_string(),
                    column_type: column.column_type(),
                    null_count: column.null_count() as u64,
                })
                .collect(),
            findings,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codes::FindingCode;
    use crate::column::{Column, ColumnData};
    use crate::dataset::Geometry;
    use crate::findings::Finding;
    use crate::lines::Lines;
    use crate::positions::Positions;
    use crate::table::Table;
    use crate::validity::Validity;
    use serde_json::json;

    fn points() -> Dataset {
        let validity = Validity::from_flags([true, false, true]);
        let columns = vec![
            Column::new("au", ColumnData::Float64(vec![1.0, 0.0, 3.0]), validity).unwrap(),
            Column::without_nulls(
                "rock",
                ColumnData::Categorical {
                    codes: vec![0, 1, 0],
                    dictionary: vec!["a".into(), "b".into()],
                },
            ),
        ];
        let mut d = Dataset::new(
            DatasetId(7),
            "Collars",
            Some(CrsRef::Epsg { code: 32640 }),
            Geometry::Points(Positions::from_interleaved(
                vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0],
                true,
            )),
            Table::from_columns(columns, &mut Findings::new()).unwrap(),
        );
        d.id = DatasetId(7);
        d
    }

    #[test]
    fn a_points_summary_has_counts_columns_and_a_box() {
        let s = points().summary(Findings::new());
        assert_eq!(
            (
                s.id,
                s.name.as_str(),
                s.kind,
                s.element_count,
                s.vertex_count
            ),
            (DatasetId(7), "Collars", Kind::Points, 3, None)
        );
        assert!(s.has_z);
        assert_eq!(s.crs, Some(CrsRef::Epsg { code: 32640 }));
        assert_eq!(s.bbox.unwrap().min, [1.0, 2.0, 3.0]);
        assert_eq!(s.bbox.unwrap().max, [7.0, 8.0, 9.0]);
        let columns: Vec<_> = s
            .columns
            .iter()
            .map(|c| (c.name.as_str(), c.column_type, c.null_count))
            .collect();
        assert_eq!(
            columns,
            [
                ("au", ColumnType::Float64, 1),
                ("rock", ColumnType::Categorical, 0)
            ]
        );
    }

    #[test]
    fn lines_also_report_their_vertices() {
        let positions = Positions::from_interleaved(vec![0.0; 12], false);
        let mut d = points();
        d.geometry = Geometry::Lines(Lines {
            positions,
            offsets: vec![0, 2, 4],
        });
        d.attributes = Table::empty();
        let s = d.summary(Findings::new());
        assert_eq!(
            (s.kind, s.element_count, s.vertex_count),
            (Kind::Lines, 2, Some(4))
        );
        assert!(!s.has_z);
    }

    #[test]
    fn the_findings_given_are_attached() {
        let mut findings = Findings::new();
        findings.add(Finding::new(FindingCode::CsvRowsSkipped, "Skipped."));
        assert_eq!(points().summary(findings).findings.iter().count(), 1);
    }

    #[test]
    fn the_json_uses_camel_case_and_leaves_out_what_is_absent() {
        let mut d = points();
        d.crs = None;
        let v = serde_json::to_value(d.summary(Findings::new())).unwrap();
        let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "bbox",
                "columns",
                "elementCount",
                "findings",
                "hasZ",
                "id",
                "kind",
                "name"
            ]
        );
        assert_eq!(v["id"], 7);
        assert_eq!(v["kind"], "points");
        assert_eq!(
            v["columns"][0],
            json!({"name": "au", "type": "float", "nullCount": 1})
        );
        assert_eq!(v["columns"][1]["type"], "category");
        assert_eq!(
            v["bbox"],
            json!({"min": [1.0, 2.0, 3.0], "max": [7.0, 8.0, 9.0]})
        );
    }

    #[test]
    fn an_empty_dataset_has_no_box() {
        let mut d = points();
        d.geometry = Geometry::Points(Positions::from_interleaved(vec![], false));
        d.attributes = Table::empty();
        let s = d.summary(Findings::new());
        assert_eq!((s.element_count, s.bbox), (0, None));
    }
}
