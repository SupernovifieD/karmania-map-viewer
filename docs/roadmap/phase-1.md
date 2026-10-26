# Phase 1 roadmap: data entry and validation

Copied from section 9 of the Phase 1 implementation brief. Work strictly in
order, one step per commit. Tick a step in the same commit that completes it.
If a step grows past the commit size guideline, split it into sub-steps (for
example 4.5a, 4.5b) and list them here.

Checkpoints: pause for approval after step 0.0, after each milestone (M0 to
M10), before adding any dependency not named in the brief, and whenever the
brief says to stop.

## M0: Groundwork

- [x] 0.0 Survey: report the branch, remote, existing files, and tool versions
  (rustc, cargo, wasm-pack, node, pnpm, Docker). Done when: a report is posted
  and approved. No commit.
- [x] 0.1 `docs/roadmap/phase-1.md` with this step list; a README stub with the
  project's one-paragraph purpose.
- [x] 0.2 `.editorconfig` and `.gitignore` (target, pkg, dist, node_modules,
  reports, generated fixtures).
- [x] 0.3 Rust workspace plus `rust-toolchain.toml`; `crates/karmania-core` as
  an empty library with one passing test.
- [x] 0.4 `rustfmt.toml` and clippy settings; workspace lints; forbid
  `unsafe_code` in core.
- [x] 0.5 pnpm workspace root, `.nvmrc`, base tsconfig (strict options from
  section 6).
- [x] 0.6 ESLint (typescript-eslint, strict) and Prettier configs, with root
  lint and format scripts.
- [x] 0.7 `packages/engine` skeleton with Vitest and one passing test.
- [x] 0.8 `docs/conventions.md` (naming, commit rules, finding code style) and
  empty `docs/decisions.md` and `docs/dependencies.md`.
- [x] 0.9 CI workflow (GitHub Actions, or the platform the remote uses) for
  Rust fmt, clippy and test, and TS lint, typecheck and test. Done when: CI is
  green on the pushed commit.
- [x] 0.10 Root `pnpm check` script as defined in section 5.

Follow-ups requested by the owner after the M0 report (added as sub-steps of
M0; each is its own commit):

- [x] 0.11 Update pnpm to 12.15.0 (global install and `packageManager`).
- [x] 0.12 License policy: accept BlueOak-1.0.0 and, for dev-only build tools,
  MPL-2.0 (weak copyleft); update `docs/dependencies.md` and
  `docs/conventions.md`.
- [x] 0.13 Move Vite from 7 to 8 now that MPL-2.0 build tools are accepted.
- [x] 0.14 Add `pnpm format:check` to `pnpm check`.

## M1: Core data model (karmania-core)

- [x] 1.1 Severity, Location and Finding types, plus a Findings collector that
  aggregates repeats (count plus at most 20 examples). Split to stay under the
  commit size guideline:
  - [x] 1.1a Severity, WizardStep, Location and Finding types (adds serde).
  - [x] 1.1b Findings collector that aggregates repeats.
- [x] 1.2 FindingCode: a registry of stable codes with `as_str()`, plus
  `docs/validation-codes.md` with its "every code documented" test.
- [x] 1.3 CrsRef (Epsg, Local) and Units, with serde.
- [x] 1.4 Column and ColumnData (five types) with a validity bitmap: length,
  null count, get as optional. Split to stay under the commit size guideline:
  - [x] 1.4a Validity bitmap.
  - [x] 1.4b ColumnData, Column and Value.
- [x] 1.5 Table: ordered columns; construction reports duplicate or empty names
  as findings.
- [x] 1.6 Positions newtype (interleaved xyz, has_z) with constructors from x,
  y and optional z.
- [x] 1.7 Dataset struct plus `Geometry::Points`.
- [x] 1.8 `Geometry::Lines`.
- [x] 1.9 `Geometry::Polygons`.
- [x] 1.10 `Geometry::Mesh`.
- [x] 1.11 Lattice: fields, doc-commented conventions, index <-> ijk, cell
  centre with rotation. Tests include 30 and 90 degree rotations.
- [x] 1.12 `Geometry::Grid` (Flat or FromColumn z).
- [x] 1.13 `Geometry::Blocks` (dense or sparse ijk).
- [x] 1.14 `element_count()` and expected attribute rows for each kind.
- [x] 1.15 Bounding box for each kind (lattice bbox accounts for rotation).
  Split to stay under the commit size guideline:
  - [x] 1.15a BBox type and the rotated lattice bounding box.
  - [x] 1.15b Dataset bounding box for each kind.
- [x] 1.16 MAX_ELEMENTS guard: a size estimate before allocation that returns
  an error finding.

Follow-ups requested by the owner after the M1 report (each its own commit):

- [x] 1.17 Regression tests for non-finite and overflowing lattice bounding
  boxes, per axis.
- [ ] 1.18 Use the `libm` crate for rotation sine and cosine, so results are
  bit-identical on every platform.

## M2: Validation (karmania-core)

- [ ] 2.1 `validate(&Dataset) -> ValidationReport`: an ordered list of check
  groups; `is_loadable()`; deterministic ordering.
- [ ] 2.2 Structure: non-empty geometry; positions length is a multiple of 3.
- [ ] 2.3 Structure: line offsets (length L+1, start 0, end = vertex count,
  non-decreasing).
- [ ] 2.4 Structure: lines with fewer than 2 vertices (warning).
- [ ] 2.5 Structure: polygon ring and polygon offsets; rings with fewer than 3
  vertices (error).
- [ ] 2.6 Structure: mesh indices are a multiple of 3 and in range.
- [ ] 2.7 Structure: degenerate triangles (warning); unused vertices (info).
- [ ] 2.8 Structure: lattice dims and spacing valid; checked cell count equals
  value count.
- [ ] 2.9 Structure: sparse ijk length, in range, no duplicates (error).
- [ ] 2.10 Structure: attribute row counts match element counts; vertex
  attribute rows match the vertex count.
- [ ] 2.11 Values: non-finite coordinates (error, aggregated).
- [ ] 2.12 Values: coordinate magnitude above 1e8 (warning: "check units").
- [ ] 2.13 Values: exact duplicate points (warning, hashing on bit patterns).
- [ ] 2.14 Values: all-null columns (warning); categorical codes within the
  dictionary (error).
- [ ] 2.15 CRS: missing CRS (error, hint: choose an EPSG code or Local grid,
  step "crs"); Local accepted.
- [ ] 2.16 Add the EPSG definitions dependency (dependency-only commit, with
  `docs/dependencies.md`).
- [ ] 2.17 CRS: unknown EPSG code (error); expose a lookup with code, name,
  kind (geographic or projected) and units.
- [ ] 2.18 CRS: geographic range check; swapped-axes heuristic (warning "X and
  Y may be swapped").
- [ ] 2.19 Add the proj4rs dependency (dependency-only commit).
- [ ] 2.20 CRS: projected plausibility. Inverse-project the bbox corners plus up
  to 1,000 evenly spaced sample points to longitude and latitude. Non-finite or
  out-of-range results give a warning.
- [ ] 2.21 Report snapshot tests: one full report per kind, fixed and
  deterministic.
- [ ] 2.22 Ignored-by-default timing test: validate 1M points; record the result
  in `docs/perf.md`.

## M3: Readers (karmania-io)

- [ ] 3.1 Create `crates/karmania-io` and `fixtures/` with tiny sample files for
  every format.
- [ ] 3.2 Text decoding: UTF-8 with BOM strip; Windows-1252 fallback with a
  warning finding.
- [ ] 3.3 Delimited text sniffing: delimiter (comma, semicolon, tab,
  whitespace), header detection, first 200 rows, estimated row count.
- [ ] 3.4 Column type inference from a sample (float, int, bool, text,
  category). Decimal comma detection when the delimiter is a semicolon.
- [ ] 3.5 Coordinate role suggestions from header names, with confidence scores.
  Recognize at least: x: X, EAST, EASTING, XC, XCOORD, XCENTRE, LON, LONG,
  LONGITUDE; y: Y, NORTH, NORTHING, YC, YCOORD, YCENTRE, LAT, LATITUDE; z: Z,
  RL, ELEV, ELEVATION, ZC, ZCOORD, ZCENTRE, DEPTH. Matching is case-insensitive.
- [ ] 3.6 Nodata suggestions. Tokens: empty, NA, N/A, null, NaN, "-", "\*".
  Numbers: -999, -9999, -99999, 1e30, -1e30, 1.70141e38. A value is suggested
  only when it actually appears in a numeric column.
- [ ] 3.7 ImportMapping type with serde, plus a mapping validation that returns
  findings tagged with step "mapping" (missing X or Y, line ID missing for
  lines, block size missing for blocks).
- [ ] 3.8 CSV -> points: full parse with mapping; bad numbers become null with a
  warning; empty-coordinate policy (error or skip with a warning count).
- [ ] 3.9 CSV -> lines: group by line ID in order of first appearance; vertices
  in row order; info finding if IDs are not contiguous.
- [ ] 3.10 CSV -> blocks, part 1: centroid columns plus block size give the
  lattice origin and dims (rotation 0).
- [ ] 3.11 CSV -> blocks, part 2: compute ijk; off-lattice centroids (error with
  lines); duplicate blocks (error); dense vs sparse chosen automatically.
- [ ] 3.12 GeoJSON: FeatureCollection with Point and MultiPoint gives points;
  properties become attributes with type inference across features.
- [ ] 3.13 GeoJSON: LineString and MultiLineString give lines; each part is a
  line and copies the feature's attributes plus a `feature_id` column.
- [ ] 3.14 GeoJSON: Polygon and MultiPolygon give polygons; drop closing
  vertices; `feature_id` column.
- [ ] 3.15 GeoJSON: mixed geometry types give one dataset per kind (info); CRS
  defaults to EPSG:4326 (RFC 7946); the legacy "crs" member is honored when it
  names an EPSG code.
- [ ] 3.16 ESRI ASCII grid header: ncols, nrows, xllcorner or xllcenter,
  yllcorner or yllcenter, cellsize or dx/dy, NODATA_value.
- [ ] 3.17 ESRI ASCII grid values: flip rows to south-first; normalize centre
  registration to corner; check value count; nodata to null with a warning
  count.
- [ ] 3.18 OBJ mesh: v and f records, 1-based and negative indices, fan
  triangulation of n-gons (info with count); ignore vt and vn.
- [ ] 3.19 .prj sidecar: extract the EPSG code from WKT1 AUTHORITY or WKT2 ID.
  Otherwise report "unrecognized", and the wizard asks.
- [ ] 3.20 Format detection from extension plus content sniffing, giving
  DetectedFormat and the suggested kind.
- [ ] 3.21 Reader robustness tests: the malformed-input list from section 6 for
  every reader.
- [ ] 3.22 Incremental ImportJob with `step(budget_rows) -> Progress | Done` for
  CSV; the other readers run as one step for now.

## M4: WebAssembly bridge (karmania-wasm)

- [ ] 4.1 Crate with wasm-bindgen and an exported `version()`; scripts/
  build-wasm script; output gitignored; root `pnpm build:wasm`.
- [ ] 4.2 Serialize findings, report and preview to JS with serde-wasm-bindgen;
  matching TS types in `packages/engine`.
- [ ] 4.3 Export `preview(bytes, filename, sidecars)`.
- [ ] 4.4 Export a dataset store inside the WASM instance (handles) plus
  ImportJob creation and `step()`.
- [ ] 4.5 Export builders from typed arrays: points.
- [ ] 4.6 Builders: lines.
- [ ] 4.7 Builders: polygons.
- [ ] 4.8 Builders: mesh.
- [ ] 4.9 Builders: grid.
- [ ] 4.10 Builders: blocks.
- [ ] 4.11 Export `summary(handle)`, `rows(handle, start, count)` with
  geometry-derived columns, and `remove(handle)`.
- [ ] 4.12 Export `search_crs(query, limit)`.
- [ ] 4.13 Node smoke test: load the built WASM and round-trip one fixture per
  format.

## M5: Engine (packages/engine)

- [ ] 5.1 Public TS types for every contract in section 8, with exhaustive
  unions and type tests.
- [ ] 5.2 Worker entry: loads the WASM; typed request and response protocol with
  IDs; serializes errors.
- [ ] 5.3 KernelClient on the main thread: promises, transferables, AbortSignal
  to cancel messages; tested with a fake worker.
- [ ] 5.4 createEngine and dispose; multiple instances; no globals.
- [ ] 5.5 Registry and events: `datasets()`, `on("datasets")`, `remove()`.
- [ ] 5.6 `preview(files)`: sidecar grouping by basename; reads File bytes
  inside the worker.
- [ ] 5.7 `importFiles(files, mapping)`: the incremental job loop, progress and
  cancellation.
- [ ] 5.8 `load(input)`: builder functions in TS; data problems resolve as a
  "blocked" result, never a throw.
- [ ] 5.9 `rows()`: paging with a small LRU cache (pages of 256 rows).
- [ ] 5.10 `searchCrs()`.
- [ ] 5.11 Browser integration test (Playwright, test page): import every
  fixture, check summaries and findings.

## M6: UI foundations (packages/ui)

- [ ] 6.1 Package setup with Lit and Vite library mode; `gallery.html` in
  `packages/app` shows components in isolation.
- [ ] 6.2 `tokens.css` (section 7.1) plus `docs/design-tokens.md`.
- [ ] 6.3 Base styles: Inter self-hosted, box-sizing, focus-visible, reduced
  motion, scrollbar styling.
- [ ] 6.4 Icon component (Lucide static SVG; 16 and 20; aria-hidden unless
  labelled).
- [ ] 6.5 Button component: primary, secondary and ghost variants; icon-only
  requires an aria-label (type-enforced); sizes 28 and 32.
- [ ] 6.6 Tabs component: ARIA tablist, arrow and Home/End keys, roving
  tabindex.
- [ ] 6.7 Tooltip component (hover and focus, positioned inside the viewport,
  never clipped).
- [ ] 6.8 Layout test helpers from section 7.4, with their own tests on the
  gallery page.
- [ ] 6.9 Empty-state component.
- [ ] 6.10 Gallery screenshots for every component state, reviewed with the
  section 7.5 checklist.

## M7: App shell (packages/app)

- [ ] 7.1 Vite app mounting `<karmania-app>`; a Playwright smoke test.
- [ ] 7.2 Shell grid (toolbar plus main, map plus panel) with no content; layout
  assertions for adjacency and no overflow at all three viewports.
- [ ] 7.3 Toolbar contents exactly as in section 7.2.
- [ ] 7.4 Map area empty state.
- [ ] 7.5 Drop zone highlight with zero layout shift (test that bounding boxes
  are unchanged during drag-over).
- [ ] 7.6 Panel header with Legend and Data tabs; Legend empty state.
- [ ] 7.7 Collapse to rail and expand; rail buttons open the right tab;
  persistence; keyboard; aria-expanded.
- [ ] 7.8 Panel resize handle (pointer, keyboard, double-click reset, clamping,
  persistence).
- [ ] 7.9 Shell screenshot baselines (expanded, collapsed, both themes, three
  viewports), reviewed and committed.

## M8: Import wizard

- [ ] 8.1 Dialog frame: header, step indicator, scrolling body, footer layout
  per section 7.2; focus handling; Esc.
- [ ] 8.2 Wire the Import button and map-area drop to open the wizard with the
  selected files.
- [ ] 8.3 Step "File": the file list, detected format, encoding and delimiter; a
  kind selector offering only kinds valid for that format; preview findings.
- [ ] 8.4 Step "Mapping", part 1: preview table (first 100 rows) with a role
  selector in each column header; suggestions pre-filled and marked
  "suggested".
- [ ] 8.5 Step "Mapping", part 2: required-role checks inline (missing X or Y,
  line ID, block size field for blocks); Next disabled with a visible reason.
- [ ] 8.6 Step "Mapping", part 3: per-column type override and rename.
- [ ] 8.7 Step "Nodata": suggested tokens and numbers as checkboxes with counts;
  custom value input; empty-coordinate policy.
- [ ] 8.8 Step "CRS", part 1: the detected CRS with its source; EPSG search
  (code or name, top 20) with name, kind and units shown.
- [ ] 8.9 Step "CRS", part 2: the Local grid option with units; the chosen CRS
  summary.
- [ ] 8.10 Step "Review": runs the import job with a progress bar and cancel;
  findings grouped by severity; each error links to the step in its "step"
  field.
- [ ] 8.11 Fix-and-retry loop: after editing a step, Review re-runs. Load is
  disabled while there are errors and reads "Load with N warnings" when there
  are warnings.
- [ ] 8.12 On load: close the dialog, select the new dataset and open the Data
  tab.
- [ ] 8.13 End-to-end tests, one commit each: CSV points happy path; CSV with
  errors fixed in the wizard; GeoJSON mixed types; ASCII grid; OBJ mesh; block
  model CSV; missing CRS; cancel during a large import.
- [ ] 8.14 Wizard screenshot baselines for every step, including the error and
  warning states, reviewed and committed.

## M9: Data tab

- [ ] 9.1 Data tab empty state ("No data loaded" plus an Import button).
- [ ] 9.2 Dataset list: kind icon, truncated name, tabular count, warning badge,
  remove with confirmation; selection.
- [ ] 9.3 Dataset summary: kind, count, CRS (code, name, units or Local),
  has_z, formatted bbox, columns; an expandable list of warnings and info.
- [ ] 9.4 Virtualized table, part 1: fixed rows, sticky header, row-number
  column, windowed rendering.
- [ ] 9.5 Virtualized table, part 2: column width measurement and clamping;
  ellipsis plus full value; horizontal scroll inside the table.
- [ ] 9.6 Virtualized table, part 3: cell formatting (numbers, null, categories,
  booleans).
- [ ] 9.7 Virtualized table, part 4: page fetching through `engine.rows()` with
  prefetch of the next page.
- [ ] 9.8 Very large row counts: scaled scrolling when the total height exceeds
  the browser's maximum element height (about 33 million px in Chromium, lower
  in Firefox); test with 2,000,000 synthetic rows.
- [ ] 9.9 Geometry-derived columns shown first for each kind (section 8.4).
- [ ] 9.10 Keyboard navigation in the table: arrows, Page Up and Down, Home and
  End, focus visible.
- [ ] 9.11 Data tab screenshot baselines (empty, one dataset, many datasets,
  long names, warnings expanded), reviewed and committed.

## M10: Hardening

- [ ] 10.1 axe pass across every state; fix each issue in its own commit.
- [ ] 10.2 Long-content pass: the inputs from section 7.3 in every component;
  fix each issue in its own commit.
- [ ] 10.3 Performance: `scripts/generate-fixtures` (not committed output) for a
  1M-point CSV and a 4M-cell grid. Measure preview, import, validation and long
  tasks; record in `docs/perf.md`. Fix regressions in separate commits.
- [ ] 10.4 Message review: every finding has a plain-language message and a
  hint; `docs/validation-codes.md` is complete.
- [ ] 10.5 README: setup, build, test, phase 1 architecture overview, supported
  formats and their conventions.
- [ ] 10.6 Final report (section 10).
