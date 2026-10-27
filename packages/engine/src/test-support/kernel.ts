/// <reference types="node" />
/**
 * Loads the built WebAssembly kernel in Node, for tests. It needs
 * `pnpm build:wasm` to have run, which `pnpm check` and CI do first.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as generated from '../../wasm/karmania_wasm.js';
import { kernelModuleOf } from '../kernel-module.js';
import type { KernelApi, KernelModule } from '../kernel-module.js';

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

/** The kernel module as the worker handler takes it, initialised. */
export function testKernelModule(): KernelModule {
  loadKernel();
  return kernelModuleOf(generated);
}

/** One of the sample files in the repository's `fixtures/` directory, as a `File`. */
export function fixtureFile(name: string): File {
  return new File([fixtureBytes(name).slice()], name);
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
  readonly load: (input: unknown) => unknown;
  readonly rows: (datasetId: number, start: number, count: number) => unknown;
  readonly summary: (datasetId: number) => unknown;
  readonly remove: (datasetId: number) => boolean;
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
    load: (input) => kernel.load(input) as unknown,
    rows: (datasetId, start, count) => kernel.rows(datasetId, start, count) as unknown,
    summary: (datasetId) => kernel.summary(datasetId) as unknown,
    remove: (datasetId) => kernel.remove(datasetId),
    free: () => {
      kernel.free();
    },
  };
}

/**
 * Typed arrays made in another JavaScript realm, as arrays handed over from another
 * window or worker are: `instanceof Float64Array` is false for them.
 */
export function foreignArrays(): {
  readonly floats: Float64Array;
  readonly unsigned: Uint32Array;
} {
  return runInNewContext(
    '({ floats: new Float64Array([1, 2]), unsigned: new Uint32Array([0, 2]) })',
  ) as {
    floats: Float64Array;
    unsigned: Uint32Array;
  };
}

/** The methods of a kernel as plain properties, so a test can replace some of them. */
export function wrapKernel(kernel: KernelApi): { -readonly [K in keyof KernelApi]: KernelApi[K] } {
  return {
    startImport: (fileName, bytes, mapping) => kernel.startImport(fileName, bytes, mapping),
    stepImport: (importId, budget) => kernel.stepImport(importId, budget),
    cancelImport: (importId) => kernel.cancelImport(importId),
    load: (input) => kernel.load(input),
    rows: (dataset, start, count) => kernel.rows(dataset, start, count),
    remove: (dataset) => kernel.remove(dataset),
    free: () => {
      kernel.free();
    },
  };
}
