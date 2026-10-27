/** Runs the worker handler in Node on the real kernel, and records what it posts. */
import { createWorkerHandler } from '../handler.js';
import type { LoadKernelModule } from '../kernel-module.js';
import type { FromWorker, RequestMessage, RequestType, Requests, ToWorker } from '../protocol.js';
import { testKernelModule } from './kernel.js';

/** A reply the handler posted, with the buffers it handed over. */
export interface Posted {
  readonly message: FromWorker;
  readonly transfer: readonly Transferable[];
}

/** A handler under test. */
export interface HandlerHarness {
  /** Everything the handler has posted, in order. */
  readonly posted: Posted[];
  /** Sends a message as the main thread would. */
  readonly send: (message: ToWorker) => void;
  /** Sends a request and waits for the reply that ends it: anything but progress. */
  readonly settle: (message: RequestMessage) => Promise<Posted>;
}

/** Starts a handler. The kernel is the real one unless `loadModule` is given. */
export function startHandler(
  loadModule: LoadKernelModule = () => Promise.resolve(testKernelModule()),
): HandlerHarness {
  const posted: Posted[] = [];
  const waiting = new Map<number, (posted: Posted) => void>();
  const handler = createWorkerHandler({
    loadModule,
    post: (message, transfer) => {
      const entry = { message, transfer };
      posted.push(entry);
      if (message.type !== 'progress') {
        waiting.get(message.id)?.(entry);
        waiting.delete(message.id);
      }
    },
  });
  return {
    posted,
    send: (message) => {
      handler.handle(message);
    },
    settle: (message) =>
      new Promise((resolve) => {
        waiting.set(message.id, resolve);
        handler.handle(message);
      }),
  };
}

/** The result of a reply, which must be the result of the given request. */
export function resultOf<T extends RequestType>(posted: Posted, request: T): Requests[T]['result'] {
  const { message } = posted;
  if (message.type === 'result' && message.request === request) {
    return message.result;
  }
  throw new Error(`expected the result of "${request}", got ${JSON.stringify(message)}`);
}
