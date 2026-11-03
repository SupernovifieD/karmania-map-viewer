/**
 * The checks of display preparation, against what the built kernel really gives and against values that
 * are wrong in one way each. A check that accepted anything would pass the first half; one that rejected
 * only some wrong shapes would pass the second, so both are here.
 */
import { describe, expect, it } from 'vitest';
import { ContractError } from './contract-check.js';
import {
  checkedClassBreaks,
  checkedClassifyResult,
  checkedFrame,
  checkedFrameChoice,
  checkedPrepareResult,
  checkedRenderBuffers,
} from './display-check.js';
import { createKernel } from './test-support/kernel.js';
import type { KernelColumn } from './types.js';

const METRES = { kind: 'local', units: 'm' } as const;

function floats(name: string, values: number[]): KernelColumn {
  return { name, type: 'float', values: new Float64Array(values) };
}

/** A kernel with one dataset of each shape in a local grid, and the result of preparing each. */
function everyKind() {
  const kernel = createKernel();
  const ids = (input: unknown): number => {
    const result = kernel.load(input) as { summaries: { id: number }[] };
    return result.summaries[0]?.id ?? -1;
  };
  const datasets = [
    ids({
      kind: 'points',
      name: 'p',
      crs: METRES,
      x: new Float64Array([1, 2]),
      y: new Float64Array([3, 4]),
    }),
    ids({
      kind: 'lines',
      name: 'l',
      crs: METRES,
      x: new Float64Array([0, 1, 2]),
      y: new Float64Array([0, 1, 0]),
      offsets: new Uint32Array([0, 3]),
    }),
    ids({
      kind: 'polygons',
      name: 'g',
      crs: METRES,
      x: new Float64Array([0, 10, 10, 0]),
      y: new Float64Array([0, 0, 10, 10]),
      ringOffsets: new Uint32Array([0, 4]),
      polygonOffsets: new Uint32Array([0, 1]),
    }),
    ids({
      kind: 'mesh',
      name: 'm',
      crs: METRES,
      x: new Float64Array([0, 1, 0]),
      y: new Float64Array([0, 0, 1]),
      z: new Float64Array([1, 2, 3]),
      indices: new Uint32Array([0, 1, 2]),
    }),
    ids({
      kind: 'grid',
      name: 'i',
      crs: METRES,
      origin: [0, 0, 0],
      spacing: [1, 1, 1],
      dims: [2, 2, 1],
      columns: [floats('v', [1, 2, 3, 4])],
    }),
    ids({
      kind: 'grid',
      name: 's',
      crs: METRES,
      origin: [0, 0, 0],
      spacing: [1, 1, 1],
      dims: [2, 2, 1],
      elevationColumn: 'z',
      columns: [floats('z', [1, 2, 3, 4])],
    }),
    ids({
      kind: 'blocks',
      name: 'b',
      crs: METRES,
      origin: [0, 0, 0],
      spacing: [1, 1, 1],
      dims: [2, 1, 1],
    }),
  ];
  const choice = kernel.chooseFrame();
  const frame = (choice as { frame: unknown }).frame;
  const prepared = datasets.map((id) => {
    const job = kernel.startPrepare(id, frame, 4096);
    // Polygons take a second step (their triangles come after their positions).
    for (let steps = 0; steps < 10; steps += 1) {
      const step = kernel.stepPrepare(job, 1_000_000) as { status: string; result?: unknown };
      if (step.status === 'done') return step.result;
    }
    throw new Error('a prepare did not finish');
  });
  return { kernel, datasets, choice, frame, prepared };
}

describe('what the kernel gives passes', () => {
  const { kernel, datasets, choice, frame, prepared } = everyKind();

  it('the frame and the choice', () => {
    expect(checkedFrame(frame).source).toBe('auto');
    expect(checkedFrameChoice(choice).drawable).toHaveLength(7);
    expect(checkedFrameChoice(createKernel().chooseFrame()).frame).toBeNull();
  });

  it('the buffers of every kind', () => {
    const kinds = prepared.map((r) => {
      const result = checkedPrepareResult(r);
      if (result.status !== 'drawn') throw new Error('not drawn');
      return result.buffers.kind;
    });
    expect(kinds).toStrictEqual([
      'points',
      'lines',
      'polygons',
      'mesh',
      'grid',
      'surface',
      'blocks',
    ]);
  });

  it('the classes by every method, and the answer for a column that cannot be classified', () => {
    const id = datasets[4] ?? -1;
    for (const method of ['equal', 'quantile', 'jenks', 'categories']) {
      checkedClassifyResult(kernel.classify(id, 'v', method, 3));
    }
    const wrong = kernel.classify(datasets[0] ?? -1, 'nothing', 'equal', 3);
    expect(checkedClassifyResult(wrong).status).toBe('not_classified');
  });
});

describe('what is wrong in one way is rejected', () => {
  const points = { kind: 'points', positions: new Float32Array([1, 2, 3]) };
  const bad = (check: () => unknown, message: RegExp) => {
    expect(check).toThrow(ContractError);
    expect(check).toThrow(message);
  };

  it('a frame with a key that is not in the type, a short origin or an unknown source', () => {
    const frame = { mapCrs: METRES, origin: [0, 0, 0], source: 'auto' };
    expect(checkedFrame(frame)).toStrictEqual(frame);
    bad(() => checkedFrame({ ...frame, extra: 1 }), /unexpected "extra"/);
    bad(() => checkedFrame({ ...frame, origin: [0, 0] }), /expected 3 numbers/);
    bad(() => checkedFrame({ ...frame, source: 'guess' }), /expected one of auto, user/);
    bad(
      () => checkedFrameChoice({ frame: undefined, drawable: [], findings: [] }),
      /"frame" is undefined/,
    );
  });

  it('buffers whose arrays are of the wrong kind or do not match', () => {
    expect(checkedRenderBuffers(points).kind).toBe('points');
    bad(() => checkedRenderBuffers({ ...points, positions: [1, 2, 3] }), /expected a Float32Array/);
    bad(
      () => checkedRenderBuffers({ ...points, positions: new Float64Array(3) }),
      /expected a Float32Array/,
    );
    bad(() => checkedRenderBuffers({ ...points, extra: 1 }), /unexpected "extra"/);
    bad(() => checkedRenderBuffers({ kind: 'cone' }), /expected points, lines/);
    const lines = {
      kind: 'lines',
      positions: new Float32Array(9),
      segments: new Uint32Array([0, 1, 1, 2]),
      segmentLine: new Uint32Array([0]),
    };
    bad(() => checkedRenderBuffers(lines), /a line number for each segment/);
    bad(
      () =>
        checkedRenderBuffers({
          kind: 'surface',
          positions: new Float32Array(9),
          triangles: new Uint32Array(3),
          triangleCell: new Uint32Array(2),
        }),
      /a cell for each triangle/,
    );
    bad(
      () =>
        checkedRenderBuffers({
          kind: 'blocks',
          centres: new Float32Array(4),
          spacing: [1, 1, 1],
          rotation: 0,
        }),
      /x, y and z for each centre/,
    );
  });

  it('a grid with both a placement and a warp, with neither, or with a warp that does not add up', () => {
    const placement = { origin: [0, 0, 0], spacing: [1, 1], rotation: 0 };
    const warp = {
      positions: new Float32Array(12),
      uvs: new Float32Array(8),
      triangles: new Uint32Array([0, 1, 3, 0, 3, 2]),
      tileTriangles: new Uint32Array([2]),
    };
    const grid = { kind: 'grid', size: [2, 2], tiles: [{ i0: 0, j0: 0, nx: 2, ny: 2 }] };
    expect(checkedRenderBuffers({ ...grid, placement }).kind).toBe('grid');
    expect(checkedRenderBuffers({ ...grid, warp }).kind).toBe('grid');
    bad(() => checkedRenderBuffers({ ...grid, placement, warp }), /not both and not neither/);
    bad(() => checkedRenderBuffers(grid), /not both and not neither/);
    bad(
      () => checkedRenderBuffers({ ...grid, warp: { ...warp, uvs: new Float32Array(6) } }),
      /a u and v for each vertex/,
    );
    bad(
      () =>
        checkedRenderBuffers({ ...grid, warp: { ...warp, tileTriangles: new Uint32Array([1]) } }),
      /add up/,
    );
    bad(
      () =>
        checkedRenderBuffers({
          ...grid,
          warp: { ...warp, tileTriangles: new Uint32Array([1, 1]) },
        }),
      /a triangle count for each tile/,
    );
  });

  it('a result that is not drawn and says nothing, or a status that is neither', () => {
    bad(() => checkedPrepareResult({ status: 'not_drawn', findings: [] }), /has a reason/);
    bad(() => checkedPrepareResult({ status: 'maybe' }), /expected drawn or not_drawn/);
    bad(() => checkedClassifyResult({ status: 'not_classified', findings: [] }), /has a reason/);
  });

  it('class breaks whose bounds go down, whose counts do not match, or that have a stray key', () => {
    const ranges = { kind: 'ranges', column: 'v', bounds: [0, 5, 10], counts: [2, 3], nulls: 0 };
    expect(checkedClassBreaks(ranges)).toStrictEqual(ranges);
    expect(checkedClassBreaks({ ...ranges, bounds: [0, 10, 10], counts: [2, 3] }).kind).toBe(
      'ranges',
    );
    bad(() => checkedClassBreaks({ ...ranges, bounds: [0, 10, 5] }), /must not go down/);
    bad(() => checkedClassBreaks({ ...ranges, counts: [5] }), /one count for each class/);
    bad(() => checkedClassBreaks({ ...ranges, bounds: [0] }), /two bounds/);
    bad(() => checkedClassBreaks({ ...ranges, values: [] }), /unexpected "values"/);
    const categories = {
      kind: 'categories',
      column: 'rock',
      values: ['a', 2, true],
      counts: [3, 2, 1],
      nulls: 0,
    };
    expect(checkedClassBreaks(categories)).toStrictEqual(categories);
    bad(
      () => checkedClassBreaks({ ...categories, values: ['a', null, true] }),
      /a string, a number or a boolean/,
    );
    bad(() => checkedClassBreaks({ ...categories, counts: [3] }), /one count for each value/);
    bad(() => checkedClassBreaks({ ...categories, other: 0 }), /absent when there is none/);
  });
});
