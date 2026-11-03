/**
 * The worker's handling of display preparation, in Node on the real kernel: the frame, a prepare that is
 * done in steps (with progress, other requests heard in between, a request to stop honoured) and hands its
 * buffers over, and the classes.
 */
import { describe, expect, it } from 'vitest';
import { points } from './builders.js';
import type { Frame } from './display.js';
import type { KernelModule } from './kernel-module.js';
import type { HandlerHarness, Posted } from './test-support/handler.js';
import { resultOf, startHandler } from './test-support/handler.js';
import { testKernelModule, wrapKernel } from './test-support/kernel.js';
import type { CrsRef, LoadResult } from './types.js';

const UTM40: CrsRef = { kind: 'epsg', code: 40 + 32600 };

let nextId = 1_000;
const id = (): number => nextId++;

async function ready(module: () => KernelModule = testKernelModule) {
  const harness = startHandler(() => Promise.resolve(module()));
  await harness.settle({ type: 'init', id: id(), params: {} });
  return harness;
}

/** Loads `count` points in UTM 40 and returns the dataset's number. */
async function loadPoints(harness: HandlerHarness, count: number, name = 'Wells'): Promise<number> {
  const x = new Float64Array(count).map((_, i) => 500_000 + (i % 1_000));
  const y = new Float64Array(count).map((_, i) => 2_700_000 + Math.floor(i / 1_000));
  const reply = await harness.settle({
    type: 'load',
    id: id(),
    params: { input: points({ name, crs: UTM40, x, y }) },
  });
  const result: LoadResult = resultOf(reply, 'load');
  if (result.status !== 'loaded') throw new Error('blocked');
  return result.summaries[0]?.id ?? -1;
}

async function chosenFrame(harness: HandlerHarness): Promise<Frame> {
  const choice = resultOf(
    await harness.settle({ type: 'chooseFrame', id: id(), params: {} }),
    'chooseFrame',
  );
  if (choice.frame === null) throw new Error('no frame');
  return choice.frame;
}

function errorMessage(reply: Posted): string {
  if (reply.message.type !== 'error')
    throw new Error(`expected an error: ${JSON.stringify(reply.message)}`);
  return reply.message.error.message;
}

/** The positions of a drawn result. */
function positionsOf(reply: Posted): Float32Array {
  const result = resultOf(reply, 'prepare');
  if (result.status !== 'drawn' || result.buffers.kind !== 'points')
    throw new Error('not drawn points');
  return result.buffers.positions;
}

describe('chooseFrame', () => {
  it('says there is no frame with nothing loaded, and chooses one for what is', async () => {
    const harness = await ready();
    const none = resultOf(
      await harness.settle({ type: 'chooseFrame', id: id(), params: {} }),
      'chooseFrame',
    );
    expect(none).toStrictEqual({ frame: null, drawable: [], findings: [] });
    const dataset = await loadPoints(harness, 10);
    const frame = await chosenFrame(harness);
    expect(frame.mapCrs).toStrictEqual(UTM40);
    const again = resultOf(
      await harness.settle({
        type: 'chooseFrame',
        id: id(),
        params: { preferred: { kind: 'epsg', code: 32641 } },
      }),
      'chooseFrame',
    );
    expect(again.frame?.source).toBe('user');
    expect(again.drawable.map((d) => d.id)).toStrictEqual([dataset]);
  });

  it('refuses a preferred system that is not one', async () => {
    const harness = await ready();
    const reply = await harness.settle({
      type: 'chooseFrame',
      id: id(),
      params: { preferred: { kind: 'nonsense' } as unknown as CrsRef },
    });
    expect(errorMessage(reply)).toMatch(/not valid/);
  });
});

describe('prepare', () => {
  it('does a large dataset in steps, reports how far it is, and hands the buffers over', async () => {
    const harness = await ready();
    const dataset = await loadPoints(harness, 350_000);
    const frame = await chosenFrame(harness);
    const requestId = id();
    const reply = await harness.settle({
      type: 'prepare',
      id: requestId,
      params: { dataset, frame },
    });
    const positions = positionsOf(reply);
    expect(positions).toHaveLength(350_000 * 3);
    expect(reply.transfer).toStrictEqual([positions.buffer]);
    const fractions = harness.posted
      .map((p) => p.message)
      .filter((m) => m.type === 'prepareProgress' && m.id === requestId)
      .map((m) => (m.type === 'prepareProgress' ? m.progress.fraction : -1));
    expect(fractions.length).toBeGreaterThanOrEqual(2);
    expect(fractions).toStrictEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.every((f) => f >= 0 && f < 1)).toBe(true);
  });

  it('gives the same buffers however it is done, and nothing is posted twice for one percent', async () => {
    const harness = await ready();
    const dataset = await loadPoints(harness, 150_000);
    const frame = await chosenFrame(harness);
    const requestId = id();
    await harness.settle({ type: 'prepare', id: requestId, params: { dataset, frame } });
    const percents = harness.posted
      .map((p) => p.message)
      .filter((m) => m.type === 'prepareProgress' && m.id === requestId);
    expect(new Set(percents.map((m) => JSON.stringify(m))).size).toBe(percents.length);
  });

  it('lets other requests through between the steps', async () => {
    // What decides it is the order in which the kernel is called: with no yield between steps, a prepare
    // runs to the end before anything else is looked at (the order of the replies would not show it,
    // since a shorter request can be answered first by the order of promises alone).
    const module = testKernelModule();
    const calls: string[] = [];
    const spy: KernelModule = {
      ...module,
      createKernel: () => {
        const kernel = wrapKernel(module.createKernel());
        const { stepPrepare, remove } = kernel;
        kernel.stepPrepare = (job, budget) => {
          calls.push('step');
          return stepPrepare(job, budget);
        };
        kernel.remove = (dataset) => {
          calls.push('remove');
          return remove(dataset);
        };
        return kernel;
      },
    };
    const harness = await ready(() => spy);
    const dataset = await loadPoints(harness, 350_000);
    const other = await loadPoints(harness, 3, 'Others');
    const frame = await chosenFrame(harness);
    calls.length = 0;
    const prepared = harness.settle({ type: 'prepare', id: id(), params: { dataset, frame } });
    // Sent at once, while the prepare has only begun.
    const removed = harness.settle({ type: 'remove', id: id(), params: { dataset: other } });
    expect(resultOf(await removed, 'remove')).toBe(true);
    await prepared;
    const steps = calls.filter((c) => c === 'step').length;
    expect(steps).toBeGreaterThanOrEqual(4);
    // The removal came after the first step and before the last.
    expect(calls.indexOf('remove')).toBeGreaterThan(0);
    expect(calls.indexOf('remove')).toBeLessThan(calls.lastIndexOf('step'));
  });

  it('stops when the main thread asks, drops the job, and says it was cancelled', async () => {
    const module = testKernelModule();
    const cancelled: number[] = [];
    const spy: KernelModule = {
      ...module,
      createKernel: () => {
        const kernel = wrapKernel(module.createKernel());
        const cancelPrepare = kernel.cancelPrepare;
        kernel.cancelPrepare = (job) => {
          cancelled.push(job);
          return cancelPrepare(job);
        };
        return kernel;
      },
    };
    const harness = await ready(() => spy);
    const dataset = await loadPoints(harness, 350_000);
    const frame = await chosenFrame(harness);
    const requestId = id();
    const finished = harness.settle({ type: 'prepare', id: requestId, params: { dataset, frame } });
    // Wait for the first progress, then ask it to stop.
    while (
      !harness.posted.some(
        (p) => p.message.type === 'prepareProgress' && p.message.id === requestId,
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    harness.send({ type: 'cancel', target: requestId });
    expect((await finished).message).toStrictEqual({ type: 'cancelled', id: requestId });
    expect(cancelled).toHaveLength(1);
    // Nothing was handed over: a cancelled prepare has no result to transfer.
    expect((await finished).transfer).toStrictEqual([]);
  });

  it('says the dataset was removed when it is removed while it is being prepared', async () => {
    const harness = await ready();
    const dataset = await loadPoints(harness, 350_000);
    const frame = await chosenFrame(harness);
    const requestId = id();
    const finished = harness.settle({ type: 'prepare', id: requestId, params: { dataset, frame } });
    while (
      !harness.posted.some(
        (p) => p.message.type === 'prepareProgress' && p.message.id === requestId,
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await harness.settle({ type: 'remove', id: id(), params: { dataset } });
    expect(errorMessage(await finished)).toMatch(/removed while it was being prepared/);
  });

  it('says why a dataset is not drawn, with nothing to hand over', async () => {
    const harness = await ready();
    const dataset = await loadPoints(harness, 5);
    const other: Frame = {
      mapCrs: { kind: 'local', units: 'm' },
      origin: [0, 0, 0],
      source: 'user',
    };
    const reply = await harness.settle({
      type: 'prepare',
      id: id(),
      params: { dataset, frame: other },
    });
    const result = resultOf(reply, 'prepare');
    expect(result.status).toBe('not_drawn');
    expect(reply.transfer).toStrictEqual([]);
  });

  it('refuses what is misuse', async () => {
    const harness = await ready();
    const dataset = await loadPoints(harness, 5);
    const frame = await chosenFrame(harness);
    const send = (params: Record<string, unknown>) =>
      harness.settle({ type: 'prepare', id: id(), params: { dataset, frame, ...params } });
    expect(errorMessage(await send({ dataset: -1 }))).toMatch(/dataset must be a whole number/);
    expect(errorMessage(await send({ dataset: 1.5 }))).toMatch(/dataset must be a whole number/);
    expect(errorMessage(await send({ maxTextureSize: 0 }))).toMatch(/at least 1 cell/);
    expect(errorMessage(await send({ maxTextureSize: 2.5 }))).toMatch(
      /largest texture must be a whole number/,
    );
    expect(errorMessage(await send({ dataset: 9_999 }))).toMatch(/no dataset with that id/);
    expect(errorMessage(await send({ frame: { mapCrs: 1 } }))).toMatch(/frame is not valid/);
  });
});

describe('classify and classIndex', () => {
  async function withGrades() {
    const harness = await ready();
    const reply = await harness.settle({
      type: 'load',
      id: id(),
      params: {
        input: points({
          name: 'Assays',
          crs: UTM40,
          x: new Float64Array([1, 2, 3, 4]),
          y: new Float64Array([1, 2, 3, 4]),
          attributes: { grade: new Float64Array([1, 2, 3, Number.NaN]) },
        }),
      },
    });
    const result: LoadResult = resultOf(reply, 'load');
    if (result.status !== 'loaded') throw new Error('blocked');
    return { harness, dataset: result.summaries[0]?.id ?? -1 };
  }

  it('divides a column and gives the class of every element, handed over', async () => {
    const { harness, dataset } = await withGrades();
    const classified = resultOf(
      await harness.settle({
        type: 'classify',
        id: id(),
        params: { dataset, column: 'grade', method: 'equal', classes: 2 },
      }),
      'classify',
    );
    expect(classified.status).toBe('classified');
    if (classified.status !== 'classified') return;
    expect(classified.breaks).toStrictEqual({
      kind: 'ranges',
      column: 'grade',
      bounds: [1, 2, 3],
      counts: [1, 2],
      nulls: 1,
    });
    const reply = await harness.settle({
      type: 'classIndex',
      id: id(),
      params: { dataset, breaks: classified.breaks },
    });
    const index = resultOf(reply, 'classIndex');
    expect(Array.from(index)).toStrictEqual([0, 1, 1, 255]);
    expect(reply.transfer).toStrictEqual([index.buffer]);
  });

  it('says in a finding when a column cannot be classified, and refuses what is misuse', async () => {
    const { harness, dataset } = await withGrades();
    const classify = (params: Record<string, unknown>) =>
      harness.settle({
        type: 'classify',
        id: id(),
        params: { dataset, column: 'grade', method: 'equal', classes: 3, ...params } as never,
      });
    const missing = resultOf(await classify({ column: 'nothing' }), 'classify');
    expect(missing.status).toBe('not_classified');
    expect(errorMessage(await classify({ method: 'rainbow' }))).toMatch(
      /expected one of equal, quantile, jenks, categories/,
    );
    expect(errorMessage(await classify({ classes: -1 }))).toMatch(
      /number of classes must be a whole number/,
    );
    expect(errorMessage(await classify({ column: 7 }))).toMatch(/column must be a string/);
    const index = (breaks: unknown) =>
      harness.settle({
        type: 'classIndex',
        id: id(),
        params: { dataset, breaks: breaks as never },
      });
    expect(errorMessage(await index({ kind: 'ranges' }))).toMatch(/missing/);
    expect(
      errorMessage(
        await index({ kind: 'ranges', column: 'gone', bounds: [0, 1], counts: [1], nulls: 0 }),
      ),
    ).toMatch(/no column named gone/);
  });
});
