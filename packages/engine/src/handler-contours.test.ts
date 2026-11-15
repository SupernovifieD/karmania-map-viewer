/**
 * The worker's handling of contour lines, in Node on the real kernel: a job done in steps (with progress, other requests heard in
 * between, a request to stop honoured, the job dropped), what is misuse, and the settings a set of contours starts with.
 */
import { describe, expect, it } from 'vitest';
import { grid } from './builders.js';
import type { KernelModule } from './kernel-module.js';
import type { HandlerHarness, Posted } from './test-support/handler.js';
import { resultOf, startHandler } from './test-support/handler.js';
import { testKernelModule, wrapKernel } from './test-support/kernel.js';
import type { ContourParams, CrsRef, LoadResult } from './types.js';

const UTM40: CrsRef = { kind: 'epsg', code: 32640 };

let nextId = 1_000;
const id = (): number => nextId++;

async function ready(module: () => KernelModule = testKernelModule) {
  const harness = startHandler(() => Promise.resolve(module()));
  await harness.settle({ type: 'init', id: id(), params: {} });
  return harness;
}

/** Loads a cone of `nx` by `ny` cells and returns the dataset's number. */
async function loadCone(harness: HandlerHarness, nx: number, ny: number): Promise<number> {
  const height = new Float64Array(nx * ny).map((_, k) =>
    Math.hypot((k % nx) - nx / 2, Math.floor(k / nx) - ny / 2),
  );
  const reply = await harness.settle({
    type: 'load',
    id: id(),
    params: {
      input: grid({
        name: 'Cone',
        crs: UTM40,
        origin: [500_000, 4_000_000, 0],
        spacing: [10, 10, 1],
        dims: [nx, ny, 1],
        z: 0,
        values: { height },
      }),
    },
  });
  const result: LoadResult = resultOf(reply, 'load');
  if (result.status !== 'loaded') throw new Error('blocked');
  return result.summaries[0]?.id ?? -1;
}

const params = (interval: number): ContourParams => ({ interval, base: 0, indexEvery: 5 });

function errorMessage(reply: Posted): string {
  if (reply.message.type !== 'error')
    throw new Error(`expected an error: ${JSON.stringify(reply.message)}`);
  return reply.message.error.message;
}

function progressOf(harness: HandlerHarness, requestId: number): number[] {
  return harness.posted.flatMap((p) =>
    p.message.type === 'contoursProgress' && p.message.id === requestId
      ? [p.message.progress.fraction]
      : [],
  );
}

describe('contours', () => {
  it('is done in steps with progress that only grows, one message for each whole percent at most, with other requests heard between', async () => {
    const harness = await ready();
    const dataset = await loadCone(harness, 800, 500);
    const requestId = id();
    const calls: string[] = [];
    // A request sent while it works is answered before it ends.
    const finished = harness.settle({
      type: 'contours',
      id: requestId,
      params: { dataset, params: params(10) },
    });
    while (progressOf(harness, requestId).length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const between = await harness.settle({
      type: 'crsInfo',
      id: id(),
      params: { code: 4326 },
    });
    calls.push(between.message.type);
    const done = await finished;
    const result = resultOf(done, 'contours');
    expect(result.status).toBe('loaded');
    expect(calls).toStrictEqual(['result']);
    const progress = progressOf(harness, requestId);
    expect(progress.length).toBeGreaterThan(3);
    expect([...progress].sort((a, b) => a - b)).toStrictEqual(progress);
    expect(new Set(progress).size).toBe(progress.length);
    expect(progress.every((f) => f >= 0 && f < 1)).toBe(true);
    expect(done.transfer).toStrictEqual([]);
  });

  it('posts progress at most once for each whole percent, however many steps there are', async () => {
    const module = testKernelModule();
    let calls = 0;
    const spy: KernelModule = {
      ...module,
      createKernel: () => {
        const kernel = wrapKernel(module.createKernel());
        const stepContours = kernel.stepContours;
        // The first 40 steps are small ones, all inside the 50th percent; then the real ones.
        kernel.stepContours = (job, budget) => {
          calls += 1;
          return calls <= 40
            ? { status: 'progress', fraction: 0.5 + calls * 0.0001 }
            : stepContours(job, budget);
        };
        return kernel;
      },
    };
    const harness = await ready(() => spy);
    const dataset = await loadCone(harness, 40, 30);
    const requestId = id();
    await harness.settle({
      type: 'contours',
      id: requestId,
      params: { dataset, params: params(2.5) },
    });
    expect(calls).toBeGreaterThan(40);
    const progress = progressOf(harness, requestId);
    expect(progress.filter((f) => f === 0.5)).toHaveLength(1);
    expect(new Set(progress).size).toBe(progress.length);
  });

  it('stops when the main thread asks, drops the job, and says it was cancelled', async () => {
    const module = testKernelModule();
    const cancelled: [number, boolean][] = [];
    const spy: KernelModule = {
      ...module,
      createKernel: () => {
        const kernel = wrapKernel(module.createKernel());
        const cancelContours = kernel.cancelContours;
        kernel.cancelContours = (job) => {
          const had = cancelContours(job);
          cancelled.push([job, had]);
          return had;
        };
        return kernel;
      },
    };
    const harness = await ready(() => spy);
    const dataset = await loadCone(harness, 800, 500);
    const requestId = id();
    const finished = harness.settle({
      type: 'contours',
      id: requestId,
      params: { dataset, params: params(10) },
    });
    while (progressOf(harness, requestId).length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    harness.send({ type: 'cancel', target: requestId });
    expect((await finished).message).toStrictEqual({ type: 'cancelled', id: requestId });
    // The job was there and was dropped, and nothing was loaded.
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.[1]).toBe(true);
    const rows = await harness.settle({
      type: 'rows',
      id: id(),
      params: { dataset: dataset + 1, start: 0, count: 1 },
    });
    expect(errorMessage(rows)).toMatch(/no dataset/);
  });

  it('says the dataset was removed when it is removed while its contours are being made', async () => {
    const harness = await ready();
    const dataset = await loadCone(harness, 800, 500);
    const requestId = id();
    const finished = harness.settle({
      type: 'contours',
      id: requestId,
      params: { dataset, params: params(10) },
    });
    while (progressOf(harness, requestId).length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await harness.settle({ type: 'remove', id: id(), params: { dataset } });
    expect(errorMessage(await finished)).toMatch(/removed while its contours were being made/);
  });

  it('is misuse, an error and not a finding, for a dataset that is not a whole number or not there and for settings that cannot be used', async () => {
    const harness = await ready();
    const dataset = await loadCone(harness, 40, 30);
    const send = async (p: unknown): Promise<string> =>
      errorMessage(
        await harness.settle({
          type: 'contours',
          id: id(),
          params: p as never,
        }),
      );
    expect(await send({ dataset: 1.5, params: params(2) })).toMatch(/whole number/);
    expect(await send({ dataset: -1, params: params(2) })).toMatch(/whole number/);
    expect(await send({ dataset: 999, params: params(2) })).toMatch(/no dataset with that id/);
    expect(await send({ dataset, params: params(0) })).toMatch(/interval/);
    expect(await send({ dataset, params: { ...params(2), indexEvery: 0 } })).toMatch(/indexEvery/);
    expect(await send({ dataset, params: { ...params(2), colour: 'red' } })).toMatch(/unexpected/);
    expect(await send({ dataset })).toMatch(/params|settings|object/i);
  });

  it('says why nothing was made as a result and not an error, with the findings of the reason', async () => {
    const harness = await ready();
    const dataset = await loadCone(harness, 40, 30);
    const reply = await harness.settle({
      type: 'contours',
      id: id(),
      params: { dataset, params: params(0.001) },
    });
    const result = resultOf(reply, 'contours');
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.findings.map((f) => f.code)).toStrictEqual(['contours.levels.too_many']);
    }
  });
});

describe('contourDefaults', () => {
  it('gives the settings, or why there are none, and is misuse for what is not there', async () => {
    const harness = await ready();
    const dataset = await loadCone(harness, 40, 30);
    const defaults = resultOf(
      await harness.settle({ type: 'contourDefaults', id: id(), params: { dataset } }),
      'contourDefaults',
    );
    expect(defaults).toStrictEqual({
      status: 'defaults',
      params: { column: 'height', interval: 2.5, base: 0, indexEvery: 5 },
    });
    const missing = resultOf(
      await harness.settle({
        type: 'contourDefaults',
        id: id(),
        params: { dataset, column: 'nope' },
      }),
      'contourDefaults',
    );
    expect(missing.status === 'not_available' && missing.findings[0]?.code).toBe(
      'contours.column.missing',
    );
    const send = async (p: unknown): Promise<string> =>
      errorMessage(await harness.settle({ type: 'contourDefaults', id: id(), params: p as never }));
    expect(await send({ dataset: 'x' })).toMatch(/whole number/);
    expect(await send({ dataset, column: 5 })).toMatch(/column must be a string/);
    expect(await send({ dataset: 999 })).toMatch(/no dataset with that id/);
  });
});
