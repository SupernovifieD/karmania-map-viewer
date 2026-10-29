# Decisions

Short log of decisions made while building. One entry per decision: step, what
was chosen, why.

- Step 0.1: `docs/roadmap/phase-1.md` is about 300 lines, over the 150-line
  guideline, because the step is the copied step list itself. One concern, so
  not split.
- Step 0.2: `.claude/` is gitignored at the owner's request. Large generated
  fixtures go to `fixtures/generated/` (ignored); hand-written fixtures stay in
  `fixtures/`.
- Step 0.3: Rust is pinned to 1.99.1 in `rust-toolchain.toml`. rustup was
  installed with the official installer because Homebrew no longer supports
  this Intel Mac. rustup does not auto-install toolchains for most commands, so
  CI must run `rustup toolchain install` first (step 0.9). Cargo manifests set
  no `license` field while the project license is undecided.
- Step 0.4: `unsafe_code` is forbidden per crate (`#![forbid(unsafe_code)]`),
  not workspace-wide, because wasm-bindgen generates unsafe code in
  `karmania-wasm`. Workspace clippy lints deny `unwrap`, `expect`, `panic`,
  `todo`, `unimplemented`, `dbg!` and printing in library code; `clippy.toml`
  allows them in tests.
- Step 0.5: `docs/dependencies.md` and `docs/decisions.md` are created here, not
  at 0.8, because the dependency policy requires recording a dependency in the
  commit that adds it and TypeScript is the first one. Step 0.8 keeps
  `docs/conventions.md`.
- Step 0.5: TypeScript is `~6.0.3`, not the newest 7.0.2, because
  typescript-eslint 8.72 (step 0.6) supports only `>=4.8.4 <6.1.0`. Revisit when
  typescript-eslint supports TypeScript 7.
- Step 0.5: pnpm is pinned to 10.7.1 (`packageManager`), the version installed
  on the development machine, so no package manager is downloaded behind the
  owner's back. The newest pnpm is 12.15.0; upgrading is a separate, deliberate
  step.
- Step 0.5: Node is pinned to 24.22.1 (`.nvmrc`), the "Krypton" LTS line
  installed on the development machine.
- Step 0.5: `tsconfig.base.json` sets `noEmit`; packages type-check only and
  Vite builds the output. Library `.d.ts` emission is decided when the engine
  package is built (M5).
- Step 0.6: ESLint uses `strictTypeChecked` (type-aware) so `any`, unsafe
  `unknown` handling and floating promises are caught. Default exports are
  banned with ESLint's built-in `no-restricted-exports` rather than
  `eslint-plugin-import`, because that plugin is not on the approved dependency
  list; tool config files (`*.config.*`) are exempt. `eslint-config-prettier`
  is not needed: ESLint 10 core and typescript-eslint `strict` carry no
  formatting rules.
- Step 0.6: Prettier skips `*.md` (hand-written, not reflowed) and `fixtures/`
  (sample files must stay byte-exact). Rust is formatted by rustfmt.
- Step 0.6: the root `lint` script runs `eslint .` over the whole repo using the
  single root config. Package `lint` scripts (step 0.7 onward) call the same
  command, and `pnpm check` (step 0.10) decides how to avoid linting twice.
- Step 0.6: `minimatch` (BlueOak-1.0.0, permissive, dev-only transitive of
  ESLint) is outside the allowed license list but unavoidable with ESLint;
  recorded in `docs/dependencies.md` for owner approval.
- Step 0.7: Vite is pinned to `^7.3.7`, added explicitly, instead of the Vite 8
  that pnpm auto-installs as Vitest's peer. Vite 8 has `lightningcss` (MPL-2.0)
  as a hard dependency, which breaks the no-copyleft rule; Vite 7 only lists it
  as an optional peer and Vitest 5 supports Vite 7. Revisit when the project
  license is decided or Vite 8 drops it.
- Step 0.7: Vitest is a dev dependency of each package that has tests, not the
  root. `@karmania/engine` exports its TypeScript source (`exports` points at
  `src/index.ts`) for workspace use only; the build and publish setup is decided
  in M5. Its tsconfig uses the `DOM` lib; typing for the worker entry (the
  `WebWorker` lib) is decided in step 5.2.
- Step 0.8: `docs/conventions.md` accepts the `build` commit type from
  `AGENTS.md` in addition to the types listed in the brief; both come from the
  owner. It also fixes the finding-code style (`<area>.<subject>[.<problem>]`,
  lowercase ASCII, stable once released), which the brief only described as
  "stable, dotted lowercase".
- Step 0.9: the CI workflow was pushed with step 0.9 unticked and ticked in a
  follow-up commit, because the done condition (CI green on the pushed commit)
  can only be proven after the push. Run 40273487943 on `d3c6823` passed both
  jobs.
- Step 0.9: CI uses third-party actions only from `actions/*` and `pnpm/*`, all
  pinned to commit SHAs. It runs on `ubuntu-latest`, which resolved to
  ubuntu-24.04; GitHub is migrating the label to Ubuntu 26. Revisit pinning the
  image when screenshot baselines (step 7.9) make the OS matter.
- Step 0.9: CI also runs `pnpm format:check`, which the brief's `pnpm check`
  (step 0.10) does not list. Left for the owner to decide whether `pnpm check`
  should include it so local and CI runs match.
- Step 0.10: `pnpm check` is the exact sequence from section 5, as one
  `package.json` script that stops at the first failure. It runs whichever
  `cargo` is first on PATH. On the development machine a Homebrew Rust in
  `/usr/local/bin` can shadow the rustup one in interactive login shells (macOS
  reorders PATH after `~/.zshenv`). The Rust checks pass either way, but the
  pinned toolchain and the wasm32 target (needed from step 4.1) only apply when
  `~/.cargo/bin` comes first. Fix is a PATH line in `~/.zshrc`, left to the
  owner.
- After the M0 report the owner approved `minimatch` (BlueOak-1.0.0), asked to
  allow MPL-2.0 build tooling (Vite 8), to update pnpm, and to add
  `pnpm format:check` to `pnpm check`. These became steps 0.11 to 0.14. The
  owner also put the rustup PATH line in `~/.zshrc`; verified: a fresh login
  shell resolves `rustc` to `~/.cargo/bin`.
- Step 0.11: pnpm is 12.15.0 (`packageManager`), superseding the 10.7.1 pin from
  step 0.5. `pnpm self-update` from 10.7.1 cannot do this on this machine: pnpm
  10 skips the install script that replaces pnpm 12's text placeholder with the
  native binary, so the switch fails with `ENOEXEC`. The global pnpm in
  `/usr/local` was updated with `npm install -g --prefix /usr/local
  pnpm@12.15.0` instead, and the broken tool-cache copy was deleted. Anyone
  still on pnpm 10 must do the same (or use the standalone installer); this goes
  in the README setup section (step 10.5).
- Step 0.11: pnpm 12 defaults kept on purpose. `minimumReleaseAge` (one day)
  rejects packages published in the last 24 hours, which is a supply-chain
  guard; the lockfile was re-resolved once because `magic-string@1.4.4` was a few
  hours old (now 1.4.3). Dependency build scripts need approval: esbuild's
  postinstall is denied (`allowBuilds` in `pnpm-workspace.yaml`) because esbuild
  runs without it; the entry becomes unnecessary once Vite 8 replaces Vite 7
  (step 0.13). The lockfile now begins with a document that pins pnpm itself.
- Step 0.12: license policy, owner decision. Apache-2.0 (the `LICENSE` from the
  initial commit, which the owner said not to touch) is treated as the project
  license, so the brief's "no copyleft until the license is decided" no longer
  blocks anything. `minimatch` (BlueOak-1.0.0) is accepted. MPL-2.0 is accepted
  for dev-only build tools, which covers `lightningcss` in Vite 8. This is a
  narrow reading of "go with copyleft": GPL, LGPL and AGPL, and any license not
  listed in `docs/dependencies.md`, still need approval. If the owner wants a
  broader rule, change it there.
- Step 0.13: Vite is `^8.3.5` (Rolldown-based) in `@karmania/engine`, replacing
  the 7.x pin from step 0.7. The lockfile was re-resolved from scratch because
  pnpm otherwise keeps stale optional-peer packages (esbuild) from the old tree.
  esbuild is gone, so the `allowBuilds` entry from step 0.11 was removed.
  `pnpm licenses list` under pnpm 12 undercounts (it omitted `lightningcss` and
  `rolldown`), so licenses are now audited by reading each installed package's
  `license` field; result in `docs/dependencies.md`. If a license check is ever
  added to CI, it must not use `pnpm licenses list`.
- Step 0.14: `pnpm check` also runs `pnpm format:check` as its last stage, an
  owner-approved addition to the section 5 list, so local runs match CI.
- Step 1.1: split into 1.1a (types, adds serde) and 1.1b (collector) to stay
  under the commit size guideline. serde arrives in 1.1a, not 1.3, because
  `Finding` is a wire contract and its JSON shape is pinned by tests from the
  start. Findings only serialize; nothing deserializes them. `Finding.code` is a
  `&'static str` until step 1.2 introduces the code registry.
- Step 1.1: `unicode-ident` (`Unicode-3.0`) is in the serde tree and is outside
  the written license policy. It is permissive and unavoidable with serde's
  derive macros, so work continues; approval is requested in the M1 report.
- Step 1.2: a finding's severity and wizard step now come from its
  `FindingCode`, so `Finding::new(code, message)` takes no severity and
  `with_step` is gone; "one code, one severity" holds by construction and
  `Finding.code` is the enum. The registry is one `macro_rules!` table (no extra
  dependency), so `ALL`, `as_str`, `severity` and `step` cannot drift apart.
- Step 1.2: the registry starts with the three codes M1 needs next
  (`dataset.too_large`, `table.column.name_empty`, `table.column.name_duplicate`)
  rather than an empty list, so the docs test has something to check. Later
  steps add codes with the step that uses them. `dataset` was added to the list
  of code areas in `docs/conventions.md` for the size limit.
- Step 1.4: `ColumnType::as_str` returns the import-mapping vocabulary (`float`,
  `int`, `bool`, `text`, `category`) so the dataset summary and the wizard show
  the same words. A categorical code outside its dictionary is allowed in a
  column and reported by validation (step 2.14), not rejected at construction.
  The only construction error is a data/validity length mismatch, a plain
  `std::error::Error` type rather than `thiserror`, which would add a
  dependency for one type.
- Step 1.5: beyond the brief, a `Table` also requires all columns to have the
  same length, reported as `table.column.length_mismatch`. Without it a table
  has no single row count. Validation (step 2.10) then only compares the table's
  row count with the element count. Blank names (whitespace only) count as
  empty. Constructors that can meet bad user data return `Option<T>` and add
  findings to a `Findings`; this is the pattern for later steps. A thousands
  separator helper (`text::format_count`) was added for messages like `1,204`.
- Step 1.6: the code for mismatched coordinate lists is
  `dataset.coordinates.length_mismatch` (area `dataset`, shared by every shape
  that has positions). `Positions` does not enforce the size limit itself; the
  readers and builders that create the coordinate lists apply it first
  (step 1.16).
- Step 1.7 (logged one commit late): `DatasetId(u64)` is a newtype assigned by
  the holder of the datasets, not by `Dataset::new`. `Provenance` holds only the
  source file name for now; the import mapping is added when its type exists
  (steps 3.7 and 3.8). `Dataset` fields are public, since validation exists to
  check them; `kind` and `has_z` are methods derived from the geometry, never
  stored.
- Step 1.8: geometry types keep their fields public and never trust them:
  accessors such as `Lines::vertex_range` return `None` for malformed offsets,
  because checking the offsets is validation's job (step 2.3). Offsets are
  `u32`, which is enough because the size limit is far below 2^32 elements.
- Step 1.11: lattice rotation uses exact sine and cosine for multiples of 90
  degrees (so a quarter turn gives exact coordinates, and -270, 90 and 450
  agree bit for bit). Other angles use the platform's `f64::sin_cos`, whose last
  bit can differ between native code and WebAssembly. Bit-identical results for
  every angle would need a pure-Rust math crate such as `libm`, which is not on
  the approved dependency list; this is flagged for the owner in the M1 report.
  The lattice stores `dims` as `u32`, with cell counts computed in `u64` using
  checked multiplication; methods return `None` or NaN for invalid values and
  never panic.
- Step 1.13: a block model is always reported as 3D (`has_z` is true), and a
  grid is 3D only with elevations from a column or more than one layer. Sparse
  block triplets are a flat `Vec<u32>` rather than `Vec<[u32; 3]>` so that a
  length that is not a multiple of 3 stays representable and can be reported.
- Step 1.14: `vertex_count` is `Some` only for lines, polygons and meshes (the
  shapes with a vertex list; the dataset summary shows it "where relevant"),
  and per-vertex attributes are expected only for lines and meshes, as the brief
  says. Every count returns `None` rather than a guess when the geometry is too
  malformed to count; the expected attribute rows equal the element count for
  every kind.
- Step 1.15: the bounding box is computed on demand (`Dataset::bbox()`), not
  stored, so it cannot go stale. Points with any non-finite coordinate are
  skipped; `Lattice::bbox` instead returns `None` unless all eight corners are
  finite, because a partial box would be misleading. Block models report the
  whole lattice even when sparse (a CSV import builds the lattice from the
  blocks, so the two agree). A grid's Z is its flat elevation (one layer), or
  the finite range of its elevation column, and falls back to the lattice's own
  Z extent when neither is usable; a dataset without Z reports Z as 0. The
  helper `Column::finite_range` (min and max of valid, finite numbers) was added
  for this and is reusable by validation.
- Step 1.16: `MAX_ELEMENTS` is 134,217,728 (2^27) and applies to each count on
  its own (points, vertices, cells or blocks), not to their sum. `check_size`
  takes an `Option<u64>` so a count that overflowed (`None`, for example from
  `Lattice::cell_count`) is rejected too, with its own message; callers pass the
  plural noun for the message. Its hint is the same for every shape: the
  cell-size advice that the first draft of `docs/validation-codes.md` had is
  dropped because it made no sense for points. The guard only reports; readers
  and builders (milestones M3 and M4) must call it before allocating, which is
  tracked there.
- Step 1.17: the lattice bounding-box bug (a NaN spacing on one axis gave a
  partial box) now has per-axis regression tests; three of them fail against the
  original code.
- Step 1.18: the owner approved `libm` (MIT), resolving the flag in the step 1.11
  entry. Rotation by an angle that is not a multiple of 90 degrees uses
  `libm::sincos`, and a test pins the exact bits of eight results, so a platform
  difference would fail on CI. `f64::to_radians` and `rem_euclid` are plain IEEE
  arithmetic, so they already agree everywhere.
- Step 1.19: the owner approved `unicode-ident` (Unicode-3.0), so Unicode-3.0 is
  now in the license policy in `docs/dependencies.md`.
- Step 2.5: beyond the brief's list, a polygon with no rings is an error
  (`polygons.polygon.no_rings`): the offsets can be valid and the polygon still
  has no outline to draw. Ring orientation and repeated closing vertices are not
  checked (the model stores rings open and does not enforce orientation).
- Steps 2.3 to 2.5: every offsets list (lines, rings, polygons) is checked by one
  shared function giving up to four codes (`empty`, `bad_start`, `bad_end`,
  `decreasing`). Backwards steps are one finding with a count and the first 20
  examples, so a bad file does not produce thousands of findings.
- Step 2.8: lattice checks cover dimensions, cell size, origin, rotation and the
  size limit. The origin and rotation checks go beyond the brief's "dims and
  spacing" because a non-finite origin or rotation makes the bounding box and
  every cell centre meaningless. For a sparse block model the size limit applies
  to the number of blocks, not lattice cells (a sparse model can sit on a huge
  lattice). Whether the attribute row count equals the cell count is checked
  once, for every kind, in step 2.10. Numbers in these messages use Rust's
  shortest round-trip format (`10`, `0.5`, `NaN`, `inf`), which is identical on
  every platform.
- Step 2.9: duplicate sparse blocks are found with one bit per lattice cell when
  the lattice has at most `MAX_ELEMENTS` cells (linear time, at most 16 MB), and
  by sorting block indices otherwise (a sparse model on a huge lattice). A test
  checks that both paths give identical results. Only blocks inside the lattice
  can be duplicates; out-of-range blocks are reported separately. The first copy
  of a repeated block is not blamed, only the later ones.
- Step 2.10: a table with no columns always passes (a dataset may have no
  attributes), and a dataset whose elements cannot be counted is not compared
  (the structure checks already reported why). Beyond the brief, a per-vertex
  table on a shape that does not use one (anything but lines and meshes) is a
  warning, `dataset.vertex_attributes.unsupported`, so supplied values are never
  silently dropped.
- Step 2.13: duplicate points are found by ordering point indices by the bit
  patterns of x, y and z, not by hashing as the brief suggests. A hash set needs
  about five times the memory at the size limit and its speed depends on a hash
  function; the sort needs four bytes per point and gives the same answer. The
  later copies are counted (the first is not blamed), and 0.0 and -0.0 count as
  different points because "exact" means identical bits.
- Step 2.16: the EPSG definitions come from `crs-definitions` 0.6.0 (CC0-1.0,
  `no_std`, no dependencies, released regularly through September 2026). It maps
  a `u16` EPSG code to a PROJ string and a WKT string; it has no names or unit
  fields, so step 2.17 reads the name, kind and unit from the WKT. Codes above
  65535 are therefore unknown, which covers every EPSG code in use. The owner
  said to use EPSG whatever its license; the data's provenance (PostGIS table,
  derived from the IOGP EPSG registry) is written down in
  `docs/dependencies.md`. Its size in the WebAssembly build is to be measured
  at step 4.1 and reported at the M4 checkpoint.
- Step 2.17a: `epsg::lookup` reads each definition's WKT with a small parser (no
  dependency), because `crs-definitions` gives only PROJ and WKT strings. A
  compound or bound system reports the kind and unit of its horizontal part and
  keeps its full name; geocentric systems and the 8 entries with no WKT are kind
  `other`. A test describes all 6,184 definitions and requires a unit for every
  geographic and projected one. The names are the registry's own wording, for
  example "OSGB 1936 / British National Grid".
- Step 2.18: for a geographic EPSG system, a range outside longitude -180 to 360
  or latitude -90 to 90 is an error (`crs.geographic.out_of_range`), because
  such values cannot be positions on the Earth. Longitude is allowed up to 360,
  so data written as 0 to 360 is not blocked. The brief did not give a severity
  for the range check. If the values fit longitude and latitude only with X and
  Y swapped (X within 90 and Y above 90, up to 180), the check gives the
  `crs.geographic.axes_swapped` warning instead of the error. Data that fits
  both ways (for example X 35.7, Y 51.4) cannot be told apart and gets no
  finding. The check uses the bounding box, so grids and block models are
  checked by their extent.
- Step 2.19: `proj4rs` 0.2.1 (the latest; `cargo info` showed 0.1.5 by default)
  is added with default features off. The `aeqd` feature builds C code through
  the `cc` crate, which cannot target `wasm32-unknown-unknown` without a wasm C
  compiler and is not pure Rust. The cost: projections that need it (azimuthal
  equidistant, e.g. EPSG:3993 for Guam) cannot be plausibility-checked; step
  2.20 must treat a definition proj4rs rejects as "not checked" and say so.
  Two side effects, both outside our code: on `wasm32-unknown-unknown` proj4rs
  depends on `wasm-bindgen`, `js-sys`, `web-sys` and `console_log` whatever the
  features, so `karmania-core` pulls them in on that target even though none of
  our core code uses them (the brief wants a wasm-free core; our source is, the
  dependency tree is not), and a wasm32 check now takes about 80 s on a cold
  build. Reported to the owner at the M2 checkpoint.
- Step 2.20: projected plausibility converts the four corners of the bounding
  box plus up to 1,000 evenly spaced data positions (all of them for small
  datasets, always including the first and last) to longitude and latitude with
  proj4rs. A sample is bad if the conversion fails, gives a non-finite value, or
  lands outside longitude -180 to 360 or latitude -90 to 90. Beyond the brief it
  also converts the answer back and requires the original coordinate within
  about a metre, because a projection such as transverse Mercator happily maps a
  northing past the pole to a valid-looking position on the far side of the
  Earth. Known limit, covered by a test: a coordinate that is absurd for the zone
  but converts cleanly (an easting of 2.7 million in a UTM zone) is not flagged,
  because that needs each system's area of use, which `crs-definitions` does not
  have. A UTM-zone-distance rule could close most of that gap and is offered to
  the owner at the M2 checkpoint, not added silently. 305 of the 5,217 projected
  codes (6%) cannot be built by proj4rs without its C-backed feature; those get
  the info finding `crs.projected.unchecked` instead of being skipped silently.
  Results come from proj4rs's use of the platform math library, so a coordinate
  within a hair of a limit could in principle differ between platforms.
- Step 2.21: snapshot tests compare a pretty-printed JSON report with a committed
  file in `crates/karmania-core/src/validate/snapshots/`; there is no snapshot
  library on the approved list, so a 15-line helper does it, and
  `KARMANIA_UPDATE_SNAPSHOTS=1` rewrites the files. Regenerated files must be read
  before committing (the first set was checked against what each fixture was
  built to trip). The fixtures are built so the reports contain no floating point
  numbers and no platform-dependent values. `crates/` is excluded from Prettier,
  since rustfmt formats the Rust and the snapshots are generated.
- Step 2.23 (owner request): for UTM systems (`+proj=utm`, 1 to 60 zones, north
  and south) a sample that converts to a longitude more than 9 degrees from the
  middle of the zone (`6 * zone - 183`) gives the warning
  `crs.projected.outside_zone`. 9 degrees is the zone's own 3 degrees each side
  plus one more zone width, so data that straddles a zone edge is accepted. This
  closes the gap noted at step 2.20 for UTM only (it catches an easting of
  2.7 million and swapped easting and northing); other projections still have no
  area-of-use check. It cannot catch a wrong zone with normal-looking eastings,
  because the numbers alone do not say which zone they came from. The finding
  count is the number of failing samples, which includes the box corners.
- Step 2.24 (owner request): `crs.geographic.out_of_range` is a warning, not an
  error, so a dataset whose longitude or latitude fall outside the valid range
  still loads and the user is told. This replaces the "error" choice logged at
  step 2.18; the swapped-axes warning and the 0 to 360 longitude allowance are
  unchanged. Anything that later draws such a dataset must cope with positions
  outside longitude -180 to 360 or latitude -90 to 90.
- Step 3.1: M3 dependency choices. The CSV reader uses the `csv` crate, as the
  brief suggests. `encoding_rs` is not used: the only fallback needed is
  Windows-1252, a 32-entry table that is simpler and cheaper than a dependency
  (step 3.2). The `geojson` crate is not used either: `serde_json`, already
  approved, parses GeoJSON, and `geojson` would add `geo-types` and its
  dependencies for no gain. Fixtures are small hand-written files in `fixtures/`
  (one per format, plus a second `.prj` without an EPSG code, the common ESRI
  style); a test keeps each under 50 KB and the directory in step with its list.
- Step 3.2: besides UTF-8 (with or without a byte-order mark) and the
  Windows-1252 fallback the brief asks for, UTF-16 with a byte-order mark is read
  too, because Excel's "Unicode text" export is UTF-16 and would otherwise come
  out as Windows-1252 garbage. UTF-16 without a mark is not guessed. Files that
  are valid UTF-8 are not copied. The Windows-1252 table was generated from
  Python's codec; the five undefined bytes map to the control character with the
  same number (WHATWG behaviour). A file that mixes valid UTF-8 and stray bad
  bytes is read as Windows-1252 as a whole, which is the brief's rule.
- Step 3.3: the delimited-text reader is written in `karmania-io`, not taken from
  the `csv` crate as step 3.1 planned. The `csv` crate reports a record's start as
  the first blank line before it, and the brief needs exact source line numbers
  ("Line 1,203: Easting is empty"). Writing it also gives whitespace-delimited
  files, blank-line rules and an incremental reader for step 3.22 without a second
  code path. To make up for not using a proven library, `csv` is a dev-dependency
  used only to cross-check the reader on 300 random well-formed texts, and a
  second random test writes records with awkward content (delimiters, quotes, line
  breaks, blank lines, CR and CRLF) and requires the same fields and the exact
  start line back. That test found a real bug during the work (a CRLF inside a
  quoted field was not counted as a line); the test was strengthened so it fails
  against that bug. Rules: a line of only spaces or tabs that are not the delimiter
  is blank; a quote that never closes runs to the end of the text; text after a
  closing quote stays in the field. The delimiter is the candidate (comma,
  semicolon, tab, whitespace) that splits the first 50 rows into the same number of
  fields most consistently, ties going to the earlier candidate; a text with only
  white space is empty (`file.empty`, an error).
- Step 3.4: type inference ignores empty cells and the words `NA`, `N/A`, `null`,
  `NaN`, `-` and `*`. A column is numeric when at least 90% of its values are
  numbers (so a few `<0.01` detection-limit entries do not turn an assay column
  into text; the readers report them as bad numbers), and `Int` only if all its
  numbers are whole. Text with leading zeros (`007`) is never turned into a number,
  because that would lose the zeros. A text column is a category when it has at
  most 50 distinct values and each appears twice on average. Decimal-comma
  detection is done for semicolon files as the brief says, and also for tab and
  whitespace files, since European data uses them with decimal commas too; a comma
  file always uses a decimal point. Thousands separators are not understood.
  Number parsing lives in `numbers.rs` so the readers share one definition.
- Step 3.5: role suggestions use the listed X, Y and Z names plus a few obvious
  spellings (`centre`/`center`, `coordinate`, plural eastings/northings) and,
  beyond the brief, line-identifier names (`Line`, `LineID`, `LineNo`, ...) so the
  wizard can pre-fill the CSV-to-lines mapping. Names are compared after dropping
  a trailing unit in brackets and everything but letters and digits. Confidence is
  fixed by how specific the name is (0.95 descriptive, 0.9 single letters and `RL`,
  0.8 `Long`, 0.5 `Depth`, because depth grows downwards and Z upwards). A
  coordinate name on a non-numeric column is not suggested. Each role goes to one
  column only, the best match then the leftmost; a column with no match is an
  attribute at 0.5, meaning "no idea". Suggestions use the header and the inferred
  types, not the values, so a column named `Lat` holding projected numbers is still
  suggested; the CRS checks catch that later.
- Step 3.6: nodata suggestions follow the brief's lists exactly. A candidate is
  offered only when it appears in a numeric column of the sample, for words as well
  as numbers, so an `NA` in a text column stays text. Counts are for the sample, not
  the whole file. Words are compared ignoring case and spaces except `-` and `*`,
  which must match; the empty word matches empty or blank cells but not a missing
  cell in a short row. Numbers are matched exactly after parsing, so `-999`,
  `-999.0` and `-9.99e2` all count, and `-998` or `-999.5` do not.
- Step 3.7a: `ImportMapping` is in `karmania-io` and follows section 8.3 field for
  field (camelCase JSON). Unknown fields anywhere in it are rejected, so a typo in
  a client is an error, not a silently ignored setting; `blockSize` must have three
  numbers. The contract's words are the serde names of the types themselves:
  `ColumnType` (in core) serializes as `float`, `int`, `bool`, `text`, `category`,
  `Role` as `x`, `y`, `z`, `line_id`, `attribute`, `ignore`, and `DecimalSeparator`
  as `.` or `,`; a test pins each. One leniency: `crs` may be absent as well as
  `null`, and both mean "not chosen yet". Everything else listed as required is
  required.
- Step 3.7b: `validate_mapping` is for CSV mappings (the other formats do not use
  columns). It returns nine error codes, all with the mapping wizard step except
  `mapping.kind.unsupported`, which points at the file step because the fix is to
  choose a different kind. Z is required only for block models; a line identifier
  only for lines; the block size only for blocks. A role held by two columns, a
  column mapped twice, a mapped column missing from the file (names match exactly,
  including case) and a coordinate typed as text, bool or category are reported
  too. It does not look at the data, so numbers that fail to parse are reported by
  the readers (step 3.8).
- Step 3.8: `CsvImport` reads a file in steps (`step(n)` then `finish()`), so the
  incremental job of step 3.22 is a thin wrapper around it; `read_csv` runs it to
  the end. Value rules (also in the module docs): an empty cell is null in every
  column; the mapping's no-data words and numbers apply only to float and int
  columns, because `NA` or `-` can be real text elsewhere; a value that does not
  read as its column's type is null and counted in one `csv.value.unreadable`
  warning per column; a coordinate that is empty, no-data or unreadable follows
  `emptyCoordinates`: `error` gives one `csv.coordinate.missing` error per
  coordinate column (and no dataset), `skip` drops the row and gives one
  `csv.rows.skipped` warning with the count and example lines. Rows with a
  different number of fields from the header give `csv.rows.ragged` (missing cells
  are empty, extra ones ignored). Attribute types the mapping leaves open are
  guessed from the first 200 rows. Text is kept exactly as written (not trimmed).
  Dataset ids are 0 until whoever holds the datasets assigns them. The new code
  area `csv` is in `docs/conventions.md`. For now a mapping whose kind is not
  points gets an error; steps 3.9 to 3.11 add lines and blocks and remove that
  guard.
- Step 3.9: for lines, rows are grouped by the line-identifier column (trimmed
  text): lines come in order of first appearance and vertices keep file order
  within a line. If a line's rows are interrupted by another line's, they are
  gathered (vertices and their attributes reordered together) and one info finding,
  `csv.lines.scattered`, counts the lines affected with the line where each first
  reappears. A row with no identifier is left out with the warning
  `csv.line_id.missing` (a stray blank-ID row should not block the import); it is
  not also counted as a missing coordinate. The dataset's own attribute table has
  one row per line holding the identifiers, in a column named after the
  line-identifier column (or its rename); every attribute column of the file
  becomes a per-vertex attribute, since the file gives no way to know which values
  are constant along a line. With no attribute columns there is no vertex table.
  Lines with fewer than two vertices are left to validation (`lines.line.too_short`).
- Step 3.10: the lattice of a block-model CSV starts half a block before the lowest
  centre on each axis (origin = outer corner of cell 0,0,0), has no rotation, and
  has `round(span / size) + 1` cells per axis, so the lowest and highest centres
  are the centres of the first and last cells. `lattice_from_centres` is public
  and tested on its own; step 3.11 uses it in the importer and checks that every
  centre really sits on the lattice. A span needing more than `u32::MAX` cells on
  one axis (a wrong block size or wrong units) is `csv.blocks.lattice_too_large`.
  Writing the test for absurd spans found an overflow in `count + 1`, now a
  saturating add.
- Step 3.11b: `place_blocks` turns block centres into cells. A centre is on the
  lattice if it is within 1% of a block of a whole number of block sizes from the
  lowest centre on each axis (exported coordinates carry rounding noise, and 1% is
  far below any real offset between block grids). Anything else is the error
  `csv.blocks.off_lattice` with the file lines. Two rows in the same cell are
  `csv.blocks.duplicate`; the first row is not blamed, as in the validator, whose
  repeat finder (`repeated_blocks`) the reader now shares. No usable rows is
  `csv.blocks.none`. A model with exactly one block per cell is dense and its rows
  are put in lattice order (the order is only returned if the rows are not
  already in it); anything else is sparse with `i, j, k` in file order. A block
  model with sub-blocks of different sizes is not supported and shows up as
  off-lattice centres.
- Step 3.11c: the CSV importer now reads block models (the "cannot import blocks
  yet" guard is gone). The blocks are placed when the file ends, once the other
  findings are known: if a coordinate error already stops the import, the model is
  not placed, so the user is not also told there are no blocks. The attribute
  columns are reordered together with the rows for a dense model. Rows left out
  with `emptyCoordinates=skip` leave gaps, so the model becomes sparse. The
  reader keeps the three centre columns and the line of every kept row until the
  end, like points, plus 12 bytes per row for the cells.
- Step 3.12a: GeoJSON properties become attribute columns, one per property name,
  in alphabetical order (JSON objects are unordered, and the `serde_json`
  `preserve_order` feature would bring in `hashbrown` and its Zlib-licensed
  `foldhash`, which is not on the license list). A column's type comes from all
  its values: true/false is `Bool`; numbers are `Int64` when every one is a whole
  number that fits, else `Float64`; text is a category under the same rule as CSV
  (`infer::is_category`) and plain text otherwise. A property with different
  kinds of value, or with lists or objects, is read as text (lists and objects as
  compact JSON) with the warning `geojson.property.as_text`, which counts the
  values that were converted. A missing property and a `null` are both null. A
  property with a blank name is left out with `geojson.property.unnamed`, because
  a table cannot hold a column without a name and one odd key should not block
  the whole file.
- Step 3.12c: `read_geojson(text, file_name)` has no column mapping; the shape of
  the data decides the kind of dataset. The whole file is parsed into a JSON tree
  first (memory is a small multiple of the file size, which suits the element
  limit; streaming would only be worth it if real files prove too big). A
  FeatureCollection, a single Feature and a bare geometry are all read. Features
  that cannot be used are left out and counted by reason, each with its own
  warning: not a feature, no geometry, a geometry type that cannot be imported
  (one finding per type), and malformed coordinates. A MultiPoint with one bad
  position is left out whole, so a feature is never half imported. Findings point
  at features by their position in the file counting from 0 (`element`), since a
  JSON file has no useful line per feature; anything shown to a user adds 1.
  Positions with more than three values use the first three (info, counted). If
  only some points have an elevation all elevations are ignored, with a warning,
  because a missing elevation cannot be filled in honestly. Until the line and
  polygon steps (3.13 and 3.14), those features are reported as unsupported. A
  file with no coordinate system gets EPSG:4326 as RFC 7946 says, with an info
  finding; validation then catches projected coordinates that are not valid
  longitudes and latitudes. Truncated or malformed JSON is `geojson.json.invalid`
  with serde_json's line; very deep nesting hits its recursion limit and gives the
  same error rather than a crash.
- Step 3.13: a LineString is one line and each part of a MultiLineString is a line
  of its own, so a feature with several parts gives several rows that share the
  feature's property values. The first attribute column is `feature_id`: the
  feature's position in the file counting from 1 (the same numbering a user would
  count by), so rows from one feature can be told apart from rows of another. A
  property that is already called `feature_id` keeps its name and the added column
  becomes `feature_id_2` (or `_3`, ...). GeoJSON has no per-vertex values, so the
  lines have no vertex table. Lines with fewer than two positions, including an
  empty LineString, are read as they are and left to validation
  (`lines.line.too_short`), as for CSV; a MultiLineString with no parts has no
  lines at all. A file that gives datasets of several kinds names them
  `<file> (points)`, `<file> (lines)`, and so on; with no file name the kind alone.
- Step 3.14: a Polygon is one polygon and each part of a MultiPolygon is a polygon
  of its own, with `feature_id` and the feature's properties on each, as for
  lines. GeoJSON rings are closed (the last position repeats the first) but the
  core stores them open, so the closing position is dropped only when it repeats
  the first one in every value, elevation included. A ring that does not close is
  kept whole and counted in `geojson.ring.not_closed` (a warning, "they were
  closed", since an open ring is closed implicitly when stored); it is not
  dropped or repaired beyond that. Empty polygons give nothing, as an empty
  MultiPoint does; rings with too few vertices are left to validation. Ring
  orientation is not changed, because the core does not enforce one.
- Step 3.15: a file with more than one kind of shape becomes one dataset per kind,
  named `<file> (points)`, `<file> (lines)`, `<file> (polygons)`, with the info
  finding `geojson.kinds.mixed` naming the kinds. All datasets from one file share
  its coordinate system. With no `crs` member the datasets are EPSG:4326 as RFC
  7946 says, with an info finding. The legacy `crs` member is read in four forms
  (`EPSG:n`, the `urn:ogc:def:crs:EPSG:...:n` URN, the OpenGIS URL, and
  `{"type": "EPSG", "properties": {"code": n}}`) plus the OGC name `CRS84`, which
  is WGS 84 longitude and latitude; an explicit CRS is honored without a finding.
  Anything else, including `"crs": null` (which means unknown), a link, or an
  unknown name, sets no CRS and gives the warning `geojson.crs.unrecognized`, so
  the wizard asks for one; the data is still imported. A code is not looked up in
  the EPSG database here: validation reports an unknown code.
- Step 3.16: the header of an ESRI ASCII grid is a run of `name value` lines that
  ends at the first line starting with a number; names are not case sensitive and
  blank lines are allowed. The position can be `xllcorner`/`yllcorner` (the outer
  corner of the lower-left cell) or `xllcenter`/`yllcenter` (the middle of that
  cell, moved by half a cell), and the cell size `cellsize` or `dx` and `dy`. All
  problems are reported together: lines that are not understood, unusable
  numbers, a name given twice, two ways of giving the same thing, and what is
  missing (one message listing it all). A name that is present with an unusable
  value is not also reported as missing. `ncols` and `nrows` must be whole numbers
  of at least 1 and `cellsize` must be above 0. Without `NODATA_value` there is no
  nodata value; -9999 is not assumed. The codes use the new area `asc`.
- Step 3.17: `read_asc` makes a grid dataset with one `value` column in lattice
  order. The file lists the northernmost row first, so the rows are reversed to
  the south-first order of the lattice; the lattice origin is the outer corner of
  the lower-left cell (a centre position was already moved to it by the header
  step), `z` spacing is 1 and the elevation is flat at 0, since only the user
  knows whether the values are elevations. The coordinate system is left unset (a
  `.prj` sidecar, step 3.19, or the wizard provides it), so validation reports
  `crs.missing` until then. Values are read as a stream of tokens, whatever the
  line breaks. The count must be exactly ncols x nrows, else `asc.values.count`
  with both numbers and no dataset; a grid over the element limit is refused
  before any memory is allocated. A cell equal to the header's nodata value, or a
  word such as `NaN`, `NA` or `-`, is null and counted in `asc.values.nodata`; a
  token that is not a number is null and counted apart in `asc.values.unreadable`.
  A nodata value that is huge (beyond 1e30, like -3.4028234663852886e+38 from a
  single precision grid) also matches values written with fewer digits, within
  one part in a million, since writers disagree on how many digits to print. With
  no `NODATA_value` line no number is treated as nodata.
- Step 3.18: `read_obj` reads only `v` and `f` records. Texture coordinates,
  normals, objects, groups, smoothing and materials do not change the shape and are
  ignored without a finding; everything in the file is one mesh whatever its
  objects and groups. Records for lines, points and curves (and anything not
  recognized) cannot be imported and are counted in `obj.records.unsupported`.
  A face with more than three corners is split into a fan from its first corner
  (counted in an info finding); this is exact for convex faces, and a concave face
  may give triangles that overlap or lie outside it, which the file gives us no way
  to tell apart. Face numbers count from 1, or from the end of the vertices
  defined so far if negative; a face with fewer than three corners, a zero, a
  non-number or a negative number before the first vertex is left out and counted
  (`obj.face.invalid`). A positive number past the last vertex is kept, as the
  core keeps all indices as given, and validation reports it. A vertex line that
  is not three numbers is an error, not a skip, because dropping a vertex would
  silently shift the numbers of every later one. Extra numbers on a vertex (a
  weight or a colour) are ignored and counted. A backslash at the end of a line
  continues it. The file has no coordinate system, so it is left unset.
- Step 3.19: `read_prj` parses the well-known text into a small tree and takes the
  EPSG code only from the root's own `AUTHORITY[...]` (WKT 1) or `ID[...]` (WKT 2).
  A projected system contains a geographic one with an authority of its own (4326
  for WGS 84), and a text search for the last or first `EPSG` would assign the
  wrong system to projected coordinates, so nested authorities are never used. A
  file without a root authority (ESRI software writes none) gives no CRS, the
  system's name for display, and the warning `prj.unrecognized`, so the wizard asks
  the user. An empty or unreadable file is the same warning with a different
  message; a sidecar is optional help and never an error. A bare `EPSG:32640` is
  also accepted. Brackets nested more than 40 deep are not a coordinate system
  (this also keeps the recursive parser safe from hostile input). Matching a name
  such as `WGS_1984_UTM_Zone_40N` to an EPSG code is not attempted.
- Step 3.20: `detect_format(file_name, bytes)` looks at the extension and at most
  the first 64 KiB. The content wins over the extension (a `.csv` that is really an
  ASCII grid is read as one) and the mismatch is an info finding; `.txt`, `.dat`
  and a missing extension make no claim, so they never mismatch. When the content
  says nothing the specific extensions decide (`.json` that is not GeoJSON goes to
  the GeoJSON reader, which explains what is wrong). Extensions of formats we
  cannot read (shapefile, Excel, zip, KML, ...) are refused by name before any
  sniffing, since KML text would otherwise pass for a comma-separated table; a file
  with NUL bytes (except UTF-16) is refused as binary. Content is recognized, in
  this order, as well-known text, GeoJSON (starts with `{` and names a GeoJSON
  type), an ASCII grid (starts with `ncols` or `nrows` and a number), an OBJ (the
  first record is an OBJ record and a vertex line has three numbers) and a table.
  A table needs at least two columns, a data row and four rows in five as wide as
  the header; prose with a comma, JSON and XML are not tables (a first version
  read a letter as a two-column CSV). The suggested kind is a grid for an ASCII
  grid, a mesh for an OBJ and, for a table, lines if a line-identifier column is
  suggested, block model if the header has centre-style names (`XC YC ZC`,
  `XCentre YCentre ZCentre`) and points otherwise. GeoJSON gets none: its kinds
  come from its features. Cutting the examined bytes inside a UTF-8 character is
  handled so it does not make the text look invalid.
- Step 3.21: `crates/karmania-io/tests/robustness.rs` runs every reader (CSV as
  points, lines and blocks with both coordinate policies, GeoJSON, ASCII grid and
  OBJ, plus the `.prj` reader and format detection) against malformed input: empty,
  blank and mark-only files; every prefix of every sample file; random edits
  (flips, deletions, duplications, inserted delimiters) and random bytes; random
  text built from data-like pieces; byte-order marks, CRLF, UTF-16 and
  Windows-1252; trailing delimiters and ragged rows; extreme numbers in every
  numeric slot; NUL and control characters; and very long lines, many columns and
  rows, and long runs of brackets and quotes. For all of them it checks that no
  reader panics, that the same input gives the same output, that an error means
  no dataset, that no dataset means an error (nothing fails silently), that every
  finding has text and a count, and that validating whatever was produced does not
  panic. Each sample file is also run through its own matching reader and mapping,
  and the random edits must both import and be refused, or the test proves
  nothing. The suite found no defects. To be sure it can, I injected a panic and
  a silent failure into the OBJ and grid readers and both were caught. In a release
  build no stress case takes over 300 ms, so there is no slow path; the sizes are
  scaled so the suite takes about 8 seconds in a debug build.
- Step 3.22a: a `CsvImport` can own its text and mapping (`CsvImport::owned`,
  giving a `CsvImport<'static>`) as well as borrow them (`CsvImport::new`, as
  before). In step 4 the import has to live inside a WebAssembly object between
  JavaScript calls, which cannot carry a borrowed lifetime, so this is done now
  rather than as a rewrite then. Both share one implementation through `Cow`, so
  `read_csv` still copies nothing. The reader no longer lives inside the import:
  each step builds a `RecordReader` at a saved `ReaderPosition` (offset and line
  number) and saves it again, which keeps line numbers exact across steps. The
  text and row buffer are moved out of the import for the length of a step, since
  the reader borrows the text while the row handler needs the rest of the import.
  No unsafe code is involved. Output is unchanged: all earlier tests pass, and
  every kind of CSV import read one row at a time equals one read in one go.
- Step 3.22b: an `ImportJob` runs one import in bounded steps. `step(budget_rows)`
  returns `Step::Progress` (rows read, and an estimated total from counting lines
  up front, never less than the real number) or `Step::Done` with the result. A
  CSV job reads the budgeted rows each step; GeoJSON, ASCII grid and OBJ jobs parse
  the whole file in their first step, since those formats cannot be split cheaply
  (a JSON document has to be parsed whole, and a grid or mesh is checked as a
  whole). A budget of 0 counts as 1, so a caller looping until done cannot stall.
  The job owns its text and mapping, so it can be held between calls, and dropping
  it cancels. `Done` is returned once; asking a spent job again gives `Done` with
  no datasets and no findings, and `is_finished` says so, so misuse cannot panic.
  A problem found at the start (a bad mapping, an empty file) ends the job in its
  first step. Reading a 20,000 row file 1,000 rows at a time gives exactly the
  result of reading it at once.
- Step 3.23: `pnpm check` and CI now run clippy and the tests with `--locked`, so a
  `Cargo.lock` that does not match the manifests fails instead of being quietly
  rewritten. Checking milestone M3 from a fresh clone showed the lockfile was out
  of date for seven commits in a row (3.7a, when `karmania-io` got `serde` and
  `serde_json`, up to 3.11b), fixed forward in 0524ab0. Nothing caught it because
  clippy runs before the tests and rewrites a stale lock without complaint, and
  the step helper only committed the files it was given. I checked the new flag
  against a deliberately stale lockfile and it fails with "cannot update the lock
  file". The step helper now also stages a changed `Cargo.lock`.
- Step 3.24: `crates/karmania-io/tests/timing.rs` holds ignored timing tests for the
  readers on generated files of about a million elements, recorded in
  `docs/perf.md`. Importing and validating a million-row CSV takes about 1.1 s
  natively, a fifth of the brief's 5 s. The one worry is GeoJSON memory, about 20
  times the file size; it is left as it is (recorded, not fixed) because reading
  features one at a time is a bigger change that only matters for files over
  roughly 100 MB, and it needs the owner's view on whether such files are
  expected.
- Step 3.25a (owner decision after the M3 report): the repository is the core, so
  it carries a CRS identifier and does not interpret it. Projection and the EPSG
  definitions can be added later, together with features that need them. This step
  removes the projected plausibility check (inverse-projecting sample points to
  longitude and latitude), the UTM zone rule, the three `crs.projected.*` finding
  codes and the `proj4rs` dependency, with `thiserror` and the browser helper
  crates it brought along on wasm32. The snapshot for polygons now shows
  `crs.missing`, since its fixture had a CRS only to trip the removed check. The
  one-million-point validation time is unchanged in practice (about 300 ms; the
  `crs` group fell from 6 to 0.1 ms). Step 3.25b removes the rest of what needs the
  definitions. The earlier decision entries for steps 2.16 to 2.24 describe how
  these checks worked and are kept as history.
- Step 3.25b (owner decision): the EPSG definitions are out of the core. Removed the
  lookup (`epsg::lookup`, `CrsInfo`, `CrsKind`, `CrsUnit`), the `crs.epsg.unknown`
  check and the `crs.geographic.out_of_range` and `crs.geographic.axes_swapped`
  checks, and the `crs-definitions` dependency. Those checks need to know what a code
  means: whether it exists, and whether it is a longitude and latitude system.
  What is left of the CRS group is `crs.missing`, and any EPSG code is accepted as
  given (the readers still refuse code 0 and read the code out of GeoJSON `crs`
  members and `.prj` files, which needs no table). A GeoJSON file read with the
  assumed EPSG:4326 is therefore no longer checked for values that cannot be
  longitudes and latitudes, and the two checks the owner asked for after M2 (the
  UTM zone rule, and the range check as a warning) are gone with the data they
  relied on. If wanted later, a range check for EPSG:4326 alone needs no table and is
  about thirty lines. The resolved dependency graph fell from 36 crates to 15 and
  the core's WebAssembly build no longer carries about 4.8 MB of definitions, which
  settles the question of the size of the EPSG data.
- Step 3.25c: the plan for later milestones follows the owner's decision that the
  core does not know what an EPSG code means. Steps 4.12 (`search_crs`) and 5.10
  (`searchCrs()`) are dropped and kept in the list, marked, so step numbers do not
  move. The wizard's CRS step (8.8) takes an EPSG code typed as a number and shows
  where the file's own CRS came from, with no name, kind or units shown; the
  dataset summary (9.3) shows the code, or Local with its units. When definitions
  are added later, those are the places to extend.
- Step 4.1: `karmania-wasm` is built with `wasm-pack build --target web` (a module
  that a module Web Worker can load), as the brief says. `wasm-pack` 0.15.0 was
  already installed in `~/.cargo/bin`; it is still being released, which settled the
  question of whether the tool is maintained (the `rustwasm` GitHub organization was
  wound down in 2025, but `wasm-pack` and `wasm-bindgen` continue). On first use it
  downloads a matching `wasm-bindgen` command-line tool and `wasm-opt`, so a first
  build needs network access; this is recorded with the tools in
  `docs/dependencies.md`. The crate is both a `cdylib` (the module) and an `rlib` (so
  unit tests run natively). `unsafe_code` is not forbidden here, unlike in the core
  and io crates, because the generated bindings contain `unsafe`; the crate's own code
  writes none. The build output `pkg/` stays out of git. Loaded in Node with
  `initSync`, the built module returns its version; the empty module is 13.7 KB.
- Step 4.2: the findings and the validation report already serialize to JSON in
  exactly the shape the engine wants (optional fields are left out, never
  `undefined`, which is what `exactOptionalPropertyTypes` needs), so this step adds
  the TypeScript side: `packages/engine/src/types.ts` (`Finding`, `Location`,
  `ValidationReport`, ...) and a contract test. The test runs the committed Rust
  snapshot reports (`crates/karmania-core/src/validate/snapshots/*.json`, real kernel
  output) through strict checks that reject unknown keys, unknown severities and
  steps, a count below 1, more than 20 examples and the like, so a field added on
  the Rust side without a TypeScript type fails a test. The checks themselves are
  tested with bad input. The lists of severities, steps and check groups are
  defined once, in `types.ts`. The conversion to JavaScript values with
  `serde-wasm-bindgen` is not here: nothing can use it until there is an export that
  returns data, so the dependency and the helper arrive with `preview` in step 4.3,
  as the rule is to add a dependency in the step that first needs it. When they do,
  maps must be serialized as plain objects, not JavaScript `Map`s.
- Step 4.3a: the preview is assembled in `karmania-io::preview` (not in the
  bindings crate, which holds no logic) so it is plain Rust that runs and is tested
  natively. `preview(file_name, bytes, sidecars)` returns the detected format, the
  suggested kind, the encoding, the coordinate system with its source (`prj_file`,
  `geojson_default` or `geojson_crs_member`) and the file-level findings; for a
  delimited file it also returns a `table` holding the delimiter, header, the first
  200 rows, an estimated row count (counted by lines) and the suggestions for
  types, roles and "no data". The brief lists the table fields at the top level; they
  are nested under `table` here so that a consumer can test `preview.table` once
  rather than each field, and because they only exist for delimited text. Other
  formats are not parsed: a GeoJSON file is parsed only if its text mentions `"crs"`
  (otherwise the standard's default applies), an ASCII grid has just its header read
  so header problems show at the file step, and an OBJ is left to the import. The
  coordinate system is chosen in this order: the GeoJSON `crs` member, a `.prj`
  sidecar, the GeoJSON default; a `crs` member that cannot be used gives a warning and
  no system, and a sidecar is not used to fill in for it. Only a `.prj` sidecar is
  used, matched by extension in any case. The delimiter and header are not settings
  of the import mapping, so the import will detect them again from the same bytes,
  which gives the same answer. Previewing a 46 MB, 1,000,000-row CSV takes 54 ms
  (target: under 1 s); the preview is also part of the malformed-input suite.
- Step 4.3b: `preview` is exported to JavaScript as `preview(fileName, bytes,
  sidecars)`, where `sidecars` is an array of `{ name, bytes }` (or absent). The
  bindings crate does no work of its own: it reads the arguments, calls the Rust
  preview and turns the result into plain JavaScript values with `serde-wasm-bindgen`,
  configured so maps become objects and absent fields are absent, never `undefined`. A
  file that cannot be read gives a preview with no format and a finding; only misuse
  (sidecars that are not `{ name, bytes }` objects) throws. The build now writes into
  `packages/engine/wasm` (git-ignored, with `--no-pack`) so the engine owns its
  artifacts and imports them locally. The generated types call every result `any`;
  the tests wrap the module in a small typed facade that returns `unknown`, and
  check each result with a strict runtime check for `Preview` that rejects unknown
  fields, as for findings. Because the engine's type checks and tests now import the
  built module, `pnpm check` and CI build it first (CI installs a prebuilt `wasm-pack`
  with a pinned action). The tests run the real module in Node on every sample file
  and cover the sidecar path, files that cannot be read and misuse. I broke the
  sidecar handling in the glue to see the tests fail, and they did. The release
  module is 219 KB.
- Step 4.4a: `Dataset::summary(findings)` in `karmania-core` gives a `Summary`: id,
  name, kind, element count, vertex count (lines, polygons and meshes), CRS (the code,
  or Local with units: there is no name or units lookup any more), `has_z`, bounding
  box, attribute columns (name, type, null count) and the findings. It was planned for
  step 4.11 but a load result carries summaries, so it comes first. Per-vertex
  attribute columns are not listed: nothing shows them in phase 1. The JSON uses
  camelCase and leaves out what is absent, so `crs`, `bbox` and `vertexCount` are
  omitted rather than null.
- Step 4.4b: `Registry` (in `karmania-io`, plain Rust) holds the loaded datasets.
  `load(datasets, context)` validates them and, if nothing has an error, stores them
  under new identifiers (starting at 1, in the order given, never reused after a
  removal) and returns `Loaded { summaries }`; otherwise it returns `Blocked {
  findings }` and stores nothing. Loading is all or nothing for the datasets given
  together, because they came from one file and a half-loaded file would be
  confusing; and a failed load does not use up identifiers. `context` is the findings
  about how the datasets were made (reading problems); an error there blocks too, and
  it is attached to every dataset loaded, so a mixed GeoJSON file's notes appear on
  each of its datasets. Blocked findings are the context first, then each dataset's
  validation findings in order; they do not name the dataset, which only matters for
  multi-dataset files. A summary is worked out once at load time, since a loaded
  dataset never changes, so listing the datasets does not rescan their coordinates.
  `LoadResult` serializes as `{ status: "loaded", summaries }` or `{ status:
  "blocked", findings }`, as the brief's contract says.
- Step 4.4c: `ImportJob::file(file_name, bytes, mapping)` makes a job from a file's
  raw bytes: it detects the format, decodes the text and, for a delimited file,
  sniffs the delimiter and header, with the same code as the preview, so a mapping
  made from a preview names the columns the import reads. The mapping is used by CSV
  only; GeoJSON, ASCII grids and OBJ meshes ignore it in the reader (the run in step
  4.4d applies the dataset name and coordinate system from it). What was found before
  the reader ran (a name that disagrees with the content, an encoding fallback) comes
  first in the result's findings. A file that cannot be imported, including a `.prj`
  (which names a coordinate system and holds no data), gives a job that finishes in
  its first step with an error and no dataset. File jobs are part of the malformed-input
  suite.
- Step 4.4d: `ImportRun` is a whole file import in two stages. Parsing wraps the
  import job (a bounded number of CSV rows per step, or the whole file in one step for
  the other formats); validating then checks one dataset per step, so a file with
  several datasets reports progress through them. Progress carries the stage (`parsing`
  or `validating`) and a fraction of that stage; reading the file from disk happens
  before the kernel sees it and is the caller's stage. The name and coordinate system
  the user chose in the wizard are applied to the datasets after parsing, for every
  format: a name given to a file that makes several datasets gets the kind added
  (`Survey (points)`), a blank name keeps the reader's, and no coordinate system keeps
  the one the file named. The run does not decide whether to load: it ends with
  `Imported`, the datasets each with their validation report and the reading findings,
  and the registry blocks or admits them. A run that cannot read the file ends at its
  first step with no datasets and the reason. The run is in the malformed-input suite,
  which also checks that it always finishes.
- Step 4.4e: the state behind the engine, a `Kernel` holding the registry and the
  imports in progress, is plain Rust in `karmania-io` rather than in the bindings
  crate, because it contains a rule that needs testing (a finished import is forgotten
  and its datasets go into the registry, which validates or blocks them). The
  JavaScript object in step 4.4f is a thin wrapper around it. `start_import` takes
  the file name, bytes and mapping and returns an import identifier (from 1, never
  reused); `step_import(id, budget)` returns `progress` (stage and fraction) or
  `done` with the load result, and `None` for an identifier that never existed,
  finished or was cancelled; `cancel_import` drops the import. Imports can run side
  by side and be stepped alternately, and two kernels share nothing (no globals).
- Step 4.4f: the kernel is exported as a `Kernel` class (`new Kernel()`, `free()` to
  release it) with `startImport(fileName, bytes, mapping)`, `stepImport(id,
  budgetRows)`, `cancelImport(id)` and `datasets()`, named in camelCase for JavaScript.
  It is a thin wrapper over the Rust kernel of step 4.4e. Results are plain objects:
  a step gives `{ status: "progress", phase, fraction }` or `{ status: "done", result
  }`, where `result` is `{ status: "loaded", summaries }` or `{ status: "blocked",
  findings }`. Only misuse throws: an import id that does not exist, or a mapping
  missing a required field. The TypeScript types (`Summary`, `LoadResult`,
  `ImportStatus`, `ImportMapping`, ...) are checked by strict runtime checks against
  every result in tests that run the real module in Node: they import the sample
  files, check progress through both stages, a blocked file, a GeoJSON file that makes
  three datasets, a grid and a mesh with a chosen coordinate system, cancelling, kernels
  that share nothing, and a budget of zero. One thing found: `serde-wasm-bindgen`
  ignores a field the Rust type does not know even though `ImportMapping` says
  `deny_unknown_fields` (which `serde_json` does enforce), so a misspelled optional
  field would pass the boundary unnoticed. The TypeScript `ImportMapping` type, which
  the engine will use, is what guards against that, so the check was left there. The
  stage names are `parsing` and `validating`; the brief's `reading` stage, reading the
  file from disk, belongs to the engine that calls the kernel.
- Step 4.5a: datasets made from arrays are built in `karmania-io::build` as plain
  Rust. A column is a name, typed values and optional null flags (`true` = null, the
  same sense as the page format in the brief); the column types are the five of the data
  model, and whole numbers are `i64`, so nothing is lost beyond 2^53 (the bindings
  will take a `BigInt64Array`). `build_points` makes a points dataset. A problem with
  the arrays themselves (coordinate lists of different lengths, null flags that do not
  match their values, a column name empty or used twice, columns of different lengths)
  is a finding and no dataset; a problem with the data (no coordinate system, a
  coordinate that is not a number, attribute rows that do not match the points) is
  found by validation when the dataset is loaded, like for a file. A blank name becomes
  the name of the kind. `Kernel::load_points` builds, validates and loads, returning
  the same `LoadResult` as an import.
- Step 4.5b: points are loaded from JavaScript with `kernel.loadPoints(name, crs, x,
  y, z?, columns?)`, where `x`, `y` and `z` are `Float64Array`s and `crs` is a
  coordinate system object, `null` or `undefined` (validation reports a missing one).
  Attribute columns are built in a `ColumnSet`, an object with one method per column
  type: `addFloat` (`Float64Array`), `addInt` (`BigInt64Array`), `addBool` (`Uint8Array`
  of 1 and 0), `addText` (array of strings) and `addCategory` (`Uint32Array` of codes
  plus a dictionary), each with an optional `Uint8Array` of null flags (1 = null).
  Typed arrays cross the boundary in one copy each, not element by element; the engine
  (step 5.8) will turn a plain array of numbers or strings into the right typed array.
  The `ColumnSet` is used up by the load call. The result is a load result, as for an
  import. The bindings crate is now split into `columns`, `kernel`, `preview` and
  `convert` modules, with `lib.rs` as the index. Tests load points with a column of
  every type (including nulls and a whole number past 2^53), without a coordinate
  system, with coordinate lists or columns that do not fit, with non-numeric
  coordinates, with warnings, and with a coordinate system of the wrong shape (which
  throws, as misuse). Inverting the meaning of the null bytes in the glue makes a test
  fail.
- Step 4.6: datasets built from arrays are loaded with one call, `kernel.load(input)`,
  where `input` is one object: `{ kind, name, crs, x, y, z?, ..., columns? }` with typed
  arrays for the numbers and a list of column objects (`{ name, type, values, nulls? }`;
  a category column has `codes` and `dictionary`). This replaces the `ColumnSet` class
  and positional `loadPoints` of step 4.5b, which would not have scaled: lines need
  eight arguments, grids and blocks more, and the lint against more than seven function
  arguments is there for a reason. One object is also the shape the engine will build
  and pass on from the worker. The glue reads it field by field and throws, naming the
  field, for anything of the wrong shape (a missing field, a plain array where a typed
  array is needed, an unknown kind or column type). Typed arrays are recognised by their
  type tag rather than `instanceof`, so arrays that came from another window or worker
  are accepted, which a test checks with arrays from a separate realm. The TypeScript
  type of the object is `KernelDataset` (points and lines so far; the other shapes
  follow in steps 4.7 to 4.10). Lines take `offsets` (a `Uint32Array`, one more entry
  than there are lines), attribute columns per line and optional `vertexColumns` per
  vertex. Offsets that do not fit the vertices are left to validation, which names the
  problem; a one-vertex line loads with a warning.
- Step 4.7: polygons are loaded with `kind: "polygons"`, `x`, `y`, `z?`, `ringOffsets`
  and `polygonOffsets` (both `Uint32Array`s with one more entry than there are rings and
  polygons) and one attribute value per polygon. Rings are open, as in the data model:
  the closing vertex that repeats the first is not given (the GeoJSON reader already
  drops it). Ring or polygon offsets that do not fit, a ring of fewer than three
  vertices and a polygon without rings are left to validation, which names each; the
  tests check every one of them through the real module. As for lines, coordinate lists
  of different lengths make no dataset at all.
- Step 4.8: a mesh is loaded with `kind: "mesh"`, `x`, `y`, `z` (required: a mesh is
  always three-dimensional), `indices` (a `Uint32Array`, three vertex numbers per
  triangle, counting from 0), one attribute value per triangle and optional
  `vertexColumns`. Indices out of range or not a multiple of three are errors found by
  validation; a flat (degenerate) triangle is a warning and a vertex no triangle uses is
  info, and both load. A mesh with no `z` is refused as misuse, since the type requires
  it.
- Step 4.9a: validation gained two structure errors for grids, `grid.elevation_column.missing`
  and `grid.elevation_column.not_numeric`. A grid's elevations can come from a column
  of its attribute table (`GridZ::FromColumn`), but nothing checked that the column
  exists or holds numbers, so a grid could name a column that was not there and still
  load, with its elevations quietly ignored in the bounding box. This was noticed while
  designing the grid builder. It is a core check, not a builder check, so every way of
  making a grid is covered. Whole numbers and decimals both count as numbers. A flat
  grid and every other shape are not affected.
- Step 4.9b: a grid is loaded with `kind: "grid"`, a lattice (`origin`, `spacing`,
  `dims` and an optional `rotation` in degrees), its cell values as columns (one value
  per cell, X fastest, then Y, then Z; a 2D grid has 1 along Z) and either `elevation`
  (every cell at that height; 0 if neither is given) or `elevationColumn` (the name of
  a numeric column holding the height of each cell), not both: giving both is refused
  as misuse. The three-number fields accept a plain array or a typed array, since they
  are tiny; `dims` must be whole numbers of 0 or more. A lattice with a zero count, a
  cell size at or below 0, or a position or rotation that is not a number, values for
  the wrong number of cells, and a missing or non-numeric elevation column are all
  found by validation and block the load; a grid whose cell count does not fit in a
  `u64` or exceeds the limit is refused by the size guard without any cell being made
  (4,000,000,000 x 4,000,000,000 x 2 is tested). Rotation is applied about the origin,
  and the bounding box follows it.
- Step 4.10: a block model is loaded with `kind: "blocks"`, a lattice (as for a grid),
  and attribute columns with one value per block. Without `ijk` the model is dense: a
  block in every cell, values in lattice order (X fastest, then Y, then Z). With `ijk`
  (a `Uint32Array` of `i, j, k` triplets) it is sparse, and the values follow the order
  of the triplets. Blocks outside the lattice, blocks listed twice, an incomplete last
  triplet, values for the wrong number of blocks and a lattice that cannot be used are
  found by validation, which names each. A sparse model on a huge lattice (100,000
  cells along each axis) loads, because only its blocks exist and the check for
  repeats sorts instead of using one bit per cell; a dense model too big to hold is
  refused by the size guard before any block is made. The bounding box of a model is
  its whole lattice, sparse or not. This completes the builders (steps 4.5 to 4.10).
- Step 4.11a: `Dataset::page(start, count)` gives a window of rows: the geometry
  columns first, then the attribute columns, as the brief lists them (points `X Y Z`;
  lines `line #` and `vertex count`; polygons `polygon #`, `ring count` and `vertex
  count`; mesh `triangle #` and `v1 v2 v3`; grid `i j`, `k` and `cell centre X Y`; blocks
  `i j k` and `centre X Y Z`). Choices made where the brief was silent: a 2D point set
  has no `Z` column and a one-layer grid no `k`; a sparse block model reads its cell from
  its triplets and a dense one from the row number; rotated lattices give rotated
  centres. Indices are shown as stored, counting from 0, following the convention that
  only source-file line numbers are 1-based; the data table's own row-number column
  (step 9.4) is separate and 1-based. This is easy to change if 1-based reads better
  to geoscientists. Values come as `Float64` (decimals, and whole numbers, which lose
  digits beyond 2^53), `Int32` (counts and indices), `Bool` as 0/1 bytes and text; a
  category shows its text. A null has a placeholder value and a 1 in `nulls`, and so
  does a category whose code is outside its dictionary (validation rejects those before
  a dataset loads). A start past the end gives an empty page that still names its
  columns; a count past the end or past 100,000 rows is cut short and the page says how
  many rows it holds.
- Step 4.11b: the kernel object gained `rows(datasetId, start, count)`,
  `summary(datasetId)` and `remove(datasetId)`. A page comes back as `{ start, count,
  columns: [{ name, values, nulls }] }` with `values` a `Float64Array`, `Int32Array`,
  `Uint8Array` or array of strings, built by hand in the glue so the numbers cross as
  typed arrays rather than being converted one by one; `nulls` is always a `Uint8Array`.
  `rows` for a dataset that does not exist throws (misuse); `summary` for one returns
  `undefined`, so a caller can ask without catching; `remove` returns whether there was
  one, and the identifier is never given again. The tests page an imported CSV, a GeoJSON
  file that made three datasets, and builder-made datasets of every shape, and check each
  page against a strict contract check (typed arrays of the right length for the number of
  rows, nulls that are only 0 or 1, unique column names).
- Step 4.13: the Node smoke test takes one sample file per format (a points, a lines
  and a block-model CSV, a GeoJSON file that makes three datasets, an ASCII grid and a
  mesh) through the whole path the wizard will use, against the built module: preview,
  a mapping made from nothing but the preview's own suggestions (its roles, "no data"
  values and decimal separator), import, the summaries the kernel lists, every row read in
  pages of three until the count matches, and removal. A second case uses a `.prj`
  sidecar for the coordinate system, and one whose `.prj` has no EPSG code, which leaves
  the wizard with no system and the import blocked with `crs.missing` instead of guessing.
  The suggestions were good enough to import all three CSV samples with no error, so the
  preview and the import agree. Together with the earlier Node tests this closes M4.
- Step 4.14: an opt-in test (`KARMANIA_TIMING=1`) times the built module in Node on a
  million-row CSV: the preview takes 143 ms (target under 1 s) and the import with
  validation 1.7 s (target under 5 s), so both targets hold with room to spare inside
  WebAssembly on this laptop. It is not run by default for the same reason as the Rust
  timing tests. The final measurement in a browser is step 10.3.
- Step 4.15 (owner decision after the M4 review, superseding the "counting from 0" in
  4.11a): the numbers a page shows count from 1, as a person counts. That covers `line #`,
  `polygon #`, `triangle #`, the vertex numbers `v1` to `v3`, and the cell numbers `i`, `j`
  and `k` of grids and blocks. Everything inside the kernel stays 0-based: `Page.start` is
  still an offset to ask for, the mesh builder still takes vertex indices from 0, and the
  `element`, `row` and `vertex` of a finding's location are still 0-based, so whoever shows
  a location adds 1 (only `line` was ever 1-based). `docs/conventions.md` says so.
- Step 4.16 (owner decision after the M4 review, qualifying 3.25b): a range check for
  EPSG:4326 alone is back, as the owner allowed provided it stays minimal and the
  assumption is written down. `crs.geographic.out_of_range` and
  `crs.geographic.axes_swapped` are warnings again, with the same wording, thresholds
  and examples as before 3.25b: longitude from -180 to 360, latitude within 90, a
  per-position count with the first examples located, and the swapped-axes warning
  instead when the values only fit the other way round. A grid or a block model is
  judged by its extent. **The assumption:** the core treats the code 4326 and no other
  as a longitude and latitude system (`GEOGRAPHIC_EPSG_CODE` in
  `validate/crs_checks.rs`), because it has no definitions to ask. Other geographic
  codes (NAD83 4269, ETRS89 4258, ...) are accepted without a range check, and so is
  every projected code, as before. A GeoJSON file with no `crs` member is EPSG:4326, so
  it is checked again. When EPSG definitions return, replace the constant with a lookup
  of the system's kind; the checks, codes and tests stay.
- Plan for M5 (the engine), with the choices the brief left open:
  - The worker is a small shell around a *handler* that takes the kernel and a
    `post` function, so it can be tested in Node. The tests connect the client and
    the handler through a real `MessageChannel` (real structured cloning and
    transfer) with the real WebAssembly kernel; only the browser test (5.11) runs
    the real `Worker`.
  - `importFiles(files, mapping)` imports one data file; the other files may only be
    sidecars (a `.prj`), because one mapping describes the columns of one file and
    the coordinate system is already in the mapping. Two data files are misuse and
    throw. The sidecars are not read at import time.
  - An abort settles the promise with what really happened: an import is stopped
    between steps and rejects with the signal's reason; a call that already finished
    in the worker resolves with its result, as `fetch` does. A `load` cannot be
    interrupted, so aborting it only helps before it starts.
  - `load` transfers the typed arrays in a dataset input to the worker (the brief asks
    for transferables, and a large dataset must not be copied on the main thread). The
    arrays become empty in the caller's code, so an input can be loaded once; loading
    it twice is misuse and throws. Pages come back to the main thread the same way.
  - A column of mixed types in a builder (numbers and strings, say) is a mistake in
    the code that builds the data, so the builder throws a `TypeError` naming the
    column and the first value that does not fit; it is not a finding.
  - Progress has three phases: `reading` (the worker reading the file, with a real
    fraction), then the kernel's `parsing` and `validating`.
- Step 5.4: `createEngine({ workerUrl?, wasmUrl? })` starts a module worker (the
  `new Worker(new URL(...), { type: "module" })` form that bundlers turn into a worker
  script) and wraps it in a port; `createEngineOnPort` takes any port and is what the
  tests use, so the public options stay exactly the brief's. A `wasmUrl` is made
  absolute against the page before it is sent, since the worker would otherwise resolve
  it against its own address. The `init` request is sent at once; calls that arrive
  before the worker is ready wait for it, and if it cannot start, the first call
  rejects with the reason. Without `Worker` (in Node, say) `createEngine` throws a
  message saying it needs a browser. After `dispose` the synchronous calls
  (`datasets`, `on`) throw an `EngineDisposedError` and the asynchronous ones reject
  with it; calls under way reject, and no listener hears anything more.
  This step gives every method a first, working form, so that every commit has a whole
  engine: `preview` takes each file alone, `importFiles` takes one file, `load` copies
  its arrays and `rows` asks the worker each time. Steps 5.5 to 5.9 each replace one of
  these with the full behaviour and its tests.
- Step 5.8a: the builders give each attribute column the type a CSV import would give
  the same values: whole numbers that a 64-bit integer holds exactly are `int` and other
  numbers `float`; true and false are `bool`; text with at most 50 different values, each
  appearing twice or more on average, is a `category` (numbered in order of first
  appearance), and other text is `text`; `null` is a missing value of any type, and a
  column that is all `null` or empty is `float`. A `Float64Array` is taken as it is, as a
  `float` column, and the other typed arrays are read as numbers. Coordinates and offsets
  that are already typed arrays are not copied (loading transfers them, see 5.8b). Mixed
  kinds, a value that is none of the kinds, and a position that is not a whole number from
  0 to 4,294,967,295 make the builder throw a `TypeError` that names the column or list
  and the place counting from 1: they cannot be put in a dataset (a wrapped-around offset
  would change the data silently), and everything else, such as lengths that do not match,
  is left to the kernel to report as a finding.
- Step 6.1: `@karmania/ui` is the component library and `@karmania/app` hosts
  `gallery.html`, which shows the components in isolation (step 7.1 adds the real app to
  it). Components are written without decorators: reactive properties are declared in
  `static properties` and typed with `declare` fields, which behaves the same under every
  TypeScript setting. Custom elements are named with a `k-` prefix, like the `--k-`
  tokens (the app's root is `<karmania-app>`, as the brief says). Vite 8 is built on
  Rolldown, so the build options are `rolldownOptions` (the old name is deprecated and
  lint rejects it); the UI library is built as an ES module with Lit left external.
  `pnpm check` and CI now also run every package's `build`, so a broken build is caught
  at once. The gallery's browser tests use port 4174, the engine's use 4173.
- Step 6.2 (tokens): colors were chosen by measuring WCAG contrast, not by eye, and
  `tokens.test.ts` re-measures them from the CSS: text, the muted text and the state
  colors are at least 4.5:1 on all three surfaces in both themes, the boundary of a
  control at least 3:1. The dark values are written twice in `tokens.css` (once for the
  system preference, once for a forced `data-theme="dark"`) because CSS cannot share a
  block between two conditions; the test requires the two copies to be identical.
- Step 6.3 (base styles): the page and the components need different things. The page
  gets `base.css` (font faces, typography, scrollbars); a component adopts `sharedStyles`
  (box sizing, the focus ring, native controls that follow the font), because a page's
  rules do not cross into a shadow root and `@font-face` is ignored inside one. Both are
  built from the same `shared.css`. Inter is a variable font, so 400 and 500 come from
  one file; `font-display: block` makes text wait a moment for the font rather than show
  in another font and then shift. Tabular numerals are on for the whole page. Reduced
  motion needs no extra rule: every transition uses `--k-motion-duration`, which is 0
  under `prefers-reduced-motion`, and a test fails any `transition` or `animation` that
  does not. Scrollbars use the standard `scrollbar-width` and `scrollbar-color`, which
  inherit into shadow roots; the `::-webkit-scrollbar` pseudo-elements do not.
- Step 6.4 (icons): the registry in `components/icons.ts` lists each icon in three
  places (the import, the name list and the table) and the compiler requires all three, so
  an icon cannot be half added. Lucide's drawings are imported as text and only the shapes
  inside their `<svg>` are used; the component draws its own `<svg>` so that the size comes
  from the `--k-icon-size-*` tokens (new in this step: 16 and 20) and the color from the
  text around it. An icon is `aria-hidden` unless it has a `label`, when it becomes an
  image with that name; an unknown name draws nothing instead of throwing, since it may
  arrive from an attribute. Elements register through `defineOnce`, which does nothing
  without a page, so the package can be imported in Node tests. A unit test now scans every
  style in the UI for raw colors and lengths, so the "no magic numbers" rule is checked, not
  just stated. Accessibility is checked with axe through `e2e/support/axe.ts`, which looks
  inside shadow roots when given a path of selectors; it was seen to fail on an image with
  no alt text before it was trusted to pass.
- Step 6.5 (button): `k-button` wraps a native `<button>` in its shadow root, so focus,
  Enter and Space, `disabled` and the accessible role are the browser's own, and
  `delegatesFocus` lets `element.focus()` reach it. "Icon-only needs an aria-label,
  type-enforced" is done in two layers: the `kButton()` template helper takes a union in
  which an icon alone must have a `label`, so the omission does not compile (checked with
  `@ts-expect-error` cases in `button.test.ts`), and the element throws at runtime if it
  ends up with neither text nor a label, since a page that is not written in TypeScript can
  still make that mistake. Every variant has a border (transparent for ghost) so all are the
  same size; hover and pressed colors of the primary button are mixed from the accent and
  the text color (`color-mix`), so they follow the theme, and the tests measure that text
  stays at 4.5:1 in every state. The brief asks both for compact 28 px controls and for a
  32 x 32 focusable area on icon buttons; a compact icon-only button is 28 px (so it lines up
  with its neighbours) and its pointer target is extended to 32 px with a pseudo-element, which
  the tests probe. A label that does not fit is cut with an ellipsis; the accessible name
  stays whole. Icon size: 16 beside words and in compact buttons, 20 for an icon alone in a
  default button.
- Step 6.6 (tabs): the tab buttons and the panels are in one shadow root, because an ARIA
  reference (`aria-controls`, `aria-labelledby`) cannot point across a shadow boundary; the
  page's content reaches a panel through a slot named after the tab's id. Inactive panels
  are hidden, not removed, so a table's scroll position or a text box's contents survive
  switching tabs. Tabs choose as they take focus (automatic activation, as the pattern allows
  when a panel is cheap to show), wrap round at the ends, and only the chosen tab is in the
  Tab order. The chosen tab is underlined as well as darker, and the underline is inside the
  tab and the weight never changes, so choosing a tab shifts nothing (the tests measure
  positions from the row, since a click may scroll the page). The focus ring is drawn inside
  the tab, where an `overflow` ancestor cannot clip it. Tab height, 40, is a token because it
  is also the height of the panel header. Like the button, tabs throw on a mistake in the
  page: two tabs with the same id, or a row with no label. A panel is not made focusable
  itself; when the app's panels hold scroll regions, axe will say whether they need that.
- Step 6.7 (tooltip): the bubble is a `popover="manual"` element, which the browser draws in
  its top layer, so no ancestor's `overflow: hidden`, transform or stacking context can clip
  it; the test puts a trigger inside a box that does all three and checks, with a probe that
  was seen to detect an ordinary element being clipped, that the bubble sticks out of it. Where
  it goes is a pure function (`placeTooltip`: above if it fits, else below, then slid into the
  window a margin from the edges) tested in Node on its own, and in the browser at the corners
  and edges of two window sizes. The behaviour follows WCAG 1.4.13 for content that appears on
  hover: it is dismissible (Escape), hoverable (the pointer can move onto it) and persistent
  until the pointer or focus leaves. Keyboard focus shows it but the focus a click leaves
  behind does not (`:focus-visible` on the element that took focus). It appears at once: a
  delay would be a number outside the tokens. An ARIA reference cannot cross into the tooltip's
  shadow root, so the bubble is `aria-hidden` and the control is given the text as
  `aria-description` only when it differs from the control's own name, which for an icon button
  it usually does not, so nothing is read twice. A control near the edge gets a tooltip that is
  slid in rather than centred on it, which the tests check on purpose.
- Step 6.8 (layout helpers): the overflow check found two real problems the first time it was
  run on the gallery, which is the point of having it. The icon grid's cells were 48 px wide for
  a name like `chevrons-right`, so they were widened and the names allowed to wrap. And the
  pointer target I gave compact icon-only buttons in 6.5 (an invisible `::after` reaching 32 px)
  counts as scrollable overflow, so a button at the edge of a scrolling panel would have made
  it scroll by two pixels. That approach is superseded: an icon-only button is now never smaller
  than the 32 px hit target, so a compact one is 32 x 32 rather than 28, and the pseudo-element
  is gone. The cost is that a compact icon button is taller than the compact text buttons beside
  it; rows are aligned on their centre line, and the row test says so. The checks work through
  shadow roots, use a one-pixel tolerance for rounding in scroll sizes and half a pixel for
  positions, and take a baseline from the first line of text's box and the font's descent, so
  it holds through slots. Native text boxes are exempt from the overflow check, since scrolling
  their own text is what they are for, and so are the document and body, whose scrolling is the
  window check's business.
- Step 6.9 (empty state): every part (icon, heading, line, action) is optional, so the same
  component serves the map area ("No data yet"), the Legend tab (a line alone) and later
  panels. The heading is a styled paragraph, not a heading element, so that placing the
  component does not disturb the page's heading order. The spacing is the brief's: 8 between
  parts, 16 before the action (the flex gap plus 8 more), and the tests measure it. The text
  sits in a column no wider than 288 px so a line does not stretch across a wide window.
  Content that is still too tall once wrapped, which only long text in little room produces,
  scrolls rather than overflowing: the element is a scroll region, and centres its content
  with an auto margin rather than `justify-content: center`, because the latter leaves the
  top of overflowing content unreachable. The 32 px icon needed an icon size, so
  `--k-icon-size-lg` is new and `k-icon` accepts size 32.
- Step 6.10 (screenshots): Docker is available here, so the baselines come from the official
  Playwright image, as the brief asks. Only the browser is in the container: it runs
  Playwright's server and the tests, on the host, drive it over a websocket, so the macOS
  `node_modules` need not work in Linux and CI uses the very same script. The container
  reaches the host's preview server as `host.docker.internal`, which Vite's host check would
  otherwise refuse, so the preview allows that name (it is a throwaway test server). Because the
  browser is always the one in the image, there is one set of baselines whatever the platform of
  the machine running the tests, so the snapshot path has no platform suffix. The comparison is
  tight (a pixel may differ by 5% in colour, and none beyond that); a one-pixel change in a gap
  was seen to fail it. The `visual` project only exists when `PW_VISUAL_WS` names a browser, so a
  plain `playwright test` runs the ordinary tests and never compares pictures taken by another
  browser. 25 states are photographed at 6 layouts: 150 pictures, 1.1 MB. Reviewing them as the
  brief requires turned up one thing to fix: the browser's own text box, used in the tabs demo,
  had a faint boundary in the dark theme, so it is now drawn with the tokens. In this review
  nothing else bled, clipped, overflowed or overlapped, rows and baselines lined up, focus rings
  were whole, and nothing moved between states of one control.
- Step 7.1 (app page): `index.html` mounts `<karmania-app>` from `src/main.ts`, and the Vite
  build now has two pages, the app and the gallery. Reading `?theme=light|dark` moved out of
  the gallery into `src/theme.ts`, so both pages force a theme the same way (the layout helper
  already promised this). For now the app shows only its name in an `h1`; the shell replaces
  that in 7.2. The smoke test (`e2e/app.e2e.ts`) checks the title, the language, that the
  element is registered and rendered, that nothing is logged as an error, the theme switch, and
  axe in both themes. Each of its checks was seen to fail when the thing it checks was broken
  (the theme call removed, the element renamed).
- Step 7.2 (shell grid): the app is two rows, the toolbar (`--k-toolbar-height`, 48) and the rest,
  and the rest is two columns, the map area (`minmax(0, 1fr)`, so that nothing inside it can push
  the panel out of the window) and the panel (`--k-panel-width`). That variable is not set yet and
  falls back to the new token `--k-panel-width-default` (360); the app sets it once the panel can be
  resized (7.8). The map area and the panel are already elements of their own, empty
  (`karmania-map-area`, `karmania-panel`), so that the next steps fill them instead of
  restructuring the grid. They are landmarks: the toolbar is the banner, the map area is `main`,
  and the panel is a complementary region called "Side panel". The step says the toolbar has no
  content yet, so the 7.1 smoke test no longer looks for the `h1`; the wordmark of 7.3 brings
  it back, with its own check. The checks of `styles.test.ts` (no raw colors, lengths or durations)
  now read the app's CSS as well as the UI package's.
- Step 7.3 (toolbar): the name is the page's `h1` (16/24, medium) and the Import button is
  `<k-button>` in its secondary variant with the upload icon; clicking it does nothing yet, since
  opening the wizard is step 8.2. The toolbar is 48 high including its 1 px border, so the
  contents would sit on 7.5 px (a half pixel, blurred at the edges) if they were centred in what
  is left; the toolbar has the same 1 px of padding above that the border takes below, which puts
  the 32 px button at 8 and the 24 px name at 12, centred on the 48 and on whole pixels. The
  test measures that, and was seen to fail (11.5) without the padding. The name and the button
  are centred on each other rather than aligned on a baseline, since the name is not a control;
  the spec's baseline rule is for controls in a row.
- Step 7.4 (map area): the empty state is `<k-empty-state>` with the `map` icon, the title "No data
  yet", the line "Drop files here or use Import" and a second Import button (secondary, as in the
  toolbar), so the spacing of 8 and 16 and the centring come from the component and are measured
  here, in place, in every layout. The brief also says what the area shows once data is loaded
  ("Map rendering arrives in phase 2" and the number of datasets), and no later step in the
  roadmap did that, so the area has a `datasets` property that switches between the two (the
  button is left out when there is data, since the toolbar still has one) and step 8.12 now says
  to set it. Nothing sets it yet; the tests set it directly. The map area is the page's `main`
  landmark, called "Map".
- Step 7.5 (drop zone): the outline and its label are always in the map area and only become
  visible, absolutely positioned 8 px inside its edges, so showing them cannot change a layout;
  `pointer-events: none` keeps them from stealing the drag. They have a tinted background that
  covers the empty state while they are shown, so that the label does not sit on top of its text.
  The test records the box, the content size and the scroll position of every element of the app
  (through shadow roots, apart from the overlay) before and during a drag and requires them to be
  the same, in all six layouts; it was seen to fail when the overlay joined the flow while shown.
  Moving the pointer from one part of the area to another fires `dragenter` for the new part
  before `dragleave` for the old one, so the area counts how many parts the drag is over. Only
  drags that carry files count: text dragged over the area is ignored. Files dropped anywhere
  else are refused at the window (cancelled, with the drop effect `none`), because the browser
  would otherwise open the file in place of the app and its state would be lost. The drop itself
  is taken and discarded for now; passing the files on is step 8.2. A script cannot start a real
  drag from outside the page, so the tests fire the drag events; the browser keeps `dropEffect`
  at `none` for a `DataTransfer` that was not made by a real drag, so those tests record what
  the page sets it to instead. How the pointer looks during a real drag is not tested.
- Before step 7.6 (`k-tabs`): the side panel needs its collapse button on the same row as the
  tabs, and a body that fills the rest of the panel and scrolls, and `k-tabs` could do neither.
  It now has a slot `actions` at the far end of the row (a tab can therefore not be called
  `actions`, which throws like the other mistakes in the page), the row gives way to it by
  cutting tab labels short, and the element is a column, so that given a height it gives the
  chosen panel what the row leaves; what is in the panel can scroll in that. Without a height it
  is as it was, and the 25 existing screenshot states are unchanged to the pixel. The row has no
  padding of its own and exposes itself as `part="header"` so that a page can give it some, as the
  panel will (a part, not a property, since the space is the page's business). The new gallery
  demos have their own tab names so that the existing tests' locators stay unambiguous.
- Step 7.6 (panel tabs): the panel is a `k-tabs` of Legend and Data in an `aside` called "Side
  panel" (the tab row is "Panel tabs", so that the two are not announced alike). The header is 40
  high, and the brief gives it a padding of 0 8 0 16 and also says that left text edges in the
  panel line up at 16. A tab has 12 px of padding of its own, so with 16 in the header the label
  would start at 28; the header has 4 at the start instead, which puts the label at 16 (measured
  from inside the panel's 1 px border), where the body's text will be. The 8 at the end is for the
  collapse button of 7.7, which is not there yet because it would do nothing. A 1 px divider is
  drawn under the row, inside it (an inset shadow), since the row and the body are the same color;
  the brief does not ask for one. The body is the `data-scroll-region`: 16 of padding, scrolling
  down only (`overflow: hidden auto`). `overflow-x: hidden` still lets a script scroll sideways,
  and `clip` cannot be combined with `auto`, so the test uses the mouse wheel and checks that
  there is no scrollbar and that the page does not move, which is what a person can do. The Data
  body is empty until M9 (9.1 puts its empty state there). The Legend's line wraps in the panel's
  width with its last word on a line of its own at the default width; balancing the lines would
  change the empty state's existing screenshots, so it is left. `assertAligned` has a new edge,
  `text-left`, for where text starts whatever box is around it; the panel test measures the first
  label with it.
- Before step 7.7 (`k-button`): the brief wants `aria-expanded` on the buttons that collapse and
  expand the panel, and a `k-button` could not say it, because its `<button>` is inside its shadow
  root where a page cannot reach it. It now has an `expanded` property (`true`, `false`, or unset
  for a button that opens nothing, in which case the attribute is left out), and `kButton` takes
  `expanded` too. It is a property and not an attribute because unset is a third state that an
  attribute would have to spell out. The button keeps its own name when its state changes, as
  the disclosure pattern asks.
- Before step 7.7 (`k-tabs` again): opening the panel from the rail should put the keyboard on
  the tab that was opened, and the panel cannot do that without reaching into the tabs' shadow
  root, so `focus()` on `k-tabs` now focuses the chosen tab (and does nothing if there are none),
  which is also where a person enters the row with Tab. Delegating focus to the first focusable
  thing in the row would have picked the first tab whichever was chosen.
- Step 7.7 (collapse to a rail): the app keeps `{ collapsed, tab }` and the panel shows it; a
  person's request (collapse, expand, a rail button, a tab) leaves the panel as a
  `karmania-panel-change` event and comes back as the new state, which the app also writes to
  `localStorage` under `karmania.panel`. Reading is as careful as for any outside text: no
  storage, a storage that throws on reading or writing, text that is not JSON or not an object,
  or a field of the wrong type each fall back to the default, field by field, and nothing is
  logged. That logic is plain functions (`panel-state.ts`, unit tests in Node), which is why the
  app now has Vitest (the version the UI package uses; no new package). The open view is hidden,
  not removed, when the panel is folded away, so what is in the bodies keeps its state, and it is
  out of the Tab order and the accessibility tree while hidden. In the rail, the brief says "8 px
  padding and 4 px gaps" for buttons that are 32 px (the minimum target) in a rail of 40: 8 can
  only be the padding above and below, so the sides have 4, which the panel's 1 px border takes
  one pixel of on the left (3 beside the border, 4 from the edge of the panel); the test measures
  4 from either edge. `aria-expanded` is on every button that folds or opens the panel: `true` on
  Collapse panel and `false` on the three buttons of the rail, each of which opens it. The brief
  gives Collapse and Expand different names, so the name does not change with the state. Where the
  keyboard goes matters, since the pressed button disappears: Collapse puts it on Expand panel,
  Expand puts it on Collapse panel, and a tab's rail button puts it on that tab. It does this only
  for a change a person asked for, so a change made some other way leaves focus alone. A known edge:
  a button that had keyboard focus and is then clicked with the mouse hands its `:focus-visible` to
  the button that replaces it, so that button's tooltip stays until focus moves on. `kButton` takes
  an `onClick` now.
- Step 7.8 (resize handle): the handle is its own element, `karmania-resize-handle`, laid over
  the edge of the panel by the app (a sibling of the map area and the panel, which neither knows
  about it), and the app keeps the width with the rest of the panel's state. The handle only asks
  for a width (`karmania-resize`); the app limits it (280 up to the least of half the window and
  640, whole pixels), keeps it, and tells the handle the width, the limits and the usual width
  back, which is what its `aria-value` attributes say. The strip is 6 wide: 3 either side of the
  panel's outer edge, which puts the 1 px border on the panel's side (a strip centred on the
  middle of a 1 px border would be on half pixels). The line is 2 wide and sits on the edge, one
  pixel over the map and one over the border. It shows for the pointer over it, for keyboard focus
  and while it is dragged, and it is the focus indicator, so the default outline is off; a click
  focuses the handle without showing it. A drag moves the edge to follow the pointer exactly, by
  how far the pointer has moved since it was pressed (so that grabbing the strip off-centre does
  not make the panel jump); Left widens, since the edge moves left, and Right narrows, by 16; Home
  and End are the narrowest and the widest; a double click is 360. The window is followed: the
  width that was asked for is what is kept, and the width the panel has is that, limited by the
  window as it is now, so a panel made wide in a big window is narrower in a small one and wide
  again when the big window returns. The usual width is in two places, the token for the style
  sheets and `PANEL_WIDTH.default` for the code; the browser test checks that the token says what
  the code starts at. Dragging selects no text in Chromium whatever the handle's CSS says, so the
  `user-select: none` on the handle is for the browsers that are not tested; I mutated it away to
  see, and no test failed. In the Tab order the handle is after the map area's Import button and
  before the panel's tabs, as it is on the screen. It is not there when the panel is folded away.
- Found while reviewing the 7.9 screenshots (`k-tooltip`): a tooltip above or below a button in the
  rail covered the next button, which the checklist counts as a control with something over it. The
  tooltip can now be put to the `left` or `right` of its control as well as above (`top`) or below,
  centred on it from top to bottom, with the same rules as before: the preferred side if it fits,
  the opposite one if not (the roomier one if neither does), and slid to stay a margin inside the
  window. `placeTooltip` stays one pure function, tested for all four sides in Node and in the browser
  for a control in the middle, near either side and at the top edge. The gallery shows it in a row of
  its own, with room to its left, because in the row of the other examples it covered the button
  before it: the same flaw, seen in the first picture.
- Found while reviewing the 7.9 screenshots (the rail): the tooltips of the three rail buttons now go
  to the left of their buttons, over the map, instead of above them, where the Data tooltip covered
  the Legend button. A test hovers each button and checks that its tooltip is 4 to the left of it,
  centred on it, and over none of the rail's buttons; it was seen to fail with the tooltip above
  (the gap was -28).
- Step 7.9 (shell screenshots): nine states of the whole app, each at 1024x640, 1440x900 and
  1920x1080 in both themes (54 pictures, 1.1 MB): open, folded away, with data loaded ("Map
  rendering arrives in phase 2"), with files dragged over the map, a tooltip in the rail, the
  resize handle pointed at and with keyboard focus, and the panel at its widest and narrowest. Each
  state starts from a fresh load with the panel kept as the state needs, and with the pointer out
  of the way. The Data tab is not photographed: its body is empty until M9, and a picture of
  nothing would only have to be taken again. Reviewing the pictures with the checklist found the
  rail tooltip covering a button (fixed: see the entries above for the tooltip and the rail), and
  nothing else: nothing bleeds, clips or overflows, the empty states are in the middle, the edges
  line up, the line on the handle shows for hover and focus, and dark mode reads well. One thing
  left alone: at the usual width the Legend's line wraps with "rendered." alone on its second
  line, and balancing the lines (`text-wrap: balance`) would change the empty state's existing
  pictures for a purely cosmetic gain.

## M8: the import wizard

- How M8 is built. The wizard is one dialog in the app (`karmania-import-dialog`) that shows one step
  at a time. The parts that are not specific to it go in `@karmania/ui`, each in a commit of its own
  before the step that needs it, with a gallery demo, a browser test and pictures: `k-dialog`, then
  the step indicator, form controls and so on as the steps call for them. The wizard imports one data
  file at a time, because one mapping describes one file: with several files, the File step lists
  them all, and after one is loaded the wizard moves on to the next (the sidecar `.prj` goes with its
  data file). The kernel applies the chosen name and coordinate system to every format, but only
  CSV has columns to map and values to treat as missing, so for the other formats the Mapping and
  Nodata steps say there is nothing to set (GeoJSON: the shape of the data decides the kind; ASCII
  grid: its header has the missing-value marker; OBJ: nothing), and Next goes on.
- `k-dialog`: a native `<dialog>` opened with `showModal()`, so that the page behind is inert, Tab
  stays inside, Esc closes it and the keyboard goes back to where it was. It is open while `open` is
  set; a person closing it (Esc or the close button) sets `open` to false and sends
  `k-dialog-close`, and closing it by setting `open` sends nothing, so the page that owns it hears
  only about what a person did. A click outside does not close it: a wizard holds work that would be
  lost. The header, footer and size are the specification's (56, 64, `min(720, window - 48)`); the
  bands' heights and the size are tokens, and so is the colour that dims the page (`--k-scrim`, a
  dark one in both themes: the text colour would have lightened the page in the dark theme). The
  footer has 1 below its buttons for the 1 of its border above them, so that they sit on whole
  pixels, as in the toolbar. The steps band is hidden while nothing is in the `steps` slot, so that
  a dialog without steps has no gap under its header.
- The dialog's pictures hide the rest of the gallery first (the dialog is made visible again), so
  that what shows round the dialog, under the dimming, is the same whatever else the gallery holds:
  the lesson of `tooltip-below`, which was moved by a heading added above it.
- `k-steps` (the wizard's step indicator, in `@karmania/ui`): a row of numbered, labelled circles
  joined by lines. Done, current and to do differ by more than colour: a tick in an outlined circle,
  a number in a filled circle with a bold label, a number in a grey circle. Screen readers get
  `aria-current="step"` on the current step and ", done" or ", to do" in text that is not drawn
  (a listitem takes no name from its content, so a label would not have been read). It is not
  interactive: going back is done with Back, and a finding sends a person to its step in 8.10. The
  overflow check used by the tests now lets text hidden from the eye and kept for screen readers
  (a box of a pixel, cut away by `clip-path`) be bigger than its box, as it is meant to be.
- Step 8.1 (the wizard's frame): `karmania-import-dialog` puts `k-dialog`, `k-steps` and the footer
  together: Cancel (ghost) on the left, Back (secondary) and Next (primary) on the right. It owns the
  step a person is on and starts at File every time it is opened. Moving between steps leaves the
  keyboard on the button that was pressed, so that Enter can be pressed again; where a person is, is
  said to screen readers by a status line that is not drawn ("Step 2 of 5: Mapping"), because
  moving focus to each step's heading would cost extra Tab presses. The body of every step says that
  it is not built yet, and Load, the last step's button, is there but disabled: nothing has been
  prepared to load. Both go in 8.3 to 8.11. Nothing opens the dialog yet (8.2 wires the buttons), so
  its tests open it by setting `open`. The pictures of the wizard are 8.14's, when it has content.
- The tests that count how often a dialog said it was closed wait a moment before reading the count:
  a dialog is hidden before the browser sends its `close` event, so a test that read the count the
  moment the dialog was hidden could, and once nearly did, read it too early.
- Step 8.2 (opening the wizard): both Import buttons open the browser's file picker, which is an
  `<input type="file" multiple>` that is not shown (it is labelled, and out of the Tab order, so the
  keyboard never stops at it); a drop on the map area opens the wizard with the files as well. The
  map area does not decide what happens: it sends `karmania-import-request` for its button and
  `karmania-files-dropped` with the files for a drop, and the app opens the wizard (`show(files)`,
  which starts it on its first step). The picker offers the extensions the kernel reads, and `.txt`,
  which delimited text often has; a person can still choose any file, and the wizard is where an
  unreadable one is explained. The input is emptied once its files are taken, because a browser
  sends no `change` for a file chosen again while it is still the input's value; Playwright does,
  so the test checks that the input is empty, and it was seen to fail without. Closing the wizard
  forgets its files. A drop of anything but files, or of files anywhere but the map area, does
  nothing, as before.
- A test that looks for "the header" of the app now finds two, since the wizard has one: the tests
  of the toolbar ask for `header.toolbar`.
- `k-select` and `k-input` (in `@karmania/ui`, with the `chevron-down` icon): a label above the control,
  the control at the height of a button (32, or 28 compact with `hide-label`, which keeps the label
  for screen readers), and a line under it for help or for what is wrong. Both are native controls
  inside (`<select>`, `<input>`), so the keyboard and what screen readers say are the browser's own.
  A wrong value is said in words with an icon and marked `aria-invalid`, never by colour alone.
  `reserve` keeps the line's room free, so that a message appearing moves nothing (the wizard's
  fields will use it); without it the field grows by the line, and a test checks both. The value is
  the page's to keep, as for any native control; a person's change is sent as `k-select-change` or
  `k-input-change` (every keystroke), because `change` does not leave a shadow root. The test of the
  select chooses by typing a letter, not by the arrow keys: on a Mac an arrow opens the list, on
  Windows and Linux it changes the value. The gallery's demos are each as tall as their own content,
  so that a field's picture does not depend on the field beside it.
- `k-dialog` has a `footer-note` slot between the footer's two sides, for why the primary action
  cannot be used yet (8.5 says Next is disabled "with a visible reason", and the same goes for the
  other steps). It is muted 13/20 text of at most two lines, cut with an ellipsis after that; whoever
  fills it puts the whole text in a `title`. The footer stays 64 high.
- The app now depends on `@karmania/engine` (a workspace link: 3 lines of the lockfile, nothing from
  outside). The engine, and with it the worker and the 630 KB WebAssembly module, is started when
  the first files arrive, not when the page loads, so a person who never imports pays nothing and the
  shell's tests do not start a worker. The build emits the worker and the module as files of their
  own (`worker: { format: 'es' }` in the app's Vite config). The wizard has the engine look at the
  files as soon as it opens (`entries`: one for each file that is not a sidecar, with the data file,
  its sidecars and what the kernel made of them) and ignores an answer that arrives after the files
  have been changed or the dialog closed; a failure of the engine itself (it could not start) is
  kept as `failure`, whereas a file it cannot read is a finding about that file. The tests run the
  real worker and kernel on the files in `fixtures/`.
- Step 8.3 (the File step). It lists every file with what the kernel found (format, encoding, the
  delimiter and about how many rows, and the projection file that goes with it); one that cannot be
  imported (a projection file on its own, a format the kernel does not read, a file with an error)
  says so, with the kernel's own findings under it. With more than one importable file each row says
  whether it is being imported now or waits; with one there is nothing to say. Under the list, the
  file being imported (the first that can be) has its settings: what to import it as, and the
  dataset's name, which starts as the file's name without its extension. The kinds offered are those
  the format can be, in `KINDS_BY_FORMAT`: points, lines or a block model for CSV; a grid for an ASCII
  grid; a mesh for OBJ; and for GeoJSON none to choose, since the kernel makes a dataset of each kind
  of shape in it. A format with one kind shows it in a select that is disabled, with a line saying
  why, rather than leaving the choice out, so that the step looks the same for every file. What the
  kernel found about the file that is not an error (the encoding it fell back to, say) is shown under
  the settings. Next cannot be used while the files are being read, when none can be imported, or
  while the name is empty, and the footer says which; a failure of the engine itself is shown as an
  error with what to do.
- The wizard's state is kept in a draft (`ImportDraft`) that the wizard owns and each step edits
  through `karmania-draft-change`; it starts from what the kernel suggested (`draftFor`) and later
  steps add their parts. A step shows what it is given and says what a person changed, as the side
  panel does.
- `karmania-findings` lists findings for people: an icon whose shape tells the severity (a circle with
  a mark, a triangle, an "i"), the message, the hint, and for one that happened more than once how
  often and where (`Seen 12 times: line 3, line 8, line 15 and 9 more.`; one that happened once has its
  place in its message, and nothing is said twice). The severity is also said in words that are not
  drawn. Rows and elements are counted from 1 there, as a person counts; lines already are.
- `k-dialog` gained `fill`, and the wizard uses it: the dialog is as tall as it can be at every step,
  so that its buttons are where they were when the step changes, and a person can press Next again
  without moving the pointer. (On the last step the button reads Load, and its width may differ, which
  moves Back; its right edge stays.) The dialog also takes the keyboard itself when it opens, with
  no ring, instead of the browser's choice of the close button, whose tooltip opened at once when the
  dialog was opened with the keyboard; the first Tab goes to the first control. This was found by
  looking at the pictures of the step.
- CI (Linux) failed on four of the last pushes, which the same tests had passed on a Mac, and the
  causes were three. (1) A race in `k-dialog`: the browser sends a dialog's `close` event a moment
  after it closes, so a dialog closed and opened again at once (which a wizard that is cancelled and
  reopened does) took the first close's echo for a person closing it, and shut. It now ignores a
  `close` that arrives while the dialog is open; a test closes and reopens in one go, which is what
  shows it, and was seen to fail without the fix. (2) A race in the tests: Playwright turns on its
  hold on the file picker a moment after it is asked to, and a picker that opens before then is never
  seen, which a quick key press does. Pressing Enter on the focused Import button did it in 5 of 80
  runs of the old pattern, and 0 of 80 with a round trip to the page between asking for the picker
  and pressing; every test that chooses files now goes through one helper (`support/picker.ts`) that
  does that, and waits for the picker for 10 seconds, so that a stall says where it was. This was
  also the stall seen twice on this Mac. (3) A test of the dialog read how often it had said it was
  closed the moment the dialog was hidden, before the browser's event (fixed earlier, in `df38a18`).
  Called flaky, the first was a real fault of the dialog and the other two were races in the tests.
- Step 8.4 (the Mapping step, part 1). For a CSV file it shows the first 100 rows as a table, with
  over each column its name and a selector of its role (X, Y, Z, Line ID for lines, Attribute,
  Ignore: short names, because the room in a header is short; the roles a kind has are in
  `ROLES_BY_KIND`, and the line identifier is only for lines). The roles the kernel suggested are
  filled in and marked "suggested" until a person changes them; the kernel suggests a role for each
  column and calls an ordinary one an attribute, so only the others are marked, and a suggestion the
  chosen kind cannot have (a line identifier, for points) becomes an attribute. Changing what the
  file is imported as, back in the File step, turns a column whose role the new kind has not into an
  attribute, and does not give it back if the kind is changed back: it is a person's to set again. The
  table has all the room of the step and scrolls inside itself, in both directions, with its header and
  the selectors kept in view, so that the dialog's own body has nothing to scroll; columns are 160 wide
  (`--k-mapping-column-width`) and rows 28 high, numbers to the right, text to the left, and a cell
  or name that is too long is cut with an ellipsis and has its whole text as a title. Columns that
  have a coordinate role have a tinted header, and ignored ones are muted. A file with no columns
  (GeoJSON, an ASCII grid, an OBJ mesh) says that there is nothing to map. A line under the table
  says how many rows are shown of about how many. No rule keeps a person from going on yet: those are 8.5.
- Step 8.5 (the Mapping step, part 2). The step says what the chosen kind needs before anything is
  wrong (points: X and Y; lines: X, Y and a line identifier; a block model: X, Y and Z, and the size
  of a block), and then what is wrong: a role no column has, a role several columns have, a block
  size that is missing or cannot be used. Those are the findings the kernel would make when the file
  is imported (`mapping.*`), and the wizard words them exactly as the kernel does: a test reads the
  hint and the example of each in `docs/validation-codes.md` and checks the wizard's are the same.
  Next cannot be used while anything is wrong, and the footer says what, first thing first. What is
  wrong is listed under the table, not over it: over it, a role changing would move the header and the
  rows, which the rules forbid; under it, only the table's bottom edge gives way, and a test checks
  that nothing else moves. The table keeps room for four rows whatever the rest of the step takes, so
  a block model in the smallest window, with a problem to show, makes the body scroll a little rather
  than squeeze the table to nothing. A block model's size is three fields (along X, Y and Z, "in the
  units of the coordinates"), kept as typed since a number can be half typed; a point or a comma
  does for the decimals, and anything but a plain number above 0 is wrong: a field that has text in it
  that is not one says so under itself, in a line that is kept free so that it moves nothing, and an
  empty field is only missing. The size starts empty: the kernel suggests none, and a guess at it
  would be a silent default.
- Found while testing 8.5: text that is hidden from the eye and kept for screen readers is placed
  absolutely, so when the dialog's body scrolled, the hidden severity of a finding, outside the
  body's clip, counted as the dialog overflowing. The things that hold such text (a field, a
  finding) are now positioned, so that it stays with them, and the wizard's own hidden status line
  comes first in the body, where it is always in sight.
- Step 8.6 (the Mapping step, part 3). A column's type and its name are set in a slim panel under the
  table for the column a person has chosen, by clicking its name in the header (a button, marked
  pressed and with a line under its header). They are not in every header: with a role selector, a
  type selector and a name field in each, a header would be some 130 high and leave the smallest window
  room for no rows. The panel is one row of a fixed height, whether a column is chosen or not, so
  choosing moves nothing (a test checks that, for an attribute, a coordinate and an ignored column).
  The type selector starts with Auto, which says what the kernel found ("Auto (Float)"); a coordinate
  can be read as a float or an integer only, a line identifier as an integer, text or category, an
  attribute as any of the five; a type that was chosen and has stopped being offered (the column was
  then given the role of a coordinate) stays in the list, so that what is wrong can be seen and
  changed. The name is only for an attribute, the file's name is its placeholder, and what was typed is
  kept as typed (spaces and all) and trimmed where it is used, so that a space typed at the end of
  half a name is not taken away. Two things are checked in the kernel's words: a coordinate set to
  be read as something that is not a number (`mapping.coordinate.not_numeric`), and two attributes
  with one name (`table.column.name_duplicate`), the name being the one a column will have, renamed or
  not; the first is checked from what a person set, as the kernel does, and a column the kernel only
  finds to be text is its business when it imports. The test of the wording covers them.
- Found while testing 8.6: a native select that a person has changed no longer follows the
  `selected` of its options, so `k-select`, used for the type of one column and then of another,
  went on showing the first one's choice. It now sets the value of its select after every render, and
  a test gives a select that a person has used a new value and new choices.
- `k-checkbox` (in `@karmania/ui`, for the Nodata step): a native checkbox, drawn with the tokens (a
  box of 16, with a tick over it when it is ticked), with its label beside it and a muted `detail`
  at the end of the row, such as how often a value was found. The whole row, label and all, is what
  can be pressed, and it is at least as high as a hit target. The label wraps, and a word that does
  not fit is broken; when the row has too little room for both the label and the detail, the detail
  goes under the label, to the right. The state is the page's to keep, as for the other fields: a
  person's change is sent as `k-checkbox-change` and the page sets `checked`, which is shown even
  after the person has changed the box themselves. Found by the test of the long label: an inline
  input in a box of 16 made the box's content 5 high over (a line of text under it), and the detail
  left the label 14 wide.
- Step 8.7 (the Nodata step). The words and numbers the kernel found that look like "no data" are
  boxes, ticked to begin with, each with how often the preview had it ("1 in the preview": the counts
  are from the preview's rows, not the whole file, and the step says so rather than imply they are
  totals). Ticked by default because it is what a person is most likely to want and nothing is
  changed silently: the kernel counts every value it turns into an empty one in a warning. An empty
  cell is called "(empty cell)". Other values are typed in a field, separated by commas: what is a
  plain number (a point for the decimals, and an exponent if need be) is a number and anything else
  is a word, each once and words whatever their case; under the field the step says how it read
  them, since "1,5" is two numbers and a person should see that before importing. A file that writes
  its numbers with commas needs a different separator for this field; a comma in the file's numbers is
  rare in a list of no-data values, and a person who does need one can say so with the decimal
  setting. The step also holds two more choices the mapping contract needs: what to do with a row
  that has an empty coordinate (stop with an error, or skip it and count it; the first to begin with,
  since it is the one that loses nothing), and how the numbers in the file are written (a point or
  a comma, found by the kernel, which a person can change). No choice here can stop a person going on.
  A file with no columns says that there is nothing to set (an ASCII grid names its own no-data
  value in its header, and that is used).
- Step 8.8 (the coordinate system step, part 1). The step says which coordinate system was found in or
  beside the file and where it came from: the `.prj` file (by name), the file's own `crs` member, or
  the default of GeoJSON, which it says is assumed because the file names none. A person chooses what
  the coordinates are in: the one found, or an EPSG code that they type, which is shown as it was given
  and nothing more (the kernel has no list to look it up in, so no name, kind or units are shown, and
  a test checks that none is). A code is a whole number from 1, of up to six digits; anything else is
  said to be wrong in words. The step is stopped at when nothing has been chosen: the kernel counts a
  missing coordinate system an error (`crs.missing`) when it validates the dataset, so letting a
  person go on without one would only send them back from the Review step, and the footer says what to
  do. The choice is a select and the code a field beside it, so that the field appearing moves nothing;
  a projection file that was found but could not be used is explained by the kernel's own finding
  (that it describes a system but gives no EPSG code), shown in the step. The tests of the wizard's
  frame now open it with a data file and its projection file, so that no step stops them.
