/**
 * The WebAssembly kernel as the worker uses it. The generated bindings call every result
 * `any`; here each one is `unknown`, so what the kernel returns has to be checked before
 * it is used, as anything that crosses the boundary does.
 */

/** One kernel: its datasets and the imports in progress. Kernels share nothing. */
export interface KernelApi {
  readonly startImport: (fileName: string, bytes: Uint8Array, mapping: unknown) => number;
  readonly stepImport: (importId: number, budgetRows: number) => unknown;
  readonly cancelImport: (importId: number) => boolean;
  readonly load: (input: unknown) => unknown;
  readonly rows: (datasetId: number, start: number, count: number) => unknown;
  readonly remove: (datasetId: number) => boolean;
  /** Releases the kernel's memory. */
  readonly free: () => void;
}

/** The loaded WebAssembly module: what is not tied to one kernel, and a way to make one. */
export interface KernelModule {
  readonly version: () => string;
  readonly preview: (fileName: string, bytes: Uint8Array, sidecars: unknown) => unknown;
  readonly createKernel: () => KernelApi;
}

/** Loads the module (fetching the `.wasm` file, if it is not at the usual place from `wasmUrl`). */
export type LoadKernelModule = (options: { readonly wasmUrl?: string }) => Promise<KernelModule>;

/** The part of the generated bindings the worker uses. */
export interface GeneratedBindings {
  readonly version: () => string;
  readonly preview: (fileName: string, bytes: Uint8Array, sidecars: unknown) => unknown;
  readonly Kernel: new () => KernelApi;
}

/** Wraps the generated bindings, once the module is initialised, as a `KernelModule`. */
export function kernelModuleOf(generated: GeneratedBindings): KernelModule {
  return {
    version: () => generated.version(),
    preview: (fileName, bytes, sidecars) => generated.preview(fileName, bytes, sidecars),
    createKernel: () => new generated.Kernel(),
  };
}
