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
- [x] 12.5 Add proj4rs (dependency-only).
- [x] 12.6 Transformer between two CrsRefs: identity, local-to-local unit
  scaling, EPSG-to-EPSG through proj4rs; local-to-EPSG and unbuildable
  definitions give findings. New codes documented. Split to stay under the
  commit size guideline:
  - [x] 12.6a The finding codes `crs.transform.local_grid`, `code_unknown` and
    `unsupported`, in the registry of the core and documented.
  - [x] 12.6b The transformer: identity, local-to-local unit scaling and
    EPSG-to-EPSG through proj4rs; local-to-EPSG, codes that are not known and
    definitions that cannot be used give findings.
  - [x] 12.6c Which definitions of the registry can be used and why the others
    cannot, over the whole registry, pinned.
- [x] 12.7 Transform positions in place (f64, z untouched); non-finite results
  counted in a finding with examples.
- [x] 12.8 Accuracy tests: reference conversions from an independent source
  (PROJ or pyproj if available on the machine, otherwise published values), the
  source named for each row; tolerance 1 mm projected, 1e-9 degrees geographic;
  round trips.
- [x] 12.9 CrsKinds hook in karmania-core with the default implementation (4326
  only). No behaviour change: phase 1 snapshots unchanged.
- [x] 12.10 karmania-crs implements CrsKinds.
- [x] 12.11 The wasm kernel passes it to validation on import and load; the
  "code not in the definitions" warning; tests for 4269 (geographic, now
  range-checked) and an unknown code. Split to stay under the commit size
  guideline:
  - [x] 12.11a `karmania-io` passes a `CrsKinds` through: `Registry::load_with`,
    `ImportRun::step_with` and `Kernel::with_kinds`; the defaults are unchanged.
  - [x] 12.11b The warning for a code that is not in the definitions
    (`crs.code.unknown`), asked only of a `CrsKinds` that has every code.
  - [x] 12.11c The wasm kernel is built with the definitions; tests for 4269 and
    an unknown code.
- [x] 12.12 wasm exports crsInfo and searchCrs. Measure the module size (raw and
  gzip) before and after; record in `docs/perf.md`; apply the build-size rule of
  section 4 of the brief.
- [x] 12.13 Engine: crsInfo() and searchCrs(), types, unit and real-worker
  tests. Split to stay under the commit size guideline:
  - [x] 12.13a The `CrsInfo` type and its constants, the strict contract check,
    and every definition of the registry run through it.
  - [x] 12.13b The worker: the kernel module's two calls, the two requests of the
    protocol and the handler, with their tests.
  - [x] 12.13c `engine.crsInfo()` and `engine.searchCrs()`, and a test with the
    real worker.
- [x] 12.14 Wizard CRS step: search by code or name (top 20) showing name, kind
  and units; the detected CRS shows its name (extends 8.8). Screenshots updated
  and reviewed. Split to stay under the commit size guideline:
  - [x] 12.14a The words: what a system is, a code with its name, and the
    summary of what is chosen with the name in it (no change to the screen).
  - [x] 12.14b The step asks the engine for the name of the found and of the
    chosen code, and shows it. Screenshots updated and reviewed.
  - [x] 12.14c The draft keeps what is in the search box apart from the code,
    and a name typed is no error (no change to the screen).
  - [x] 12.14d The field becomes "EPSG code or name", with up to 20 matches
    under it (name, code, kind and units). Screenshots updated and reviewed.
- [x] 12.15 Dataset summary: CRS shows code, name and units (extends 9.3).
  Screenshots updated and reviewed.
- [x] 12.F1 The transformer refuses a geographic system whose units are not
  degrees (found at the gate: EPSG:4807 and eight others were read as degrees).
- [x] 12.F2 `THIRD_PARTY_NOTICES.md` begun, with the EPSG acknowledgement and terms
  (found at the gate: the engine's types pointed at a file that did not exist).
- [x] 12.F3 The record of the Node 24 abort corrected: one search is enough, and CI
  prints it in every run since 12.13 (found at the gate). No change to the code.
- [x] 12.F4 Stale documents corrected: the README on coordinate systems, the sizes after
  M12 in `docs/perf.md`, two comments in `codes.rs`, a sum in the decisions.
- [x] 12.F5 The CRS step says "from the matches", not "as you entered it", of a
  code that was picked from the matches of a name. Screenshots updated and reviewed.
- [x] 12.F6 The search test of "a code that is also part of names" uses one that is
  (2000), not 84, which is not a code.
- [x] 12.F7 The definitions are held as a table, not as the one giant match of
  `crs-definitions`, which made Node 24 abort after a few dozen lookups
  (found at the gate).
- [x] 12.F8 The "Chosen:" line of the CRS step is one line, cut, with the whole in its
  title, when matches are under it: a long name no longer moves the box (second review).
- [x] 12.F9 `scripts/generate-crs-table` writes the file `cargo fmt --check` wants, and CI
  checks that regenerating it changes nothing (second review).
- [x] 12.F10 The record of the notices corrected: the builds do not carry the file yet,
  and the terms still have not been read at the source (second review).
- [x] 12.F11 `docs/perf.md` read again after 12.F7: the rule paragraph, the raw size, the
  start-up and search figures (second review).
- [x] 12.F12 The nine geographic systems in grads are not range-checked as degrees by
  validation (second review; 12.F1 did the transformer).
- [x] 12.F13 The "Chosen:" line of the CRS step has room for two lines instead of being
  cut to one, so that nothing moves and the unit is not hidden (third review).
  Screenshots updated and reviewed.
- [x] 12.F14 `scripts/generate-crs-table` formats only the table it writes (third review).
- [x] 12.F15 Documents corrected: the perf figures at the head of the milestone, the
  wording about epsg.org, the 12.F9 and 12.F10 records (third review).
- [x] 12.F16 The doc of `CrsGeography::NotGeographic` says that it covers a geographic system
  in grads (third review).
- [x] 12.F17 The CRS step no longer makes the dialog scroll at 1024 x 640 (the box shows
  3.5 rows), and its "Chosen:" line is not cut in a narrow window (fourth review).
  Screenshots updated and reviewed.
- [x] 12.F18 The CRS step shows the mark of "nothing chosen" in the EPSG mode until a code
  is typed or a match picked (fourth review). Screenshots updated and reviewed.
- [x] 12.F19 The CI step that regenerates the table compares the whole tree (fourth review).
- [x] 12.F20 The longest name of the registry is pinned by a test, since the two lines of the
  "Chosen:" line were measured for it (fourth review).
- [x] 12.F21 The CRS step does not make the dialog scroll at 1024 x 640 when the "Found" line wraps
  either (a long projection file name, a GeoJSON with no crs): the box shows 3 rows (fifth review).
  Screenshots updated and reviewed.
- [x] 12.F22 The focus ring of a match reached by the arrows is never clipped by the edge of
  its box (fifth review).
- [x] 12.F23 The CI step that regenerates the table also fails on a file that is new (fifth review).
- [x] 12.F24 The record of what the fifth review's re-run leaves open at 1024 x 640 is
  corrected: a projection file with no EPSG code, three-line "Found" lines (docs only).
- [x] 12.G Gate.

## M13: Display preparation (karmania-prep)

- [x] 13.1 Crate karmania-prep (depends on core and crs), forbid unsafe.
- [x] 13.2 Frame choice (section 9.2 of the brief) with the info finding for the
  UTM choice. Tests: projected, local, geographic north and south, zone edges.
- [x] 13.3 Rebasing to f32 against the origin; the precision test of 9.1.
- [x] 13.4 Drawability per dataset (9.2) with display findings; documented. Split to stay under the
  commit size guideline:
  - [x] 13.4a A correction of 13.2: every system that is not longitude and latitude in degrees is its
    own map system, an unknown code included.
  - [x] 13.4b `drawable(map_crs, dataset)` and the display findings.
  - [x] 13.4c `choose_frame`: the frame and the drawable list of every dataset, with the rule that the
    map CRS stays until it is changed or the last dataset is removed.
- [x] 13.5 Points buffers.
- [x] 13.6 Lines buffers.
- [x] 13.7 Add the earcut port (dependency-only).
- [x] 13.8 Polygon triangulation with holes and multipolygons; outline buffers;
  the "outline only" warning; collinear and degenerate cases.
- [x] 13.9 Mesh buffers.
- [x] 13.10 Grid image placement and tiling by a maximum texture size.
- [x] 13.11 Grid warp when the grid's CRS differs from the map CRS: subdivide
  until the error measured at sub-cell midpoints is under 0.1 cell; test across
  a UTM zone change. Split to stay under the commit size guideline:
  - [x] 13.11a The mesh of one tile: cut finer until the middles of its parts are within 0.1 cell.
  - [x] 13.11b The warp for a whole grid: the tiles, `GridLayout::Warp`, the findings.
- [x] 13.12 Grid surface buffers (elevations from a column).
- [x] 13.13 Block buffers (own CRS only).
- [x] 13.14 Column statistics: count, nulls, finite min and max, distinct values
  with counts up to a limit; deterministic.
- [x] 13.15 Class breaks: equal intervals and quantiles.
- [x] 13.16 Class breaks: natural breaks (sampled as 11.4 of the brief says) and
  categories with "Other". Split to stay under the commit size guideline:
  - [x] 13.16a Natural breaks (Jenks) from an evenly strided sample of at most 10,000 values.
  - [x] 13.16b Categories: up to 20 values by count, ties by value, the rest as "Other".
- [x] 13.17 Class index per element (u8, 255 = no value) for every kind.
- [x] 13.18 PrepareJob with step(budget) and cancellation for large datasets.
  Split to stay under the commit size guideline:
  - [x] 13.18a The projection of positions in parts (`Projector`), and the
    transformer's `convert_chunk_in_place`, with the same results in parts of any size.
  - [x] 13.18b The one-shot functions rebuilt from parts that can be stepped (lines, mesh,
    polygons, blocks, surface and the warped grid), with no change of behaviour.
  - [x] 13.18c The `PrepareJob` over every kind, and its cancellation.
- [x] 13.19 wasm exports chooseFrame, prepare, classify, classIndex, with typed
  arrays as transferables. Split to stay under the commit size guideline:
  - [x] 13.19a What the worker keeps between requests (`Preparer`: the frame and the jobs), the
    JSON forms of the class breaks, and `Registry::datasets`.
  - [x] 13.19b The exports of the wasm `Kernel`, with typed arrays, and a test in Node.
- [x] 13.20 Engine: chooseFrame(), prepare(), classify(), classIndex(); protocol
  types; a test that transferred buffers are detached on the sending side;
  real-worker tests. Split to stay under the commit size guideline:
  - [x] 13.20a The public types (`display.ts`) and the strict checks of what the kernel gives
    (`display-check.ts`), tested against the built kernel and against values wrong in one way each.
  - [x] 13.20b The protocol (requests, progress of a prepare) and the worker's handler, with the
    buffers of a result in the transfer list.
  - [x] 13.20c The client and the engine's methods, with their checks of misuse, and the test that
    the buffers are detached on the sending side.
  - [x] 13.20d The real-worker tests in the browser.
- [x] 13.21 `scripts/generate-fixtures` also writes a 1,000,000-block model CSV
  (not committed). Ignored Rust timing tests for preparing 1M points, 4M cells
  and 1M blocks; results in `docs/perf.md`.
- [x] 13.21a A faster count of distinct values, since the timing of 13.21 found categories over a
  4,000,000-cell column slower than the restyle target.
- [x] 13.F1 Gate fix: quantile classes of a column with two values, or with most rows at one value, are
  not collapsed to one class.
- [x] 13.F2 Gate fix: a frame made when nothing was drawable gets its origin from the first dataset that is.
- [x] 13.F3 Gate fix: a polygon too detailed to triangulate in one step is outlined only, with a finding of its
  own, and the claims about the length of a step are corrected.
- [x] 13.F4 Gate fix: removing the last dataset drops the frame in the kernel itself.
- [x] 13.F5 Gate fix: the mesh of a warped tile is cut along `i` and along `j` by what each side needs.
- [x] 13.F6 Gate fix: the finding for two local grids says that heights are drawn as given.
- [x] 13.F7 Gate fix: the classes and the class index of a grid with several layers are those of the first
  layer, the one that is drawn.
- [x] 13.F8 Gate fix: the browser and Node reports of display preparation compare the bytes of the buffers.
- [x] 13.F9 Gate fix: a test of the sample of natural breaks that is not a multiple of its stride.
- [x] 13.F10 Gate fix: small things (words about NaN and infinity, the module doc of `stats`, the frame
  checked before a prepare starts, the error of a job that is gone).
- [x] 13.F11 Gate fix, second review: the cost of holes bounds a polygon too (vertices times rings), and what
  the limits do and do not bound is said as it was measured.
- [x] 13.F12 Gate fix, second review: equal-interval bounds never descend and never overflow.
- [x] 13.F13 Gate fix, second review: stale words ("one byte for each element", the other kinds of step that cannot
  be cut, the `chooseFrame` doc) and the record of the commit that did not build.
- [x] 13.F14 Gate fix, third review: a plain curve is the slow polygon and not the ragged one: the word, the
  table, the owner's options, and a note of what earlier records the later fixes superseded.
- [x] 13.F15 Gate fix, third review: equal-interval bounds are exact where the width divides evenly, as they were
  before step 13.F12.
- [x] 13.F16 Gate fix, third review: a step of polygons is charged by work and not by vertices, the validation-codes
  document says what step 13.F11 said it did, and the test with the real limits has its holes inside.
- [x] 13.F17 Gate fix, fourth review: two tests for `equal_bounds` (the hold between bounds, and the blend for a range
  wider than a float), each seen to fail when its part of the code is removed.
- [x] 13.G Gate.

## M14: Scene document (@karmania/scene)

- [x] 14.1 Package (pure TypeScript, no DOM lib), Vitest, one test.
- [x] 14.2 Types of section 11.6 of the brief.
- [x] 14.3 validateScene() and migrate() with tests. Split to stay under the commit size guideline:
  - [x] 14.3a The list of problems and the checks it is made of (numbers, text, choices, lists, objects).
  - [x] 14.3b `validateScene`: the version, the frame, the view, the cameras and the exaggeration.
  - [x] 14.3c `validateScene`: the layers (colour, opacity, sizes, contours, derivation).
  - [x] 14.3d `validateScene`: the legend, the selection and how they refer to layers.
  - [x] 14.3e `migrate`.
- [x] 14.4 Colour ramps and palettes with sources and licences; sampling to n
  classes; categorical palette contrast checked against both map backgrounds
  (record any colour under 3:1 and how it is made readable, for example by the
  outline). Split to stay under the commit size guideline:
  - [x] 14.4a Colours: `#rrggbb`, mixing, and WCAG contrast.
  - [x] 14.4b The ramps (viridis and magma from matplotlib, ColorBrewer sequential and
    diverging) with their sources and licences, sampling to n classes, the "Data" table
    of `docs/dependencies.md`, and `validateScene` refusing a ramp that is not one.
    Cividis is left out until the owner decides (its licence is not CC0 as far as is shown).
  - [x] 14.4c The categorical palettes (Okabe-Ito, ColorBrewer Paired), their contrast against
    the light and the dark map, and the colours of new layers.
- [x] 14.5 Default styles (11.6).
- [x] 14.6 Commands: layers and visibility. Split to stay under the commit size guideline:
  - [x] 14.6a The empty scene, the ids of new layers, and `addLayers`.
  - [x] 14.6b `removeLayersOfDataset`, `setVisible` and `setGroupVisible`.
- [x] 14.7 Commands: ordering and groups. Split to stay under the commit size guideline:
  - [x] 14.7a `moveNode`: a layer or a group to a place in the legend or in a group.
  - [x] 14.7b `createGroup`, `renameGroup`, `deleteGroup`, and `setGroupCollapsed` (the brief's list has no
    command that changes `collapsed`, and step 19.5 needs one).
- [x] 14.8 Commands: style, contours, view, camera, frame, selection. Split to stay under the commit
  size guideline:
  - [x] 14.8a `setStyle` and `setContours`.
  - [x] 14.8b `setViewMode`, `setVerticalExaggeration` and `setCamera`.
  - [x] 14.8c `setFrame` and `setSelection`.
- [x] 14.9 Store: getState, dispatch, subscribe; several stores per page. Split to stay under the commit
  size guideline:
  - [x] 14.9a `Command` as data, `applyCommand`, and the test that no run of commands makes a document
    that `validateScene` refuses.
  - [x] 14.9b `createSceneStore`.
- [x] 14.10 Legend model with number labels (11.7). Split to stay under the commit size guideline:
  - [x] 14.10a Number labels: thousands commas and a true minus sign, and each bound as it is, not rounded (the owner's
    choice after M14, see decisions; the brief's rule was "the fewest decimals that keep neighbouring bounds distinct").
  - [x] 14.10b The colours of the classes, and the entries of a layer's classes with their labels and counts.
  - [x] 14.10c The legend model: groups, layers, class entries and the notices of layers that are not drawn.
- [x] 14.11 Furniture model: north arrow and scale bar (nice lengths, unit
  changes, null cases). Split to stay under the commit size guideline:
  - [x] 14.11a The north arrow: the angle of the needle and what it says.
  - [x] 14.11b The scale bar: a nice length, its unit, its width in pixels, or nothing and why.
- [x] 14.12 Camera models: fit 2D and 3D; 2D to 3D keeping centre and heading. Split to stay under the
  commit size guideline:
  - [x] 14.12a The heading and elevation helpers move out of the commands into `angles.ts`, unchanged (a move
    is a commit of its own).
  - [x] 14.12b The cameras that fit an extent in 2D and in 3D.
  - [x] 14.12c The 2D camera of a 3D one and the 3D camera of a 2D one, keeping centre, heading and scale.
- [x] 14.13 Export layout model (10.6) with a fake measure callback; tests for one
  column, several columns, a group heading at a column end, a narrow map
  warning. Split to stay under the commit size guideline:
  - [x] 14.13a The lines of the exported legend: visible layers that are drawn, their classes, and the groups that
    have any.
  - [x] 14.13b The layout: the map, the north arrow, the scale bar and the columns of the legend, in pixels, with the
    warning that the map is narrow.
- [x] 14.F1 Gate fix, review of M14: ids that cannot collide or lose digits, and datasets that are not what the engine
  gives are refused, so that a command never makes a document that `validateScene` refuses.
- [x] 14.F2 Gate fix, review of M14: a hole in a list is a thing that is missing, `validateScene` takes a time in
  proportion to the layers and not to their square, the cap of 100 problems is pinned, and two comments say what is true.
- [x] 14.F3 Gate fix, review of M14: lines that go to the next column to stay with their heading do so only if they fit
  there, and a line wider than its column is said to be drawn within its rectangle.
- [x] 14.F4 Gate fix, review of M14: the cameras are undefined for a heading or an elevation that is not a number,
  so every camera given is one that `validateScene` accepts.
- [x] 14.F5 Gate fix, review of M14: the property tests take tens of milliseconds and not seconds, so that a loaded
  machine does not run them out of their five seconds.
- [x] 14.F6 Gate fix, review of M14: the words that were stale or wrong in the roadmap, a header and the decisions,
  the data and problem-code notes the review asked for, and the packages that use vitest, vite and Node's types.
- [x] 14.F7 Gate fix, second review of M14: `addLayers` also refuses a dataset whose columns are not what the engine gives.
- [x] 14.F8 Gate fix, second review of M14: a camera is given only if it validates, an extent that overflows has no
  camera, and the small things that review found in tests, comments and docs.
- [x] 14.F9 Gate fix, third review of M14: `addLayers` works on one copy of each dataset (holes and getters), and the
  cameras take the middle as the sum of the halves and do not take a scale that underflows for a point.
- [x] 14.G Gate.

## M15: The viewer package (a move, no visible change)

- [x] 15.1 Package @karmania/viewer, empty, with tests running.
- [x] 15.2 Move the map area component and its tests. Every screenshot and e2e
  test unchanged. Split, because the map area needs two helpers that the rest of the app uses too, and
  the viewer may not import from the app:
  - [x] 15.2a Move the helpers: `drag.ts` and `import-files.ts` with its test.
  - [x] 15.2b Move `map-area.ts`.
- [x] 15.3 Move the panel (tabs, resize handle, panel state): `panel-tabs.ts`, `panel-state.ts` with its test and
  `resize-handle.ts`. The panel element itself, `panel.ts`, imports the Data tab (it registers `<karmania-data-tab>`),
  so it moves after the Data tab, as step 15.4e.
- [x] 15.4 Move the Data tab, dataset list and summary, and the panel that holds them. Each piece moves after what it
  imports, since the viewer may not import from the app:
  - [x] 15.4a `datasets.ts` and `import-crs.ts`, with their tests.
  - [x] 15.4b The import logic that the summary uses: `import-mapping.ts`, `import-nodata.ts`, `import-draft.ts` and
    `import-run.ts`, with their tests.
  - [x] 15.4c0 A unit test for the app's own `theme.ts`: with `findings-text` and `import-steps` the last unit
    tests leave the app, and a package with no test file fails `vitest run`. (Added; not in the brief.)
  - [x] 15.4c The findings list: `findings-text.ts`, `import-steps.ts` and `findings.ts`, with their tests.
  - [x] 15.4d `data-tab.ts`, `dataset-list.ts` and `dataset-summary.ts`.
  - [x] 15.4e `panel.ts`.
- [x] 15.5 Move the import dialog and its steps.
- [x] 15.6 `<karmania-viewer>` composes them with an engine; the app becomes toolbar plus viewer; a minimal
  createViewer(container) and dispose(). Still pixel-identical. Split:
  - [x] 15.6a `<karmania-viewer>`: the composition of `app.ts` (the map area, the panel, the wizard, the engine and
    the state) moves into the viewer; the app is the toolbar and `<karmania-viewer>`.
  - [x] 15.6b `createViewer(container)` and `dispose()`; the app uses them.
- [x] 15.7 The viewer holds a scene store; datasets loaded or removed add or
  remove layers (nothing drawn yet); tests.
- [x] 15.8 ESLint import restrictions for the dependency direction (5.2).
- [x] 15.8a (added) Record the decisions of M15 in the log.
- [x] 15.F1 Gate fix, review of M15: the dependency table, the list of packages, a step number and the README say what is
  true, and what the review found but this milestone leaves is recorded.
- [x] 15.F2 Gate fix, review of M15: the largest number is not written as `Infinity`, and the comments and the
  tests say what 15 significant digits do (a longer bound is rounded to 15).
- [x] 15.F3 Gate fix, review of M15: `openImport` with an empty list opens the file picker, as it does with no list.
- [x] 15.F4 Gate fix, review of M15: an app that was taken out of the page before its first render and put back has one
  viewer, not two.
- [x] 15.F5 Gate fix, review of M15: a viewer taken out of the page forgets the datasets and layers that its engine held,
  and a test shows that it frees its listeners on the window.
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
