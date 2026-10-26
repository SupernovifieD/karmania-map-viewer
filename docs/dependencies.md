# Dependencies

Every dependency, with its version, license and purpose, recorded in the same
commit that adds it.

## License policy

The project license is Apache-2.0 (see `LICENSE`). Allowed for dependencies:

- MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, and OFL (fonts only).
- BlueOak-1.0.0, a permissive license, accepted at step 0.12.
- Unicode-3.0, a permissive license for Unicode data and code, accepted at
  step 1.19 (it covers `unicode-ident`, which `serde_derive` needs).
- CC0-1.0, a public-domain dedication, accepted at step 2.16 for
  `crs-definitions`. The owner chose to use the EPSG definitions whatever their
  terms; see the note under the Rust crates table.
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
| eslint (dev) | ^10.13.0 | MIT | Linting for TypeScript and JavaScript. | step 0.6 |
| @eslint/js (dev) | ^10.0.1 | MIT | ESLint's recommended rule set. | step 0.6 |
| typescript-eslint (dev) | ^8.72.0 | MIT | Parser and the `strictTypeChecked` rule set (bans `any`, unsafe `unknown` use, floating promises, non-null assertions). | step 0.6 |
| prettier (dev) | ^3.9.10 | MIT | Code formatting for TypeScript, JavaScript, JSON, YAML, CSS and HTML. | step 0.6 |
| vitest (dev, `@karmania/engine`) | ^5.0.5 | MIT | TypeScript unit tests. | step 0.7 |
| vite (dev, `@karmania/engine`) | ^8.3.5 | MIT | Required peer of vitest, and the app dev server and library builds later. Was 7.x from step 0.7 until step 0.13 (Vite 8 pulls in lightningcss, MPL-2.0, now accepted for dev-only tools). | step 0.7 |

## Transitive licenses

Checked at step 0.13 by reading the `license` field of every installed package
(129 packages, none unknown). `pnpm licenses list` is not used: under pnpm 12 it
omits packages it listed under pnpm 10. All are MIT, Apache-2.0, BSD-2-Clause,
BSD-3-Clause or ISC, except:

- `minimatch` 10.2.6, BlueOak-1.0.0. Dev-only, required by ESLint itself, never
  shipped. Approved by the owner (step 0.12).
- `lightningcss` 1.33.0 and its platform binary package, MPL-2.0. Dev-only CSS
  build tool pulled in by Vite 8; covered by the MPL-2.0 rule in the policy above.

## Rust crates

| Crate | Version | License | Purpose | Added |
| --- | --- | --- | --- | --- |
| serde (with `derive`) | 1.0.229 | MIT OR Apache-2.0 | Serialization of the wire contracts (findings, CRS, import mapping) in `karmania-core`. | step 1.1a |
| serde_json (dev, `karmania-core`) | 1.0.154 | MIT OR Apache-2.0 | Tests that pin the exact JSON shape of serialized types. | step 1.1a |
| crs-definitions | 0.6.0 | CC0-1.0 | EPSG code to definition lookup (name, kind and units are read from the WKT; the PROJ string feeds the plausibility check). `no_std`, no dependencies of its own. Its definition tables are 4.8 MB of source text, so expect a noticeably larger WebAssembly file (not yet measured). | step 2.16 |
| libm | 0.2.16 | MIT | Pure-Rust sine and cosine for lattice rotation, so results are bit-identical on every platform. No dependencies of its own. Approved by the owner. | step 1.18 |

Where the EPSG data comes from: `crs-definitions` is licensed CC0-1.0, but its
definitions are generated from the `spatial_ref_sys` table of PostGIS, which in
turn derives from the EPSG registry maintained by IOGP, whose own terms of use
apply to that data. The owner decided to use it regardless of those terms
(step 2.16). Check the EPSG terms before redistributing the definitions on their
own, outside this engine.

Rust transitive tree at step 1.1a (12 crates, checked with `cargo metadata`):
all MIT, Apache-2.0 or `Unlicense OR MIT`, except:

- `unicode-ident` 1.0.27, `(MIT OR Apache-2.0) AND Unicode-3.0`. Required by
  `syn`, which `serde_derive` cannot do without. Approved by the owner
  (step 1.19).
