import { describe, expect, it } from 'vitest';
import type { DatasetInput } from './inputs.js';
import type { KernelModule, LoadKernelModule } from './kernel-module.js';
import type { HandlerHarness, Posted } from './test-support/handler.js';
import { resultOf, startHandler } from './test-support/handler.js';
import { fixtureFile, testKernelModule, wrapKernel } from './test-support/kernel.js';
import { bigPointsCsv, pointsMapping, UTM40 } from './test-support/data.js';
import { mappingFrom } from './test-support/mapping.js';
import type { ImportMapping, Kind, LoadResult } from './types.js';

let nextId = 100;
const id = (): number => nextId++;

/** A started handler with its kernel loaded. */
async function ready(loadModule?: LoadKernelModule) {
  const harness = startHandler(loadModule);
  await harness.settle({ type: 'init', id: id(), params: {} });
  return harness;
}

function errorOf(reply: Posted): { name: string; message: string } {
  if (reply.message.type !== 'error') {
    throw new Error(`expected an error, got ${JSON.stringify(reply.message)}`);
  }
  return reply.message.error;
}

function loadedSummaries(result: LoadResult) {
  if (result.status !== 'loaded') {
    throw new Error(`blocked: ${result.findings.map((f) => f.code).join(', ')}`);
  }
  return result.summaries;
}

describe('starting up', () => {
  it('refuses a request before it has been initialised', async () => {
    const harness = startHandler();
    const reply = await harness.settle({
      type: 'rows',
      id: id(),
      params: { dataset: 1, start: 0, count: 1 },
    });
    expect(errorOf(reply).message).toMatch(/not been initialised/);
  });

  it('loads the module once, passes the address of the .wasm file, and says its version', async () => {
    const seen: (string | undefined)[] = [];
    const harness = startHandler((options) => {
      seen.push(options.wasmUrl);
      return Promise.resolve(testKernelModule());
    });
    const first = await harness.settle({
      type: 'init',
      id: id(),
      params: { wasmUrl: 'https://example.test/k.wasm' },
    });
    expect(resultOf(first, 'init').version).toBe(testKernelModule().version());
    const second = await harness.settle({ type: 'init', id: id(), params: {} });
    expect(errorOf(second).message).toMatch(/already initialised/);
    expect(seen).toEqual(['https://example.test/k.wasm']);
  });

  it('answers requests sent before the module has finished loading', async () => {
    const harness = startHandler(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return testKernelModule();
    });
    const init = harness.settle({ type: 'init', id: id(), params: {} });
    const removed = harness.settle({ type: 'remove', id: id(), params: { dataset: 9 } });
    expect(resultOf(await removed, 'remove')).toBe(false);
    expect(resultOf(await init, 'init').version).not.toBe('');
  });

  it('says so when the module cannot be loaded', async () => {
    const harness = startHandler(() => Promise.reject(new Error('the .wasm file is missing')));
    const reply = await harness.settle({ type: 'init', id: id(), params: {} });
    expect(errorOf(reply).message).toBe('the .wasm file is missing');
  });
});

describe('looking at files', () => {
  it('previews a file with the sidecar that sits beside it, reading both inside the worker', async () => {
    const harness = await ready();
    const reply = await harness.settle({
      type: 'preview',
      id: id(),
      params: {
        groups: [
          { file: fixtureFile('points.csv'), sidecars: [fixtureFile('points.prj')] },
          { file: fixtureFile('grid.asc'), sidecars: [] },
        ],
      },
    });
    const previews = resultOf(reply, 'preview');
    expect(previews.map((p) => [p.fileName, p.format])).toEqual([
      ['points.csv', 'csv'],
      ['grid.asc', 'ascii_grid'],
    ]);
    expect(previews[0]?.crs?.source).toBe('prj_file');
    expect(previews[1]?.crs).toBeUndefined();
  });
});

describe('importing, reading and removing', () => {
  it('takes a file through to rows that are handed over, not copied', async () => {
    const harness = await ready();
    const file = fixtureFile('points.csv');
    const seen = resultOf(
      await harness.settle({
        type: 'preview',
        id: id(),
        params: { groups: [{ file, sidecars: [] }] },
      }),
      'preview',
    )[0];
    expect(seen).toBeDefined();
    if (seen === undefined) {
      return;
    }
    const mapping = mappingFrom(seen, 'points', UTM40);
    const imported = await harness.settle({ type: 'import', id: id(), params: { file, mapping } });
    const [summary] = loadedSummaries(resultOf(imported, 'import'));
    expect(summary?.elementCount).toBe(8);
    const dataset = summary?.id ?? -1;

    const page = await harness.settle({
      type: 'rows',
      id: id(),
      params: { dataset, start: 2, count: 3 },
    });
    const rows = resultOf(page, 'rows');
    expect([rows.start, rows.count]).toEqual([2, 3]);
    const buffers = rows.columns.flatMap((column) => [
      ...(ArrayBuffer.isView(column.values) ? [column.values.buffer] : []),
      column.nulls.buffer,
    ]);
    expect(buffers.length).toBeGreaterThan(rows.columns.length);
    expect(page.transfer).toEqual(buffers);

    const removed = await harness.settle({ type: 'remove', id: id(), params: { dataset } });
    expect(resultOf(removed, 'remove')).toBe(true);
    const gone = await harness.settle({
      type: 'rows',
      id: id(),
      params: { dataset, start: 0, count: 1 },
    });
    expect(errorOf(gone).message).toMatch(/no dataset/);
  });

  it('reports data problems as a blocked result, not as an error', async () => {
    const harness = await ready();
    const mapping: ImportMapping = { ...pointsMapping('x'), crs: null };
    const reply = await harness.settle({
      type: 'import',
      id: id(),
      params: { file: bigPointsCsv(10), mapping },
    });
    const result = resultOf(reply, 'import');
    expect(result.status === 'blocked' && result.findings.map((f) => f.code)).toEqual([
      'crs.missing',
    ]);
  });

  it('refuses a mapping that is not a mapping, as misuse', async () => {
    const harness = await ready();
    const reply = await harness.settle({
      type: 'import',
      id: id(),
      params: { file: bigPointsCsv(2), mapping: {} as unknown as ImportMapping },
    });
    expect(errorOf(reply).message).toMatch(/mapping/);
  });

  it('lets other requests through while an import is under way', async () => {
    const harness = await ready();
    const importing = harness.settle({
      type: 'import',
      id: id(),
      params: { file: bigPointsCsv(150_000), mapping: pointsMapping('big') },
    });
    const removed = await harness.settle({ type: 'remove', id: id(), params: { dataset: 99 } });
    expect(resultOf(removed, 'remove')).toBe(false);
    expect(
      harness.posted.filter((p) => p.message.type === 'result' && p.message.request === 'import'),
    ).toEqual([]);
    expect(loadedSummaries(resultOf(await importing, 'import'))[0]?.elementCount).toBe(150_000);
  });
});

describe('progress of an import', () => {
  /** A file whose bytes arrive in small pieces, as a large file's do. */
  class PiecemealFile extends File {
    override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
      const content = this.arrayBuffer().then((buffer) => new Uint8Array(buffer));
      const piece = 1000;
      let offset = 0;
      return new ReadableStream({
        async pull(controller) {
          const bytes = await content;
          if (offset >= bytes.byteLength) {
            controller.close();
            return;
          }
          controller.enqueue(bytes.slice(offset, offset + piece));
          offset += piece;
        },
      });
    }
  }

  const progressOf = (harness: HandlerHarness, request: number) =>
    harness.posted.flatMap(({ message }) =>
      message.type === 'progress' && message.id === request ? [message.progress] : [],
    );

  it('goes through reading, parsing and validating, each from 0 to 1 and never back', async () => {
    const harness = await ready();
    const request = id();
    const reply = await harness.settle({
      type: 'import',
      id: request,
      params: { file: bigPointsCsv(150_000), mapping: pointsMapping('big') },
    });
    expect(reply.message.type).toBe('result');
    const progress = progressOf(harness, request);
    const phases = [...new Set(progress.map((p) => p.phase))];
    expect(phases).toEqual(['reading', 'parsing', 'validating']);
    for (const phase of phases) {
      const fractions = progress.filter((p) => p.phase === phase).map((p) => p.fraction);
      expect(Math.min(...fractions)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...fractions)).toBeLessThanOrEqual(1);
      expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    }
    expect(progress[0]).toEqual({ phase: 'reading', fraction: 0 });
    expect(progress.filter((p) => p.phase === 'reading').at(-1)?.fraction).toBe(1);
    // Progress is not a message for every row: at most one for each whole percent.
    expect(progress.length).toBeLessThanOrEqual(3 * 101);
  });

  it('reads a file that arrives in pieces, and says how far it has got', async () => {
    const harness = await ready();
    const request = id();
    const source = bigPointsCsv(2_000);
    const file = new PiecemealFile([await source.arrayBuffer()], 'pieces.csv');
    const reply = await harness.settle({
      type: 'import',
      id: request,
      params: { file, mapping: pointsMapping('pieces') },
    });
    expect(loadedSummaries(resultOf(reply, 'import'))[0]?.elementCount).toBe(2_000);
    const reading = progressOf(harness, request).filter((p) => p.phase === 'reading');
    expect(reading.length).toBeGreaterThan(10);
    expect(reading.at(-1)?.fraction).toBe(1);
  });

  it('stops reading a large file when asked to', async () => {
    const harness = await ready();
    const request = id();
    const file = new PiecemealFile([await bigPointsCsv(5_000).arrayBuffer()], 'pieces.csv');
    const reply = harness.settle({
      type: 'import',
      id: request,
      params: { file, mapping: pointsMapping('pieces') },
    });
    harness.send({ type: 'cancel', target: request });
    expect((await reply).message).toEqual({ type: 'cancelled', id: request });
  });

  it('says so when the file is not the size it was when the import began', async () => {
    class GrowingFile extends File {
      override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
        const size = this.size;
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(size + 10));
            controller.close();
          },
        });
      }
    }
    const harness = await ready();
    const reply = await harness.settle({
      type: 'import',
      id: id(),
      params: { file: new GrowingFile(['X,Y\n'], 'grew.csv'), mapping: pointsMapping('g') },
    });
    expect(errorOf(reply).message).toMatch(/changed while it was being read/);
  });
});

describe('loading datasets made from arrays', () => {
  const points = (crs: DatasetInput['crs']): DatasetInput => ({
    kind: 'points',
    name: 'p',
    crs,
    x: new Float64Array([500_000, 500_010]),
    y: new Float64Array([2_700_000, 2_700_010]),
  });

  it('loads them, or says what blocked them', async () => {
    const harness = await ready();
    const loaded = await harness.settle({
      type: 'load',
      id: id(),
      params: { input: points(UTM40) },
    });
    expect(loadedSummaries(resultOf(loaded, 'load'))[0]?.kind).toBe<Kind>('points');
    const blocked = await harness.settle({
      type: 'load',
      id: id(),
      params: { input: points(null) },
    });
    const result = resultOf(blocked, 'load');
    expect(result.status === 'blocked' && result.findings[0]?.code).toBe('crs.missing');
  });

  it('refuses an input that is not a dataset, as misuse', async () => {
    const harness = await ready();
    const reply = await harness.settle({
      type: 'load',
      id: id(),
      params: { input: { kind: 'sing' } as unknown as DatasetInput },
    });
    expect(errorOf(reply).message).toMatch(/kind/);
  });

  it('does not trust the kernel: a result that breaks the contract is an error', async () => {
    const real = testKernelModule();
    const lying: KernelModule = {
      ...real,
      createKernel: () => ({
        ...wrapKernel(real.createKernel()),
        load: () => ({ status: 'maybe' }),
      }),
    };
    const harness = await ready(() => Promise.resolve(lying));
    const reply = await harness.settle({
      type: 'load',
      id: id(),
      params: { input: points(UTM40) },
    });
    expect(errorOf(reply).message).toMatch(/status/);
  });
});

describe('stopping a request', () => {
  it('stops one that has not started', async () => {
    const harness = await ready();
    const request = id();
    const reply = harness.settle({
      type: 'import',
      id: request,
      params: { file: bigPointsCsv(100), mapping: pointsMapping('p') },
    });
    harness.send({ type: 'cancel', target: request });
    expect((await reply).message).toEqual({ type: 'cancelled', id: request });
  });

  it('stops an import between two steps and drops what it had read', async () => {
    const real = testKernelModule();
    const request = id();
    const stopped: number[] = [];
    let steps = 0;
    const module: KernelModule = {
      ...real,
      createKernel: () => {
        const kernel = real.createKernel();
        return {
          ...wrapKernel(kernel),
          stepImport: (importId, budget) => {
            const status = kernel.stepImport(importId, budget);
            steps += 1;
            if (steps === 1) {
              harness.send({ type: 'cancel', target: request });
            }
            return status;
          },
          cancelImport: (importId) => {
            stopped.push(importId);
            return kernel.cancelImport(importId);
          },
        };
      },
    };
    const harness: HandlerHarness = await ready(() => Promise.resolve(module));
    const reply = await harness.settle({
      type: 'import',
      id: request,
      params: { file: bigPointsCsv(150_000), mapping: pointsMapping('p') },
    });
    expect(reply.message).toEqual({ type: 'cancelled', id: request });
    expect(steps).toBe(1);
    expect(stopped).toHaveLength(1);
  });

  it('lets a request that has already finished stand', async () => {
    const harness = await ready();
    const request = id();
    const reply = await harness.settle({
      type: 'import',
      id: request,
      params: { file: bigPointsCsv(10), mapping: pointsMapping('p') },
    });
    expect(reply.message.type).toBe('result');
    const before = harness.posted.length;
    harness.send({ type: 'cancel', target: request });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(harness.posted).toHaveLength(before);
  });

  it('ignores messages that are not requests', async () => {
    const harness = await ready();
    const before = harness.posted.length;
    for (const junk of [null, 'hello', { type: 'sing' }, { type: 'rows' }]) {
      harness.send(junk as never);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(harness.posted).toHaveLength(before);
  });
});
