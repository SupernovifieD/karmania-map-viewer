/**
 * The exports of the built kernel that prepare datasets for drawing, in Node: the frame, the stepped
 * prepare jobs with their typed arrays, and the classes. Results are `unknown` until checked, as the
 * engine treats anything that crosses the boundary.
 */
import { describe, expect, it } from 'vitest';
import { checkedClassifyResult } from './display-check.js';
import { createKernel, type TestKernelInstance } from './test-support/kernel.js';
import type { CrsRef, KernelColumn } from './types.js';

const UTM40: CrsRef = { kind: 'epsg', code: 32640 };
const WGS84: CrsRef = { kind: 'epsg', code: 4326 };
const METRES: CrsRef = { kind: 'local', units: 'm' };

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  return value as Obj;
}

function asArray(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

function floatColumn(name: string, values: number[]): KernelColumn {
  return { name, type: 'float', values: new Float64Array(values) };
}

/** Loads one dataset and returns its id. */
function load(kernel: TestKernelInstance, input: unknown): number {
  const result = asObject(kernel.load(input));
  expect(result.status).toBe('loaded');
  const summaries = asArray(result.summaries);
  return asObject(summaries[0]).id as number;
}

function points(
  kernel: TestKernelInstance,
  crs: CrsRef,
  xy: [number, number][],
  columns?: KernelColumn[],
): number {
  return load(kernel, {
    kind: 'points',
    name: 'Wells',
    crs,
    x: new Float64Array(xy.map((p) => p[0])),
    y: new Float64Array(xy.map((p) => p[1])),
    ...(columns === undefined ? {} : { columns }),
  });
}

/** Steps a prepare to the end; returns the `result` of the step that is `done`, and how many steps it took. */
function prepare(
  kernel: TestKernelInstance,
  dataset: number,
  frame: unknown,
  budget = 1_000_000,
  maxTexture = 4096,
): { readonly result: Obj; readonly steps: number } {
  const job = kernel.startPrepare(dataset, frame, maxTexture);
  let steps = 0;
  let last = -1;
  for (;;) {
    steps += 1;
    expect(steps).toBeLessThan(10_000);
    const step = asObject(kernel.stepPrepare(job, budget));
    if (step.status === 'progress') {
      const fraction = step.fraction as number;
      expect(fraction).toBeGreaterThanOrEqual(last);
      expect(fraction).toBeLessThanOrEqual(1);
      last = fraction;
    } else {
      expect(step.status).toBe('done');
      return { result: asObject(step.result), steps };
    }
  }
}

function frameOf(kernel: TestKernelInstance, preferred?: CrsRef): Obj {
  const choice = asObject(kernel.chooseFrame(preferred));
  return asObject(choice.frame);
}

describe('chooseFrame', () => {
  it('has no frame, and no datasets, when nothing is loaded, with null and not undefined', () => {
    const choice = asObject(createKernel().chooseFrame());
    expect(choice).toStrictEqual({ frame: null, drawable: [], findings: [] });
  });

  it('takes the system of a projected dataset, and the centre of its extent for the origin', () => {
    const kernel = createKernel();
    const id = points(kernel, UTM40, [
      [512_000, 4_012_000],
      [513_000, 4_013_000],
    ]);
    const choice = asObject(kernel.chooseFrame());
    expect(choice.frame).toStrictEqual({
      mapCrs: UTM40,
      origin: [513_000, 4_013_000, 0],
      source: 'auto',
    });
    expect(choice.drawable).toStrictEqual([
      { id, status: 'drawn', reprojected: false, findings: [] },
    ]);
    expect(choice.findings).toStrictEqual([]);
  });

  it('chooses a UTM zone for data in longitude and latitude, and says so once', () => {
    const kernel = createKernel();
    const id = points(kernel, WGS84, [
      [57, 25],
      [57.6, 25.4],
    ]);
    const choice = asObject(kernel.chooseFrame());
    expect(asObject(choice.frame).mapCrs).toStrictEqual(UTM40);
    const findings = asArray(choice.findings);
    expect(findings).toHaveLength(1);
    expect(asObject(findings[0]).code).toBe('display.frame.utm_chosen');
    expect(asObject(asArray(choice.drawable)[0])).toMatchObject({
      id,
      status: 'drawn',
      reprojected: true,
    });
    // The frame is kept, and the finding was said once.
    const again = asObject(kernel.chooseFrame());
    expect(again.frame).toStrictEqual(choice.frame);
    expect(again.findings).toStrictEqual([]);
  });

  it('keeps the frame while datasets remain, takes the person’s choice, and loses it with the last dataset', () => {
    const kernel = createKernel();
    const first = points(kernel, UTM40, [[512_000, 4_012_000]]);
    const second = points(kernel, { kind: 'epsg', code: 32641 }, [[300_000, 4_000_000]]);
    const auto = frameOf(kernel);
    expect(auto.mapCrs).toStrictEqual(UTM40);
    expect(kernel.remove(first)).toBe(true);
    expect(frameOf(kernel)).toStrictEqual(auto);
    const chosen = frameOf(kernel, { kind: 'epsg', code: 32641 });
    expect(chosen.mapCrs).toStrictEqual({ kind: 'epsg', code: 32641 });
    expect(chosen.source).toBe('user');
    expect(kernel.remove(second)).toBe(true);
    expect(kernel.chooseFrame()).toStrictEqual({ frame: null, drawable: [], findings: [] });
  });

  it('makes the origin from the first dataset that can be drawn, when the person’s choice had none', () => {
    // A local grid is loaded and the person chooses UTM 40, in which nothing is drawn: the origin is 0.
    const kernel = createKernel();
    points(kernel, METRES, [[1, 1]]);
    const chosen = frameOf(kernel, UTM40);
    expect(chosen.origin).toStrictEqual([0, 0, 0]);
    // Data in UTM 40 comes: it is drawn, and the origin is made from it (once), so that points 1 cm
    // apart are two numbers.
    const id = points(kernel, UTM40, [
      [512_000.01, 4_012_345.01],
      [512_000.02, 4_012_345.02],
    ]);
    const frame = frameOf(kernel);
    expect(frame.origin).toStrictEqual([512_000, 4_012_000, 0]);
    expect(frame.source).toBe('user');
    const positions = asObject(prepare(kernel, id, frame).result.buffers).positions as Float32Array;
    expect(positions[0]).toBeLessThan(positions[3] ?? Number.NaN);
    expect(positions[1]).toBeLessThan(positions[4] ?? Number.NaN);
    // And it stays, however many datasets come after.
    points(kernel, UTM40, [[300_000, 4_000_000]]);
    expect(frameOf(kernel)).toStrictEqual(frame);
  });

  it('drops the frame itself when the last dataset is removed, without chooseFrame being asked in between', () => {
    // Found by the review of the milestone: the frame was dropped only if chooseFrame happened to run while
    // nothing was loaded, so a page that removed A and loaded B and then asked got A's system and origin.
    const kernel = createKernel();
    const a = points(kernel, UTM40, [[512_000, 4_012_000]]);
    expect(frameOf(kernel).mapCrs).toStrictEqual(UTM40);
    expect(kernel.remove(a)).toBe(true);
    const b = points(kernel, { kind: 'epsg', code: 32641 }, [[300_000, 4_000_000]]);
    const frame = frameOf(kernel);
    expect(frame.mapCrs).toStrictEqual({ kind: 'epsg', code: 32641 });
    expect(frame.origin).toStrictEqual([300_000, 4_000_000, 0]);
    expect(frame.source).toBe('auto');
    expect(asArray(asObject(kernel.chooseFrame()).drawable)).toHaveLength(1);
    // Removing one of two datasets does not drop it.
    const c = points(kernel, { kind: 'epsg', code: 32641 }, [[310_000, 4_010_000]]);
    expect(kernel.remove(b)).toBe(true);
    expect(frameOf(kernel)).toStrictEqual(frame);
    expect(kernel.remove(c)).toBe(true);
  });

  it('throws for a preferred system that is not one', () => {
    expect(() => createKernel().chooseFrame({ kind: 'nonsense' })).toThrow(/not valid/);
  });
});

describe('previewFrame', () => {
  it('says what chooseFrame would say for a system, and keeps nothing', () => {
    const kernel = createKernel();
    const id = points(kernel, UTM40, [
      [512_000, 4_012_000],
      [513_000, 4_013_000],
    ]);
    const kept = asObject(kernel.chooseFrame());
    // The data are in UTM 40, which a local grid is not a system for: they would not be drawn in it.
    const preview = asObject(kernel.previewFrame(METRES));
    expect(asObject(preview.frame)).toMatchObject({ mapCrs: METRES, source: 'user' });
    const entry = asObject(asArray(preview.drawable)[0]);
    expect(entry).toMatchObject({ id, status: 'not_drawn' });
    expect(asArray(entry.findings).length).toBeGreaterThan(0);
    // The kernel's frame is what it was, and choosing the system says the same as the preview did.
    expect(asObject(kernel.chooseFrame()).frame).toStrictEqual(kept.frame);
    expect(asObject(kernel.chooseFrame(METRES))).toStrictEqual(preview);
  });

  it('says that a dataset would be drawn, and reprojected, in another system that it can be converted to', () => {
    const kernel = createKernel();
    const id = points(kernel, UTM40, [[512_000, 4_012_000]]);
    kernel.chooseFrame();
    const preview = asObject(kernel.previewFrame(WGS84));
    expect(asObject(asArray(preview.drawable)[0])).toMatchObject({
      id,
      status: 'drawn',
      reprojected: true,
    });
    // The frame of a map in degrees has an origin of whole degrees, not UTM metres.
    expect(asObject(preview.frame).mapCrs).toStrictEqual(WGS84);
    expect(asObject(kernel.chooseFrame()).frame).toMatchObject({ mapCrs: UTM40, source: 'auto' });
  });

  it('has no frame and no datasets when nothing is loaded', () => {
    expect(createKernel().previewFrame(UTM40)).toStrictEqual({
      frame: null,
      drawable: [],
      findings: [],
    });
  });

  // That a preview does not make the origin that waits for a dataset is held by the preparer's test in Rust (`a_preview_does_not_make_an_origin_that_is_waiting`):
  // here a later `chooseFrame` would give the same origin whether or not the preview had kept it.
  it('leaves the frame as it was, and says the origin that a choice would make', () => {
    const kernel = createKernel();
    points(kernel, METRES, [[1, 1]]);
    kernel.chooseFrame();
    // The map is put in a system nothing is drawn in, so its origin is 0 and waits for a dataset that is.
    expect(asObject(asObject(kernel.chooseFrame(UTM40)).frame).origin).toStrictEqual([0, 0, 0]);
    points(kernel, UTM40, [[512_000.01, 4_012_345.01]]);
    // A preview of the map's own system has the origin that a choice would make, and does not make it.
    const preview = asObject(asObject(kernel.previewFrame(UTM40)).frame);
    expect(preview.origin).toStrictEqual([512_000, 4_012_000, 0]);
    // A preview of another system in between does not disturb it either.
    kernel.previewFrame(WGS84);
    expect(asObject(kernel.chooseFrame()).frame).toStrictEqual(preview);
  });

  it('refuses a system that is not one, and takes no preference as the one the map is in', () => {
    const kernel = createKernel();
    points(kernel, UTM40, [[512_000, 4_012_000]]);
    const kept = asObject(kernel.chooseFrame());
    expect(() => kernel.previewFrame({ kind: 'nonsense' })).toThrow(/not valid/);
    expect(asObject(kernel.previewFrame(undefined)).frame).toStrictEqual(kept.frame);
  });
});

describe('prepare', () => {
  it('gives the positions of points as a Float32Array, relative to the origin, with its own buffer', () => {
    const kernel = createKernel();
    const id = points(kernel, UTM40, [
      [512_001, 4_012_002],
      [511_000, 4_011_000],
    ]);
    const frame = { mapCrs: UTM40, origin: [512_000, 4_012_000, 0], source: 'auto' };
    const { result } = prepare(kernel, id, frame);
    expect(result.status).toBe('drawn');
    const buffers = asObject(result.buffers);
    expect(buffers.kind).toBe('points');
    const positions = buffers.positions as Float32Array;
    expect(positions).toBeInstanceOf(Float32Array);
    expect(Array.from(positions)).toStrictEqual([1, 2, 0, -1000, -1000, 0]);
    expect(positions.buffer.byteLength).toBe(positions.byteLength);
    expect(result.findings).toStrictEqual([]);
  });

  it('gives buffers that can be transferred: the sender’s are detached afterwards', () => {
    const kernel = createKernel();
    const id = points(kernel, UTM40, [[512_001, 4_012_002]]);
    const frame = { mapCrs: UTM40, origin: [512_000, 4_012_000, 0], source: 'auto' };
    const buffers = asObject(prepare(kernel, id, frame).result.buffers);
    const positions = buffers.positions as Float32Array;
    expect(positions.byteLength).toBe(12);
    const moved = structuredClone(positions, { transfer: [positions.buffer] });
    expect(Array.from(moved)).toStrictEqual([1, 2, 0]);
    expect(positions.byteLength).toBe(0);
  });

  it('steps by a budget, and says how far it is', () => {
    const kernel = createKernel();
    const xy: [number, number][] = Array.from({ length: 40 }, (_, i) => [512_000 + i, 4_012_000]);
    const id = points(kernel, UTM40, xy);
    const frame = { mapCrs: UTM40, origin: [512_000, 4_012_000, 0], source: 'auto' };
    expect(prepare(kernel, id, frame, 5).steps).toBe(8);
    expect(prepare(kernel, id, frame, 1_000).steps).toBe(1);
    const whole = asObject(prepare(kernel, id, frame, 1_000).result.buffers)
      .positions as Float32Array;
    const parts = asObject(prepare(kernel, id, frame, 7).result.buffers).positions as Float32Array;
    expect(Array.from(parts)).toStrictEqual(Array.from(whole));
  });

  it('counts positions that cannot be converted, and keeps their place as NaN', () => {
    const kernel = createKernel();
    const id = points(kernel, WGS84, [
      [57, 25],
      [57, 95],
    ]);
    const frame = frameOf(kernel);
    const { result } = prepare(kernel, id, frame);
    const positions = asObject(result.buffers).positions as Float32Array;
    expect(positions).toHaveLength(6);
    expect(Number.isNaN(positions[3])).toBe(true);
    expect(asArray(result.findings).map((f) => asObject(f).code)).toStrictEqual([
      'crs.transform.not_finite',
    ]);
  });

  it('says why a dataset is not drawn, with no buffers', () => {
    const kernel = createKernel();
    const id = load(kernel, {
      kind: 'blocks',
      name: 'Model',
      crs: { kind: 'epsg', code: 32641 },
      origin: [0, 0, 0],
      spacing: [1, 1, 1],
      dims: [2, 2, 2],
    });
    const frame = { mapCrs: UTM40, origin: [0, 0, 0], source: 'user' };
    const { result, steps } = prepare(kernel, id, frame);
    expect(steps).toBe(1);
    expect(result.status).toBe('not_drawn');
    expect(result.buffers).toBeUndefined();
    expect(asArray(result.findings).map((f) => asObject(f).code)).toStrictEqual([
      'display.blocks.other_crs',
    ]);
  });

  it('gives typed arrays for every kind', () => {
    const kernel = createKernel();
    const frame = { mapCrs: METRES, origin: [0, 0, 0], source: 'auto' };
    const ids = {
      lines: load(kernel, {
        kind: 'lines',
        name: 'Roads',
        crs: METRES,
        x: new Float64Array([0, 1, 2, 5, 6]),
        y: new Float64Array([0, 1, 0, 5, 6]),
        offsets: new Uint32Array([0, 3, 5]),
      }),
      polygons: load(kernel, {
        kind: 'polygons',
        name: 'Leases',
        crs: METRES,
        x: new Float64Array([0, 10, 10, 0, 2, 2, 4, 4]),
        y: new Float64Array([0, 0, 10, 10, 2, 4, 4, 2]),
        ringOffsets: new Uint32Array([0, 4, 8]),
        polygonOffsets: new Uint32Array([0, 2]),
      }),
      mesh: load(kernel, {
        kind: 'mesh',
        name: 'Surface',
        crs: METRES,
        x: new Float64Array([0, 1, 0]),
        y: new Float64Array([0, 0, 1]),
        z: new Float64Array([1, 2, 3]),
        indices: new Uint32Array([0, 1, 2]),
      }),
      grid: load(kernel, {
        kind: 'grid',
        name: 'Grid',
        crs: METRES,
        origin: [100, 200, 0],
        spacing: [10, 20, 1],
        dims: [3, 2, 1],
        rotation: 30,
        elevation: 5,
        columns: [floatColumn('value', [1, 2, 3, 4, 5, 6])],
      }),
      surface: load(kernel, {
        kind: 'grid',
        name: 'Surface grid',
        crs: METRES,
        origin: [0, 0, 0],
        spacing: [10, 10, 1],
        dims: [3, 3, 1],
        elevationColumn: 'z',
        columns: [floatColumn('z', [1, 2, 3, 4, 5, 6, 7, 8, 9])],
      }),
      blocks: load(kernel, {
        kind: 'blocks',
        name: 'Model',
        crs: METRES,
        origin: [0, 0, 0],
        spacing: [10, 10, 5],
        dims: [2, 2, 2],
      }),
    };
    const done = (id: number) => asObject(prepare(kernel, id, frame, 1_000_000, 2).result.buffers);

    const lines = done(ids.lines);
    expect(lines.kind).toBe('lines');
    expect(lines.segments).toBeInstanceOf(Uint32Array);
    expect(Array.from(lines.segments as Uint32Array)).toStrictEqual([0, 1, 1, 2, 3, 4]);
    expect(Array.from(lines.segmentLine as Uint32Array)).toStrictEqual([0, 0, 1]);

    const polygons = done(ids.polygons);
    expect(polygons.kind).toBe('polygons');
    for (const name of ['triangles', 'trianglePolygon', 'outline', 'outlinePolygon']) {
      expect(polygons[name], name).toBeInstanceOf(Uint32Array);
    }
    expect((polygons.outline as Uint32Array).length).toBe(16);

    const mesh = done(ids.mesh);
    expect(Array.from(mesh.triangles as Uint32Array)).toStrictEqual([0, 1, 2]);
    expect(Array.from(mesh.positions as Float32Array)).toStrictEqual([0, 0, 1, 1, 0, 2, 0, 1, 3]);

    const grid = done(ids.grid);
    expect(grid.kind).toBe('grid');
    expect(grid.placement).toStrictEqual({
      origin: [100, 200, 5],
      spacing: [10, 20],
      rotation: 30,
    });
    expect(grid.size).toStrictEqual([3, 2]);
    expect(grid.tiles).toStrictEqual([
      { i0: 0, j0: 0, nx: 2, ny: 2 },
      { i0: 2, j0: 0, nx: 1, ny: 2 },
    ]);
    expect(grid.warp).toBeUndefined();

    const surface = done(ids.surface);
    expect(surface.kind).toBe('surface');
    expect((surface.positions as Float32Array).length).toBe(27);
    expect((surface.triangles as Uint32Array).length).toBe(24);
    expect((surface.triangleCell as Uint32Array).length).toBe(8);

    const blocks = done(ids.blocks);
    expect(blocks.kind).toBe('blocks');
    expect((blocks.centres as Float32Array).length).toBe(24);
    expect(blocks.spacing).toStrictEqual([10, 10, 5]);
    expect(blocks.rotation).toBe(0);
  });

  it('warps a grid in another system, a mesh for each tile', () => {
    const kernel = createKernel();
    const id = load(kernel, {
      kind: 'grid',
      name: 'Geographic grid',
      crs: WGS84,
      origin: [57, 25, 0],
      spacing: [0.01, 0.01, 1],
      dims: [90, 40, 1],
      columns: [
        floatColumn(
          'value',
          Array.from({ length: 3600 }, (_, i) => i),
        ),
      ],
    });
    const frame = { mapCrs: UTM40, origin: [500_000, 2_700_000, 0], source: 'auto' };
    const { result, steps } = prepare(kernel, id, frame, 1_000, 32);
    expect(steps).toBe(6);
    const grid = asObject(result.buffers);
    const warp = asObject(grid.warp);
    expect(warp.positions).toBeInstanceOf(Float32Array);
    expect(warp.uvs).toBeInstanceOf(Float32Array);
    expect(warp.triangles).toBeInstanceOf(Uint32Array);
    const perTile = warp.tileTriangles as Uint32Array;
    expect(perTile).toBeInstanceOf(Uint32Array);
    expect(perTile).toHaveLength(6);
    expect(Array.from(perTile).reduce((a, b) => a + b, 0) * 3).toBe(
      (warp.triangles as Uint32Array).length,
    );
    expect(grid.placement).toBeUndefined();
  });

  it('stops on cancel and when the dataset is removed, and throws for what does not exist', () => {
    const kernel = createKernel();
    const xy: [number, number][] = Array.from({ length: 20 }, (_, i) => [512_000 + i, 4_012_000]);
    const id = points(kernel, UTM40, xy);
    const frame = { mapCrs: UTM40, origin: [512_000, 4_012_000, 0], source: 'auto' };
    const job = kernel.startPrepare(id, frame, 4096);
    expect(asObject(kernel.stepPrepare(job, 5)).status).toBe('progress');
    expect(kernel.cancelPrepare(job)).toBe(true);
    expect(kernel.cancelPrepare(job)).toBe(false);
    expect(() => kernel.stepPrepare(job, 5)).toThrow(/no prepare with that id/);
    // The dataset goes while its job is under way.
    const second = kernel.startPrepare(id, frame, 4096);
    expect(asObject(kernel.stepPrepare(second, 5)).status).toBe('progress');
    kernel.remove(id);
    expect(() => kernel.stepPrepare(second, 5)).toThrow(/no prepare with that id/);
    expect(() => kernel.startPrepare(id, frame, 4096)).toThrow(/no dataset with that id/);
    expect(() => kernel.startPrepare(999, frame, 4096)).toThrow(/no dataset with that id/);
    const other = points(kernel, UTM40, [[1, 1]]);
    expect(() => kernel.startPrepare(other, { mapCrs: 7 }, 4096)).toThrow(/frame is not valid/);
  });
});

describe('classify and classIndex', () => {
  function withGrades(): { readonly kernel: TestKernelInstance; readonly id: number } {
    const kernel = createKernel();
    const grades = Array.from({ length: 12 }, (_, i) => (i === 5 ? Number.NaN : i * 2));
    const id = points(
      kernel,
      UTM40,
      grades.map((_, i) => [512_000 + i, 4_012_000] as [number, number]),
      [
        floatColumn('grade', grades),
        {
          name: 'rock',
          type: 'text',
          values: ['a', 'b', 'a', 'c', 'a', 'b', 'a', 'b', 'c', 'a', 'd', 'a'],
        },
      ],
    );
    return { kernel, id };
  }

  it('divides a numeric column into ranges, with a sample size only for natural breaks of a long column', () => {
    const { kernel, id } = withGrades();
    const result = asObject(kernel.classify(id, 'grade', 'equal', 2));
    expect(result.status).toBe('classified');
    const breaks = asObject(result.breaks);
    expect(breaks).toStrictEqual({
      kind: 'ranges',
      column: 'grade',
      bounds: [0, 11, 22],
      // 0, 2, 4, 6 and 8 are below 11; 12 to 22 are in the last class, which includes its upper bound.
      counts: [5, 6],
      nulls: 1,
    });
    const jenks = asObject(asObject(kernel.classify(id, 'grade', 'jenks', 3)).breaks);
    expect(jenks.sampled).toBeUndefined();
    expect(asArray(jenks.bounds)).toHaveLength(4);
  });

  it('gives bounds that the engine accepts for a column a few units in the last place wide, or wider than a float', () => {
    // Found by the second review of the milestone: equal intervals of 2.67 and the number after it gave bounds that went down,
    // and the engine's check refused them as a ContractError, for a column that is legitimate.
    const kernel = createKernel();
    const next =
      new Float64Array(new BigUint64Array([BigInt('0x4005570A3D70A3D7') + 1n]).buffer)[0] ?? 0;
    const narrow = points(
      kernel,
      UTM40,
      [
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5],
      ],
      [floatColumn('v', [2.67, next, 2.67, next, 2.67])],
    );
    const wide = points(
      kernel,
      UTM40,
      [
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      [floatColumn('v', [-1.7e308, 1.7e308, 0])],
    );
    for (const [id, classes] of [
      [narrow, 7],
      [wide, 1],
      [wide, 3],
    ] as const) {
      const result = checkedClassifyResult(kernel.classify(id, 'v', 'equal', classes));
      expect(result.status).toBe('classified');
    }
  });

  it('counts categories, with the rest as Other, the strings and numbers themselves', () => {
    const { kernel, id } = withGrades();
    const breaks = asObject(asObject(kernel.classify(id, 'rock', 'categories', 2)).breaks);
    expect(breaks).toStrictEqual({
      kind: 'categories',
      column: 'rock',
      values: ['a', 'b'],
      counts: [6, 3],
      other: 3,
      nulls: 0,
    });
  });

  it('says in a finding when a column cannot be classified, and throws for misuse', () => {
    const { kernel, id } = withGrades();
    const text = asObject(kernel.classify(id, 'rock', 'equal', 3));
    expect(text.status).toBe('not_classified');
    expect(asArray(text.findings).map((f) => asObject(f).code)).toStrictEqual([
      'classes.column.not_numeric',
    ]);
    const missing = asObject(kernel.classify(id, 'nothing', 'equal', 3));
    expect(asArray(missing.findings).map((f) => asObject(f).code)).toStrictEqual([
      'classes.column.missing',
    ]);
    expect(() => kernel.classify(id, 'grade', 'rainbow', 3)).toThrow(/method is not/);
    expect(() => kernel.classify(999, 'grade', 'equal', 3)).toThrow(/no dataset with that id/);
  });

  it('gives one byte for each element, 255 for none, and the counts of the legend are the picture’s', () => {
    const { kernel, id } = withGrades();
    for (const [column, method] of [
      ['grade', 'equal'],
      ['grade', 'quantile'],
      ['grade', 'jenks'],
      ['rock', 'categories'],
      ['grade', 'categories'],
    ] as const) {
      const breaks = asObject(asObject(kernel.classify(id, column, method, 3)).breaks);
      const index = kernel.classIndex(id, breaks);
      expect(index).toBeInstanceOf(Uint8Array);
      expect(index).toHaveLength(12);
      const counts = [...asArray(breaks.counts)] as number[];
      if (breaks.other !== undefined) counts.push(breaks.other as number);
      const tally = counts.map(() => 0);
      let none = 0;
      for (const c of index) {
        if (c === 255) none += 1;
        else tally[c] = (tally[c] ?? 0) + 1;
      }
      expect(tally, `${column} ${method}`).toStrictEqual(counts);
      expect(none, `${column} ${method}`).toBe(breaks.nulls);
    }
  });

  it('throws for breaks that are not breaks, or of a column the dataset does not have', () => {
    const { kernel, id } = withGrades();
    expect(() => kernel.classIndex(id, { kind: 'ranges' })).toThrow(/class breaks are not valid/);
    expect(() =>
      kernel.classIndex(id, {
        kind: 'ranges',
        column: 'gone',
        bounds: [0, 1],
        counts: [1],
        nulls: 0,
      }),
    ).toThrow(/no column named gone/);
    expect(() =>
      kernel.classIndex(999, {
        kind: 'ranges',
        column: 'grade',
        bounds: [0, 1],
        counts: [1],
        nulls: 0,
      }),
    ).toThrow(/no dataset with that id/);
  });
});
