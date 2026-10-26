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
