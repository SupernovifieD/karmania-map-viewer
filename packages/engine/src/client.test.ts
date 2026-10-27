import { afterEach, describe, expect, it } from 'vitest';
import { createKernelClient } from './client.js';
import type { ClientPort } from './client.js';
import type { ImportProgress } from './api.js';
import { EngineDisposedError, EngineError } from './errors.js';
import { parseToWorker } from './protocol.js';
import { FakeWorkerPort, clientOverChannel } from './test-support/ports.js';
import { fixtureFile } from './test-support/kernel.js';

const sentMessages = (port: FakeWorkerPort) =>
  port.sent.map(({ message }) => parseToWorker(message));

describe('sending requests', () => {
  it('sends each request as a numbered message the worker accepts', () => {
    const port = new FakeWorkerPort();
    const client = createKernelClient(port);
    void client.request('remove', { dataset: 4 });
    void client.request('rows', { dataset: 4, start: 0, count: 10 });
    expect(sentMessages(port)).toEqual([
      { type: 'remove', id: 1, params: { dataset: 4 } },
      { type: 'rows', id: 2, params: { dataset: 4, start: 0, count: 10 } },
    ]);
  });

  it('gives every client ids of its own, so clients cannot answer each other`s requests', async () => {
    const [a, b] = [new FakeWorkerPort(), new FakeWorkerPort()];
    const first = createKernelClient(a).request('remove', { dataset: 1 });
    const second = createKernelClient(b).request('remove', { dataset: 1 });
    expect(sentMessages(a)[0]).toMatchObject({ id: 1 });
    expect(sentMessages(b)[0]).toMatchObject({ id: 1 });
    a.reply({ type: 'result', id: 1, request: 'remove', result: true });
    b.reply({ type: 'result', id: 1, request: 'remove', result: false });
    expect([await first, await second]).toEqual([true, false]);
  });
});

describe('receiving replies', () => {
  it('settles each request with its own reply, in whatever order they come', async () => {
    const port = new FakeWorkerPort();
    const client = createKernelClient(port);
    const first = client.request('remove', { dataset: 1 });
    const second = client.request('init', {});
    port.reply({ type: 'result', id: 2, request: 'init', result: { version: '0.1.0' } });
    port.reply({ type: 'result', id: 1, request: 'remove', result: true });
    expect(await second).toEqual({ version: '0.1.0' });
    expect(await first).toBe(true);
  });

  it('rejects with an EngineError when the worker answers with an error', async () => {
    const port = new FakeWorkerPort();
    const request = createKernelClient(port).request('rows', { dataset: 9, start: 0, count: 1 });
    port.reply({
      type: 'error',
      id: 1,
      error: { name: 'Error', message: 'there is no dataset with that id', stack: 'at rows' },
    });
    const error: unknown = await request.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect(error).toMatchObject({
      message: 'there is no dataset with that id',
      remoteName: 'Error',
      remoteStack: 'at rows',
    });
  });

  it('rejects when the worker answers a request with another request`s result', async () => {
    const port = new FakeWorkerPort();
    const request = createKernelClient(port).request('remove', { dataset: 1 });
    port.reply({ type: 'result', id: 1, request: 'init', result: { version: '0.1.0' } });
    await expect(request).rejects.toThrow(/"remove" request 1 with a "init" result/);
  });

  it('ignores what it cannot match to a request, and goes on waiting', async () => {
    const port = new FakeWorkerPort();
    const request = createKernelClient(port).request('remove', { dataset: 1 });
    for (const junk of [
      null,
      'hello',
      {},
      { type: 'result', id: 77, request: 'remove', result: true },
    ]) {
      port.reply(junk);
    }
    port.reply({ type: 'result', id: 1, request: 'remove', result: true });
    expect(await request).toBe(true);
  });

  it('settles a request only once', async () => {
    const port = new FakeWorkerPort();
    const request = createKernelClient(port).request('remove', { dataset: 1 });
    port.reply({ type: 'result', id: 1, request: 'remove', result: true });
    port.reply({ type: 'result', id: 1, request: 'remove', result: false });
    expect(await request).toBe(true);
  });
});

describe('progress and transfer', () => {
  it('passes progress to the request it belongs to, and to no other', async () => {
    const port = new FakeWorkerPort();
    const client = createKernelClient(port);
    const seenByFirst: ImportProgress[] = [];
    const seenBySecond: ImportProgress[] = [];
    const first = client.request(
      'remove',
      { dataset: 1 },
      { onProgress: (p) => seenByFirst.push(p) },
    );
    const second = client.request(
      'remove',
      { dataset: 2 },
      { onProgress: (p) => seenBySecond.push(p) },
    );
    port.reply({ type: 'progress', id: 2, progress: { phase: 'reading', fraction: 0.5 } });
    port.reply({ type: 'progress', id: 1, progress: { phase: 'parsing', fraction: 0.25 } });
    port.reply({ type: 'result', id: 1, request: 'remove', result: true });
    port.reply({ type: 'progress', id: 1, progress: { phase: 'parsing', fraction: 1 } });
    port.reply({ type: 'result', id: 2, request: 'remove', result: true });
    await Promise.all([first, second]);
    expect(seenByFirst).toEqual([{ phase: 'parsing', fraction: 0.25 }]);
    expect(seenBySecond).toEqual([{ phase: 'reading', fraction: 0.5 }]);
  });

  it('hands over the buffers it is told to, and copies the rest', () => {
    const port = new FakeWorkerPort();
    const client = createKernelClient(port);
    const buffer = new ArrayBuffer(8);
    void client.request('remove', { dataset: 1 }, { transfer: [buffer] });
    void client.request('remove', { dataset: 2 });
    expect(port.sent.map(({ transfer }) => transfer)).toEqual([[buffer], []]);
  });
});

describe('stopping a request', () => {
  const start = () => {
    const port = new FakeWorkerPort();
    const controller = new AbortController();
    const request = createKernelClient(port).request(
      'remove',
      { dataset: 1 },
      { signal: controller.signal },
    );
    return { port, controller, request };
  };

  it('does not send a request whose signal has already been aborted', async () => {
    const port = new FakeWorkerPort();
    const request = createKernelClient(port).request(
      'remove',
      { dataset: 1 },
      { signal: AbortSignal.abort('too late') },
    );
    await expect(request).rejects.toMatchObject({ name: 'AbortError', message: 'too late' });
    expect(port.sent).toEqual([]);
  });

  it('asks the worker to stop, and rejects with the reason once it has', async () => {
    const { port, controller, request } = start();
    controller.abort(new Error('the user cancelled'));
    expect(port.sent.map(({ message }) => message)).toEqual([
      { type: 'remove', id: 1, params: { dataset: 1 } },
      { type: 'cancel', target: 1 },
    ]);
    port.reply({ type: 'cancelled', id: 1 });
    await expect(request).rejects.toThrow('the user cancelled');
  });

  it('rejects with an AbortError when the signal gave no reason of its own', async () => {
    const port = new FakeWorkerPort();
    const request = createKernelClient(port).request('remove', { dataset: 1 }, {});
    port.reply({ type: 'cancelled', id: 1 });
    const error: unknown = await request.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('resolves with the result when the work finished before the worker heard the cancel', async () => {
    const { port, controller, request } = start();
    controller.abort();
    port.reply({ type: 'result', id: 1, request: 'remove', result: true });
    expect(await request).toBe(true);
  });

  it('rejects with the worker`s error when that is what came back', async () => {
    const { port, controller, request } = start();
    controller.abort();
    port.reply({ type: 'error', id: 1, error: { name: 'Error', message: 'broke' } });
    await expect(request).rejects.toBeInstanceOf(EngineError);
  });

  it('stops listening to the signal once the request is settled', async () => {
    const { port, controller, request } = start();
    port.reply({ type: 'result', id: 1, request: 'remove', result: true });
    await request;
    controller.abort();
    expect(port.sent).toHaveLength(1);
  });
});

describe('a worker that fails', () => {
  it('rejects the waiting requests and every later one, saying why', async () => {
    const port = new FakeWorkerPort();
    const client = createKernelClient(port);
    const waiting = client.request('remove', { dataset: 1 });
    port.fail('Failed to load the module script');
    const error: unknown = await waiting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect(error).toMatchObject({
      remoteName: 'WorkerError',
      message: 'Failed to load the module script',
    });
    await expect(client.request('remove', { dataset: 2 })).rejects.toBe(error);
    expect(port.sent).toHaveLength(1);
  });
});

describe('disposing the client', () => {
  it('closes the port and rejects what is waiting, and what comes later', async () => {
    const port = new FakeWorkerPort();
    const client = createKernelClient(port);
    const waiting = client.request('remove', { dataset: 1 });
    client.dispose();
    expect(port.closed).toBe(true);
    await expect(waiting).rejects.toBeInstanceOf(EngineDisposedError);
    await expect(client.request('remove', { dataset: 2 })).rejects.toBeInstanceOf(
      EngineDisposedError,
    );
    client.dispose();
  });

  it('ignores replies and failures that arrive after it', async () => {
    const port = new FakeWorkerPort();
    const client = createKernelClient(port);
    const waiting = client.request('remove', { dataset: 1 });
    client.dispose();
    port.reply({ type: 'result', id: 1, request: 'remove', result: true });
    port.fail('too late');
    await expect(waiting).rejects.toBeInstanceOf(EngineDisposedError);
    await expect(client.request('remove', { dataset: 2 })).rejects.toBeInstanceOf(
      EngineDisposedError,
    );
  });
});

describe('against a real worker handler, over a message channel', () => {
  const open: ClientPort[] = [];
  afterEach(() => {
    for (const port of open.splice(0)) {
      port.close();
    }
  });

  it('takes a file from preview to rows and removal', async () => {
    const { client, port } = clientOverChannel();
    open.push(port);
    const { version } = await client.request('init', {});
    expect(version).not.toBe('');

    const [preview] = await client.request('preview', {
      groups: [{ file: fixtureFile('points.csv'), sidecars: [fixtureFile('points.prj')] }],
    });
    expect(preview?.crs?.source).toBe('prj_file');

    const loaded = await client.request('load', {
      input: {
        kind: 'points',
        name: 'p',
        crs: { kind: 'epsg', code: 32640 },
        x: new Float64Array([500_000, 500_010]),
        y: new Float64Array([2_700_000, 2_700_010]),
      },
    });
    const dataset = loaded.status === 'loaded' ? (loaded.summaries[0]?.id ?? -1) : -1;
    expect(dataset).toBeGreaterThan(0);

    const page = await client.request('rows', { dataset, start: 0, count: 5 });
    expect(page.count).toBe(2);
    expect(await client.request('remove', { dataset })).toBe(true);
    await expect(client.request('rows', { dataset, start: 0, count: 1 })).rejects.toThrow(
      /no dataset/,
    );
  });

  it('hands arrays over to the worker, which loads them', async () => {
    const { client, port } = clientOverChannel();
    open.push(port);
    await client.request('init', {});
    const x = new Float64Array([500_000, 500_010]);
    const y = new Float64Array([2_700_000, 2_700_010]);
    const loaded = await client.request(
      'load',
      { input: { kind: 'points', name: 'p', crs: { kind: 'epsg', code: 32640 }, x, y } },
      { transfer: [x.buffer, y.buffer] },
    );
    expect(loaded.status).toBe('loaded');
    expect([x.byteLength, y.byteLength]).toEqual([0, 0]);
  });

  it('stops an import when its signal is aborted, and loads nothing', async () => {
    const { client, port } = clientOverChannel();
    open.push(port);
    await client.request('init', {});
    const rows = ['X,Y,Z'];
    for (let row = 0; row < 150_000; row += 1) {
      rows.push(`${String(500_000 + row)},${String(2_700_000 + row)},${String(row % 100)}`);
    }
    const controller = new AbortController();
    const importing = client.request(
      'import',
      {
        file: new File([rows.join('\n')], 'big.csv'),
        mapping: {
          datasetName: 'big',
          kind: 'points',
          columns: [
            { source: 'X', role: 'x' },
            { source: 'Y', role: 'y' },
            { source: 'Z', role: 'z' },
          ],
          nodata: { tokens: [], numbers: [] },
          emptyCoordinates: 'error',
          decimalSeparator: '.',
          crs: { kind: 'epsg', code: 32640 },
        },
      },
      {
        signal: controller.signal,
        onProgress: ({ phase }) => {
          if (phase === 'parsing') {
            controller.abort();
          }
        },
      },
    );
    const error: unknown = await importing.catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'AbortError' });
    await expect(client.request('rows', { dataset: 1, start: 0, count: 1 })).rejects.toThrow(
      /no dataset/,
    );
  });
});
