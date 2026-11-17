import type { Page } from '@playwright/test';

/** What a page has made and let go of, of the things that must not be left behind when a viewer is disposed. */
export interface Leaks {
  /** Workers started, and workers terminated. */
  readonly workers: { readonly started: number; readonly terminated: number };
  /** WebGL contexts made (by any canvas), and how many of them the page still has (not lost). */
  readonly contexts: { readonly created: number; readonly live: number };
  /** Animation frames asked for that have neither come nor been cancelled. */
  readonly frames: number;
  /** Resize, mutation and intersection observers that have not been disconnected. */
  readonly observers: number;
  /** Listeners on the window, the document and media queries that have not been removed (a listener that is `once` or has a `signal` ends itself, and is not counted). */
  readonly listeners: number;
}

/** What the script that `trackLeaks` adds keeps. */
interface Kept {
  workers: { started: number; terminated: number };
  contexts: Set<WebGLRenderingContext | WebGL2RenderingContext>;
  frames: Set<number>;
  observers: Set<object>;
  listeners: Set<string>;
}

declare global {
  interface Window {
    /** What `trackLeaks` counts, kept by the script it adds to the page. */
    __leaks: Kept;
  }
}

/**
 * Counts what a page starts and does not let go of, from before any of its scripts run (call it before `goto`): workers, WebGL contexts, animation frames, observers, and
 * listeners on the window, the document and media queries. `read` gives the counts at the time it is called, so that a test can compare what the page had before a viewer
 * with what it has after the viewer is taken out.
 */
export async function trackLeaks(page: Page): Promise<() => Promise<Leaks>> {
  await page.addInitScript(() => {
    const kept: Kept = {
      workers: { started: 0, terminated: 0 },
      contexts: new Set(),
      frames: new Set(),
      observers: new Set(),
      listeners: new Set(),
    };
    window.__leaks = kept;

    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        kept.workers.started += 1;
      }
      override terminate(): void {
        kept.workers.terminated += 1;
        super.terminate();
      }
    };

    // Every WebGL context that a canvas gives, whoever asks.
    for (const Canvas of [HTMLCanvasElement, window.OffscreenCanvas]) {
      const prototype = Canvas.prototype as unknown as {
        getContext: (this: object, ...args: unknown[]) => unknown;
      };
      const getContext = prototype.getContext;
      prototype.getContext = function (this: object, ...args: unknown[]): unknown {
        const context = getContext.apply(this, args);
        if (context instanceof WebGL2RenderingContext || context instanceof WebGLRenderingContext) {
          kept.contexts.add(context);
        }
        return context;
      };
    }

    const requestFrame = window.requestAnimationFrame.bind(window);
    const cancelFrame = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = requestFrame((time) => {
        kept.frames.delete(id);
        callback(time);
      });
      kept.frames.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      kept.frames.delete(id);
      cancelFrame(id);
    };

    const observable = window as unknown as Record<
      string,
      (new (...args: unknown[]) => { disconnect(): void }) | undefined
    >;
    for (const name of ['ResizeObserver', 'MutationObserver', 'IntersectionObserver']) {
      const Observer = observable[name];
      if (Observer === undefined) {
        continue;
      }
      observable[name] = class extends Observer {
        constructor(...args: unknown[]) {
          super(...args);
          kept.observers.add(this);
        }
        override disconnect(): void {
          kept.observers.delete(this);
          super.disconnect();
        }
      };
    }

    // Listeners on what outlives a viewer, by where, the type, the function and whether it listens while the event goes down.
    const names = new WeakMap<object, number>();
    let named = 0;
    const nameOf = (callback: unknown): number => {
      const object = callback as object;
      let name = names.get(object);
      if (name === undefined) {
        named += 1;
        name = named;
        names.set(object, name);
      }
      return name;
    };
    const where = (target: unknown): string | undefined =>
      target === window
        ? 'window'
        : target === document
          ? 'document'
          : target instanceof MediaQueryList
            ? 'media'
            : undefined;
    const capturing = (options: unknown): boolean =>
      options === true ||
      (typeof options === 'object' &&
        options !== null &&
        (options as AddEventListenerOptions).capture === true);
    const endsItself = (options: unknown): boolean =>
      typeof options === 'object' &&
      options !== null &&
      ((options as AddEventListenerOptions).once === true ||
        (options as AddEventListenerOptions).signal !== undefined);
    type Listening = (this: object, type: string, callback: unknown, options?: unknown) => void;
    const target = EventTarget.prototype as unknown as {
      addEventListener: Listening;
      removeEventListener: Listening;
    };
    const add = target.addEventListener;
    const remove = target.removeEventListener;
    target.addEventListener = function (this: object, type, callback, options): void {
      const place = where(this);
      if (place !== undefined && callback !== null && !endsItself(options)) {
        kept.listeners.add(
          `${place} ${type} ${String(nameOf(callback))} ${String(capturing(options))}`,
        );
      }
      add.call(this, type, callback, options);
    };
    target.removeEventListener = function (this: object, type, callback, options): void {
      const place = where(this);
      if (place !== undefined && callback !== null) {
        kept.listeners.delete(
          `${place} ${type} ${String(nameOf(callback))} ${String(capturing(options))}`,
        );
      }
      remove.call(this, type, callback, options);
    };
  });
  return () =>
    page.evaluate(() => {
      const kept = window.__leaks;
      return {
        workers: { ...kept.workers },
        contexts: {
          created: kept.contexts.size,
          live: [...kept.contexts].filter((context) => !context.isContextLost()).length,
        },
        frames: kept.frames.size,
        observers: kept.observers.size,
        listeners: kept.listeners.size,
      };
    });
}
