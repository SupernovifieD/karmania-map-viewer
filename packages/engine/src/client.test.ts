import { afterEach, describe, expect, it } from 'vitest';
import { createKernelClient } from './client.js';
import type { ClientPort } from './client.js';
import { EngineError } from './errors.js';
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
});
