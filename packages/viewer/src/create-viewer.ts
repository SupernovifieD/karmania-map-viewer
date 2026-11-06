/**
 * `createViewer`: puts a viewer in an element of a page, and gives back what the page needs of it. The page owns
 * the container (its size and place); the viewer fills it.
 */
import './viewer.js';

/** A viewer that has been put in a page. */
export interface Viewer {
  /** Opens the import wizard on `files`, or the browser's file picker when there are none to give. */
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
 * @throws Error from `openImport` if the viewer has been disposed, which is a mistake of the caller.
 */
export function createViewer(container: HTMLElement): Viewer {
  const element = document.createElement('karmania-viewer');
  container.append(element);
  let disposed = false;
  return {
    openImport(files) {
      if (disposed) {
        throw new Error('The viewer has been disposed.');
      }
      element.openImport(files);
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        element.remove();
      }
    },
  };
}
