# Phase 2 roadmap: maps

Copied from section 12 of the Phase 2 implementation brief. Work strictly in
order, one step per commit, on the `dev` branch. Tick a step in the same commit
that completes it. If a step grows past the commit size guideline, split it into
sub-steps (for example 12.6a, 12.6b) and list them here.

Milestones continue phase 1's numbering (M11 onwards), so step numbers never
collide with phase 1 entries in `docs/decisions.md`. Every milestone ends with
its gate (G): full verification, an independent review, fixes as sub-steps
(12.F1, 12.F2, ...), a pull request into `main` merged with a merge commit, and
a report. Then stop and wait for the owner.

Checkpoints: pause for approval after step 11.0, after every milestone's merge
into `main`, before adding any dependency not named in the brief, before tagging
or releasing, and whenever the brief says to stop.

## M11: Groundwork

- [x] 11.0 Survey: local main equals origin/main and the v0.1.0 tag; tool
  versions and `gh auth status`; repository settings; CI status of main; `pnpm
  check`, `test:e2e`, `test:visual` and `test:axe` pass on main; WebGL2 in the
  local Playwright Chromium and in the Docker image; gzipped sizes of the wasm
  module and the app's JavaScript. Done when: a report is posted and approved.
  No commit.
- [x] 11.1 Create `dev` from main and push it. No commit.
- [x] 11.2 `docs/roadmap/phase-2.md` with this step list. Then open the draft
  pull request.
- [x] 11.3 `docs/conventions.md`: the roadmap is the current phase's file; new
  scopes (crs, prep, scene, render, viewer); new finding areas (display,
  contours, classes).
- [x] 11.4 CI keeps the Playwright report and traces of failed runs as artifacts
  for 7 days (closes the open item of decision 10.6).
- [x] 11.5 WebGL2 in tests: the Chromium flags that make WebGL2 work in the e2e
  browser, the Docker visual runs, the axe runs and CI, in the Playwright
  configs; a smoke test that draws one triangle and reads back its pixel. Record
  the flags.
- [x] 11.F1 Gate fix: the keyboard test of the table that failed in CI (run of c32cd05) waits
  for the browser's own scrolling to end before it reads the cell the keyboard is on.
- [x] 11.F2 Gate fix: `pnpm format:check` runs before the browser tests, so a formatting failure
  can no longer upload the reports of passing browser tests.
- [x] 11.F3 Gate fix: the M11 entries of `docs/decisions.md` corrected and completed (where
  Playwright adds the SwiftShader flag, which Chromium uses the GPU, sizes of commits, what the
  failed run showed about the upload and the time of tracing).
- [x] 11.F4 Gate fix, from the second review: statements of the M11 entries that said more than
  was shown, and one long line of `docs/conventions.md`.
- [x] 11.G Gate.

## M12: Coordinate systems (karmania-crs)

- [x] 12.1 Crate karmania-crs (depends on core), forbid unsafe, one test.
- [x] 12.2 Add crs-definitions (dependency-only; licence policy and EPSG terms as
  section 4 of the brief says).
- [x] 12.3 `lookup(code) -> CrsInfo`. Tests: 4326, 32640, 2229 (US survey feet),
  27700, a geocentric code (other), an unknown code. Split to stay under the
  commit size guideline:
  - [x] 12.3a The WKT reader (the parser of phase 1's `epsg.rs`).
  - [x] 12.3b WKT queries: the name, a keyword's node, the part that places data.
  - [x] 12.3c The `CrsInfo` contract types: `CrsKind`, `AxisUnits`, `CrsInfo`.
  - [x] 12.3d `describe`: name, kind and units read from a WKT definition.
  - [x] 12.3e `lookup(code)`; the IOGP acknowledgement in the crate documentation; the
    tests of the brief.
- [x] 12.4 `search(query, limit)` with the ranking of section 11.1 of the brief.
  Tests.
- [ ] 12.5 Add proj4rs (dependency-only).
- [ ] 12.6 Transformer between two CrsRefs: identity, local-to-local unit
  scaling, EPSG-to-EPSG through proj4rs; local-to-EPSG and unbuildable
  definitions give findings. New codes documented.
- [ ] 12.7 Transform positions in place (f64, z untouched); non-finite results
  counted in a finding with examples.
- [ ] 12.8 Accuracy tests: reference conversions from an independent source
  (PROJ or pyproj if available on the machine, otherwise published values), the
  source named for each row; tolerance 1 mm projected, 1e-9 degrees geographic;
  round trips.
- [ ] 12.9 CrsKinds hook in karmania-core with the default implementation (4326
  only). No behaviour change: phase 1 snapshots unchanged.
- [ ] 12.10 karmania-crs implements CrsKinds.
- [ ] 12.11 The wasm kernel passes it to validation on import and load; the "code
  not in the definitions" warning; tests for 4269 (geographic, now
  range-checked) and an unknown code.
- [ ] 12.12 wasm exports crsInfo and searchCrs. Measure the module size (raw and
  gzip) before and after; record in `docs/perf.md`; apply the build-size rule of
  section 4 of the brief.
- [ ] 12.13 Engine: crsInfo() and searchCrs(), types, unit and real-worker tests.
- [ ] 12.14 Wizard CRS step: search by code or name (top 20) showing name, kind
  and units; the detected CRS shows its name (extends 8.8). Screenshots updated
  and reviewed.
- [ ] 12.15 Dataset summary: CRS shows code, name and units (extends 9.3).
  Screenshots updated and reviewed.
- [ ] 12.G Gate.

## M13: Display preparation (karmania-prep)

- [ ] 13.1 Crate karmania-prep (depends on core and crs), forbid unsafe.
- [ ] 13.2 Frame choice (section 9.2 of the brief) with the info finding for the
  UTM choice. Tests: projected, local, geographic north and south, zone edges.
- [ ] 13.3 Rebasing to f32 against the origin; the precision test of 9.1.
- [ ] 13.4 Drawability per dataset (9.2) with display findings; documented.
- [ ] 13.5 Points buffers.
- [ ] 13.6 Lines buffers.
- [ ] 13.7 Add the earcut port (dependency-only).
- [ ] 13.8 Polygon triangulation with holes and multipolygons; outline buffers;
  the "outline only" warning; collinear and degenerate cases.
- [ ] 13.9 Mesh buffers.
- [ ] 13.10 Grid image placement and tiling by a maximum texture size.
- [ ] 13.11 Grid warp when the grid's CRS differs from the map CRS: subdivide
  until the error measured at sub-cell midpoints is under 0.1 cell; test across
  a UTM zone change.
- [ ] 13.12 Grid surface buffers (elevations from a column).
- [ ] 13.13 Block buffers (own CRS only).
- [ ] 13.14 Column statistics: count, nulls, finite min and max, distinct values
  with counts up to a limit; deterministic.
- [ ] 13.15 Class breaks: equal intervals and quantiles.
- [ ] 13.16 Class breaks: natural breaks (sampled as 11.4 of the brief says) and
  categories with "Other".
- [ ] 13.17 Class index per element (u8, 255 = no value) for every kind.
- [ ] 13.18 PrepareJob with step(budget) and cancellation for large datasets.
- [ ] 13.19 wasm exports chooseFrame, prepare, classify, classIndex, with typed
  arrays as transferables.
- [ ] 13.20 Engine: chooseFrame(), prepare(), classify(), classIndex(); protocol
  types; a test that transferred buffers are detached on the sending side;
  real-worker tests.
- [ ] 13.21 `scripts/generate-fixtures` also writes a 1,000,000-block model CSV
  (not committed). Ignored Rust timing tests for preparing 1M points, 4M cells
  and 1M blocks; results in `docs/perf.md`.
- [ ] 13.G Gate.

## M14: Scene document (@karmania/scene)

- [ ] 14.1 Package (pure TypeScript, no DOM lib), Vitest, one test.
- [ ] 14.2 Types of section 11.6 of the brief.
- [ ] 14.3 validateScene() and migrate() with tests.
- [ ] 14.4 Colour ramps and palettes with sources and licences; sampling to n
  classes; categorical palette contrast checked against both map backgrounds
  (record any colour under 3:1 and how it is made readable, for example by the
  outline).
- [ ] 14.5 Default styles (11.6).
- [ ] 14.6 Commands: layers and visibility.
- [ ] 14.7 Commands: ordering and groups.
- [ ] 14.8 Commands: style, contours, view, camera, frame, selection.
- [ ] 14.9 Store: getState, dispatch, subscribe; several stores per page.
- [ ] 14.10 Legend model with number labels (11.7).
- [ ] 14.11 Furniture model: north arrow and scale bar (nice lengths, unit
  changes, null cases).
- [ ] 14.12 Camera models: fit 2D and 3D; 2D to 3D keeping centre and heading.
- [ ] 14.13 Export layout model (10.6) with a fake measure callback; tests for one
  column, several columns, a group heading at a column end, a narrow map
  warning.
- [ ] 14.G Gate.

## M15: The viewer package (a move, no visible change)

- [ ] 15.1 Package @karmania/viewer, empty, with tests running.
- [ ] 15.2 Move the map area component and its tests. Every screenshot and e2e
  test unchanged.
- [ ] 15.3 Move the panel (tabs, resize handle, panel state).
- [ ] 15.4 Move the Data tab, dataset list and summary.
- [ ] 15.5 Move the import dialog and its steps.
- [ ] 15.6 `<karmania-viewer>` composes them with an engine; the app becomes
  toolbar plus viewer; a minimal createViewer(container) and dispose(). Still
  pixel-identical.
- [ ] 15.7 The viewer holds a scene store; datasets loaded or removed add or
  remove layers (nothing drawn yet); tests.
- [ ] 15.8 ESLint import restrictions for the dependency direction (5.2).
- [ ] 15.G Gate.

## M16: 2D rendering (@karmania/render)

- [ ] 16.1 Package @karmania/render; add three and @types/three (dependency-only,
  with the gzipped size added).
- [ ] 16.2 The map canvas in the map area: fills it, follows resizes and device
  pixel ratio, renders on demand; layout tests unchanged.
- [ ] 16.3 Renderer core: 2D orthographic camera from camera2d, clear colour from
  `--k-surface-map` in both themes, dispose; the idle "no frames" test.
- [ ] 16.4 Context loss and restore (8).
- [ ] 16.5 2D controller: pan, zoom to the pointer, rotate, no tilt; scale
  limits; keyboard (10.2). Tests for each gesture and key.
- [ ] 16.6 Layer pipeline: on scene changes, chooseFrame and prepare for new or
  changed layers, cancel stale requests, upload in chunks, dispose on removal;
  the GPU memory test.
- [ ] 16.7 Points layer.
- [ ] 16.8 Lines layer.
- [ ] 16.9 Polygons layer.
- [ ] 16.10 Mesh layer (derivative flat shading, light from above).
- [ ] 16.11 Grid image layer (NEAREST, transparent no-value, rotation, tiles,
  warp).
- [ ] 16.12 Block layer (instanced, top faces in 2D).
- [ ] 16.13 Class colours: palette uniforms from class indices; restyling
  recomputes only class indices.
- [ ] 16.14 Draw order with depth cleared between layers; pixel tests.
- [ ] 16.15 Precision e2e (9.1): UTM-sized points 1 cm apart stay apart when
  zoomed; no jitter while panning.
- [ ] 16.16 Render golden images for 2D (10.8), reviewed.
- [ ] 16.17 Map area states: preparing chip, "Nothing can be drawn yet", the
  phase 1 placeholder text removed. Shell screenshots updated, each change
  explained.
- [ ] 16.G Gate (with `pnpm perf` for 2D).

## M17: Map furniture and overlays

- [ ] 17.1 North arrow (10.2): turns with the heading, resets on click, keyboard,
  accessible name with the angle.
- [ ] 17.2 Scale bar from the furniture model, units from CrsInfo; absent in 3D
  and for geographic map CRSs.
- [ ] 17.3 Navigation group: zoom in, zoom out, fit, reset view.
- [ ] 17.4 Status chip: pointer coordinates (fixed width, decimals by scale) and
  the map CRS button.
- [ ] 17.5 Map CRS dialog (10.5): current CRS, search, local option, "What
  changes", apply re-prepares every layer.
- [ ] 17.6 Datasets that are not drawn: the reason and hint in the dataset
  summary.
- [ ] 17.7 Canvas accessibility: live label, keyboard description, inset focus
  ring.
- [ ] 17.8 Overlay layout tests: no overlap for every pair at every window size,
  panel narrowest, widest and collapsed; screenshots; axe.
- [ ] 17.G Gate.

## M18: 3D view

- [ ] 18.1 Perspective camera from camera3d; near and far from the extent.
- [ ] 18.2 Orbit controller (9.5) and keyboard.
- [ ] 18.3 Toolbar 2D | 3D control; switching keeps centre and heading.
- [ ] 18.4 Lighting for meshes, surfaces and blocks; points and lines unlit.
- [ ] 18.5 Grid surfaces in 3D; flat grids at their elevation.
- [ ] 18.6 Blocks in 3D.
- [ ] 18.7 Vertical exaggeration control in the toolbar (10.1), applied as a z
  scale about the origin.
- [ ] 18.8 Furniture in 3D: no scale bar; the north arrow shows the heading and
  resets it only.
- [ ] 18.9 Render golden images for 3D, reviewed; 3D perf measured. If the block
  target is missed, add a step for drawing only exposed faces of dense models,
  then measure again.
- [ ] 18.G Gate (with `pnpm perf` for 3D).

## M19: Legend system

- [ ] 19.1 Legend tab tree from the legend model: rows of 10.3, empty state kept.
- [ ] 19.2 Visibility for layers and groups (tri-state); keyboard.
- [ ] 19.3 Class entries with counts and "No value".
- [ ] 19.4 Reordering by drag and drop with the drop line; Alt + Up/Down; live
  announcements; draw order follows.
- [ ] 19.5 Groups: create, rename, delete, collapse, move layers in and out (drag
  and Alt + Right/Left).
- [ ] 19.6 Style editor 1: colour by; single colour swatches and hex field.
- [ ] 19.7 Style editor 2: method, classes, ramp with previews, reverse.
- [ ] 19.8 Style editor 3: opacity, point size, line width.
- [ ] 19.9 Notices for layers that are not drawn (icon, tooltip, reason in the
  expanded row).
- [ ] 19.10 Long content and quantity: 50 layers, 12 classes, names of 120
  characters, 10 million as a count; screenshots; axe.
- [ ] 19.G Gate.

## M20: Contours

- [ ] 20.1 Kernel: grid contours (11.5) with tests (a plane gives straight, evenly
  spaced lines; a cone gives circles; saddles; no-value holes; rotated
  lattices).
- [ ] 20.2 Kernel: mesh contours by z, chained, with tests.
- [ ] 20.3 Default interval and the level limit finding.
- [ ] 20.4 Engine contours(): derived datasets, replace, remove with the source,
  cancellation.
- [ ] 20.5 Data tab: derived datasets under their source (10.4); summary shows the
  parameters.
- [ ] 20.6 Legend: the contours sub-section in the style editor (column for
  grids, interval, base, index every N, show); the derived layer under its
  source; index contours drawn thicker.
- [ ] 20.7 Render golden images and the 4M-cell perf measurement.
- [ ] 20.G Gate (with `pnpm perf` for contours).

## M21: Selection and identify

- [ ] 21.1 GPU picking on click: an integer render target with layer and element,
  one-pixel asynchronous readback; tests on known pixels.
- [ ] 21.2 Highlight of the selected element in 2D and 3D.
- [ ] 21.3 Identify popover (10.5).
- [ ] 21.4 "Show in table": opens the Data tab, selects the dataset, scrolls to
  the row and focuses it.
- [ ] 21.5 Table to map: selecting a row highlights its element.
- [ ] 21.6 Escape and removal clear the selection; selection in the scene
  document; screenshots; axe.
- [ ] 21.G Gate.

## M22: PNG export

- [ ] 22.1 Offscreen map render at the export size, independent of the screen;
  asynchronous readback; framing as 10.6 says.
- [ ] 22.2 Furniture drawn into the export from the furniture model.
- [ ] 22.3 Legend drawn with Canvas 2D from the legend model, with the font
  loaded first.
- [ ] 22.4 Composition from the export layout model, light colours.
- [ ] 22.5 PNG encoding with pHYs and sRGB chunks; tests read the chunks.
- [ ] 22.6 viewer.exportPng(); the byte-identical test.
- [ ] 22.7 Export dialog (10.5) and the toolbar's Export PNG button.
- [ ] 22.8 Live preview in the dialog (debounced, small).
- [ ] 22.9 Limits, warnings, progress, cancel, file name.
- [ ] 22.10 e2e: download and check size, dpi, and that the legend's region starts
  level with the map's top; export golden images (2D, rotated 2D, 3D, a legend
  in two columns) in Docker, reviewed.
- [ ] 22.11 Perf: A4 300 dpi export time and long tasks; recorded.
- [ ] 22.G Gate (with `pnpm perf` for export).

## M23: Embedding

- [ ] 23.1 The complete Viewer API (11.8) with type tests and doc comments.
- [ ] 23.2 Library build of @karmania/viewer: ESM, the worker and the wasm as
  assets with resolvable URLs, emitted type declarations.
- [ ] 23.3 Test page with two viewers on one page, independent of each other,
  served under a strict Content Security Policy. Find the smallest policy that
  works (it will need 'wasm-unsafe-eval'), record it, and test that nothing is
  blocked.
- [ ] 23.4 Dispose test: create and dispose twice; no workers or WebGL contexts
  left behind.
- [ ] 23.5 `THIRD_PARTY_NOTICES.md` for everything shipped (three, Lit, Lucide,
  Inter, the EPSG definitions, the colour data) and the builds keep licence
  comments where licences require them.
- [ ] 23.6 `docs/embedding.md`: install, createViewer, options, events, export,
  CSP, dispose.
- [ ] 23.G Gate.

## M24: Hardening

- [ ] 24.1 axe over every new state, both themes, smallest window; each fix its
  own commit.
- [ ] 24.2 Long-content pass over every new piece of UI (legend, dialogs,
  popover, status chip, export); each fix its own commit.
- [ ] 24.3 `pnpm perf` covers section 9.6 completely; `docs/perf.md` updated;
  regressions fixed in separate commits.
- [ ] 24.4 Review the words of every new finding (plain language, hints, the
  phase 1 word rules).
- [ ] 24.5 README: where it stands, what works, coordinate systems and
  reprojection rules, how it is built (new crates and packages), testing.
  Checked against the code.
- [ ] 24.G Gate (with `pnpm perf`).

## M25: Release and cleanup

- [ ] 25.0 Ask the owner whether to release 0.2.0. No commit.
- [ ] 25.1 If yes: the version in the manifests, the Rust workspace and
  Cargo.lock, in a commit of its own.
- [ ] 25.2 If yes: the CHANGELOG.md entry, in the style of 0.1.0.
- [ ] 25.3 If yes: gate and merge. Then, once CI passes on main, tag v0.2.0 on the
  merge commit and create the GitHub release from the CHANGELOG entry, copied
  exactly.
- [ ] 25.4 After the owner approves: delete `dev` locally and on the remote. No
  commit. Show the output.
- [ ] 25.5 Final report. No commit.
