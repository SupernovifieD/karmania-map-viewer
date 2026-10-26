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
