import { describe, expect, it } from 'vitest';
import { checkedLoadResult } from './contract-check.js';
import { createColumns, createKernel } from './test-support/kernel.js';
import type { CrsRef, LoadResult } from './types.js';

const METRES: CrsRef = { kind: 'local', units: 'm' };

function load(result: unknown): LoadResult {
  return checkedLoadResult(result);
}

function summaries(result: LoadResult) {
  if (result.status !== 'loaded') throw new Error(`blocked: ${JSON.stringify(result.findings)}`);
  return result.summaries;
}

function blockedCodes(result: LoadResult): string[] {
  if (result.status !== 'blocked') throw new Error('expected a blocked result');
  return result.findings.map((f) => f.code);
}

describe('loading points from arrays through the kernel object', () => {
  it('loads points with a column of every type, including nulls and big whole numbers', () => {
    const kernel = createKernel();
    const columns = createColumns();
    columns.addFloat('au', new Float64Array([0.5, 1.5, 2.5, 3.5]), new Uint8Array([0, 1, 0, 0]));
    columns.addInt('count', new BigInt64Array([1n, 2n, 2n ** 62n, -5n]));
    columns.addBool('visited', new Uint8Array([1, 0, 1, 1]), new Uint8Array([0, 0, 0, 1]));
    columns.addText('note', ['a', 'b', 'c', 'd']);
    columns.addCategory('rock', new Uint32Array([0, 1, 0, 1]), ['ore', 'waste']);
    const result = load(
      kernel.loadPoints(
        'Wells',
        METRES,
        new Float64Array([1, 2, 3, 4]),
        new Float64Array([10, 20, 30, 40]),
        new Float64Array([5, 6, 7, 8]),
        columns,
      ),
    );
    const [summary] = summaries(result);
    expect(summary).toMatchObject({
      id: 1,
      name: 'Wells',
      kind: 'points',
      elementCount: 4,
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
    expect(summary?.bbox).toEqual({ min: [1, 10, 5], max: [4, 40, 8] });
    expect((kernel.datasets() as unknown[]).length).toBe(1);
  });

  it('loads 2D points with no columns, and names them after their kind when unnamed', () => {
    const kernel = createKernel();
    const result = load(
      kernel.loadPoints('', METRES, new Float64Array([1, 2]), new Float64Array([3, 4])),
    );
    const [summary] = summaries(result);
    expect(summary).toMatchObject({ name: 'points', hasZ: false, elementCount: 2, columns: [] });
  });

  it('blocks points with no coordinate system, saying which step can fix it', () => {
    const kernel = createKernel();
    for (const crs of [null, undefined]) {
      const result = load(
        kernel.loadPoints('P', crs, new Float64Array([1]), new Float64Array([2])),
      );
      expect(blockedCodes(result)).toEqual(['crs.missing']);
      if (result.status === 'blocked') expect(result.findings[0]?.step).toBe('crs');
    }
    expect(kernel.datasets()).toEqual([]);
  });

  it('blocks coordinate lists that do not fit together, before any dataset exists', () => {
    const kernel = createKernel();
    const result = load(
      kernel.loadPoints('P', METRES, new Float64Array([1, 2]), new Float64Array([1])),
    );
    expect(blockedCodes(result)).toEqual(['dataset.coordinates.length_mismatch']);
    const z = load(
      kernel.loadPoints(
        'P',
        METRES,
        new Float64Array([1, 2]),
        new Float64Array([1, 2]),
        new Float64Array([1]),
      ),
    );
    expect(blockedCodes(z)).toEqual(['dataset.coordinates.length_mismatch']);
  });

  it('blocks columns that do not fit, with a message that names the column', () => {
    const kernel = createKernel();
    const flags = createColumns();
    flags.addFloat('au', new Float64Array([1, 2]), new Uint8Array([0]));
    const result = load(
      kernel.loadPoints(
        'P',
        METRES,
        new Float64Array([1, 2]),
        new Float64Array([1, 2]),
        undefined,
        flags,
      ),
    );
    expect(blockedCodes(result)).toEqual(['table.column.length_mismatch']);
    if (result.status === 'blocked') {
      expect(result.findings[0]?.message).toBe('Column "au" has 2 values but 1 null flags.');
    }

    const wrongRows = createColumns();
    wrongRows.addFloat('au', new Float64Array([1]));
    const rows = load(
      kernel.loadPoints(
        'P',
        METRES,
        new Float64Array([1, 2]),
        new Float64Array([1, 2]),
        undefined,
        wrongRows,
      ),
    );
    expect(blockedCodes(rows)).toContain('dataset.attributes.rows_mismatch');

    const twice = createColumns();
    twice.addFloat('a', new Float64Array([1]));
    twice.addText('a', ['x']);
    expect(
      blockedCodes(
        load(
          kernel.loadPoints(
            'P',
            METRES,
            new Float64Array([1]),
            new Float64Array([1]),
            undefined,
            twice,
          ),
        ),
      ),
    ).toEqual(['table.column.name_duplicate']);
  });

  it('blocks coordinates that are not numbers, as validation finds them', () => {
    const kernel = createKernel();
    const result = load(
      kernel.loadPoints('P', METRES, new Float64Array([Number.NaN, 2]), new Float64Array([1, 2])),
    );
    expect(blockedCodes(result)).toEqual(['values.coordinates.not_finite']);
  });

  it('loads with warnings, which stay on the dataset', () => {
    const kernel = createKernel();
    const result = load(
      kernel.loadPoints('P', METRES, new Float64Array([1, 1]), new Float64Array([2, 2])),
    );
    const [summary] = summaries(result);
    expect(summary?.findings.map((f) => f.code)).toEqual(['values.points.duplicate']);
  });

  it('refuses a coordinate system of the wrong shape, as misuse', () => {
    const kernel = createKernel();
    expect(() =>
      kernel.loadPoints('P', { kind: 'epsg' }, new Float64Array([1]), new Float64Array([1])),
    ).toThrow(/coordinate system is not valid/);
    expect(() =>
      kernel.loadPoints('P', 'EPSG:4326', new Float64Array([1]), new Float64Array([1])),
    ).toThrow(/coordinate system is not valid/);
  });

  it('numbers datasets from imports and builders in one sequence', () => {
    const kernel = createKernel();
    summaries(load(kernel.loadPoints('A', METRES, new Float64Array([1]), new Float64Array([1]))));
    const second = summaries(
      load(kernel.loadPoints('B', METRES, new Float64Array([1]), new Float64Array([1]))),
    );
    expect(second[0]?.id).toBe(2);
  });
});
