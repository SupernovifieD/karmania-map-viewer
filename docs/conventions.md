# Conventions

Rules for anyone changing this repository. The step plan is in
`docs/roadmap/phase-1.md`; decisions made along the way are in
`docs/decisions.md`; dependencies are in `docs/dependencies.md`. Working rules
for AI assistants are in `AGENTS.md`.

## Naming

Rust:

- Crates are `karmania-core`, `karmania-io` and `karmania-wasm`. Modules,
  functions and variables use `snake_case`; types and enum variants use
  `UpperCamelCase`; constants use `SCREAMING_SNAKE_CASE`.
- Units and conventions go in the doc comment of every public item (for
  example "metres", "degrees counter-clockwise", "i fastest").

TypeScript:

- Packages are `@karmania/engine`, `@karmania/ui` and `@karmania/app`. Files use
  `kebab-case.ts`; tests sit next to the code as `name.test.ts`.
- Variables and functions use `camelCase`; types, interfaces and classes use
  `PascalCase`. Named exports only; no default exports except tool config files
  that require them (enforced by ESLint).
- No `any`: use `unknown` and narrow it. No non-null assertions on data.
- Custom elements are prefixed `karmania-` (`<karmania-app>`); CSS custom
  properties are prefixed `--k-`.

Data in files and messages:

- Internal indices are 0-based. Anything shown to a user that numbers things is
  1-based: lines of a source file (the header counts as line 1), and the numbers of
  rows, lines, polygons, triangles, cells and vertices in the data table. The
  `element`, `row` and `vertex` of a finding's location are internal and 0-based;
  whoever shows them adds 1.
- User-facing text is plain language: say what is wrong and where, with no
  internal names or jargon.

## Finding codes

A finding code names one kind of problem, for example `crs.missing` or
`lines.offsets.decreasing`.

- Lowercase, dot-separated: `<area>.<subject>[.<problem>]`. Each segment is
  lowercase ASCII letters, digits or underscores. The area is a shape (`points`,
  `lines`, `polygons`, `mesh`, `grid`, `blocks`), `dataset`, `table`, `values`,
  `crs`, `file`, `mapping`, or a file format that has findings of its own (`csv`,
  `geojson`, `asc` for ESRI ASCII grids, `obj`, `prj`).
- Codes are stable. Once a code is released, do not rename it or change its
  meaning; add a new code instead. Never reuse a retired code.
- One code has one severity (`error`, `warning` or `info`), one message
  template and, where the user can act, one hint.
- Every code used in the source is listed in `docs/validation-codes.md` with
  its severity, message template, hint and an example. A test fails if one is
  missing.
- Data problems are findings. They are never panics in Rust or exceptions in
  TypeScript. Nothing is fixed silently: every conversion, skip or default
  produces a finding with a count.
- Output is deterministic: same input, same findings, same order, same text.
  Never build output by iterating a `HashMap`; sort or use ordered maps.

## Commits

- One roadmap step is one commit, and the commit leaves the repository building
  with all checks passing. Keep a commit under about 150 changed lines;
  lockfiles, generated snapshots, fixtures and screenshots do not count. If a
  step is bigger, split it into sub-steps (for example 4.5a, 4.5b) in the
  roadmap.
- Tick the step in `docs/roadmap/phase-1.md` in the same commit that completes
  it.
- Format: `type(scope): description` (Conventional Commits), imperative mood,
  then a body that names the step and says what was verified.
- Types: `feat`, `fix`, `test`, `docs`, `chore`, `ci`, `refactor`, `style`,
  `perf`, and `build` for build-system changes.
- Scopes: `core`, `io`, `wasm`, `engine`, `ui`, `app`, `repo`, `ci`, `docs`.
- No unrelated changes in a commit. If you notice something else worth fixing,
  add it as a new step at the end of the current milestone in the roadmap.
- Never commit secrets, credentials, personal data, generated output (`pkg/`,
  `dist/`, `target/`, Playwright reports) or files over 1 MB (the font and the
  screenshot baselines are the only exceptions).
- Push after every commit. Never force-push, and never amend or rewrite pushed
  commits.

## Checks

Before every commit, run what the step touches; from step 0.10 on that is
`pnpm check`. A change is not done if a test, lint rule or type check was
disabled, skipped or weakened to make it pass. If a rule is wrong, say so and
record the decision in `docs/decisions.md`.

## Dependencies

The allowed licenses are listed in the license policy in
`docs/dependencies.md`; anything not listed needs the owner's approval. Add a
dependency in the step that first needs it, record it in `docs/dependencies.md`
in the same commit, use the latest stable version unless a documented constraint
forbids it, and commit the lockfile.

## UI tests

Every UI state is tested in a browser (`pnpm test:e2e`), on the gallery page now and the
app's own pages from step 7.1. The helpers are in `packages/app/e2e/support`:

- `assertNoOverflow(root, { window })` fails if anything inside `root` has content bigger than
  its box, or sticks out of the window. An element marked `data-scroll-region` may scroll;
  one marked `data-truncate` cuts its text with an ellipsis. Both exceptions are for the
  element itself: what is inside a scroll region must still fit it. `window` is `both` for
  a page that never scrolls, `horizontal` for one that scrolls down.
- `assertNoOverlap(a, b)`, `assertAdjacent(first, second, axis)` and
  `assertAligned(elements, edge)` (an edge, a centre, or the text baseline) for how elements sit.
- `expectNoSeriousViolations(page, selector)` runs axe; give a path of selectors
  (`['karmania-gallery', '[data-section="tabs"]']`) to look inside a shadow root.
- `inEveryLayout(page, path, check)` runs a check at 1024x640, 1440x900 and 1920x1080, in
  the light and the dark theme.

A helper that cannot fail proves nothing, so each one is tested against layouts that are
deliberately wrong as well as ones that are right.

### Screenshots

`pnpm test:visual` photographs every state of every component in the gallery (`e2e/gallery.visual.ts`)
at 1024x640, 1440x900 and 1920x1080, in both themes, and compares each picture with the one in
`packages/app/e2e/screenshots`. It needs Docker: the browser runs in the official Playwright image,
so that the same pixels come out on every machine and in CI. A difference is a failure, however
small; if the change is meant, `pnpm test:visual:update` takes the pictures again, and **the new
pictures must be looked at before they are committed**, with the checklist of section 7.5 of the
brief (nothing bleeds, clips, overflows or overlaps; edges and baselines line up; the composition
is balanced; truncated text has an ellipsis; focus rings show and are not clipped; dark mode is
readable; nothing shifts between states). A new state is a new entry in `SHOTS`.
