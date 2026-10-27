/**
 * The engine's public interface: what `createEngine` makes and what its methods take
 * and give. The data types they use are in `types.ts` and `inputs.ts`.
 */
import type { DatasetInput } from './inputs.js';
import { PHASES } from './types.js';
import type { ImportMapping, LoadResult, Page, Preview, Summary } from './types.js';

/** Where the engine's files are, when they are not where the bundler put them. */
export interface EngineOptions {
  /** The worker's script. Defaults to the one that ships with the engine. */
  readonly workerUrl?: string | URL;
  /** The WebAssembly module. Defaults to the one beside the generated script. */
  readonly wasmUrl?: string | URL;
}

/** The stages of an import, in order. The file is read first, then the kernel takes over. */
export const IMPORT_PHASES = ['reading', ...PHASES] as const;

/** A stage of an import. */
export type ImportPhase = (typeof IMPORT_PHASES)[number];

/** How far an import has got, for a progress bar. */
export interface ImportProgress {
  readonly phase: ImportPhase;
  /** How much of this phase is done, from 0 to 1. Each phase starts again at 0. */
  readonly fraction: number;
}

/** Optional parts of `importFiles`. */
export interface ImportOptions {
  /** Aborting stops the import, drops what it has read and rejects with the signal's reason. */
  readonly signal?: AbortSignal;
  /** Called as the import advances, from the main thread. */
  readonly onProgress?: (progress: ImportProgress) => void;
}

/** Optional parts of `load`. */
export interface LoadOptions {
  /**
   * Aborting before the worker starts loading rejects with the signal's reason. A load
   * that has started cannot be interrupted and finishes.
   */
  readonly signal?: AbortSignal;
}

/** What the engine announces, by event name, with what each listener receives. */
export interface EngineEvents {
  /** Every loaded dataset, in the order they were loaded, after any change. */
  readonly datasets: readonly Summary[];
}

/** The name of something the engine announces. */
export type EngineEvent = keyof EngineEvents;

/**
 * An engine: a worker with the kernel in it, and the datasets it holds. Each engine
 * has its own, so a page can have several. Data problems come back as findings;
 * methods reject only for misuse, such as calling an engine after `dispose`.
 */
export interface Engine {
  /**
   * Looks at files before they are imported. A data file and a `.prj` of the same name
   * are looked at together: the result has one preview for each file that is not a
   * sidecar of another, in the order given.
   */
  preview(files: readonly File[]): Promise<readonly Preview[]>;

  /**
   * Imports a data file with a mapping. `files` holds one data file and, if it has any,
   * its sidecars; two data files are misuse. Resolves with the new datasets, or with the
   * findings that blocked them.
   */
  importFiles(
    files: readonly File[],
    mapping: ImportMapping,
    options?: ImportOptions,
  ): Promise<LoadResult>;

  /**
   * Loads a dataset made with a builder. This consumes `input`: its typed arrays go to
   * the worker and are empty afterwards, so an input can be loaded once.
   */
  load(input: DatasetInput, options?: LoadOptions): Promise<LoadResult>;

  /** The loaded datasets, in the order they were loaded. */
  datasets(): readonly Summary[];

  /**
   * Rows `start` to `start + count` of a dataset, counting from 0: fewer at the end of the
   * data, none past it, and never more than 100,000. Small windows are read through a
   * cache, so asking again for rows just read costs nothing. A window that is not a whole
   * number of rows, or starts before row 0, is misuse.
   */
  rows(id: number, start: number, count: number): Promise<Page>;

  /** Unloads a dataset. */
  remove(id: number): Promise<void>;

  /** Calls `listener` whenever the event happens. Returns the function that stops that. */
  on<E extends EngineEvent>(event: E, listener: (payload: EngineEvents[E]) => void): () => void;

  /** Stops the worker and frees everything it held. Later calls are misuse. */
  dispose(): void;
}
