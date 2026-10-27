/**
 * The worker's side of the protocol: takes requests, runs them on the kernel and posts
 * the replies. It knows nothing about workers: it is given the kernel's loader and a
 * `post` function, so tests can run it on the real kernel in Node, and the worker entry
 * is a few lines that connect it to the worker's scope.
 */
import {
  checkedImportStatus,
  checkedLoadResult,
  checkedPage,
  checkedPreview,
} from './contract-check.js';
import { serializeError } from './errors.js';
import { assertNever } from './exhaustive.js';
import type { KernelApi, KernelModule, LoadKernelModule } from './kernel-module.js';
import { parseToWorker } from './protocol.js';
import type { FromWorker, RequestMessage, Requests } from './protocol.js';
import type { LoadResult, Page, Preview } from './types.js';

/** What the handler needs from its surroundings. */
export interface HandlerOptions {
  readonly loadModule: LoadKernelModule;
  /** Sends a reply to the main thread, handing over the buffers in `transfer`. */
  readonly post: (message: FromWorker, transfer: readonly Transferable[]) => void;
}

/** Takes what the worker receives. */
export interface WorkerHandler {
  /** Handles one message. Anything that is not a request or a cancel is ignored. */
  readonly handle: (data: unknown) => void;
}

/** How many rows an import parses before it lets other messages through. */
const IMPORT_BUDGET_ROWS = 50_000;

/** Thrown inside a request to unwind it when the main thread asked for it to stop. */
class Cancelled extends Error {}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** The buffers of a page that can be handed over instead of copied. */
function pageBuffers(page: Page): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  for (const column of page.columns) {
    for (const array of [column.values, column.nulls]) {
      if (ArrayBuffer.isView(array) && array.buffer instanceof ArrayBuffer) {
        buffers.push(array.buffer);
      }
    }
  }
  return buffers;
}

interface Session {
  readonly module: KernelModule;
  readonly kernel: KernelApi;
}

/** A reply and the buffers that go with it. */
interface Outgoing {
  readonly reply: FromWorker;
  readonly transfer: readonly Transferable[];
}

/** Makes the handler for one worker. */
export function createWorkerHandler(options: HandlerOptions): WorkerHandler {
  const { loadModule, post } = options;
  let starting: Promise<Session> | undefined;
  // The requests being worked on, and those among them the main thread wants stopped.
  const inFlight = new Set<number>();
  const stopRequested = new Set<number>();

  async function ready(): Promise<Session> {
    if (starting === undefined) {
      throw new Error('The worker has not been initialised: send an "init" request first.');
    }
    return starting;
  }

  function throwIfStopped(id: number): void {
    if (stopRequested.has(id)) {
      throw new Cancelled();
    }
  }

  function init(params: Requests['init']['params']): Promise<Requests['init']['result']> {
    if (starting !== undefined) {
      return Promise.reject(new Error('The worker is already initialised.'));
    }
    starting = (async () => {
      const module = await loadModule(params);
      return { module, kernel: module.createKernel() };
    })();
    return starting.then(({ module }) => ({ version: module.version() }));
  }

  async function preview(
    id: number,
    params: Requests['preview']['params'],
  ): Promise<readonly Preview[]> {
    const { module } = await ready();
    const previews: Preview[] = [];
    for (const group of params.groups) {
      throwIfStopped(id);
      const bytes = await readBytes(group.file);
      const sidecars = await Promise.all(
        group.sidecars.map(async (file) => ({ name: file.name, bytes: await readBytes(file) })),
      );
      previews.push(checkedPreview(module.preview(group.file.name, bytes, sidecars)));
    }
    return previews;
  }

  async function runImport(id: number, params: Requests['import']['params']): Promise<LoadResult> {
    const { kernel } = await ready();
    throwIfStopped(id);
    const bytes = await readBytes(params.file);
    throwIfStopped(id);
    const importId = kernel.startImport(params.file.name, bytes, params.mapping);
    try {
      for (;;) {
        throwIfStopped(id);
        const status = checkedImportStatus(kernel.stepImport(importId, IMPORT_BUDGET_ROWS));
        if (status.status === 'done') {
          return status.result;
        }
        await yieldToEventLoop();
      }
    } catch (error) {
      // Whatever stopped the import, what it had read is dropped (a no-op once it is done).
      kernel.cancelImport(importId);
      throw error;
    }
  }

  async function execute(message: RequestMessage): Promise<Outgoing> {
    const { id } = message;
    switch (message.type) {
      case 'init':
        return {
          reply: { type: 'result', id, request: 'init', result: await init(message.params) },
          transfer: [],
        };
      case 'preview':
        return {
          reply: {
            type: 'result',
            id,
            request: 'preview',
            result: await preview(id, message.params),
          },
          transfer: [],
        };
      case 'import':
        return {
          reply: {
            type: 'result',
            id,
            request: 'import',
            result: await runImport(id, message.params),
          },
          transfer: [],
        };
      case 'load': {
        const { kernel } = await ready();
        throwIfStopped(id);
        const result = checkedLoadResult(kernel.load(message.params.input));
        return { reply: { type: 'result', id, request: 'load', result }, transfer: [] };
      }
      case 'rows': {
        const { kernel } = await ready();
        const { dataset, start, count } = message.params;
        const page = checkedPage(kernel.rows(dataset, start, count));
        return {
          reply: { type: 'result', id, request: 'rows', result: page },
          transfer: pageBuffers(page),
        };
      }
      case 'remove': {
        const { kernel } = await ready();
        const removed = kernel.remove(message.params.dataset);
        return { reply: { type: 'result', id, request: 'remove', result: removed }, transfer: [] };
      }
      default:
        return assertNever(message);
    }
  }

  async function run(message: RequestMessage): Promise<void> {
    inFlight.add(message.id);
    let outgoing: Outgoing;
    try {
      outgoing = await execute(message);
    } catch (error) {
      outgoing = {
        reply:
          error instanceof Cancelled
            ? { type: 'cancelled', id: message.id }
            : { type: 'error', id: message.id, error: serializeError(error) },
        transfer: [],
      };
    }
    inFlight.delete(message.id);
    stopRequested.delete(message.id);
    post(outgoing.reply, outgoing.transfer);
  }

  return {
    handle(data) {
      const message = parseToWorker(data);
      if (message === undefined) {
        return;
      }
      if (message.type === 'cancel') {
        // A cancel for something already answered has nothing left to stop.
        if (inFlight.has(message.target)) {
          stopRequested.add(message.target);
        }
        return;
      }
      void run(message);
    },
  };
}
