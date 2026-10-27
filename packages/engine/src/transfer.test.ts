import { describe, expect, it } from 'vitest';
import { blocks, grid, lines, mesh, points, polygons } from './builders.js';
import { transferablesOf } from './transfer.js';

const crs = { kind: 'epsg', code: 32640 } as const;

describe('the buffers that can be handed over', () => {
  it('are those of the coordinates, and of every column, once each', () => {
    const made = points({
      name: 'p',
      x: [1, 2, 3],
      y: new Float64Array([1, 2, 3]),
      attributes: {
        grade: [1.5, null, 2.5],
        count: [1, 2, 3],
        flag: [true, false, null],
        rock: ['a', 'a', 'a'],
        id: ['x', 'y', 'z'],
      },
      crs,
    });
    const buffers = transferablesOf(made);
    expect(new Set(buffers).size).toBe(buffers.length);
    expect(buffers).toContain(made.x.buffer);
    expect(buffers).toContain(made.y.buffer);
    // x, y, and one or two arrays for each column that is not text:
    // grade (values, nulls), count (values), flag (values, nulls), rock (codes), id (none).
    expect(buffers).toHaveLength(2 + 2 + 1 + 2 + 1);
  });

  it('count a buffer once when several arrays are views of it', () => {
    const shared = new Float64Array([1, 2, 3, 4]);
    const made = points({
      name: 'p',
      x: shared.subarray(0, 2),
      y: shared.subarray(2, 4),
      crs,
    });
    expect(transferablesOf(made)).toEqual([shared.buffer]);
  });

  it('do not include a shared buffer, which cannot be handed over', () => {
    const made = points({
      name: 'p',
      x: new Float64Array(new SharedArrayBuffer(16)),
      y: [1, 2],
      crs,
    });
    expect(transferablesOf(made)).toEqual([made.y.buffer]);
  });

  it('take in every list of positions, and the vertex columns', () => {
    const l = lines({
      name: 'l',
      x: [0, 1],
      y: [0, 1],
      offsets: [0, 2],
      attributes: { a: [1] },
      vertexAttributes: { d: [1.5, 2.5] },
      crs,
    });
    expect(transferablesOf(l)).toHaveLength(2 + 1 + 1 + 1);
    const p = polygons({
      name: 'p',
      x: [0, 1, 1],
      y: [0, 0, 1],
      ringOffsets: [0, 3],
      polygonOffsets: [0, 1],
      crs,
    });
    expect(transferablesOf(p)).toHaveLength(4);
    const m = mesh({
      name: 'm',
      x: [0, 1, 0],
      y: [0, 0, 1],
      z: [0, 0, 0],
      indices: [0, 1, 2],
      crs,
    });
    expect(transferablesOf(m)).toHaveLength(4);
  });

  it('take in a lattice whose numbers are typed arrays, and leave plain ones', () => {
    const plain = grid({
      name: 'g',
      origin: [0, 0, 0],
      spacing: [1, 1, 1],
      dims: [2, 1, 1],
      values: { v: [1.5, 2.5] },
      crs,
    });
    expect(transferablesOf(plain)).toHaveLength(1);
    const typed = blocks({
      name: 'b',
      origin: new Float64Array([0, 0, 0]),
      spacing: new Float64Array([1, 1, 1]),
      dims: new Uint32Array([2, 1, 1]),
      ijk: [0, 0, 0, 1, 0, 0],
      values: { v: [1.5, 2.5] },
      crs,
    });
    expect(transferablesOf(typed)).toHaveLength(3 + 1 + 1);
  });

  it('are none for a dataset of plain lists', () => {
    expect(
      transferablesOf({
        kind: 'grid',
        name: 'g',
        crs,
        origin: [0, 0, 0],
        spacing: [1, 1, 1],
        dims: [1, 1, 1],
        columns: [{ name: 'c', type: 'text', values: ['a'] }],
      }),
    ).toEqual([]);
  });
});
