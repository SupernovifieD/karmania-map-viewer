/**
 * The main thread's side of the protocol: sends requests to the worker and turns its
 * replies into promises. It knows nothing about what the requests mean.
 */
import type { ImportProgress } from './api.js';
import { EngineDisposedError, EngineError } from './errors.js';
import { parseFromWorker } from './protocol.js';
import type { RequestType, Requests, ResultMessage } from './protocol.js';

/**
 * What the client needs from the thing it talks to. A `Worker` is wrapped by
 * `workerPort`; a message port or a test double can provide the same four things.
 */
export interface ClientPort {
  /** Sends a message, handing over the buffers in `transfer`. */
  readonly postMessage: (message: unknown, transfer: Transferable[]) => void;
  /** Calls `listener` with the data of every message that arrives. */
  readonly onMessage: (listener: (data: unknown) => void) => void;
  /** Calls `listener`, saying why, if the other end fails and will not answer. */
  readonly onFailure: (listener: (reason: string) => void) => void;
  /** Ends the conversation and the thing at the other end. */
  readonly close: () => void;
}

/** Lets a `Worker` be used as a `ClientPort`. */
export function workerPort(worker: Worker): ClientPort {
  return {
    postMessage: (message, transfer) => {
      worker.postMessage(message, transfer);
    },
    onMessage: (listener) => {
      worker.addEventListener('message', (event: MessageEvent<unknown>) => {
        listener(event.data);
      });
    },
    onFailure: (listener) => {
      worker.addEventListener('error', (event) => {
        listener(event.message === '' ? 'The worker failed to start or crashed.' : event.message);
      });
      worker.addEventListener('messageerror', () => {
        listener('The worker sent a message that could not be read.');
      });
    },
    close: () => {
      worker.terminate();
    },
  };
}

/** Optional parts of a request. */
export interface RequestOptions {
  /**
   * Aborting asks the worker to stop. The promise then settles with whatever happened: it
   * rejects with the signal's reason (an `AbortError` unless the signal says otherwise) if
   * the worker stopped, and resolves with the result if the work was already done. A signal
   * that is already aborted rejects without sending.
   */
  readonly signal?: AbortSignal;
  /** Buffers to hand over to the worker instead of copying. They are empty afterwards. */
  readonly transfer?: readonly Transferable[];
  /** Called with the progress the worker reports for this request, if it reports any. */
  readonly onProgress?: (progress: ImportProgress) => void;
}

/** Sends requests to a worker and returns its answers. */
export interface KernelClient {
  /**
   * Sends a request and resolves with its result. Rejects with an `EngineError` if the
   * worker answers with an error or fails, and with an `EngineDisposedError` once the
   * client is disposed.
   */
  readonly request: <T extends RequestType>(
    type: T,
    params: Requests[T]['params'],
    options?: RequestOptions,
  ) => Promise<Requests[T]['result']>;
  /** Closes the port, and rejects the requests still waiting. Later requests are rejected. */
  readonly dispose: () => void;
}

/**
 * Why a request was stopped: the signal's reason if that is an error, as it is unless the
 * signal was aborted with some other value, which then becomes the message of an
 * `AbortError`.
 */
function abortError(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error) {
    return reason;
  }
  return new DOMException(
    typeof reason === 'string' ? reason : 'The request was stopped.',
    'AbortError',
  );
}

/** A request waiting for its reply. */
interface Pending {
  readonly settle: (reply: ResultMessage) => void;
  readonly fail: (error: Error) => void;
  readonly progress: (progress: ImportProgress) => void;
  readonly cancelled: () => void;
}

/** Makes a client for the worker at the other end of `port`. Each client has its own ids. */
export function createKernelClient(port: ClientPort): KernelClient {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  // Once set, nothing more will be answered: the worker failed or the client was disposed.
  let unusable: Error | undefined;
  let disposed = false;

  function rejectAll(error: Error): void {
    unusable = error;
    const waiting = [...pending.values()];
    pending.clear();
    for (const request of waiting) {
      request.fail(error);
    }
  }

  port.onMessage((data) => {
    const reply = parseFromWorker(data);
    const waiting = reply === undefined ? undefined : pending.get(reply.id);
    if (reply === undefined || waiting === undefined) {
      return;
    }
    switch (reply.type) {
      case 'result':
        pending.delete(reply.id);
        waiting.settle(reply);
        return;
      case 'error':
        pending.delete(reply.id);
        waiting.fail(new EngineError(reply.error));
        return;
      case 'cancelled':
        pending.delete(reply.id);
        waiting.cancelled();
        return;
      case 'progress':
        waiting.progress(reply.progress);
        return;
    }
  });

  port.onFailure((reason) => {
    if (!disposed) {
      rejectAll(new EngineError({ name: 'WorkerError', message: reason }));
    }
  });

  return {
    request: <T extends RequestType>(
      type: T,
      params: Requests[T]['params'],
      options: RequestOptions = {},
    ) =>
      new Promise<Requests[T]['result']>((resolve, reject) => {
        const { signal, transfer = [], onProgress } = options;
        if (unusable !== undefined) {
          reject(unusable);
          return;
        }
        if (signal?.aborted === true) {
          reject(abortError(signal));
          return;
        }
        const id = nextId;
        nextId += 1;
        const askToStop = (): void => {
          port.postMessage({ type: 'cancel', target: id }, []);
        };
        const finish = (): void => {
          signal?.removeEventListener('abort', askToStop);
        };
        pending.set(id, {
          settle: (reply) => {
            finish();
            if (reply.request === type) {
              resolve(reply.result);
            } else {
              reject(
                new Error(
                  `The worker answered "${type}" request ${String(id)} with a "${reply.request}" result.`,
                ),
              );
            }
          },
          fail: (error) => {
            finish();
            reject(error);
          },
          progress: (progress) => {
            onProgress?.(progress);
          },
          cancelled: () => {
            finish();
            reject(abortError(signal));
          },
        });
        signal?.addEventListener('abort', askToStop, { once: true });
        port.postMessage({ type, id, params }, [...transfer]);
      }),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      port.close();
      rejectAll(new EngineDisposedError());
    },
  };
}
