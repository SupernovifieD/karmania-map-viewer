# Dependencies

Every dependency, with its version, license and purpose, recorded in the same
commit that adds it.

## License policy

The project license is Apache-2.0 (see `LICENSE`). Allowed for dependencies:

- MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, and OFL (fonts only).
- BlueOak-1.0.0, a permissive license, accepted at step 0.12.
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
| vite (dev, `@karmania/engine`) | ^7.3.7 | MIT | Required peer of vitest, and the app dev server and library builds later. Held at 7 because Vite 8 hard-depends on lightningcss (MPL-2.0, weak copyleft). | step 0.7 |

## Transitive licenses

Checked with `pnpm licenses list` at step 0.7: all 123 installed packages are
MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause or ISC, except:

- `minimatch` 10.2.6, BlueOak-1.0.0. Dev-only, required by ESLint itself, never
  shipped. Approved by the owner (step 0.12).

Vite 8 (step 0.13) will add `lightningcss` (MPL-2.0), a dev-only build tool
covered by the policy above.
