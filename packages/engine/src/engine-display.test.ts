/**
 * The engine's display methods end to end in Node: a real worker handler on the real kernel over a message
 * channel, which clones messages and hands buffers over as a worker does. A spy on the kernel keeps the
 * arrays the worker made, so that the sending side can be looked at after the transfer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Engine } from './api.js';
import { points } from './builders.js';
import type { RenderBuffers } from './display.js';
import { EngineDisposedError, EngineError } from './errors.js';
import type { KernelModule } from './kernel-module.js';
import { testKernelModule, wrapKernel } from './test-support/kernel.js';
import { engineOverChannel } from './test-support/ports.js';
import type { CrsRef } from './types.js';

const UTM40: CrsRef = { kind: 'epsg', code: 32640 };

/** What the worker's kernel produced, kept for looking at after it was posted. */
interface Made {
  readonly steps: unknown[];
  readonly indexes: Uint8Array[];
  readonly cancelled: number[];
}

function spyModule(made: Made): KernelModule {
  const module = testKernelModule();
  return {
    ...module,
    createKernel: () => {
      const kernel = wrapKernel(module.createKernel());
      const { stepPrepare, classIndex, cancelPrepare } = kernel;
      kernel.stepPrepare = (job, budget) => {
        const step = stepPrepare(job, budget);
        made.steps.push(step);
        return step;
      };
      kernel.classIndex = (dataset, breaks) => {
        const index = classIndex(dataset, breaks);
        made.indexes.push(index);
        return index;
      };
      kernel.cancelPrepare = (job) => {
        made.cancelled.push(job);
        return cancelPrepare(job);
      };
      return kernel;
    },
  };
}

const engines: Engine[] = [];
function start(made?: Made): Engine {
  const engine = engineOverChannel(
    made === undefined ? undefined : () => Promise.resolve(spyModule(made)),
  );
  engines.push(engine);
  return engine;
}
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

async function loadPoints(
  engine: Engine,
  count: number,
  extra: Record<string, number[]> = {},
): Promise<number> {
  const result = await engine.load(
    points({
      name: 'Wells',
      crs: UTM40,
      x: new Float64Array(count).map((_, i) => 500_000 + (i % 1_000)),
      y: new Float64Array(count).map((_, i) => 2_700_000 + Math.floor(i / 1_000)),
      attributes: extra,
    }),
  );
  if (result.status !== 'loaded') throw new Error('blocked');
  return result.summaries[0]?.id ?? -1;
}

describe('chooseFrame', () => {
  it('has no frame for nothing, and a frame once there is data, kept until the last dataset goes', async () => {
    const engine = start();
    expect(await engine.chooseFrame()).toStrictEqual({ frame: null, drawable: [], findings: [] });
    const id = await loadPoints(engine, 10);
    const choice = await engine.chooseFrame();
    expect(choice.frame?.mapCrs).toStrictEqual(UTM40);
    expect(choice.drawable).toStrictEqual([
      { id, status: 'drawn', reprojected: false, findings: [] },
    ]);
    const user = await engine.chooseFrame({ kind: 'epsg', code: 32641 });
    expect(user.frame?.source).toBe('user');
    expect(user.drawable[0]?.reprojected).toBe(true);
    await engine.remove(id);
    expect((await engine.chooseFrame()).frame).toBeNull();
  });
});

describe('previewFrame', () => {
  it('says what choosing a system would say, as often as it is asked, and chooses nothing', async () => {
    const engine = start();
    expect((await engine.previewFrame(UTM40)).frame).toBeNull();
    const id = await loadPoints(engine, 10);
    const kept = await engine.chooseFrame();
    const local = await engine.previewFrame({ kind: 'local', units: 'm' });
    expect(local.frame).toMatchObject({ mapCrs: { kind: 'local', units: 'm' }, source: 'user' });
    expect(local.drawable.map((entry) => [entry.id, entry.status])).toStrictEqual([
      [id, 'not_drawn'],
    ]);
    expect(local.drawable[0]?.findings.length).toBeGreaterThan(0);
    const other = await engine.previewFrame({ kind: 'epsg', code: 32641 });
    expect(other.drawable[0]).toMatchObject({ id, status: 'drawn', reprojected: true });
    // Neither changed the frame the engine keeps, and a choice says what its preview did.
    expect((await engine.chooseFrame()).frame).toStrictEqual(kept.frame);
    expect(await engine.chooseFrame({ kind: 'epsg', code: 32641 })).toStrictEqual(other);
  });

  it('is refused after the engine is disposed of', async () => {
    const engine = start();
    engine.dispose();
    await expect(engine.previewFrame(UTM40)).rejects.toBeInstanceOf(EngineDisposedError);
  });
});

describe('prepare', () => {
  it('gives the buffers, with progress, and the worker’s copies are empty once they have been handed over', async () => {
    const made: Made = { steps: [], indexes: [], cancelled: [] };
    const engine = start(made);
    const id = await loadPoints(engine, 350_000);
    const frame = (await engine.chooseFrame()).frame;
    if (frame === null) throw new Error('no frame');
    const fractions: number[] = [];
    const result = await engine.prepare(
      id,
      { frame },
      { onProgress: (p) => fractions.push(p.fraction) },
    );
    expect(result.status).toBe('drawn');
    if (result.status !== 'drawn') return;
    const buffers: RenderBuffers = result.buffers;
    if (buffers.kind !== 'points') throw new Error('not points');
    expect(buffers.positions).toBeInstanceOf(Float32Array);
    expect(buffers.positions).toHaveLength(350_000 * 3);
    expect(fractions.length).toBeGreaterThanOrEqual(2);
    expect(fractions).toStrictEqual([...fractions].sort((a, b) => a - b));
    // The arrays the worker made are the ones it posted, and they were handed over: empty on its side.
    const done = made.steps.find(
      (s): s is { status: 'done'; result: { buffers: { positions: Float32Array } } } =>
        (s as { status?: string }).status === 'done',
    );
    expect(done?.result.buffers.positions.byteLength).toBe(0);
    expect(done?.result.buffers.positions.buffer.byteLength).toBe(0);
    // And the receiver's are whole.
    expect(buffers.positions.byteLength).toBe(350_000 * 12);
  });

  it('stops when the signal is aborted, rejects with its reason and drops the job', async () => {
    const made: Made = { steps: [], indexes: [], cancelled: [] };
    const engine = start(made);
    const id = await loadPoints(engine, 350_000);
    const frame = (await engine.chooseFrame()).frame;
    if (frame === null) throw new Error('no frame');
    const controller = new AbortController();
    const preparing = engine.prepare(
      id,
      { frame },
      {
        signal: controller.signal,
        onProgress: () => {
          controller.abort();
        },
      },
    );
    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    expect(made.cancelled).toHaveLength(1);
    await expect(
      engine.prepare(id, { frame }, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('says why a dataset is not drawn, with the findings and no buffers', async () => {
    const engine = start();
    const id = await loadPoints(engine, 5);
    const local: CrsRef = { kind: 'local', units: 'm' };
    const result = await engine.prepare(id, {
      frame: { mapCrs: local, origin: [0, 0, 0], source: 'user' },
    });
    expect(result.status).toBe('not_drawn');
    if (result.status === 'not_drawn') {
      expect(result.findings.map((f) => f.code)).toStrictEqual(['display.crs.not_convertible']);
    }
  });

  it('rejects what is misuse with an error that says what', async () => {
    const engine = start();
    const id = await loadPoints(engine, 5);
    const frame = (await engine.chooseFrame()).frame;
    if (frame === null) throw new Error('no frame');
    await expect(engine.prepare(id, { frame, maxTextureSize: 0 })).rejects.toThrow(
      /at least 1 cell/,
    );
    await expect(engine.prepare(-1, { frame })).rejects.toBeInstanceOf(EngineError);
    await expect(engine.prepare(id + 100, { frame })).rejects.toThrow(/no dataset with that id/);
  });
});

describe('classify and classIndex', () => {
  it('divides a column and gives the class of every element, the index handed over', async () => {
    const made: Made = { steps: [], indexes: [], cancelled: [] };
    const engine = start(made);
    const id = await loadPoints(engine, 4, { grade: [1, 2, 3, Number.NaN] });
    const classified = await engine.classify(id, 'grade', 'equal', 2);
    expect(classified.status).toBe('classified');
    if (classified.status !== 'classified') return;
    expect(classified.breaks).toMatchObject({
      kind: 'ranges',
      column: 'grade',
      bounds: [1, 2, 3],
      nulls: 1,
    });
    const index = await engine.classIndex(id, classified.breaks);
    expect(Array.from(index)).toStrictEqual([0, 1, 1, 255]);
    expect(index.buffer).not.toBe(made.indexes[0]?.buffer);
    expect(made.indexes[0]?.byteLength).toBe(0);
    const text = await engine.classify(id, 'nothing', 'equal', 2);
    expect(text.status).toBe('not_classified');
  });

  it('refuses a method that is not one of the four', async () => {
    const engine = start();
    const id = await loadPoints(engine, 2, { grade: [1, 2] });
    await expect(engine.classify(id, 'grade', 'rainbow' as never, 3)).rejects.toThrow(
      /expected one of equal/,
    );
  });
});

describe('after dispose', () => {
  it('every display method is refused, as misuse', async () => {
    const engine = start();
    const id = await loadPoints(engine, 2, { grade: [1, 2] });
    const frame = (await engine.chooseFrame()).frame;
    if (frame === null) throw new Error('no frame');
    engine.dispose();
    await expect(engine.chooseFrame()).rejects.toBeInstanceOf(EngineDisposedError);
    await expect(engine.prepare(id, { frame })).rejects.toBeInstanceOf(EngineDisposedError);
    await expect(engine.classify(id, 'grade', 'equal', 2)).rejects.toBeInstanceOf(
      EngineDisposedError,
    );
    await expect(
      engine.classIndex(id, {
        kind: 'ranges',
        column: 'grade',
        bounds: [0, 1],
        counts: [1],
        nulls: 0,
      }),
    ).rejects.toBeInstanceOf(EngineDisposedError);
  });
});
