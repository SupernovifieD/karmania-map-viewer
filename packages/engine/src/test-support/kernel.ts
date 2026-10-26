/// <reference types="node" />
/**
 * Loads the built WebAssembly kernel in Node, for tests. It needs
 * `pnpm build:wasm` to have run, which `pnpm check` and CI do first.
 */
import { readFileSync } from 'node:fs';
import * as generated from '../../wasm/karmania_wasm.js';

/**
 * The kernel as the tests see it. The generated types call every result `any`;
 * here results are `unknown`, so a test has to check what it gets, as the engine
 * does with anything that crosses the boundary.
 */
export interface TestKernel {
  readonly version: () => string;
  readonly preview: (fileName: string, bytes: Uint8Array, sidecars?: unknown) => unknown;
}

let loaded: TestKernel | undefined;

/** The kernel, with the module initialised (once). */
export function loadKernel(): TestKernel {
  if (loaded === undefined) {
    const wasm = readFileSync(new URL('../../wasm/karmania_wasm_bg.wasm', import.meta.url));
    generated.initSync({ module: wasm });
    loaded = {
      version: () => generated.version(),
      preview: (fileName, bytes, sidecars) =>
        generated.preview(fileName, bytes, sidecars) as unknown,
    };
  }
  return loaded;
}

/** The bytes of one of the sample files in the repository's `fixtures/` directory. */
export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../../../../fixtures/${name}`, import.meta.url)));
}
