/**
 * `createEngine`: starts a worker with the kernel in it and gives back the engine that
 * talks to it. Every engine has its own worker, client and datasets; nothing is shared
 * between engines, so a page can have as many as it needs.
 */
import type {
  Engine,
  EngineEvent,
  EngineEvents,
  EngineOptions,
  ImportOptions,
  LoadOptions,
} from './api.js';
import { createKernelClient, workerPort } from './client.js';
import type { ClientPort } from './client.js';
import { groupFiles } from './grouping.js';
import type { DatasetInput } from './inputs.js';
import { EngineDisposedError } from './errors.js';
import { createPageCache } from './page-cache.js';
import { createRegistry } from './registry.js';
import { transferablesOf } from './transfer.js';
import type { ImportMapping, LoadResult } from './types.js';

/** Makes the worker, at `workerUrl` or at the one that ships with the engine. */
function spawnWorker(workerUrl: string | URL | undefined): Worker {
  if (typeof Worker === 'undefined') {
    throw new Error(
      'Web Workers are not available here, so the engine cannot start. Create it in a browser.',
    );
  }
  // This exact form is what bundlers recognise and turn into a separate worker script.
  return workerUrl === undefined
    ? new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module' })
    : new Worker(workerUrl, { type: 'module' });
}

/** The address the worker should fetch the module from, made absolute where there is a page. */
function moduleAddress(wasmUrl: string | URL): string {
  return typeof location === 'undefined' ? String(wasmUrl) : new URL(wasmUrl, location.href).href;
}

/** Starts an engine with a worker of its own. */
export function createEngine(options: EngineOptions = {}): Engine {
  const port = workerPort(spawnWorker(options.workerUrl));
  return createEngineOnPort(
    port,
    options.wasmUrl === undefined ? {} : { wasmUrl: moduleAddress(options.wasmUrl) },
  );
}

/** Starts an engine on a port to a worker that is already running. */
export function createEngineOnPort(
  port: ClientPort,
  init: { readonly wasmUrl?: string } = {},
): Engine {
  const client = createKernelClient(port);
  const registry = createRegistry();
  const pages = createPageCache((dataset, start, count) =>
    client.request('rows', { dataset, start, count }),
  );
  // The dataset inputs whose arrays have gone to the worker.
  const consumed = new WeakSet<DatasetInput>();
  let disposed = false;

  // The worker answers requests that arrive before it is ready once it is, but if it
  // cannot start at all, the first call should say why rather than some later one.
  const started = client.request('init', init).then(() => undefined);
  started.catch(() => undefined);

  function assertUsable(): void {
    if (disposed) {
      throw new EngineDisposedError();
    }
  }

  function loaded(result: LoadResult): LoadResult {
    if (result.status === 'loaded') {
      registry.add(result.summaries);
    }
    return result;
  }

  return {
    preview: async (files) => {
      assertUsable();
      const groups = groupFiles(files);
      if (groups.length === 0) {
        return [];
      }
      await started;
      return client.request('preview', { groups });
    },

    importFiles: async (files, mapping: ImportMapping, importOptions: ImportOptions = {}) => {
      assertUsable();
      // One mapping describes the columns of one file, so there is one data file to import.
      // Its sidecars come along but are not read: the coordinate system is in the mapping.
      const [group, ...others] = groupFiles(files);
      if (group === undefined) {
        throw new TypeError('importFiles needs a data file to import.');
      }
      if (others.length > 0) {
        const names = [group, ...others].map((g) => `"${g.file.name}"`).join(', ');
        throw new TypeError(
          `importFiles imports one data file at a time, but was given ${names}. Call it once for each file.`,
        );
      }
      await started;
      const { signal, onProgress } = importOptions;
      return loaded(
        await client.request(
          'import',
          { file: group.file, mapping },
          {
            ...(signal === undefined ? {} : { signal }),
            ...(onProgress === undefined ? {} : { onProgress }),
          },
        ),
      );
    },

    load: async (input: DatasetInput, loadOptions: LoadOptions = {}) => {
      assertUsable();
      if (consumed.has(input)) {
        throw new TypeError(
          'This dataset input has already been loaded. Loading hands its arrays to the worker, so they are empty now; build the dataset again to load it again.',
        );
      }
      await started;
      const { signal } = loadOptions;
      const sending = client.request(
        'load',
        { input },
        { transfer: transferablesOf(input), ...(signal === undefined ? {} : { signal }) },
      );
      // Unless the signal was already aborted, the arrays were sent in the line above.
      if (signal?.aborted !== true) {
        consumed.add(input);
      }
      return loaded(await sending);
    },

    datasets: () => {
      assertUsable();
      return registry.summaries();
    },

    rows: async (id, start, count) => {
      assertUsable();
      await started;
      return pages.window(id, start, count);
    },

    remove: async (id) => {
      assertUsable();
      await started;
      const removed = await client.request('remove', { dataset: id });
      pages.forget(id);
      if (removed) {
        registry.remove(id);
      }
    },

    on: <E extends EngineEvent>(event: E, listener: (payload: EngineEvents[E]) => void) => {
      assertUsable();
      // `datasets` is the only event there is.
      return registry.subscribe(listener);
    },

    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      registry.clear();
      pages.clear();
      client.dispose();
    },
  };
}
