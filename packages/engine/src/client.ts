/**
 * The main thread's side of the protocol: sends requests to the worker and turns its
 * replies into promises. It knows nothing about what the requests mean.
 */
import { EngineError } from './errors.js';
import { parseFromWorker } from './protocol.js';
import type { ResultMessage, RequestType, Requests } from './protocol.js';

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

/** Sends requests to a worker and returns its answers. */
export interface KernelClient {
  /**
   * Sends a request and resolves with its result. Rejects with an `EngineError` if the
   * worker answers with an error.
   */
  readonly request: <T extends RequestType>(
    type: T,
    params: Requests[T]['params'],
  ) => Promise<Requests[T]['result']>;
}

/** A request waiting for its reply. */
interface Pending {
  readonly type: RequestType;
  readonly settle: (reply: ResultMessage) => void;
  readonly fail: (error: Error) => void;
}

/** Makes a client for the worker at the other end of `port`. Each client has its own ids. */
export function createKernelClient(port: ClientPort): KernelClient {
  let nextId = 1;
  const pending = new Map<number, Pending>();

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
      case 'progress':
      case 'cancelled':
        return;
    }
  });

  return {
    request: <T extends RequestType>(type: T, params: Requests[T]['params']) =>
      new Promise<Requests[T]['result']>((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, {
          type,
          settle: (reply) => {
            if (reply.request !== type) {
              reject(
                new Error(
                  `The worker answered "${type}" request ${String(id)} with a "${reply.request}" result.`,
                ),
              );
              return;
            }
            resolve(reply.result);
          },
          fail: reject,
        });
        port.postMessage({ type, id, params }, []);
      }),
  };
}
