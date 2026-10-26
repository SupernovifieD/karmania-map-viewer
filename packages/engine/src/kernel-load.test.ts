import { describe, expect, it } from 'vitest';
import { checkedLoadResult } from './contract-check.js';
import { createKernel, foreignArrays } from './test-support/kernel.js';
import type {
  CrsRef,
  KernelColumn,
  KernelLines,
  KernelPoints,
  KernelPolygons,
  LoadResult,
} from './types.js';

const METRES: CrsRef = { kind: 'local', units: 'm' };

function loadResult(input: unknown): LoadResult {
  return checkedLoadResult(createKernel().load(input));
}

function summaries(result: LoadResult) {
  if (result.status !== 'loaded') throw new Error(`blocked: ${JSON.stringify(result.findings)}`);
  return result.summaries;
}

function blockedCodes(result: LoadResult): string[] {
  if (result.status !== 'blocked') throw new Error('expected a blocked result');
  return result.findings.map((f) => f.code);
}

function points(extra: Partial<KernelPoints> = {}): KernelPoints {
  return {
    kind: 'points',
    name: 'Wells',
    crs: METRES,
    x: new Float64Array([1, 2]),
    y: new Float64Array([3, 4]),
    ...extra,
  };
}

function lines(extra: Partial<KernelLines> = {}): KernelLines {
  return {
    kind: 'lines',
    name: 'Roads',
    crs: METRES,
    x: new Float64Array([0, 1, 2, 5, 6]),
    y: new Float64Array([0, 1, 0, 5, 6]),
    offsets: new Uint32Array([0, 3, 5]),
    ...extra,
  };
}

function polygons(extra: Partial<KernelPolygons> = {}): KernelPolygons {
  return {
    kind: 'polygons',
    name: 'Leases',
    crs: METRES,
    x: new Float64Array([0, 10, 10, 0, 2, 2, 4, 4, 20, 30, 25]),
    y: new Float64Array([0, 0, 10, 10, 2, 4, 4, 2, 0, 0, 9]),
    ringOffsets: new Uint32Array([0, 4, 8, 11]),
    polygonOffsets: new Uint32Array([0, 2, 3]),
    columns: [{ name: 'name', type: 'text', values: ['A', 'B'] }],
    ...extra,
  };
}

const ALL_TYPES: readonly KernelColumn[] = [
  {
    name: 'au',
    type: 'float',
    values: new Float64Array([0.5, 1.5]),
    nulls: new Uint8Array([0, 1]),
  },
  { name: 'count', type: 'int', values: new BigInt64Array([2n ** 62n, -5n]) },
  { name: 'visited', type: 'bool', values: new Uint8Array([1, 0]), nulls: new Uint8Array([0, 1]) },
  { name: 'note', type: 'text', values: ['a', 'b'] },
  { name: 'rock', type: 'category', codes: new Uint32Array([0, 1]), dictionary: ['ore', 'waste'] },
];

describe('loading points from arrays through kernel.load', () => {
  it('loads points with a column of every type, with nulls and a whole number past 2^53', () => {
    const kernel = createKernel();
    const result = checkedLoadResult(
      kernel.load(points({ z: new Float64Array([5, 6]), columns: ALL_TYPES })),
    );
    const [summary] = summaries(result);
    expect(summary).toMatchObject({
      id: 1,
      name: 'Wells',
      kind: 'points',
      elementCount: 2,
      hasZ: true,
      crs: METRES,
    });
    expect(summary?.columns).toEqual([
      { name: 'au', type: 'float', nullCount: 1 },
      { name: 'count', type: 'int', nullCount: 0 },
      { name: 'visited', type: 'bool', nullCount: 1 },
      { name: 'note', type: 'text', nullCount: 0 },
      { name: 'rock', type: 'category', nullCount: 0 },
    ]);
    expect(summary?.bbox).toEqual({ min: [1, 3, 5], max: [2, 4, 6] });
    expect((kernel.datasets() as unknown[]).length).toBe(1);
  });

  it('names unnamed points after their kind and accepts 2D points without columns', () => {
    const [summary] = summaries(loadResult(points({ name: '' })));
    expect(summary).toMatchObject({ name: 'points', hasZ: false, columns: [] });
  });

  it('blocks points with no coordinate system, with the step that can fix it', () => {
    for (const crs of [null, undefined]) {
      const input = { ...points(), crs };
      const result = loadResult(input);
      expect(blockedCodes(result)).toEqual(['crs.missing']);
      if (result.status === 'blocked') expect(result.findings[0]?.step).toBe('crs');
    }
  });

  it('blocks arrays that do not fit together, and says which column', () => {
    expect(blockedCodes(loadResult(points({ y: new Float64Array([1]) })))).toEqual([
      'dataset.coordinates.length_mismatch',
    ]);
    expect(blockedCodes(loadResult(points({ z: new Float64Array([1]) })))).toEqual([
      'dataset.coordinates.length_mismatch',
    ]);
    const flags: KernelColumn = {
      name: 'au',
      type: 'float',
      values: new Float64Array([1, 2]),
      nulls: new Uint8Array([0]),
    };
    const result = loadResult(points({ columns: [flags] }));
    expect(blockedCodes(result)).toEqual(['table.column.length_mismatch']);
    if (result.status === 'blocked') {
      expect(result.findings[0]?.message).toBe('Column "au" has 2 values but 1 null flags.');
    }
    const twice: KernelColumn[] = [
      { name: 'a', type: 'float', values: new Float64Array([1, 2]) },
      { name: 'a', type: 'text', values: ['x', 'y'] },
    ];
    expect(blockedCodes(loadResult(points({ columns: twice })))).toEqual([
      'table.column.name_duplicate',
    ]);
    const short: KernelColumn = { name: 'au', type: 'float', values: new Float64Array([1]) };
    expect(blockedCodes(loadResult(points({ columns: [short] })))).toContain(
      'dataset.attributes.rows_mismatch',
    );
  });

  it('blocks coordinates that are not numbers, as validation finds them', () => {
    expect(blockedCodes(loadResult(points({ x: new Float64Array([Number.NaN, 2]) })))).toEqual([
      'values.coordinates.not_finite',
    ]);
  });

  it('loads with warnings, which stay on the dataset', () => {
    const [summary] = summaries(
      loadResult(points({ x: new Float64Array([1, 1]), y: new Float64Array([2, 2]) })),
    );
    expect(summary?.findings.map((f) => f.code)).toEqual(['values.points.duplicate']);
  });

  it('numbers datasets from imports and builders in one sequence', () => {
    const kernel = createKernel();
    summaries(checkedLoadResult(kernel.load(points({ name: 'A' }))));
    const second = summaries(checkedLoadResult(kernel.load(points({ name: 'B' }))));
    expect(second[0]?.id).toBe(2);
  });
});

describe('loading lines from arrays through kernel.load', () => {
  it('loads lines with per-line and per-vertex columns', () => {
    const [summary] = summaries(
      loadResult(
        lines({
          columns: [{ name: 'name', type: 'text', values: ['A', 'B'] }],
          vertexColumns: [
            { name: 'depth', type: 'float', values: new Float64Array([1, 2, 3, 4, 5]) },
          ],
        }),
      ),
    );
    expect(summary).toMatchObject({
      name: 'Roads',
      kind: 'lines',
      elementCount: 2,
      vertexCount: 5,
      hasZ: false,
    });
    expect(summary?.columns).toEqual([{ name: 'name', type: 'text', nullCount: 0 }]);
    expect(summary?.bbox).toEqual({ min: [0, 0, 0], max: [6, 6, 0] });
  });

  it('blocks offsets that do not fit, saying how', () => {
    const cases: [number[], string][] = [
      [[0, 4, 3, 5], 'lines.offsets.decreasing'],
      [[1, 3, 5], 'lines.offsets.bad_start'],
      [[0, 3, 4], 'lines.offsets.bad_end'],
      [[], 'lines.offsets.empty'],
    ];
    for (const [offsets, code] of cases) {
      expect(blockedCodes(loadResult(lines({ offsets: new Uint32Array(offsets) })))).toContain(
        code,
      );
    }
  });

  it('loads a one-vertex line with a warning and blocks per-vertex rows that do not fit', () => {
    const [summary] = summaries(loadResult(lines({ offsets: new Uint32Array([0, 1, 5]) })));
    expect(summary?.findings.map((f) => f.code)).toEqual(['lines.line.too_short']);
    const bad: KernelColumn = { name: 'depth', type: 'float', values: new Float64Array([1, 2]) };
    expect(blockedCodes(loadResult(lines({ vertexColumns: [bad] })))).toEqual([
      'dataset.vertex_attributes.rows_mismatch',
    ]);
  });
});

describe('loading polygons from arrays through kernel.load', () => {
  it('loads polygons with holes', () => {
    const [summary] = summaries(loadResult(polygons()));
    expect(summary).toMatchObject({
      name: 'Leases',
      kind: 'polygons',
      elementCount: 2,
      vertexCount: 11,
      hasZ: false,
    });
    expect(summary?.columns).toEqual([{ name: 'name', type: 'text', nullCount: 0 }]);
    expect(summary?.bbox).toEqual({ min: [0, 0, 0], max: [30, 10, 0] });
  });

  it('blocks ring and polygon offsets that do not fit, saying how', () => {
    const rings = (offsets: number[]) => polygons({ ringOffsets: new Uint32Array(offsets) });
    const polys = (offsets: number[]) => polygons({ polygonOffsets: new Uint32Array(offsets) });
    expect(blockedCodes(loadResult(rings([0, 8, 4, 11])))).toContain(
      'polygons.ring_offsets.decreasing',
    );
    expect(blockedCodes(loadResult(rings([1, 4, 8, 11])))).toContain(
      'polygons.ring_offsets.bad_start',
    );
    expect(blockedCodes(loadResult(rings([0, 4, 8, 10])))).toContain(
      'polygons.ring_offsets.bad_end',
    );
    expect(blockedCodes(loadResult(polys([0, 3, 2])))).toContain(
      'polygons.polygon_offsets.decreasing',
    );
    expect(blockedCodes(loadResult(polys([0, 2, 4])))).toContain(
      'polygons.polygon_offsets.bad_end',
    );
    expect(blockedCodes(loadResult(rings([0, 2, 8, 11])))).toContain('polygons.ring.too_short');
  });

  it('blocks coordinates that do not fit and refuses missing offsets as misuse', () => {
    expect(blockedCodes(loadResult(polygons({ y: new Float64Array([1]) })))).toEqual([
      'dataset.coordinates.length_mismatch',
    ]);
    const withoutRings = Object.fromEntries(
      Object.entries(polygons()).filter(([key]) => key !== 'ringOffsets'),
    );
    expect(() => createKernel().load(withoutRings)).toThrow(/needs a `ringOffsets`/);
  });
});

describe('arrays from another realm', () => {
  it('are accepted, because the check is on the kind of array, not on instanceof', () => {
    const { floats, unsigned } = foreignArrays();
    expect(floats instanceof Float64Array).toBe(false);
    const [summary] = summaries(
      loadResult({
        kind: 'lines',
        name: 'L',
        crs: METRES,
        x: floats,
        y: floats,
        offsets: unsigned,
      }),
    );
    expect(summary).toMatchObject({ kind: 'lines', elementCount: 1, vertexCount: 2 });
  });
});

describe('kernel.load refuses what is not a dataset description, as misuse', () => {
  const kernel = createKernel();
  const refused: [string, unknown, RegExp][] = [
    ['not an object', 'points', /the dataset must be an object/],
    ['an array', [1, 2], /the dataset must be an object/],
    ['no kind', {}, /the dataset needs a `kind`/],
    ['an unknown kind', { kind: 'cube' }, /unknown kind: "cube"/],
    ['no name', { kind: 'points', crs: METRES }, /needs a `name`/],
    ['x as a plain array', { ...points(), x: [1, 2] }, /`x` must be a Float64Array/],
    [
      'x as the wrong typed array',
      { ...points(), x: new Float32Array([1, 2]) },
      /`x` must be a Float64Array/,
    ],
    ['no y', { kind: 'points', name: 'a', crs: null, x: new Float64Array(1) }, /needs a `y`/],
    ['a bad crs', { ...points(), crs: { kind: 'epsg' } }, /coordinate system is not valid/],
    ['columns that are not an array', { ...points(), columns: {} }, /`columns` must be an array/],
    [
      'a column of an unknown type',
      { ...points(), columns: [{ name: 'a', type: 'date' }] },
      /unknown type: "date"/,
    ],
    [
      'a column with plain values',
      { ...points(), columns: [{ name: 'a', type: 'float', values: [1] }] },
      /`values` must be a Float64Array/,
    ],
    [
      'text that is not strings',
      { ...points(), columns: [{ name: 'a', type: 'text', values: [1] }] },
      /only strings/,
    ],
    ['offsets as numbers', { ...lines(), offsets: [0, 3, 5] }, /`offsets` must be a Uint32Array/],
  ];
  for (const [label, input, message] of refused) {
    it(`throws for ${label}`, () => {
      expect(() => kernel.load(input)).toThrow(message);
    });
  }
});
