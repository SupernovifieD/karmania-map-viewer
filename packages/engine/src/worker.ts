/**
 * Connects the request handler to the scope it runs in: messages that arrive go to the
 * handler, and its replies are posted back. Kept apart from `worker-entry.ts` (which
 * loads the real module into the real worker scope) so the connection can be tested.
 */
import { createWorkerHandler } from './handler.js';
import type { LoadKernelModule } from './kernel-module.js';

/**
 * The part of a worker's global scope this uses. A message port has the same two methods,
 * which is how the tests stand in for the scope.
 */
export interface WorkerScope {
  readonly postMessage: (message: unknown, transfer: Transferable[]) => void;
  readonly addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
}

/** Starts answering requests that arrive in `scope`, with a kernel loaded by `loadModule`. */
export function startWorker(scope: WorkerScope, loadModule: LoadKernelModule): void {
  const handler = createWorkerHandler({
    loadModule,
    post: (message, transfer) => {
      scope.postMessage(message, [...transfer]);
    },
  });
  scope.addEventListener('message', (event) => {
    handler.handle(event.data);
  });
}
