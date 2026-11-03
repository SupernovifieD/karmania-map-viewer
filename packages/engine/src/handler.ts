/**
 * The worker's side of the protocol: takes requests, runs them on the kernel and posts
 * the replies. It knows nothing about workers: it is given the kernel's loader and a
 * `post` function, so tests can run it on the real kernel in Node, and the worker entry
 * is a few lines that connect it to the worker's scope.
 */
import {
  checkedClassBreaks,
  checkedClassifyResult,
  checkedClassMethod,
  checkedFrame,
  checkedFrameChoice,
  checkedPrepareStep,
} from './display-check.js';
import type { PrepareResult } from './display.js';
import {
  checkedCrsInfo,
  checkedCrsInfoList,
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
import type { ImportPhase } from './api.js';
import { transferablesOfResult } from './transfer.js';
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

/**
 * How much of a prepare is done in one step: positions, polygon vertices or blocks (a tile of a warped
 * grid is a step of its own). Most steps take under 0.1 s, but two cannot be cut: the triangulation of one
 * polygon (up to 100,000 vertices) and the triangles of a surface, which in WebAssembly on a 1.1 GHz laptop
 * took up to about 0.4 s each (docs/perf.md). A request to stop, or any other request, is heard between steps.
 */
const PREPARE_BUDGET = 100_000;

/** The largest texture, in cells on a side, a grid is cut for when the page does not say: the one WebGL2 guarantees twice over. */
const DEFAULT_MAX_TEXTURE_SIZE = 4_096;

/** The largest whole number the kernel takes for an EPSG code or a limit (an unsigned 32 bit number). */
const MAX_UINT32 = 4_294_967_295;

/** A request that is misuse: a number that is not a whole number in the range of the kernel's. */
function requireWholeNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new TypeError(`${what} must be a whole number from 0 to ${String(MAX_UINT32)}.`);
  }
  return value;
}

/** Whether an error is the kernel's answer to a step of a prepare that no longer exists. */
function isNoSuchPrepare(error: unknown): boolean {
  return error instanceof Error && /no prepare with that id/.test(error.message);
}

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

/**
 * Reads a file chunk by chunk into one buffer of the file's size, so that a large file
 * is held once, and tells `afterChunk` how much is read (0 to 1). If `afterChunk`
 * throws, the reading stops and the error goes on.
 */
async function readBytesInChunks(
  file: File,
  afterChunk: (fraction: number) => void,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(file.size);
  const reader = file.stream().getReader();
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (offset + value.byteLength > bytes.byteLength) {
        throw new Error(`The file "${file.name}" changed while it was being read.`);
      }
      bytes.set(value, offset);
      offset += value.byteLength;
      afterChunk(bytes.byteLength === 0 ? 1 : offset / bytes.byteLength);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (offset !== bytes.byteLength) {
    throw new Error(`The file "${file.name}" changed while it was being read.`);
  }
  return bytes;
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

  /** Posts progress, at most once for each whole percent of each phase. */
  function progressReporter(id: number): (phase: ImportPhase, fraction: number) => void {
    let lastPhase: ImportPhase | undefined;
    let lastPercent = -1;
    return (phase, fraction) => {
      const percent = Math.floor(Math.min(Math.max(fraction, 0), 1) * 100);
      if (phase !== lastPhase || percent !== lastPercent) {
        lastPhase = phase;
        lastPercent = percent;
        post({ type: 'progress', id, progress: { phase, fraction: percent / 100 } }, []);
      }
    };
  }

  async function runImport(id: number, params: Requests['import']['params']): Promise<LoadResult> {
    const { kernel } = await ready();
    throwIfStopped(id);
    const report = progressReporter(id);
    report('reading', 0);
    const bytes = await readBytesInChunks(params.file, (fraction) => {
      throwIfStopped(id);
      report('reading', fraction);
    });
    throwIfStopped(id);
    const importId = kernel.startImport(params.file.name, bytes, params.mapping);
    try {
      for (;;) {
        throwIfStopped(id);
        const status = checkedImportStatus(kernel.stepImport(importId, IMPORT_BUDGET_ROWS));
        if (status.status === 'done') {
          return status.result;
        }
        report(status.phase, status.fraction);
        await yieldToEventLoop();
      }
    } catch (error) {
      // Whatever stopped the import, what it had read is dropped (a no-op once it is done).
      kernel.cancelImport(importId);
      throw error;
    }
  }

  /** Posts how far a prepare is, at most once for each whole percent. */
  function prepareReporter(id: number): (fraction: number) => void {
    let lastPercent = -1;
    return (fraction) => {
      const percent = Math.floor(Math.min(Math.max(fraction, 0), 1) * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        post({ type: 'prepareProgress', id, progress: { fraction: percent / 100 } }, []);
      }
    };
  }

  async function runPrepare(
    id: number,
    params: Requests['prepare']['params'],
  ): Promise<PrepareResult> {
    const { kernel } = await ready();
    throwIfStopped(id);
    const dataset = requireWholeNumber(params.dataset, 'The dataset');
    const maxTextureSize = requireWholeNumber(
      params.maxTextureSize ?? DEFAULT_MAX_TEXTURE_SIZE,
      'The largest texture',
    );
    if (maxTextureSize < 1) {
      throw new TypeError('The largest texture must be at least 1 cell on a side.');
    }
    // A frame with an origin that is not a number would give positions that are all NaN and no word about it.
    const job = kernel.startPrepare(dataset, checkedFrame(params.frame, 'frame'), maxTextureSize);
    const report = prepareReporter(id);
    try {
      for (;;) {
        throwIfStopped(id);
        const step = checkedPrepareStep(kernel.stepPrepare(job, PREPARE_BUDGET));
        if (step.status === 'done') {
          return step.result;
        }
        if (step.status === 'cancelled') {
          throw new Error('The dataset was removed while it was being prepared.');
        }
        report(step.fraction);
        await yieldToEventLoop();
      }
    } catch (error) {
      // Whatever stopped the prepare, what it had made is dropped. If the job is gone already because the dataset was
      // removed in the meantime, the kernel says "no prepare with that id": say that in words. Any other error is
      // not a removal and is passed on as it is, even if the job is gone (it had finished).
      if (!kernel.cancelPrepare(job) && isNoSuchPrepare(error)) {
        throw new Error('The dataset was removed while it was being prepared.', { cause: error });
      }
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
      case 'crsInfo': {
        const { module } = await ready();
        const code = requireWholeNumber(message.params.code, 'The EPSG code');
        const found = module.crsInfo(code);
        return {
          reply: {
            type: 'result',
            id,
            request: 'crsInfo',
            result: found === undefined ? undefined : checkedCrsInfo(found),
          },
          transfer: [],
        };
      }
      case 'searchCrs': {
        const { module } = await ready();
        const { query, limit } = message.params;
        if (typeof query !== 'string') {
          throw new TypeError('The search must be a string.');
        }
        const found = module.searchCrs(query, requireWholeNumber(limit, 'The limit'));
        return {
          reply: { type: 'result', id, request: 'searchCrs', result: checkedCrsInfoList(found) },
          transfer: [],
        };
      }
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
      case 'chooseFrame': {
        const { kernel } = await ready();
        const { preferred } = message.params;
        const choice = checkedFrameChoice(kernel.chooseFrame(preferred));
        return {
          reply: { type: 'result', id, request: 'chooseFrame', result: choice },
          transfer: [],
        };
      }
      case 'prepare': {
        const result = await runPrepare(id, message.params);
        return {
          reply: { type: 'result', id, request: 'prepare', result },
          transfer: transferablesOfResult(result),
        };
      }
      case 'classify': {
        const { kernel } = await ready();
        const { dataset, column, method, classes } = message.params;
        if (typeof column !== 'string') {
          throw new TypeError('The column must be a string.');
        }
        const found = kernel.classify(
          requireWholeNumber(dataset, 'The dataset'),
          column,
          checkedClassMethod(method),
          requireWholeNumber(classes, 'The number of classes'),
        );
        return {
          reply: { type: 'result', id, request: 'classify', result: checkedClassifyResult(found) },
          transfer: [],
        };
      }
      case 'classIndex': {
        const { kernel } = await ready();
        const { dataset, breaks } = message.params;
        const index = kernel.classIndex(
          requireWholeNumber(dataset, 'The dataset'),
          checkedClassBreaks(breaks),
        );
        return {
          reply: { type: 'result', id, request: 'classIndex', result: index },
          transfer: index.buffer instanceof ArrayBuffer ? [index.buffer] : [],
        };
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
