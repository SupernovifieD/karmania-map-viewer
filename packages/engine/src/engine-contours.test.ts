/**
 * The engine's contour lines end to end in Node: a real worker handler on the real kernel over a message channel, as the page has
 * it. What the engine keeps (its list of datasets, and what it announces) has to be right through replacing, failing, removing and
 * stopping, since the Data tab and the legend are built on it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Engine } from './api.js';
import { grid, mesh, points } from './builders.js';
import { EngineError } from './errors.js';
import { engineOverChannel } from './test-support/ports.js';
import type { ContourParams, CrsRef, LoadResult, Summary } from './types.js';

const UTM40: CrsRef = { kind: 'epsg', code: 32640 };

const engines: Engine[] = [];
function start(): Engine {
  const engine = engineOverChannel();
  engines.push(engine);
  return engine;
}
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

const settings = (interval: number, extra: Partial<ContourParams> = {}): ContourParams => ({
  interval,
  base: 0,
  indexEvery: 5,
  ...extra,
});

/** A cone of `nx` by `ny` cells with a column of heights and a column of text. */
async function loadCone(engine: Engine, nx = 40, ny = 30, name = 'Cone'): Promise<number> {
  const height = new Float64Array(nx * ny).map((_, k) =>
    Math.hypot((k % nx) - nx / 2, Math.floor(k / nx) - ny / 2),
  );
  const result = await engine.load(
    grid({
      name,
      crs: UTM40,
      origin: [500_000, 4_000_000, 0],
      spacing: [10, 10, 1],
      dims: [nx, ny, 1],
      z: 0,
      values: { label: Array.from({ length: nx * ny }, () => 'a'), height },
    }),
  );
  return idOf(result);
}

async function loadPyramid(engine: Engine): Promise<number> {
  return idOf(
    await engine.load(
      mesh({
        name: 'Pyramid',
        crs: UTM40,
        x: [0, 10, 0, 10, 5],
        y: [0, 0, 10, 10, 5],
        z: [0, 0, 0, 0, 10],
        indices: [0, 1, 4, 1, 3, 4, 3, 2, 4, 2, 0, 4],
      }),
    ),
  );
}

function idOf(result: LoadResult): number {
  if (result.status !== 'loaded') throw new Error('blocked');
  return result.summaries[0]?.id ?? -1;
}

function linesOf(result: LoadResult): Summary {
  if (result.status !== 'loaded') throw new Error(`blocked: ${JSON.stringify(result.findings)}`);
  const [lines] = result.summaries;
  if (lines === undefined) throw new Error('no summary');
  return lines;
}

const ids = (list: readonly Summary[]): number[] => list.map((s) => s.id);

describe('engine.contours', () => {
  it('makes the lines of a grid as a dataset that is listed and says where it came from', async () => {
    const engine = start();
    const source = await loadCone(engine);
    const heard: number[][] = [];
    engine.on('datasets', (list) => heard.push(ids(list)));
    const lines = linesOf(await engine.contours(source, settings(2.5)));
    expect(lines.name).toBe('Contours of Cone (every 2.5)');
    expect(lines.kind).toBe('lines');
    expect(lines.crs).toStrictEqual(UTM40);
    expect(lines.columns.map((c) => [c.name, c.type])).toStrictEqual([
      ['level', 'float'],
      ['index', 'bool'],
    ]);
    // The column that was taken is the first of numbers, `height` (`label` is text), and the settings are those used.
    expect(lines.derivedFrom).toStrictEqual({
      id: source,
      kind: 'contours',
      params: { column: 'height', interval: 2.5, base: 0, indexEvery: 5 },
    });
    expect(ids(engine.datasets())).toStrictEqual([source, lines.id]);
    expect(engine.datasets()[1]).toStrictEqual(lines);
    expect(heard).toStrictEqual([[source, lines.id]]);
    // The rows of the lines can be read: the level of each line and whether it is an index line.
    const page = await engine.rows(lines.id, 0, 100);
    const level = page.columns.find((c) => c.name === 'level');
    const index = page.columns.find((c) => c.name === 'index');
    expect(page.count).toBe(lines.elementCount);
    expect(Array.from(level?.values as Float64Array)).toContain(5);
    // Index lines are every 5th from the base 0: 0, 12.5, 25 for an interval of 2.5; none below 12.5 has 5 as the level.
    const levels = Array.from(level?.values as Float64Array);
    const flags = Array.from(index?.values as Uint8Array);
    levels.forEach((l, i) => {
      expect(flags[i] === 1, `level ${String(l)}`).toBe(Math.round(l / 2.5) % 5 === 0);
    });
  });

  it('makes the lines of a mesh by height, and ignores a column that is named', async () => {
    const engine = start();
    const source = await loadPyramid(engine);
    const lines = linesOf(await engine.contours(source, settings(2.5, { column: 'whatever' })));
    expect(lines.name).toBe('Contours of Pyramid (every 2.5)');
    expect(lines.hasZ).toBe(true);
    expect(lines.derivedFrom?.params).toStrictEqual({ interval: 2.5, base: 0, indexEvery: 5 });
  });

  it('is made in parts: the progress only grows, is under 1, and has many values for a large grid', async () => {
    const engine = start();
    const source = await loadCone(engine, 800, 500);
    const fractions: number[] = [];
    await engine.contours(source, settings(10), {
      onProgress: (progress) => fractions.push(progress.fraction),
    });
    expect(fractions.length).toBeGreaterThan(3);
    expect(fractions.every((f) => f >= 0 && f < 1)).toBe(true);
    expect([...fractions].sort((a, b) => a - b)).toStrictEqual(fractions);
    expect(fractions.at(-1)).toBeGreaterThan(0.7);
  });

  it('replaces the lines made before from the same dataset in one announcement, and no other dataset’s', async () => {
    const engine = start();
    const cone = await loadCone(engine);
    const pyramid = await loadPyramid(engine);
    const first = linesOf(await engine.contours(cone, settings(2.5)));
    const ofPyramid = linesOf(await engine.contours(pyramid, settings(2.5)));
    const heard: number[][] = [];
    engine.on('datasets', (list) => heard.push(ids(list)));
    // Its rows have been read, so that they are in the cache of pages.
    expect((await engine.rows(first.id, 0, 5)).count).toBe(5);
    const second = linesOf(await engine.contours(cone, settings(5)));
    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe('Contours of Cone (every 5)');
    expect(ids(engine.datasets())).toStrictEqual([cone, pyramid, ofPyramid.id, second.id]);
    // One change, with the old lines out and the new in: nobody saw both, or neither.
    expect(heard).toStrictEqual([[cone, pyramid, ofPyramid.id, second.id]]);
    // The old lines are gone from the worker too.
    await expect(engine.rows(first.id, 0, 1)).rejects.toBeInstanceOf(EngineError);
  });

  it('says why nothing was made, and the old lines are gone then too', async () => {
    const engine = start();
    const cone = await loadCone(engine);
    const first = linesOf(await engine.contours(cone, settings(2.5)));
    expect((await engine.rows(first.id, 0, 5)).count).toBe(5);
    const heard: number[][] = [];
    engine.on('datasets', (list) => heard.push(ids(list)));
    // More than 1,000 levels: the heights go from 0 to about 25.
    const tooMany = await engine.contours(cone, settings(0.001));
    expect(tooMany.status).toBe('blocked');
    if (tooMany.status === 'blocked') {
      expect(tooMany.findings.map((f) => f.code)).toStrictEqual(['contours.levels.too_many']);
      expect(tooMany.findings[0]?.severity).toBe('error');
    }
    expect(ids(engine.datasets())).toStrictEqual([cone]);
    expect(heard).toStrictEqual([[cone]]);
    await expect(engine.rows(first.id, 0, 1)).rejects.toBeInstanceOf(EngineError);
    // Another reason, which is a warning, and a call when there is nothing to take out: no announcement.
    const text = await engine.contours(cone, settings(2.5, { column: 'label' }));
    expect(text.status === 'blocked' && text.findings.map((f) => f.code)).toStrictEqual([
      'contours.column.not_numeric',
    ]);
    expect(heard).toStrictEqual([[cone]]);
    // The dataset is not a grid or a mesh.
    const wells = idOf(
      await engine.load(points({ name: 'Wells', crs: UTM40, x: [500_000], y: [4_000_000] })),
    );
    const other = await engine.contours(wells, settings(2.5));
    expect(other.status === 'blocked' && other.findings.map((f) => f.code)).toStrictEqual([
      'contours.kind.unsupported',
    ]);
  });

  it('is removed with its dataset, in one announcement, and the lines of the others stay', async () => {
    const engine = start();
    const cone = await loadCone(engine);
    const pyramid = await loadPyramid(engine);
    const ofCone = linesOf(await engine.contours(cone, settings(2.5)));
    const ofPyramid = linesOf(await engine.contours(pyramid, settings(2.5)));
    expect((await engine.rows(ofCone.id, 0, 5)).count).toBe(5);
    const heard: number[][] = [];
    engine.on('datasets', (list) => heard.push(ids(list)));
    await engine.remove(cone);
    expect(ids(engine.datasets())).toStrictEqual([pyramid, ofPyramid.id]);
    expect(heard).toStrictEqual([[pyramid, ofPyramid.id]]);
    await expect(engine.rows(ofCone.id, 0, 1)).rejects.toBeInstanceOf(EngineError);
    // Removing the lines alone leaves the dataset.
    await engine.remove(ofPyramid.id);
    expect(ids(engine.datasets())).toStrictEqual([pyramid]);
  });

  it('is misuse when the settings are not usable or the dataset is not there, and changes nothing', async () => {
    const engine = start();
    const cone = await loadCone(engine);
    const lines = linesOf(await engine.contours(cone, settings(2.5)));
    const heard: number[][] = [];
    engine.on('datasets', (list) => heard.push(ids(list)));
    for (const bad of [
      settings(0),
      settings(-1),
      settings(Number.NaN),
      settings(2.5, { indexEvery: 0 }),
      settings(2.5, { indexEvery: 1.5 }),
    ]) {
      await expect(engine.contours(cone, bad)).rejects.toThrow();
    }
    await expect(engine.contours(999, settings(2.5))).rejects.toBeInstanceOf(EngineError);
    expect(ids(engine.datasets())).toStrictEqual([cone, lines.id]);
    expect(heard).toStrictEqual([]);
  });

  it('can be stopped, and then the lines made before are as they were', async () => {
    const engine = start();
    const cone = await loadCone(engine, 800, 500);
    const before = linesOf(await engine.contours(cone, settings(10)));
    const heard: number[][] = [];
    engine.on('datasets', (list) => heard.push(ids(list)));
    const controller = new AbortController();
    const stopped = engine.contours(cone, settings(20), {
      signal: controller.signal,
      onProgress: () => {
        controller.abort();
      },
    });
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
    expect(ids(engine.datasets())).toStrictEqual([cone, before.id]);
    expect(heard).toStrictEqual([]);
    // The worker is free, and what it has still works.
    expect((await engine.rows(before.id, 0, 1)).count).toBe(1);
    expect(linesOf(await engine.contours(cone, settings(20))).name).toBe(
      'Contours of Cone (every 20)',
    );
  });

  it("is superseded by a newer call for the same dataset that is made while it is under way: it rejects and the lines are the newer call's", async () => {
    const engine = start();
    const cone = await loadCone(engine, 800, 500);
    const heard: number[][] = [];
    engine.on('datasets', (list) => heard.push(ids(list)));
    let newer: Promise<LoadResult> | undefined;
    const older = engine.contours(cone, settings(10), {
      onProgress: () => {
        newer ??= engine.contours(cone, settings(40));
      },
    });
    await expect(older).rejects.toThrow(/superseded by a newer call/);
    if (newer === undefined) throw new Error('the newer call was not made');
    const lines = linesOf(await newer);
    expect(lines.name).toBe('Contours of Cone (every 40)');
    // The list never had the lines of the older call, and has the lines of the newer.
    expect(ids(engine.datasets())).toStrictEqual([cone, lines.id]);
    expect(heard).toStrictEqual([[cone, lines.id]]);
  });

  it('is cancelled by the removal of its dataset in the middle, with a message that says so', async () => {
    const engine = start();
    const cone = await loadCone(engine, 800, 500);
    let removing: Promise<void> | undefined;
    const made = engine.contours(cone, settings(10), {
      onProgress: () => {
        removing ??= engine.remove(cone);
      },
    });
    await expect(made).rejects.toThrow(/removed while its contours were being made/);
    await removing;
    expect(engine.datasets()).toStrictEqual([]);
  });
});

describe('engine.contourDefaults', () => {
  it('gives the settings a set of contours starts with, which make contours', async () => {
    const engine = start();
    const cone = await loadCone(engine);
    const defaults = await engine.contourDefaults(cone);
    expect(defaults).toStrictEqual({
      status: 'defaults',
      params: { column: 'height', interval: 2.5, base: 0, indexEvery: 5 },
    });
    if (defaults.status !== 'defaults') throw new Error('no settings');
    expect(await engine.contourDefaults(cone, 'height')).toStrictEqual(defaults);
    const lines = linesOf(await engine.contours(cone, defaults.params));
    expect(lines.elementCount).toBeGreaterThan(5);
    const pyramid = await loadPyramid(engine);
    expect(await engine.contourDefaults(pyramid)).toStrictEqual({
      status: 'defaults',
      params: { interval: 1, base: 0, indexEvery: 5 },
    });
  });

  it('says why a dataset has none, and rejects for a dataset that is not there', async () => {
    const engine = start();
    const cone = await loadCone(engine);
    const wells = idOf(
      await engine.load(points({ name: 'Wells', crs: UTM40, x: [500_000], y: [4_000_000] })),
    );
    const codes = async (id: number, column?: string): Promise<string[]> => {
      const result = await engine.contourDefaults(id, column);
      return result.status === 'not_available' ? result.findings.map((f) => f.code) : [];
    };
    expect(await codes(wells)).toStrictEqual(['contours.kind.unsupported']);
    expect(await codes(cone, 'label')).toStrictEqual(['contours.column.not_numeric']);
    expect(await codes(cone, 'nope')).toStrictEqual(['contours.column.missing']);
    await expect(engine.contourDefaults(999)).rejects.toBeInstanceOf(EngineError);
  });
});
