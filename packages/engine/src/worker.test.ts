/**
 * The worker's connection to its scope, tested over a real `MessageChannel`: messages are
 * really structured-cloned, buffers are really transferred, and a `File` really crosses,
 * as they do between a page and a worker.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DatasetInput } from './inputs.js';
import { parseFromWorker } from './protocol.js';
import type { FromWorker, RequestMessage, Requests, RequestType } from './protocol.js';
import { fixtureFile, testKernelModule } from './test-support/kernel.js';
import { mappingFrom } from './test-support/mapping.js';
import { startWorker } from './worker.js';

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

/** The main thread's end of a started worker. */
function startOverChannel() {
  const channel = new MessageChannel();
  channels.push(channel);
  startWorker(channel.port2, () => Promise.resolve(testKernelModule()));
  const replies: FromWorker[] = [];
  const waiting = new Map<number, (reply: FromWorker) => void>();
  channel.port1.addEventListener('message', (event) => {
    const reply = parseFromWorker(event.data);
    if (reply === undefined) {
      throw new Error(`the worker sent something that is not a reply: ${String(event.data)}`);
    }
    replies.push(reply);
    if (reply.type !== 'progress') {
      waiting.get(reply.id)?.(reply);
    }
  });
  channel.port1.start();
  channel.port2.start();
  return {
    replies,
    /** Sends a request, handing over `transfer`, and waits for its final reply. */
    ask: (message: RequestMessage, transfer: Transferable[] = []): Promise<FromWorker> =>
      new Promise((resolve) => {
        waiting.set(message.id, resolve);
        channel.port1.postMessage(message, transfer);
      }),
  };
}

function resultOf<T extends RequestType>(reply: FromWorker, request: T): Requests[T]['result'] {
  if (reply.type === 'result' && reply.request === request) {
    return reply.result;
  }
  throw new Error(`expected the result of "${request}", got ${JSON.stringify(reply)}`);
}

describe('a worker over a message channel', () => {
  it('starts, and answers a request for the version', async () => {
    const worker = startOverChannel();
    const reply = await worker.ask({ type: 'init', id: 1, params: {} });
    expect(resultOf(reply, 'init').version).toBe(testKernelModule().version());
  });

  it('receives a File in a message and reads its bytes itself', async () => {
    const worker = startOverChannel();
    await worker.ask({ type: 'init', id: 1, params: {} });
    const reply = await worker.ask({
      type: 'preview',
      id: 2,
      params: {
        groups: [{ file: fixtureFile('points.csv'), sidecars: [fixtureFile('points.prj')] }],
      },
    });
    const [preview] = resultOf(reply, 'preview');
    expect(preview?.fileName).toBe('points.csv');
    expect(preview?.crs?.source).toBe('prj_file');
  });

  it('takes the arrays of a dataset by transfer, and sends rows back the same way', async () => {
    const worker = startOverChannel();
    await worker.ask({ type: 'init', id: 1, params: {} });
    const x = new Float64Array([500_000, 500_010, 500_020]);
    const y = new Float64Array([2_700_000, 2_700_010, 2_700_020]);
    const input: DatasetInput = {
      kind: 'points',
      name: 'p',
      crs: { kind: 'epsg', code: 32640 },
      x,
      y,
    };
    const loaded = await worker.ask({ type: 'load', id: 2, params: { input } }, [
      x.buffer,
      y.buffer,
    ]);
    expect(x.byteLength).toBe(0);
    const result = resultOf(loaded, 'load');
    expect(result.status).toBe('loaded');
    const dataset = result.status === 'loaded' ? (result.summaries[0]?.id ?? -1) : -1;

    const rows = resultOf(
      await worker.ask({ type: 'rows', id: 3, params: { dataset, start: 1, count: 2 } }),
      'rows',
    );
    const column = (name: string) => rows.columns.find((c) => c.name === name)?.values;
    expect(column('X')).toEqual(new Float64Array([500_010, 500_020]));
    expect(column('Y')).toEqual(new Float64Array([2_700_010, 2_700_020]));
  });

  it('reports progress on the way to the result of an import', async () => {
    const worker = startOverChannel();
    await worker.ask({ type: 'init', id: 1, params: {} });
    const file = fixtureFile('points.csv');
    const [preview] = resultOf(
      await worker.ask({ type: 'preview', id: 2, params: { groups: [{ file, sidecars: [] }] } }),
      'preview',
    );
    expect(preview).toBeDefined();
    if (preview === undefined) {
      return;
    }
    const mapping = mappingFrom(preview, 'points', { kind: 'epsg', code: 32640 });
    const reply = await worker.ask({ type: 'import', id: 3, params: { file, mapping } });
    expect(resultOf(reply, 'import').status).toBe('loaded');
    const phases = worker.replies.flatMap((r) => (r.type === 'progress' ? [r.progress.phase] : []));
    expect(phases[0]).toBe('reading');
    // A file this small is parsed within the first step, so only a larger one reports
    // the parsing phase (the handler's tests have one).
    expect(phases).toContain('validating');
  });

  it('answers a request with an error, not silence, when the kernel refuses it', async () => {
    const worker = startOverChannel();
    await worker.ask({ type: 'init', id: 1, params: {} });
    const reply = await worker.ask({
      type: 'rows',
      id: 2,
      params: { dataset: 77, start: 0, count: 1 },
    });
    expect(reply.type === 'error' && reply.error.message).toMatch(/no dataset/);
  });
});
