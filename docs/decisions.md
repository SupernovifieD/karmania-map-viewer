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
