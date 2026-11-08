/**
 * The engine's public interface: what `createEngine` makes and what its methods take
 * and give. The data types they use are in `types.ts` and `inputs.ts`.
 */
import type {
  ClassBreaks,
  ClassifyResult,
  ClassMethod,
  Frame,
  FrameChoice,
  PrepareProgress,
  PrepareResult,
} from './display.js';
import type { DatasetInput } from './inputs.js';
import { PHASES } from './types.js';
import type {
  CrsInfo,
  CrsRef,
  ImportMapping,
  LoadResult,
  Page,
  Preview,
  Summary,
} from './types.js';

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

/** What `prepare` is told: the frame to draw in, and the graphics card's limit on a texture. */
export interface PrepareParams {
  /** The frame from `chooseFrame`. */
  readonly frame: Frame;
  /** The largest texture the graphics card takes, in cells on a side. Defaults to 4,096. */
  readonly maxTextureSize?: number;
}

/** Optional parts of `prepare`. */
export interface PrepareOptions {
  /** Aborting stops the prepare, drops what it has made and rejects with the signal's reason. */
  readonly signal?: AbortSignal;
  /** Called, from the main thread, as the prepare advances. */
  readonly onProgress?: (progress: PrepareProgress) => void;
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
   * What an EPSG code means: its name, whether it is a longitude and latitude system, a
   * projected one or neither, and the unit of its axes. `undefined` if the code is not in the
   * definitions. The definitions are those of the EPSG Dataset, owned by IOGP. A code that is
   * not a whole number from 0 to 4,294,967,295 is misuse.
   */
  crsInfo(code: number): Promise<CrsInfo | undefined>;

  /**
   * Searches the EPSG definitions. The system whose code is the query (with or without `EPSG:`)
   * comes first, then those whose name starts with it, then those whose name contains it, without
   * regard to case and by code within each group. At most `limit`, and never more than 50. An
   * empty query finds nothing. A limit that is not a whole number from 0 to 4,294,967,295 is misuse.
   */
  searchCrs(query: string, limit: number): Promise<readonly CrsInfo[]>;

  /**
   * Rows `start` to `start + count` of a dataset, counting from 0: fewer at the end of the
   * data, none past it, and never more than 100,000. Small windows are read through a
   * cache, so asking again for rows just read costs nothing. A window that is not a whole
   * number of rows, or starts before row 0, is misuse.
   */
  rows(id: number, start: number, count: number): Promise<Page>;

  /** Unloads a dataset. */
  remove(id: number): Promise<void>;

  /**
   * Chooses the coordinate system the map is drawn in, and says which of the loaded datasets are drawn in
   * it. The frame stays for as long as any dataset is loaded: call this again after loading or removing,
   * and to change it with `preferred`, the system a person chose. `frame` is `null` when nothing is
   * loaded. A dataset that is not drawn stays loaded, and its findings say why. The origin is the centre of
   * the first dataset that is drawn in the map's system and is made once: if the person chose a system in
   * which nothing was drawn, it is 0, and the first call after a dataset can be drawn makes it, and then it
   * stays. A caller that has prepared layers against an origin of 0 has to prepare them again when the
   * origin in the frame it gets back is not the one it prepared them with.
   */
  chooseFrame(preferred?: CrsRef): Promise<FrameChoice>;

  /**
   * What `chooseFrame(preferred)` would answer now, **without choosing it**: the frame that would be made (with its origin) and which of
   * the loaded datasets would be drawn in it, each with its findings. The frame the engine keeps is not changed, nor is anything else, so
   * it can be asked as often as a person thinks of another system (the map CRS dialog's "What changes"), which `chooseFrame` cannot, since
   * it keeps what it answers. `frame` is `null` when nothing is loaded.
   */
  previewFrame(preferred: CrsRef): Promise<FrameChoice>;

  /**
   * Prepares a dataset for drawing in a frame: converts its positions, triangulates, rebases to the
   * frame's origin and cuts a grid into textures, in steps in the worker so that the page stays
   * responsive. The buffers of the result are handed over, not copied, and are the caller's to keep.
   * A dataset that cannot be drawn in the frame resolves with `status: "not_drawn"` and the reasons.
   */
  prepare(id: number, params: PrepareParams, options?: PrepareOptions): Promise<PrepareResult>;

  /**
   * Divides a column of a dataset into classes (`equal` intervals, `quantile`s, natural breaks as
   * `jenks`, or `categories`), with how many rows are in each. A column that cannot be classified (text
   * by ranges, a column with no values) resolves with `status: "not_classified"` and the reason. The
   * number of classes is a whole number from 1 to 254; categories show at most 20 values.
   */
  classify(
    id: number,
    column: string,
    method: ClassMethod,
    classes: number,
  ): Promise<ClassifyResult>;

  /**
   * The class of every element of a dataset under class breaks `classify` gave: one byte each, 255 for
   * an element with no value. For a grid of several layers, of which only the first is drawn, the elements are
   * the cells of that layer, and so are those `classify` counts. The array is handed over, not copied.
   */
  classIndex(id: number, breaks: ClassBreaks): Promise<Uint8Array>;

  /** Calls `listener` whenever the event happens. Returns the function that stops that. */
  on<E extends EngineEvent>(event: E, listener: (payload: EngineEvents[E]) => void): () => void;

  /** Stops the worker and frees everything it held. Later calls are misuse. */
  dispose(): void;
}
