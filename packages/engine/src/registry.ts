/**
 * The datasets an engine holds, as the main thread knows them, and who wants to hear
 * when they change. The worker is where the data are; this is only the list of summaries.
 */
import type { Summary } from './types.js';

/** Something that wants to hear about changes. */
type Listener = (summaries: readonly Summary[]) => void;

/** The list of datasets, and the listeners of its changes. */
export interface Registry {
  /**
   * The datasets in the order they were loaded. A list is never changed once it is
   * given out: a change makes a new one, so one kept earlier stays as it was.
   */
  readonly summaries: () => readonly Summary[];
  /** Adds datasets after the ones there are, and tells the listeners. */
  readonly add: (added: readonly Summary[]) => void;
  /** Takes out a dataset and tells the listeners. Does nothing if there is none with that id. */
  readonly remove: (id: number) => void;
  /** Calls `listener` after every change. Returns the function that ends that. */
  readonly subscribe: (listener: Listener) => () => void;
  /** Empties the list and drops the listeners, without telling them. */
  readonly clear: () => void;
}

/** Where an error thrown by a listener goes. By default it is thrown outside the engine. */
export type ReportError = (error: unknown) => void;

const throwLater: ReportError = (error) => {
  queueMicrotask(() => {
    throw error;
  });
};

/**
 * Makes an empty registry. A listener that throws does not stop the others hearing of
 * the change: its error goes to `reportError`, as an error in an event listener does.
 */
export function createRegistry(reportError: ReportError = throwLater): Registry {
  let current: readonly Summary[] = [];
  // Each subscription is its own object, so the same function can subscribe twice. It
  // remembers the last list it was given, so that a change made by one listener while
  // the others are being told reaches them once, and never as an older list after it.
  interface Subscription {
    readonly listener: Listener;
    told: readonly Summary[];
  }
  const subscriptions = new Set<Subscription>();

  function announce(): void {
    for (const subscription of [...subscriptions]) {
      // One that ended while the others were being told is not told, nor is one that
      // has already heard of the latest change.
      if (!subscriptions.has(subscription) || subscription.told === current) {
        continue;
      }
      subscription.told = current;
      try {
        subscription.listener(current);
      } catch (error) {
        reportError(error);
      }
    }
  }

  return {
    summaries: () => current,
    add: (added) => {
      if (added.length > 0) {
        current = [...current, ...added];
        announce();
      }
    },
    remove: (id) => {
      if (current.some((summary) => summary.id === id)) {
        current = current.filter((summary) => summary.id !== id);
        announce();
      }
    },
    subscribe: (listener) => {
      const subscription: Subscription = { listener, told: current };
      subscriptions.add(subscription);
      return () => {
        subscriptions.delete(subscription);
      };
    },
    clear: () => {
      current = [];
      subscriptions.clear();
    },
  };
}
