/**
 * The script that runs in the worker. It has no exports: loading it starts the worker's
 * work. The engine starts it with `new Worker(url, { type: 'module' })`.
 */
import init, * as generated from '../wasm/karmania_wasm.js';
import { kernelModuleOf } from './kernel-module.js';
import { startWorker } from './worker.js';
import type { WorkerScope } from './worker.js';

// Inside a worker the global scope can post messages and receive them. The DOM types this
// package is compiled with describe a window instead, so say what is used of it.
const scope = globalThis as unknown as WorkerScope;

startWorker(scope, async ({ wasmUrl }) => {
  await init(wasmUrl === undefined ? undefined : { module_or_path: wasmUrl });
  return kernelModuleOf(generated);
});
