/// <reference types="node" />
/**
 * That Node stays up when the built kernel looks up and searches EPSG codes many times.
 *
 * V8 compiles a function that is called often with its optimising compiler, in the background.
 * The definitions used to be found with one function of thousands of arms (`from_code` of the
 * `crs-definitions` crate), too large for that compiler: after a few dozen calls Node 24 died with
 * `Fatal process out of memory: Zone`, a little after the work was done, so that a test could pass and
 * the process still end in an abort (step 12.F7 in docs/decisions.md). The definitions are a table
 * now. The lookups run in a process of their own, since an abort would take this one with it.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const glue = fileURLToPath(new URL('../wasm/karmania_wasm.js', import.meta.url));
const wasm = fileURLToPath(new URL('../wasm/karmania_wasm_bg.wasm', import.meta.url));

/** What the process does: a few thousand lookups and a few searches, then waits for V8's compile. */
const SCRIPT = `
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { initSync, crsInfo, searchCrs } = await import(pathToFileURL(${JSON.stringify(glue)}).href);
initSync({ module: readFileSync(${JSON.stringify(wasm)}) });
for (let i = 0; i < 3000; i += 1) {
  crsInfo(1 + (i % 65535));
}
for (let i = 0; i < 20; i += 1) {
  searchCrs('zone ' + String(i), 20);
}
await new Promise((resolve) => setTimeout(resolve, 3000));
console.log('still up');
`;

describe('the built kernel in Node', () => {
  it('stays up through thousands of lookups and many searches, and after them', () => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', SCRIPT], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.stderr).not.toContain('Fatal process out of memory');
    expect({ status: run.status, signal: run.signal }).toEqual({ status: 0, signal: null });
    expect(run.stdout.trim()).toBe('still up');
  }, 90_000);
});
