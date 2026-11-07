# Dependencies

Every dependency, with its version, license and purpose, recorded in the same
commit that adds it.

## License policy

The project license is Apache-2.0 (see `LICENSE`). Allowed for dependencies:

- MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, and OFL (fonts only).
- BlueOak-1.0.0, a permissive license, accepted at step 0.12.
- Unicode-3.0, a permissive license for Unicode data and code, accepted at
  step 1.19 (it covers `unicode-ident`, which `serde_derive` needs).
- CC0-1.0, a public-domain dedication, accepted at step 12.2 for `crs-definitions`
  (section 2.1 of the phase 2 brief). It was accepted once before at step 2.16 and left
  the policy when the crate was removed at step 3.25b. The label covers the crate, not
  necessarily the data in it: see the EPSG terms below the Rust crates table.
- MPL-2.0, accepted at step 0.12 for dev-only build tools that are never shipped
  as part of Karmania. It is compatible with Apache-2.0: MPL's copyleft applies
  per file to MPL-licensed code, so using an unmodified MPL tool at build time
  puts no obligation on Karmania's own code. If an MPL-2.0 package is ever
  bundled into shipped output, record it here and keep its notices.

Anything else needs the owner's approval first. That includes strong copyleft
(GPL, LGPL, AGPL), source-available licenses, and licenses not named above.

| Dependency | Version | License | Purpose | Added |
| --- | --- | --- | --- | --- |
| typescript (dev) | ~6.0.3 | Apache-2.0 | Strict type checking for all TypeScript packages. Held below 7 because typescript-eslint 8.72 supports only `>=4.8.4 <6.1.0`. | step 0.5 |
| eslint (dev, root and `@karmania/app`) | ^10.13.0 | MIT | Linting for TypeScript and JavaScript. The app's test of the import rules runs ESLint's `Linter` (declared there, as it imports it). | step 0.6 |
| @eslint/js (dev) | ^10.0.1 | MIT | ESLint's recommended rule set. | step 0.6 |
| typescript-eslint (dev, root and `@karmania/app`) | ^8.72.0 | MIT | Parser and the `strictTypeChecked` rule set (bans `any`, unsafe `unknown` use, floating promises, non-null assertions). | step 0.6 |
| prettier (dev) | ^3.9.10 | MIT | Code formatting for TypeScript, JavaScript, JSON, YAML, CSS and HTML. | step 0.6 |
| vitest (dev, `@karmania/engine`, `@karmania/ui`, `@karmania/app`, `@karmania/scene`, `@karmania/render`, `@karmania/viewer`) | ^5.0.5 | MIT | TypeScript unit tests. The UI package has used it since step 6.1, and the app since step 7.7, for the panel's state. | step 0.7 |
| @types/node (dev, `@karmania/engine`, `@karmania/ui`, `@karmania/scene`, `@karmania/app`) | ^24.19.2 | MIT | Node type declarations for the tests that load the built WebAssembly module in Node (pulls in `undici-types`, MIT). Referenced only from test files and the test support file (the engine's, the scene's `palettes.test.ts`, which reads a stylesheet, and the app's `import-restrictions.test.ts`, which finds the repository's root), never from code that is shipped. | step 4.3b |
| vite (dev, `@karmania/engine`, `@karmania/ui`, `@karmania/scene`, `@karmania/render`, `@karmania/viewer`, `@karmania/app`) | ^8.3.5 | MIT | Required peer of vitest, and the app dev server and library builds later. Was 7.x from step 0.7 until step 0.13 (Vite 8 pulls in lightningcss, MPL-2.0, now accepted for dev-only tools). | step 0.7 |
| three (`@karmania/render`) | ^0.187.0 | MIT | The WebGL renderer of the map (section 2.2 of the phase 2 brief), behind `@karmania/render`: nothing else imports it (an ESLint rule says so). No dependencies of its own. **Size**: a probe bundle that imports the classes the renderer will use (`WebGLRenderer`, `Scene`, the two cameras, `BufferGeometry`, `BufferAttribute`, the instanced geometry and attribute, `ShaderMaterial`, `Mesh`, `Points`, `DataTexture`, `Color`, two vectors, `Group`, three constants) is 622,236 bytes minified and **137,293 bytes gzipped** (`gzip -9`; Vite says 139.34 kB); that is what the page gains, and it is measured again at the gate of M16 on the real build. | step 16.1b |
| @types/three (dev, `@karmania/render`) | ^0.187.0 | MIT | The type declarations of three. Its own dependencies are type packages and are dev-only: `@types/stats.js`, `@types/webxr`, `@tweenjs/tween.js`, `fflate` and `meshoptimizer` (MIT) and `@dimforge/rapier3d-compat` (Apache-2.0). None is shipped. | step 16.1b |
| lit (`@karmania/ui`, `@karmania/viewer`, `@karmania/app`) | ^3.3.3 | BSD-3-Clause | The web component library the UI is built with: small, and its components work inside any host page. Brings `@lit/reactive-element`, `lit-element` and `lit-html` (all BSD-3-Clause), `@lit-labs/ssr-dom-shim` (BSD-3-Clause) and `@types/trusted-types` (MIT, types only). | step 6.1 |
| lucide-static (`@karmania/ui`) | ^1.61.0 | ISC | The icons: static SVG drawings, imported one by one as text (`?raw`), so only the icons in `components/icons.ts` are in the build. No icon fonts. | step 6.4 |
| @axe-core/playwright (dev, `@karmania/app`) | ^4.14.0 | MPL-2.0 | Runs axe on pages in the browser tests and fails on serious or critical accessibility violations. Brings `axe-core` (MPL-2.0). Both are dev-only test tools, covered by the MPL-2.0 rule in the policy above. | step 6.4 |
| Inter (font files, `@karmania/ui`) | Google Fonts' Inter v20, as packaged in `@fontsource-variable/inter` 5.3.0 | OFL-1.1 | The UI's font, self-hosted as two variable woff2 files in `packages/ui/src/fonts` (latin, 48 KB, sha256 `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62`; latin-ext, 85 KB, sha256 `34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956`), with the license text beside them (`OFL.txt`, which the license requires). They were copied out of the npm package once; the package is not a dependency. Nothing is fetched from a CDN. | step 6.3 |
| @playwright/test (dev, `@karmania/engine` and `@karmania/app`) | ^1.64.1 | Apache-2.0 | Browser tests of the engine with its real worker and WebAssembly module (`pnpm test:e2e`), and later the end-to-end tests of the app. Brings `playwright` and `playwright-core`, both Apache-2.0. The browsers are not part of the package: Playwright downloads them on first use into a cache outside the repository (`~/Library/Caches/ms-playwright` on macOS), and CI installs Chromium with `playwright install --with-deps chromium`. That download includes an `ffmpeg` build, which Playwright uses only to record videos and which this project never turns on. It is licensed LGPL-2.1, so it is recorded here for the owner's attention: it is a test-time tool binary, never linked, bundled or shipped. | step 5.11a |

## Transitive licenses

Checked at step 0.13 by reading the `license` field of every installed package
(129 packages, none unknown); at step 4.3b there are 131, still none unknown. `pnpm licenses list` is not used: under pnpm 12 it
omits packages it listed under pnpm 10. All are MIT, Apache-2.0, BSD-2-Clause,
BSD-3-Clause or ISC, except:

- `minimatch` 10.2.6, BlueOak-1.0.0. Dev-only, required by ESLint itself, never
  shipped. Approved by the owner (step 0.12).
- `lightningcss` 1.33.0 and its platform binary package, MPL-2.0. Dev-only CSS
  build tool pulled in by Vite 8; covered by the MPL-2.0 rule in the policy above.

## Rust crates

| Crate | Version | License | Purpose | Added |
| --- | --- | --- | --- | --- |
| serde (with `derive`) | 1.0.229 | MIT OR Apache-2.0 | Serialization of the wire contracts (findings, CRS, import mapping) in `karmania-core`. Brings `serde_core` and `serde_derive` (both MIT OR Apache-2.0). | step 1.1a |
| serde_json (dev, `karmania-core`) | 1.0.154 | MIT OR Apache-2.0 | Tests that pin the exact JSON shape of serialized types. | step 1.1a |
| serde_json (`karmania-io`) | 1.0.154 | MIT OR Apache-2.0 | Parses GeoJSON. Already in use in tests; now also part of the reader, so its `itoa` (MIT OR Apache-2.0), `memchr` (Unlicense OR MIT, used under MIT) and `zmij` (MIT) dependencies are in the engine build too. | step 3.12a |
| csv (dev, `karmania-io`) | 1.4.0 | Unlicense/MIT | Cross-checks the hand-written delimited-text reader in tests only; not part of any build of the engine. Brings `csv-core` and `ryu` (`Apache-2.0 OR BSL-1.0`, used under Apache-2.0), plus crates already listed. | step 3.3 |
| wasm-bindgen (`karmania-wasm`) | 0.2.129 | MIT OR Apache-2.0 | Generates the JavaScript glue and types for the WebAssembly module. Brings `wasm-bindgen-macro`, `wasm-bindgen-macro-support` and `wasm-bindgen-shared`, `bumpalo`, `cfg-if`, `once_cell` and `rustversion`, all MIT OR Apache-2.0, and `quote`, `proc-macro2`, `syn` and `unicode-ident`, listed below. | step 4.1 |
| serde-wasm-bindgen (`karmania-wasm`) | 0.6.5 | MIT | Turns Rust values into plain JavaScript values at the WebAssembly boundary. Brings `js-sys` (MIT OR Apache-2.0) and, through it, `futures-util` and its small dependencies (`futures-core`, `futures-task`, `pin-project-lite`, `slab`; all MIT OR Apache-2.0 or MIT). | step 4.3b |
| js-sys (`karmania-wasm`) | 0.3.106 | MIT OR Apache-2.0 | Reads JavaScript arrays and typed arrays passed to the module. | step 4.3b |
| libm | 0.2.16 | MIT | Pure-Rust sine and cosine for lattice rotation, so results are bit-identical on every platform. No dependencies of its own. Approved by the owner. | step 1.18 |
| crs-definitions (`karmania-crs`) | 0.6.0 | CC0-1.0 | The EPSG definitions: a `u16` EPSG code to a WKT string (name, kind and units are read from it) and a PROJ string (for reprojection). Default features `proj4` (for the reprojection) and `wkt` (for the lookup), both needed. `no_std`, no dependencies of its own, builds for `wasm32-unknown-unknown`. About 4.9 MB of source tables, so the WebAssembly module will grow; the size is measured at step 12.12 against the 1 MB (gzipped) rule of the brief. Released 2026-09-16; its GitHub repository was archived on 2026-06-13 and moved to tangled.org/rwell.org/crs-definitions, where 0.6.0 was released. Used under the EPSG terms below. Its `from_code`, one match of 6,184 arms, is not called by the kernel: V8 aborts when it tries to optimise it (step 12.F7), so the constants of the crate are listed in a generated table (`crates/karmania-crs/src/registry/table.rs`, made by `scripts/generate-crs-table`) and found by binary search; a test checks the table against `from_code` for every code. | step 12.2 |
| proj4rs (`karmania-crs`) | 0.3.0 | MIT OR Apache-2.0 | Pure-Rust port of PROJ: reprojection between the coordinate systems of the definitions (from step 12.6). Default features off (the `aeqd` feature is not used in its source and made no difference to what it can build). 0.3.0 is the latest (2026-10-26); phase 1 used 0.2.1. Brings `proj4rs-geodesic` 0.2.0 (MIT OR Apache-2.0, a pure Rust port of GeographicLib's geodesic code, no build script and no C source) and `thiserror` 2.0.21 with `thiserror-impl` (MIT OR Apache-2.0); on `wasm32-unknown-unknown` it also brings `console_log` 1.1.0 (MIT/Apache-2.0), `log` 0.4.35 and `web-sys` 0.3.106 (MIT OR Apache-2.0), besides `wasm-bindgen` and `js-sys` that the bindings already use. It has no option to use `libm`: it relies on the platform's maths library, so results may differ in the last bits between native and WebAssembly builds. | step 12.5 |
| earcut (`karmania-prep`) | 0.4.11 | MIT OR Apache-2.0 | A Rust port of Mapbox's earcut: triangulates polygons with holes, for the filled polygons of the map (from step 13.8). Chosen over `earcutr` (ISC, a port of earcut 2.x, `f64` only, last released 2025-05-29): it tracks the current earcut (3.2.3 in 0.4.11), is generic over `f32` and `f64`, is `no_std` and builds for `wasm32-unknown-unknown` (a release build of `karmania-prep` was made), reuses its buffers between polygons, and is maintained by the georust organisation (0.4.9 to 0.4.12 between 2026-04-21 and 2026-11-02; 0.4.9 was ISC and from 0.4.10 it is MIT OR Apache-2.0). 0.4.12 was published the day before this step and changes the code that bridges holes, so the release that has been out for more than three months is used. Its code is derived in part from Mapbox's earcut (ISC, Copyright (c) 2016, Mapbox), whose notice is in `THIRD_PARTY_NOTICES.md`. Brings `num-traits` 0.2.19 (MIT OR Apache-2.0) and its build dependency `autocfg` 1.5.1 (Apache-2.0 OR MIT). | step 13.7 |

Rust transitive tree at step 4.3b (30 crates in the resolved graph, checked with
`cargo metadata`, the same for host and `wasm32-unknown-unknown`): all MIT,
Apache-2.0, `Unlicense OR MIT` (memchr), `Apache-2.0 OR BSL-1.0` (ryu, used only
by the dev dependency `csv`), or Unicode-3.0 with MIT or Apache-2.0
(`unicode-ident`):

- `unicode-ident` 1.0.27, `(MIT OR Apache-2.0) AND Unicode-3.0`. Required by
  `syn`, which `serde_derive` cannot do without. Approved by the
  owner (step 1.19).

Removed at step 3.25a and 3.25b, by the owner's decision that this repository is
the core and does not interpret coordinate systems: `proj4rs` (MIT OR Apache-2.0,
reprojection, with the crates it brought along) and `crs-definitions` (CC0-1.0,
the EPSG definitions, 4.8 MB of source text). `crs-definitions` came back at step
12.2, in the new `karmania-crs` crate (the core still knows no definitions);
`proj4rs` came back at step 12.5, in `karmania-crs` too.

What `proj4rs` 0.3.0 can build (measured at step 12.5 with `Proj::from_proj_string` on the PROJ
string of every definition of `crs-definitions` 0.6.0): 5942 of the 6182 that have one. The
other 240 are 238 that need datum-shift grid files ("NAD grid not available") and 2 whose projection
it does not know. No C-backed feature is involved: that was a problem of 0.2.1, which the brief
still describes as "about 6%".

The EPSG terms (step 12.2). `crs-definitions` is licensed CC0-1.0, but its tables are
generated, by the crate's own `scripts/regenerate.py`, from the `spatial_ref_sys` table
of PostGIS, which derives from the EPSG Dataset maintained by IOGP. A CC0 label on the
crate does not change the terms of the EPSG data in it. The terms, as read from copies
on third-party sites (epsg.org itself refused the requests of this project's tools with HTTP 403, so this project
has not read the live text, which should be read): the data may be used, copied and
distributed; it is published at no charge and "Distribution for profit is forbidden";
it may be included in a commercial package if the commerciality is based on value added
by the provider; "Ownership of the EPSG Dataset by IOGP must be acknowledged in any
publication or transmission" of it; anyone it is given to must be told that the terms
apply; data may be changed only as a short table in the terms allows (a unit
conversion, for example), and data changed otherwise must not be attributed to EPSG; it
is provided as is, without warranty. Apache SIS does not bundle the dataset because it
holds these terms incompatible with the Apache licence. The owner decided at step 12.2
to bundle the definitions in the kernel with notices, and accepted that the kernel's
build is therefore not purely Apache-2.0: Karmania's own code stays Apache-2.0, and the
EPSG data in it is under IOGP's terms. No written confirmation was asked of IOGP. What
that commits the project to: the acknowledgement and the terms in
`THIRD_PARTY_NOTICES.md` (begun at step 12.F2, completed at step 23.5) and `docs/embedding.md`
(step 23.6), which go with
every build that holds the data; the same notice in the README (step 24.5) and in the
crate documentation of `karmania-crs` (step 12.3); no change to the values beyond what
the terms permit (reading the name, kind and unit out of the WKT is not a change); and
never attributing to EPSG anything the kernel computes itself.

Build tools (not part of the Rust build or of the shipped code; installed on the
developer's machine and in CI):

| Tool | Version | License | Purpose | Added |
| --- | --- | --- | --- | --- |
| Playwright Docker image (`mcr.microsoft.com/playwright`) | v1.64.1-noble | Playwright: Apache-2.0; the image is Ubuntu 24.04 with the browsers and their system libraries, which carry their own licenses (some GPL or LGPL) | The browser the screenshot tests use, so that pictures are the same on every machine and in CI (`scripts/visual-tests`, `pnpm test:visual`). It is pulled from Microsoft's registry (about 2.5 GB), runs only while the tests do, and is never part of a build or shipped. Recorded for the owner's attention, as the Playwright `ffmpeg` is, since the policy names GPL and LGPL: nothing in it is linked into or distributed with Karmania. | step 6.10 |

| Tool | Version | License | Purpose | Added |
| --- | --- | --- | --- | --- |
| wasm-pack | 0.15.0 | MIT OR Apache-2.0 | Builds the WebAssembly module and its JavaScript glue into `packages/engine/wasm` (`scripts/build-wasm`, `pnpm build:wasm`). Install with `cargo install wasm-pack`. In CI it is installed by `taiki-e/install-action` (MIT OR Apache-2.0, pinned to a commit), which downloads a prebuilt binary. On first use it downloads and caches the matching `wasm-bindgen` command-line tool (MIT OR Apache-2.0) and `wasm-opt` from Binaryen (Apache-2.0), so the first build needs network access. | step 4.1 |

## Data

Data that is copied into the repository, not installed: the values are in the file named, and the comment at the
top of that file says where each table was taken from and how it was converted.

| Data | Source | License | Where | Added |
| --- | --- | --- | --- | --- |
| viridis and magma colour ramps (256 colours each) | matplotlib 3.10.0, `lib/matplotlib/_cm_listed.py`: the same numbers as the original `colormaps.py` of github.com/BIDS/colormap, by Nathaniel J. Smith, Stefan van der Walt and Eric Firing (checked equal when they were taken) | CC0-1.0. The original says: "This file and the colormaps in it are released under the CC0 license / public domain dedication. We would appreciate credit if you use or redistribute these colormaps, but do not impose any legal restrictions." | `packages/scene/src/ramp-data.ts` | step 14.4b |
| ColorBrewer colour schemes: Blues, Greens, Oranges, Reds, Purples, YlGnBu, YlOrRd (sequential, 9), RdBu, PuOr, BrBG (diverging, 11), Paired (qualitative, 12) | github.com/axismaps/colorbrewer, `export/colorbrewer.js`, by Cynthia Brewer (colorbrewer.org). Its header: "This product includes color specifications and designs developed by Cynthia Brewer (http://colorbrewer.org/)." | Apache-2.0 (the licence file of that repository is the Apache License 2.0) | `packages/scene/src/ramp-data.ts` | step 14.4b |
| Okabe-Ito categorical palette (8 colours, black last) | Masataka Okabe and Kei Ito, Color Universal Design (jfly.uni-koeln.de/color); also Bang Wong, Nature Methods 8, 441 (2011). A published list of colour values | none stated (a list of eight colour values; credited in `THIRD_PARTY_NOTICES.md`) | `packages/scene/src/ramps.ts` | step 14.4c |

Not taken: cividis. The brief names it with viridis and magma as CC0, but the repository it comes from
(github.com/pnnl/cmaputil, Battelle Memorial Institute) has a licence of its own, a permissive text of the BSD kind that
forbids the use of Battelle's name without consent, and no statement was found that the colormap is CC0. The policy
above says anything not named needs the owner's approval, so it is left out until the owner decides (step 14.4b in
`docs/decisions.md`).
