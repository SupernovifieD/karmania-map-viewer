/**
 * `createViewer`: puts a viewer in an element of a page, and gives back what the page needs of it. The page owns
 * the container (its size and place); the viewer fills it.
 */
import type { Command, SceneDocument, ViewMode } from '@karmania/scene';
import './viewer.js';

/** What a page can listen to: the scene (more arrive with the rest of the API). */
export type ViewerEvent = 'scene';

/** A viewer that has been put in a page. */
export interface Viewer {
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
   * Calls `listener` with the scene after each change of it, and gives the function that stops that (which may be called more than once,
   * also after the viewer was disposed).
   */
  on(event: ViewerEvent, listener: (scene: SceneDocument) => void): () => void;
  /** Opens the import wizard on `files`, or the browser's file picker when there are none to give (no list, or an empty one). */
  openImport(files?: readonly File[]): void;
  /**
   * Takes the viewer out of the page and frees what it holds: the engine and its worker, and the listeners on the
   * window. Calling it again does nothing; nothing else may be called after it.
   */
  dispose(): void;
}

/**
 * Puts a viewer in `container`, which has to have a size: the viewer is as tall and as wide as it is.
 *
 * @throws Error from `openImport`, `scene`, `dispatch`, `fit`, `setViewMode` and `on` if the viewer has been disposed, which is a mistake of the caller;
 * `setViewMode` also throws a RangeError for a mode that is not `2d` or `3d`. Disposing stops every listener that `on` gave.
 */
export function createViewer(container: HTMLElement): Viewer {
  const element = document.createElement('karmania-viewer');
  container.append(element);
  let disposed = false;
  /** The ways to stop the listeners that were added, which `dispose` uses: a viewer that is gone is not listened to. */
  const listening = new Set<() => void>();
  const alive = (): void => {
    if (disposed) {
      throw new Error('The viewer has been disposed.');
    }
  };
  return {
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
    on(_event, listener) {
      alive();
      const unsubscribe = element.subscribeToScene((scene) => {
        listener(scene);
      });
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
