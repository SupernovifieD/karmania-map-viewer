/**
 * The store of a scene: the document as it is now, a way to change it by a command, and a way to be told when
 * it changed. It holds nothing but its own document and its own listeners: there is no module state, so any
 * number of stores can live on one page without knowing of each other.
 */
import { applyCommand, type Command } from './commands.js';
import { emptyScene } from './empty.js';
import type { SceneDocument } from './types.js';

/** Called after the scene changed, with the new document and the one it replaced. */
export type SceneListener = (state: SceneDocument, previous: SceneDocument) => void;

/** A scene, and what can be done to it. */
export interface SceneStore {
  /** The document as it is now. The same object until a command changes it. */
  getState(): SceneDocument;
  /**
   * Applies a command. If it changed the document, the listeners are called, each once, in the order they were
   * added, and the new document is given back; if it changed nothing, no one is called and the document that
   * there was is given back.
   *
   * A command given by a listener is applied at once and its listeners called after those of the change that is
   * being told of, so that every listener hears of the changes in the order they were made.
   *
   * @throws if a listener throws, after all have been called (the first that threw); the change is made.
   * @throws TypeError for a command of a kind that there is not.
   */
  dispatch(command: Command): SceneDocument;
  /**
   * Adds a listener, and gives the way to take it away again (which may be used more than once). The same function added
   * twice is one listener, called once, and taking it away once takes it away.
   */
  subscribe(listener: SceneListener): () => void;
}

/**
 * Makes a store. The document it starts with is `initial`, which must be a document that `validateScene` accepts
 * (a document that came from outside is made one by `migrate` first), or the empty scene.
 */
export function createSceneStore(initial: SceneDocument = emptyScene()): SceneStore {
  let state = initial;
  const listeners = new Set<SceneListener>();
  const waiting: [SceneDocument, SceneDocument][] = [];
  let telling = false;

  function tell(): void {
    telling = true;
    const failures: unknown[] = [];
    try {
      for (let round = waiting.shift(); round !== undefined; round = waiting.shift()) {
        for (const listener of [...listeners]) {
          // One that was taken away by an earlier listener of this round is not called.
          if (listeners.has(listener)) {
            try {
              listener(round[0], round[1]);
            } catch (error) {
              failures.push(error);
            }
          }
        }
      }
    } finally {
      telling = false;
    }
    const [first] = failures;
    if (failures.length > 0) {
      throw first instanceof Error ? first : new Error(String(first));
    }
  }

  return {
    getState: () => state,
    dispatch(command) {
      const previous = state;
      const next = applyCommand(previous, command);
      if (next === previous) {
        return previous;
      }
      state = next;
      waiting.push([next, previous]);
      if (!telling) {
        tell();
      }
      return next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
