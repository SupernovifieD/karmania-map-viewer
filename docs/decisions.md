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
