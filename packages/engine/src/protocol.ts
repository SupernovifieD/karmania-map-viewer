/**
 * The messages between the main thread and the worker.
 *
 * Every message is a plain object that structured cloning can carry (no functions, no
 * classes, no `URL`s). Every request has a number, chosen by the sender, and every
 * reply carries the number of the request it answers. A request type is described once,
 * in `Requests`; the unions below are made from that, so a type of request cannot be
 * added without its reply being typed too.
 */
import { IMPORT_PHASES } from './api.js';
import type { ImportPhase, ImportProgress } from './api.js';
import type { SerializedError } from './errors.js';
import type { DatasetInput } from './inputs.js';
import type { ImportMapping, LoadResult, Page, Preview } from './types.js';

/** A data file to look at, with the sidecar files that belong to it. */
export interface PreviewGroup {
  readonly file: File;
  readonly sidecars: readonly File[];
}

/** What each request carries and what the worker answers with. */
export interface Requests {
  /** Loads the WebAssembly module and creates the kernel. Sent once, first. */
  readonly init: {
    readonly params: { readonly wasmUrl?: string };
    readonly result: { readonly version: string };
  };
  /** Looks at files; the worker reads their bytes. One preview for each group. */
  readonly preview: {
    readonly params: { readonly groups: readonly PreviewGroup[] };
    readonly result: readonly Preview[];
  };
  /** Imports a file, with `progress` replies on the way. */
  readonly import: {
    readonly params: { readonly file: File; readonly mapping: ImportMapping };
    readonly result: LoadResult;
  };
  /** Loads a dataset made from arrays. */
  readonly load: {
    readonly params: { readonly input: DatasetInput };
    readonly result: LoadResult;
  };
  /** Reads a window of rows. */
  readonly rows: {
    readonly params: {
      readonly dataset: number;
      readonly start: number;
      readonly count: number;
    };
    readonly result: Page;
  };
  /** Unloads a dataset; the answer says whether there was one. */
  readonly remove: {
    readonly params: { readonly dataset: number };
    readonly result: boolean;
  };
}

/** Every type of request. */
export const REQUEST_TYPES = ['init', 'preview', 'import', 'load', 'rows', 'remove'] as const;

/** The type of a request. */
export type RequestType = keyof Requests;

/** A request from the main thread. */
export type RequestMessage = {
  [T in RequestType]: {
    readonly type: T;
    readonly id: number;
    readonly params: Requests[T]['params'];
  };
}[RequestType];

/** Asks the worker to stop the request with this id, if it has not finished. No reply of its own. */
export interface CancelMessage {
  readonly type: 'cancel';
  /** The id of the request to stop. */
  readonly target: number;
}

/** Everything the main thread sends. */
export type ToWorker = RequestMessage | CancelMessage;

/** The final answer to a request. */
export type ResultMessage = {
  [T in RequestType]: {
    readonly type: 'result';
    readonly id: number;
    /** Which request this answers, so the pair can be checked. */
    readonly request: T;
    readonly result: Requests[T]['result'];
  };
}[RequestType];

/** How far an import has got. Any number of these come before its result. */
export interface ProgressMessage {
  readonly type: 'progress';
  readonly id: number;
  readonly progress: ImportProgress;
}

/** The request failed: it was misuse, or the worker could not do it. */
export interface ErrorMessage {
  readonly type: 'error';
  readonly id: number;
  readonly error: SerializedError;
}

/** The request was stopped on its way, as asked by a `cancel`. */
export interface CancelledMessage {
  readonly type: 'cancelled';
  readonly id: number;
}

/** Everything the worker sends. */
export type FromWorker = ResultMessage | ProgressMessage | ErrorMessage | CancelledMessage;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isRequestType(value: unknown): value is RequestType {
  return REQUEST_TYPES.some((type) => type === value);
}

function isImportPhase(value: unknown): value is ImportPhase {
  return IMPORT_PHASES.some((phase) => phase === value);
}

/**
 * Checks that something received in the worker is a request or a cancel, as far as its
 * envelope goes: the type, the id, and that the parameters are an object. What is inside
 * the parameters is the kernel's to check. Returns `undefined` for anything else.
 */
export function parseToWorker(data: unknown): ToWorker | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  if (data['type'] === 'cancel') {
    return typeof data['target'] === 'number'
      ? { type: 'cancel', target: data['target'] }
      : undefined;
  }
  const { type, id, params } = data;
  if (!isRequestType(type) || typeof id !== 'number' || !isRecord(params)) {
    return undefined;
  }
  // The parameters are only known to be an object; the handler uses them through the
  // kernel, which checks them. The pairing of a type with its parameters cannot be
  // shown to the compiler from here, so this takes the sender's word for it.
  return { type, id, params } as RequestMessage;
}

/**
 * Checks that something received on the main thread is a reply, as far as its envelope
 * goes. Returns `undefined` for anything else.
 */
export function parseFromWorker(data: unknown): FromWorker | undefined {
  if (!isRecord(data) || typeof data['id'] !== 'number') {
    return undefined;
  }
  const id = data['id'];
  switch (data['type']) {
    case 'result':
      // As in `parseToWorker`, the pairing of a request with its result type is the
      // worker's word; the worker checked what the kernel gave it.
      return isRequestType(data['request']) && 'result' in data
        ? (data as unknown as ResultMessage)
        : undefined;
    case 'progress': {
      const progress = data['progress'];
      return isRecord(progress) &&
        isImportPhase(progress['phase']) &&
        typeof progress['fraction'] === 'number'
        ? {
            type: 'progress',
            id,
            progress: { phase: progress['phase'], fraction: progress['fraction'] },
          }
        : undefined;
    }
    case 'error': {
      const error = data['error'];
      if (
        !isRecord(error) ||
        typeof error['name'] !== 'string' ||
        typeof error['message'] !== 'string'
      ) {
        return undefined;
      }
      return {
        type: 'error',
        id,
        error:
          typeof error['stack'] === 'string'
            ? { name: error['name'], message: error['message'], stack: error['stack'] }
            : { name: error['name'], message: error['message'] },
      };
    }
    case 'cancelled':
      return { type: 'cancelled', id };
    default:
      return undefined;
  }
}
