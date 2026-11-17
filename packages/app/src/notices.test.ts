/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * THIRD_PARTY_NOTICES.md (step 23.5) lists the Rust crates that are in the WebAssembly module, each with the version it is built from. The list is made from `cargo tree`, by hand, so
 * what this checks is that it has not gone stale: every row is a crate that `Cargo.lock` has, at that version (a crate that was updated or removed is found at once). The other half,
 * that a crate that was added is in the list, needs cargo: `cargo tree -p karmania-wasm --target wasm32-unknown-unknown -e normal,no-proc-macro` is the command, and it is in the file.
 * What the JavaScript has is checked against the build in `library-build.test.ts`.
 */
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const notices = readFileSync(join(repo, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const lock = readFileSync(join(repo, 'Cargo.lock'), 'utf8');

/** The crates of the table of the Rust crates, as `name version`. */
function listed(): string[] {
  const section = notices.slice(notices.indexOf('## Rust crates in the WebAssembly module'));
  const table = section.slice(
    section.indexOf('| Crate '),
    section.indexOf('\n\n', section.indexOf('| Crate ')),
  );
  return table
    .split('\n')
    .slice(2)
    .map((row) => row.split('|').map((cell) => cell.trim()))
    .map((cells) => `${cells[1] ?? ''} ${cells[2] ?? ''}`);
}

describe('the Rust crates in THIRD_PARTY_NOTICES.md', () => {
  it('are crates that Cargo.lock has, at the versions that are listed', () => {
    const crates = listed();
    // A list that is found to be empty would find no fault.
    expect(crates.length).toBeGreaterThan(20);
    const locked = new Set(
      [...lock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)].map(
        (match) => `${match[1] ?? ''} ${match[2] ?? ''}`,
      ),
    );
    expect(crates.filter((crate) => !locked.has(crate))).toEqual([]);
  });

  it('are listed once each, and include the ones that matter most for the terms of the build', () => {
    const names = listed().map((crate) => crate.split(' ')[0]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of [
      'crs-definitions',
      'earcut',
      'proj4rs',
      'serde_json',
      'wasm-bindgen',
      'libm',
    ]) {
      expect(names, name).toContain(name);
    }
  });
});
