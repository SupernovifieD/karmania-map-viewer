/// <reference types="node" />
/**
 * Loads the built WebAssembly kernel in Node, for tests. It needs
 * `pnpm build:wasm` to have run, which `pnpm check` and CI do first.
 */
import { readFileSync } from 'node:fs';
import * as generated from '../../wasm/karmania_wasm.js';

/** A set of attribute columns for building a dataset from arrays. */
export type TestColumns = generated.ColumnSet;

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

/** One kernel object, as the tests see it: results are `unknown` and must be checked. */
export interface TestKernelInstance {
  readonly startImport: (fileName: string, bytes: Uint8Array, mapping: unknown) => number;
  readonly stepImport: (importId: number, budgetRows: number) => unknown;
  readonly cancelImport: (importId: number) => boolean;
  readonly datasets: () => unknown;
  readonly loadPoints: (
    name: string,
    crs: unknown,
    x: Float64Array,
    y: Float64Array,
    z?: Float64Array,
    columns?: TestColumns,
  ) => unknown;
  readonly free: () => void;
}

/** A new kernel with nothing loaded. Each one is independent of the others. */
export function createKernel(): TestKernelInstance {
  loadKernel();
  const kernel = new generated.Kernel();
  return {
    startImport: (fileName, bytes, mapping) => kernel.startImport(fileName, bytes, mapping),
    stepImport: (importId, budgetRows) => kernel.stepImport(importId, budgetRows) as unknown,
    cancelImport: (importId) => kernel.cancelImport(importId),
    datasets: () => kernel.datasets() as unknown,
    loadPoints: (name, crs, x, y, z, columns) =>
      kernel.loadPoints(name, crs, x, y, z, columns) as unknown,
    free: () => {
      kernel.free();
    },
  };
}

/** A new, empty set of attribute columns. */
export function createColumns(): TestColumns {
  loadKernel();
  return new generated.ColumnSet();
}
