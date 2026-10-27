import { describe, expect, it } from 'vitest';
import { blocks, grid, kernelColumn, lines, mesh, points, polygons } from './builders.js';
import { checkedLoadResult } from './contract-check.js';
import type { DatasetInput } from './inputs.js';
import { createKernel } from './test-support/kernel.js';
import type { ColumnType, CrsRef, Summary } from './types.js';

const UTM40: CrsRef = { kind: 'epsg', code: 32640 };

describe('points', () => {
  it('makes typed arrays from plain arrays, and keeps the arrays it is given', () => {
    const x = new Float64Array([1, 2]);
    const made = points({ name: 'p', x, y: [3, 4], z: [5, 6], crs: UTM40 });
    expect(made).toEqual({
      kind: 'points',
      name: 'p',
      crs: UTM40,
      x: new Float64Array([1, 2]),
      y: new Float64Array([3, 4]),
      z: new Float64Array([5, 6]),
    });
    expect(made.x).toBe(x);
  });

  it('leaves out what it was not given, and takes a missing coordinate system as null', () => {
    const made = points({ name: '', x: [], y: [], crs: null });
    expect('z' in made).toBe(false);
    expect('columns' in made).toBe(false);
    expect(made.crs).toBeNull();
  });
});

describe('the type of an attribute column', () => {
  const typeOf = (values: Parameters<typeof kernelColumn>[1]): string =>
    kernelColumn('c', values).type;

  it('is int for whole numbers, and float for anything else', () => {
    expect(kernelColumn('c', [1, 2, 3])).toEqual({
      name: 'c',
      type: 'int',
      values: new BigInt64Array([1n, 2n, 3n]),
    });
    expect(typeOf([1.5, 2])).toBe('float');
    expect(typeOf([1, Number.NaN])).toBe('float');
    expect(typeOf([1, Number.POSITIVE_INFINITY])).toBe('float');
    expect(typeOf([1, 2 ** 60])).toBe('float');
    expect(typeOf([-3, 0, Number.MAX_SAFE_INTEGER])).toBe('int');
    expect(typeOf(new Uint8Array([0, 1]))).toBe('int');
  });

  it('is float, as it was given, for a Float64Array', () => {
    const values = new Float64Array([1, 2]);
    const made = kernelColumn('c', values);
    expect(made.type === 'float' && made.values).toBe(values);
    expect('nulls' in made).toBe(false);
  });

  it('is bool for true and false', () => {
    expect(kernelColumn('c', [true, false, true])).toEqual({
      name: 'c',
      type: 'bool',
      values: new Uint8Array([1, 0, 1]),
    });
  });

  it('marks the missing values and gives them a placeholder', () => {
    expect(kernelColumn('c', [1, null, 3])).toEqual({
      name: 'c',
      type: 'int',
      values: new BigInt64Array([1n, 0n, 3n]),
      nulls: new Uint8Array([0, 1, 0]),
    });
    expect(kernelColumn('c', [true, null])).toMatchObject({
      type: 'bool',
      values: new Uint8Array([1, 0]),
      nulls: new Uint8Array([0, 1]),
    });
    expect(kernelColumn('c', [null, 'a', 'a'])).toMatchObject({
      type: 'category',
      codes: new Uint32Array([0, 0, 0]),
      nulls: new Uint8Array([1, 0, 0]),
    });
  });

  it('is float when there is nothing to tell by', () => {
    expect(kernelColumn('c', [null, null])).toMatchObject({
      type: 'float',
      values: new Float64Array(2),
      nulls: new Uint8Array([1, 1]),
    });
    expect(kernelColumn('c', [])).toEqual({
      name: 'c',
      type: 'float',
      values: new Float64Array(0),
    });
  });

  describe('for text', () => {
    const repeated = (distinct: number, times: number): string[] =>
      Array.from({ length: distinct * times }, (_, i) => `value ${String(i % distinct)}`);

    it('is a category when the values repeat, numbered in order of first appearance', () => {
      expect(kernelColumn('rock', ['granite', 'basalt', 'granite', 'basalt', 'granite'])).toEqual({
        name: 'rock',
        type: 'category',
        codes: new Uint32Array([0, 1, 0, 1, 0]),
        dictionary: ['granite', 'basalt'],
      });
    });

    it('is text when most values are different', () => {
      expect(kernelColumn('id', ['a', 'b', 'c'])).toEqual({
        name: 'id',
        type: 'text',
        values: ['a', 'b', 'c'],
      });
      // Two different values among three: they do not appear twice each on average.
      expect(typeOf(['a', 'a', 'b'])).toBe('text');
    });

    it('is a category with 50 different values that each appear twice, and text with 51', () => {
      expect(typeOf(repeated(50, 2))).toBe('category');
      expect(typeOf(repeated(51, 2))).toBe('text');
      expect(typeOf(repeated(51, 3))).toBe('text');
    });

    it('keeps the empty string as a value of its own', () => {
      expect(kernelColumn('c', ['', 'a', '', 'a'])).toMatchObject({
        type: 'category',
        dictionary: ['', 'a'],
      });
    });
  });
});

describe('what a builder will not make', () => {
  it('throws for a column of mixed kinds, naming the column and the place', () => {
    expect(() =>
      points({ name: 'p', x: [1], y: [1], attributes: { mixed: [1, 'two'] }, crs: null }),
    ).toThrow(
      new TypeError(
        'The column "mixed" has text at position 2 but numbers before it. A column holds one kind of value; use null for a missing one.',
      ),
    );
    expect(() => kernelColumn('c', ['a', true])).toThrow(/true or false at position 2 but text/);
    expect(() => kernelColumn('c', [true, 1])).toThrow(/a number at position 2 but true or false/);
  });

  it('throws for a value that is none of the kinds, however it was left out', () => {
    for (const bad of [undefined, {}, [], 10n, Symbol('s')]) {
      expect(() => kernelColumn('c', [1, bad as never])).toThrow(
        /The column "c" has a value at position 2 that is not a number, text, true or false, or null/,
      );
    }
  });

  it('throws for a position that cannot be one, and says which', () => {
    const base = { name: 'l', x: [0, 1], y: [0, 1], crs: null };
    expect(() => lines({ ...base, offsets: [0, -1] })).toThrow(
      'The offsets has -1 at position 2, which is not a whole number from 0 to 4294967295.',
    );
    expect(() => lines({ ...base, offsets: [0, 1.5] })).toThrow(/1\.5 at position 2/);
    expect(() => lines({ ...base, offsets: [0, 2 ** 32] })).toThrow(/4294967296 at position 2/);
    expect(() => lines({ ...base, offsets: [0, Number.NaN] })).toThrow(/NaN at position 2/);
    const given = new Uint32Array([0, 2]);
    expect(lines({ ...base, offsets: given }).offsets).toBe(given);
  });
});

describe('the other shapes', () => {
  it('lines have offsets, a value for each line and a value for each vertex', () => {
    const made = lines({
      name: 'l',
      x: [0, 1, 2],
      y: [0, 1, 2],
      offsets: [0, 3],
      attributes: { hole: ['A'] },
      vertexAttributes: { depth: [1.5, 2.5, 3.5] },
      crs: UTM40,
    });
    expect(made.offsets).toEqual(new Uint32Array([0, 3]));
    expect(made.columns?.map((c) => c.name)).toEqual(['hole']);
    expect(made.vertexColumns?.map((c) => [c.name, c.type])).toEqual([['depth', 'float']]);
  });

  it('polygons have offsets for rings and for polygons', () => {
    const made = polygons({
      name: 'p',
      x: [0, 1, 1],
      y: [0, 0, 1],
      ringOffsets: [0, 3],
      polygonOffsets: [0, 1],
      crs: UTM40,
    });
    expect([made.ringOffsets, made.polygonOffsets]).toEqual([
      new Uint32Array([0, 3]),
      new Uint32Array([0, 1]),
    ]);
  });

  it('a mesh has indices and always has Z', () => {
    const made = mesh({
      name: 'm',
      x: [0, 1, 0],
      y: [0, 0, 1],
      z: [0, 0, 1],
      indices: [0, 1, 2],
      crs: UTM40,
    });
    expect(made.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(made.z).toEqual(new Float64Array([0, 0, 1]));
  });

  it('a grid takes its elevation as a number or as the name of a column', () => {
    const base = {
      name: 'g',
      origin: [0, 0, 0] as const,
      spacing: [1, 1, 1] as const,
      dims: [2, 1, 1] as const,
      values: { elev: [1.5, 2.5] },
      crs: UTM40,
    };
    expect(grid({ ...base, z: 12 })).toMatchObject({ elevation: 12 });
    const named = grid({ ...base, z: 'elev', rotation: 30 });
    expect(named).toMatchObject({ elevationColumn: 'elev', rotation: 30 });
    expect('elevation' in named).toBe(false);
    const none = grid(base);
    expect(['elevation', 'elevationColumn', 'rotation'].some((key) => key in none)).toBe(false);
  });

  it('blocks are dense without ijk and sparse with it', () => {
    const base = {
      name: 'b',
      origin: [0, 0, 0] as const,
      spacing: [10, 10, 10] as const,
      dims: [2, 2, 1] as const,
      values: { grade: [1.5, 2.5] },
      crs: UTM40,
    };
    expect('ijk' in blocks(base)).toBe(false);
    expect(blocks({ ...base, ijk: [0, 0, 0, 1, 1, 0] }).ijk).toEqual(
      new Uint32Array([0, 0, 0, 1, 1, 0]),
    );
  });
});

describe('what the kernel makes of them', () => {
  const load = (input: DatasetInput): Summary => {
    const result = checkedLoadResult(createKernel().load(input));
    if (result.status !== 'loaded') {
      throw new Error(`blocked: ${result.findings.map((f) => f.code).join(', ')}`);
    }
    const [summary] = result.summaries;
    if (summary === undefined) {
      throw new Error('nothing loaded');
    }
    return summary;
  };
  const types = (summary: Summary): [string, ColumnType, number][] =>
    summary.columns.map((c) => [c.name, c.type, c.nullCount]);

  it('loads points, with each column the type it was given', () => {
    const summary = load(
      points({
        name: 'assays',
        x: [500_000, 500_010, 500_020, 500_030],
        y: [2_700_000, 2_700_010, 2_700_020, 2_700_030],
        z: [10, 11, 12, 13],
        attributes: {
          grade: [0.5, null, 1.5, 2.5],
          samples: [1, 2, 3, 4],
          oxidised: [true, false, true, null],
          rock: ['granite', 'basalt', 'granite', 'basalt'],
          note: ['a', 'b', 'c', 'd'],
        },
        crs: UTM40,
      }),
    );
    expect([summary.name, summary.kind, summary.elementCount, summary.hasZ]).toEqual([
      'assays',
      'points',
      4,
      true,
    ]);
    expect(types(summary)).toEqual([
      ['grade', 'float', 1],
      ['samples', 'int', 0],
      ['oxidised', 'bool', 1],
      ['rock', 'category', 0],
      ['note', 'text', 0],
    ]);
  });

  it('loads lines with a value for each line and for each vertex', () => {
    const summary = load(
      lines({
        name: 'holes',
        x: [0, 0, 0, 10, 10],
        y: [0, 0, 0, 10, 10],
        z: [0, -10, -20, 0, -10],
        offsets: [0, 3, 5],
        attributes: { hole: ['A', 'B'] },
        vertexAttributes: { depth: [0, 10, 20, 0, 10] },
        crs: UTM40,
      }),
    );
    expect([summary.kind, summary.elementCount, summary.vertexCount]).toEqual(['lines', 2, 5]);
  });

  it('loads polygons', () => {
    const summary = load(
      polygons({
        name: 'pit',
        x: [0, 10, 10, 0],
        y: [0, 0, 10, 10],
        ringOffsets: [0, 4],
        polygonOffsets: [0, 1],
        attributes: { zone: ['A'] },
        crs: UTM40,
      }),
    );
    expect([summary.kind, summary.elementCount, summary.vertexCount]).toEqual(['polygons', 1, 4]);
  });

  it('loads a mesh', () => {
    const summary = load(
      mesh({
        name: 'surface',
        x: [0, 10, 0, 10],
        y: [0, 0, 10, 10],
        z: [0, 1, 2, 3],
        indices: [0, 1, 2, 1, 3, 2],
        crs: UTM40,
      }),
    );
    expect([summary.kind, summary.elementCount, summary.vertexCount]).toEqual(['mesh', 2, 4]);
  });

  it('loads a grid whose elevation is one of its columns', () => {
    const summary = load(
      grid({
        name: 'dem',
        origin: [500_000, 2_700_000, 0],
        spacing: [10, 10, 1],
        dims: [3, 2, 1],
        z: 'elevation',
        values: { elevation: [100, 101, 102, 103, 104, 105] },
        crs: UTM40,
      }),
    );
    expect([summary.kind, summary.elementCount]).toEqual(['grid', 6]);
    expect(types(summary)).toEqual([['elevation', 'int', 0]]);
  });

  it('loads block models, dense and sparse', () => {
    const base = {
      name: 'model',
      origin: [500_000, 2_700_000, 0] as const,
      spacing: [10, 10, 10] as const,
      crs: UTM40,
    };
    const dense = load(
      blocks({ ...base, dims: [2, 2, 1], values: { grade: [1.5, 2.5, 3.5, 4.5] } }),
    );
    expect([dense.kind, dense.elementCount]).toEqual(['blocks', 4]);
    const sparse = load(
      blocks({
        ...base,
        dims: [2, 2, 1],
        ijk: [0, 0, 0, 1, 1, 0],
        values: { grade: [1.5, 2.5] },
      }),
    );
    expect(sparse.elementCount).toBe(2);
  });

  it('leaves a mismatch between lengths for the kernel to report as a finding', () => {
    const result = checkedLoadResult(
      createKernel().load(points({ name: 'p', x: [1, 2], y: [1], crs: UTM40 })),
    );
    expect(result.status).toBe('blocked');
  });
});
