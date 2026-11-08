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
  /** Chooses the map's coordinate system and says which datasets are drawn in it. */
  readonly chooseFrame: (preferred: unknown) => unknown;
  /** What `chooseFrame` would say for `preferred`, without changing the frame the kernel keeps. */
  readonly previewFrame: (preferred: unknown) => unknown;
  /** Starts preparing a dataset for drawing; returns the job's id. */
  readonly startPrepare: (datasetId: number, frame: unknown, maxTextureSize: number) => number;
  /** Does the next part of a prepare. */
  readonly stepPrepare: (jobId: number, budget: number) => unknown;
  /** Stops a prepare; says whether there was one. */
  readonly cancelPrepare: (jobId: number) => boolean;
  /** Divides a column into classes. */
  readonly classify: (
    datasetId: number,
    column: string,
    method: string,
    classes: number,
  ) => unknown;
  /** The class of every element that is drawn under class breaks, one byte each. */
  readonly classIndex: (datasetId: number, breaks: unknown) => Uint8Array;
  /** Releases the kernel's memory. */
  readonly free: () => void;
}

/** The loaded WebAssembly module: what is not tied to one kernel, and a way to make one. */
export interface KernelModule {
  readonly version: () => string;
  readonly preview: (fileName: string, bytes: Uint8Array, sidecars: unknown) => unknown;
  /** What an EPSG code means, or `undefined` if it is not in the definitions. */
  readonly crsInfo: (code: number) => unknown;
  /** The EPSG definitions whose code or name matches the query, at most `limit` and never over 50. */
  readonly searchCrs: (query: string, limit: number) => unknown;
  readonly createKernel: () => KernelApi;
}

/** Loads the module (fetching the `.wasm` file, if it is not at the usual place from `wasmUrl`). */
export type LoadKernelModule = (options: { readonly wasmUrl?: string }) => Promise<KernelModule>;

/** The part of the generated bindings the worker uses. */
export interface GeneratedBindings {
  readonly version: () => string;
  readonly preview: (fileName: string, bytes: Uint8Array, sidecars: unknown) => unknown;
  readonly crsInfo: (code: number) => unknown;
  readonly searchCrs: (query: string, limit: number) => unknown;
  readonly Kernel: new () => KernelApi;
}

/** Wraps the generated bindings, once the module is initialised, as a `KernelModule`. */
export function kernelModuleOf(generated: GeneratedBindings): KernelModule {
  return {
    version: () => generated.version(),
    preview: (fileName, bytes, sidecars) => generated.preview(fileName, bytes, sidecars),
    crsInfo: (code) => generated.crsInfo(code),
    searchCrs: (query, limit) => generated.searchCrs(query, limit),
    createKernel: () => new generated.Kernel(),
  };
}
