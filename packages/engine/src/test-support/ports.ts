/** Ways to stand in for a worker when testing the client. */
import { createKernelClient } from '../client.js';
import type { ClientPort, KernelClient } from '../client.js';
import { startWorker } from '../worker.js';
import { testKernelModule } from './kernel.js';

/** A message the client sent, with the buffers it handed over. */
export interface Sent {
  readonly message: unknown;
  readonly transfer: readonly Transferable[];
}

/** A worker that only records what it is sent, and says whatever the test makes it say. */
export class FakeWorkerPort implements ClientPort {
  readonly sent: Sent[] = [];
  closed = false;
  private readonly messageListeners: ((data: unknown) => void)[] = [];
  private readonly failureListeners: ((reason: string) => void)[] = [];

  readonly postMessage = (message: unknown, transfer: Transferable[]): void => {
    this.sent.push({ message, transfer });
  };
  readonly onMessage = (listener: (data: unknown) => void): void => {
    this.messageListeners.push(listener);
  };
  readonly onFailure = (listener: (reason: string) => void): void => {
    this.failureListeners.push(listener);
  };
  readonly close = (): void => {
    this.closed = true;
  };

  /** Delivers a message as though the worker had sent it. */
  reply(data: unknown): void {
    for (const listener of this.messageListeners) {
      listener(data);
    }
  }

  /** Makes the worker fail. */
  fail(reason: string): void {
    for (const listener of this.failureListeners) {
      listener(reason);
    }
  }
}

/** Lets a message port be used as a `ClientPort`. */
export function messagePort(port: MessagePort): ClientPort {
  return {
    postMessage: (message, transfer) => {
      port.postMessage(message, transfer);
    },
    onMessage: (listener) => {
      port.addEventListener('message', (event) => {
        listener(event.data);
      });
      port.start();
    },
    onFailure: (listener) => {
      port.addEventListener('messageerror', () => {
        listener('The worker sent a message that could not be read.');
      });
    },
    close: () => {
      port.close();
    },
  };
}

/** A client talking to a real worker handler on the real kernel, over a message channel. */
export function clientOverChannel(): { client: KernelClient; port: ClientPort } {
  const channel = new MessageChannel();
  startWorker(channel.port2, () => Promise.resolve(testKernelModule()));
  channel.port2.start();
  const port = messagePort(channel.port1);
  const close = port.close;
  return {
    client: createKernelClient(port),
    port: {
      ...port,
      close: () => {
        close();
        channel.port2.close();
      },
    },
  };
}
