/**
 * `createViewer`: puts a viewer in an element of a page, and gives back what the page needs of it. The page owns
 * the container (its size and place); the viewer fills it.
 */
import type {
  DatasetInput,
  Engine,
  ImportMapping,
  ImportOptions,
  LoadOptions,
  LoadResult,
  Summary,
} from '@karmania/engine';
import type { Command, SceneDocument, SceneSelection, ViewMode } from '@karmania/scene';
import type { ExportPngOptions, ExportPngRun } from './export-compose.js';
import './viewer.js';

/** What a page can listen to, by the name that `on` takes, and what the listener of each is given. */
export interface ViewerEvents {
  /** The scene after each change of it (a command, the camera moving, a layer being drawn is not one). */
  readonly scene: SceneDocument;
  /**
   * The datasets that the viewer shows, in the order they were loaded, when they change: one was loaded or removed (by this viewer or by another that
   * has the same engine), or the contour lines of one were made again.
   */
  readonly datasets: readonly Summary[];
  /** What is selected on the map, which a click on a feature or a row of the Data tab changes: the layer and the element in it, or `null` when nothing is. */
  readonly selection: SceneSelection | null;
}

/** The name of something a page can listen to. */
export type ViewerEvent = keyof ViewerEvents;

/** What a page can ask of the viewer it creates. */
export interface ViewerOptions {
  /**
   * An engine that the viewer is to use instead of making its own, so that several viewers (or the page itself) can have the same data: the viewer shows
   * everything the engine holds, whoever loaded it, and follows what is loaded into it and removed from it. It is the page's: `dispose()` does not
   * dispose it. Each viewer keeps its own camera, styling and selection. Without it the viewer makes an engine of its own when the first data
   * arrives, and disposes it with itself.
   */
  readonly engine?: Engine;
  /**
   * Whether the viewer has its right panel, with the Legend and the Data tabs (default `true`). Without it the map has the whole viewer, and the page
   * changes layers with `dispatch`. The panel's width and the tab it was on are kept in the browser (per origin, for every viewer of the page): a
   * viewer without a panel neither reads nor writes them.
   */
  readonly panel?: boolean;
  /**
   * Whether the viewer has what brings files in: the Import buttons, dropping files on the map, and the import wizard (default `true`). Without it
   * `openImport` throws; data comes in with `load` or through an engine the page gives.
   */
  readonly importUi?: boolean;
}

/** A viewer that has been put in a page. */
export interface Viewer {
  /**
   * The engine of the viewer: the one the page gave in the options, or the viewer's own, which is started when this is first read or when the first
   * data arrives (a viewer that has none has no worker) and is disposed with the viewer. Read it to ask what is loaded (`engine.datasets()`), for the
   * rows of a dataset, or to give the same engine to another viewer.
   */
  readonly engine: Engine;
  /**
   * Loads a dataset made with a builder (`points`, `lines`, `polygons`, `grid`, `mesh`, `blocks`), as a file that is imported is: it is listed in the
   * Data tab, selected, and drawn. The engine takes the input's arrays, which are empty afterwards, so an input is loaded once. Resolves with what the
   * engine says: `loaded` with the summaries, or `blocked` with the findings (a problem with the data is a result, not a rejection), and then nothing
   * is added.
   */
  load(input: DatasetInput, options?: LoadOptions): Promise<LoadResult>;
  /**
   * Imports a file with a mapping, as the import wizard does but without it: the dataset is listed, selected and drawn. `files` is one data file and
   * its sidecars (a `.prj`); two data files are a mistake. Resolves like `load`. It works for a viewer made with `importUi: false`.
   */
  importFiles(
    files: readonly File[],
    mapping: ImportMapping,
    options?: ImportOptions,
  ): Promise<LoadResult>;
  /** The scene as it is now: a layer for each loaded dataset, the camera, the legend. */
  scene(): SceneDocument;
  /** Shows the data: the camera goes where all the visible layers that are prepared fit in the map area. */
  fit(): void;
  /** Changes the scene by a command, and gives the document that comes of it (the same one if nothing changed). */
  dispatch(command: Command): SceneDocument;
  /**
   * Shows the map in 2D or in 3D, looking at the same place: the centre, the heading and the scale at the centre are kept (the scale only if
   * the viewer has a size to measure; the centre and the heading always). Nothing happens if the map is in that view already.
   */
  setViewMode(mode: ViewMode): void;
  /**
   * The map as a PNG file: `widthPx` by `heightPx` pixels at `dpi` (written into the file, and the scale the map's points, lines and furniture are drawn at), with the legend to
   * the right of the map if `legend`, the north arrow, and the scale bar in 2D, always in the light theme. It shows at least what is visible on screen, with the same centre,
   * heading and view. The same scene and options give the same bytes twice in a row, in one browser. `onProgress` says how far it is, from 0 to 1.
   *
   * It rejects with an `Error` named `ExportError` (its `code` says why: `busy`, `interrupted` when the map was changed meanwhile, `context_lost`, `too_large`, `point_size`,
   * `out_of_memory`, `not_ready`), `ComposeError` (`no_room_for_map`: the legend takes the width), `ExportFontError`, `PngError`, or with the signal's reason if it is aborted.
   */
  exportPng(options: ExportPngOptions, run?: ExportPngRun): Promise<Blob>;
  /**
   * Opens the dialog for the map's coordinate system (the one the map is drawn in), with nothing chosen. Nothing happens while nothing is loaded:
   * the map has no coordinate system to change yet.
   */
  openMapCrs(): void;
  /** Opens the export dialog (size, resolution, legend, file name and a preview, and Export). Nothing happens while there is nothing drawn to export (`exportable`). */
  openExport(): void;
  /** Whether there is something drawn to export: at least one layer is shown on the map and has been drawn. The Export button is disabled while it is not. */
  exportable(): boolean;
  /** Calls `listener` when `exportable()` changes, with the new answer; gives the function that stops that (which may be called more than once). */
  onExportable(listener: (available: boolean) => void): () => void;
  /**
   * Calls `listener` each time `event` happens, with what `ViewerEvents` says of it: `scene` (the document after each change of it), `datasets` (what
   * the viewer shows, when it changes) or `selection` (what is selected on the map, when it changes). Nothing is called for what was so before
   * `on`: read `scene()`, `engine.datasets()` or `scene().selection` for that. Gives the function that stops listening, which may be called
   * more than once, also after the viewer was disposed; disposing the viewer stops every listener.
   *
   * @throws RangeError for an event that is not one of those, which is a mistake of the caller.
   */
  on<E extends ViewerEvent>(event: E, listener: (payload: ViewerEvents[E]) => void): () => void;
  /**
   * Opens the import wizard on `files`, or the browser's file picker when there are none to give (no list, or an empty one).
   * Throws if the viewer was made with `importUi: false`.
   */
  openImport(files?: readonly File[]): void;
  /**
   * Takes the viewer out of the page and frees what it holds: the engine and its worker, and the listeners on the
   * window. Calling it again does nothing; nothing else may be called after it.
   */
  dispose(): void;
}

/** An event that `on` does not know is a mistake of the page. */
function refuse(event: string): never {
  throw new RangeError(
    `The viewer has no event "${event}": it has "scene", "datasets" and "selection".`,
  );
}

/**
 * Puts a viewer in `container`, which has to have a size: the viewer is as tall and as wide as it is.
 *
 * @throws Error from `engine`, `load`, `importFiles`, `openMapCrs`, `openImport` (also if the viewer was made with `importUi: false`), `scene`, `dispatch`, `fit`, `setViewMode`, `exportPng`, `openExport`, `exportable`, `onExportable` and `on` if the viewer has been disposed, which is a mistake of the caller;
 * `setViewMode` also throws a RangeError for a mode that is not `2d` or `3d`. Disposing stops every listener that `on` gave.
 */
export function createViewer(container: HTMLElement, options: ViewerOptions = {}): Viewer {
  const element = document.createElement('karmania-viewer');
  element.withPanel = options.panel ?? true;
  element.withImportUi = options.importUi ?? true;
  if (options.engine !== undefined) {
    element.useEngine(options.engine);
  }
  container.append(element);
  let disposed = false;
  /** The ways to stop the listeners that were added, which `dispose` uses: a viewer that is gone is not listened to. */
  const listening = new Set<() => void>();
  const alive = (): void => {
    if (disposed) {
      throw new Error('The viewer has been disposed.');
    }
  };
  /** How each event is listened to on the element. */
  const subscribers: {
    readonly [E in ViewerEvent]: (listener: (payload: ViewerEvents[E]) => void) => () => void;
  } = {
    scene: (listener) =>
      element.subscribeToScene((scene) => {
        listener(scene);
      }),
    datasets: (listener) =>
      element.subscribeToDatasets((datasets) => {
        listener(datasets);
      }),
    // The selection is a part of the scene, which keeps the object while it is the same: a different one is a change.
    selection: (listener) =>
      element.subscribeToScene((scene, previous) => {
        if (scene.selection !== previous.selection) {
          listener(scene.selection);
        }
      }),
  };
  return {
    get engine() {
      alive();
      return element.getEngine();
    },
    load(input, loadOptions) {
      alive();
      return element.load(input, loadOptions);
    },
    importFiles(files, mapping, importOptions) {
      alive();
      return element.importFiles(files, mapping, importOptions);
    },
    openMapCrs() {
      alive();
      element.openMapCrs();
    },
    scene() {
      alive();
      return element.scene();
    },
    fit() {
      alive();
      element.fit();
    },
    dispatch(command) {
      alive();
      return element.dispatch(command);
    },
    setViewMode(mode) {
      alive();
      element.setViewMode(mode);
    },
    exportPng(options, run) {
      alive();
      return element.exportPng(options, run);
    },
    openExport() {
      alive();
      element.openExport();
    },
    exportable() {
      alive();
      return element.exportable();
    },
    onExportable(listener) {
      alive();
      const unsubscribe = element.subscribeToExportable(listener);
      const stop = (): void => {
        if (listening.delete(stop)) {
          unsubscribe();
        }
      };
      listening.add(stop);
      return stop;
    },
    on(event, listener) {
      alive();
      const unsubscribe = Object.hasOwn(subscribers, event)
        ? (subscribers[event] as (listen: typeof listener) => () => void)(listener)
        : refuse(event);
      const stop = (): void => {
        // Once: stopping a listener that is stopped already (by the caller, or by the disposal) does nothing.
        if (listening.delete(stop)) {
          unsubscribe();
        }
      };
      listening.add(stop);
      return stop;
    },
    openImport(files) {
      alive();
      element.openImport(files);
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        for (const stop of [...listening]) {
          stop();
        }
        element.remove();
      }
    },
  };
}
