import { describe, expect, it } from 'vitest';
import {
  checkedImportStatus,
  checkedLoadResult,
  checkedPage,
  checkedSummary,
} from './contract-check.js';
import { createKernel, fixtureBytes } from './test-support/kernel.js';
import type { CrsRef, ImportMapping, KernelDataset, Page } from './types.js';

const METRES: CrsRef = { kind: 'local', units: 'm' };

function loadOne(kernel: ReturnType<typeof createKernel>, input: KernelDataset): number {
  const result = checkedLoadResult(kernel.load(input));
  if (result.status !== 'loaded') throw new Error('expected a loaded result');
  const [summary] = result.summaries;
  if (summary === undefined) throw new Error('nothing was loaded');
  return summary.id;
}

function column(page: Page, name: string) {
  const found = page.columns.find((c) => c.name === name);
  if (found === undefined) throw new Error(`no column ${name}`);
  return found;
}

describe('reading rows back through the kernel object', () => {
  it('pages points with their coordinates, then every attribute type, as typed arrays', () => {
    const kernel = createKernel();
    const id = loadOne(kernel, {
      kind: 'points',
      name: 'Wells',
      crs: METRES,
      x: new Float64Array([1, 2, 3]),
      y: new Float64Array([4, 5, 6]),
      z: new Float64Array([7, 8, 9]),
      columns: [
        {
          name: 'au',
          type: 'float',
          values: new Float64Array([0.5, 1.5, 2.5]),
          nulls: new Uint8Array([0, 1, 0]),
        },
        { name: 'count', type: 'int', values: new BigInt64Array([10n, 20n, 30n]) },
        { name: 'ok', type: 'bool', values: new Uint8Array([1, 0, 1]) },
        { name: 'note', type: 'text', values: ['a', 'b', 'c'] },
        {
          name: 'rock',
          type: 'category',
          codes: new Uint32Array([1, 0, 1]),
          dictionary: ['ore', 'waste'],
        },
      ],
    });
    const page = checkedPage(kernel.rows(id, 0, 10));
    expect(page.columns.map((c) => c.name)).toEqual([
      'X',
      'Y',
      'Z',
      'au',
      'count',
      'ok',
      'note',
      'rock',
    ]);
    expect(page).toMatchObject({ start: 0, count: 3 });
    expect(column(page, 'X').values).toEqual(new Float64Array([1, 2, 3]));
    expect(column(page, 'au').values).toEqual(new Float64Array([0.5, 0, 2.5]));
    expect(column(page, 'au').nulls).toEqual(new Uint8Array([0, 1, 0]));
    expect(column(page, 'count').values).toEqual(new Float64Array([10, 20, 30]));
    expect(column(page, 'ok').values).toEqual(new Uint8Array([1, 0, 1]));
    expect(column(page, 'note').values).toEqual(['a', 'b', 'c']);
    expect(column(page, 'rock').values).toEqual(['waste', 'ore', 'waste']);
  });

  it('cuts a window to the rows that exist', () => {
    const kernel = createKernel();
    const id = loadOne(kernel, {
      kind: 'points',
      name: 'P',
      crs: METRES,
      x: new Float64Array([1, 2, 3]),
      y: new Float64Array([4, 5, 6]),
    });
    expect(checkedPage(kernel.rows(id, 1, 1))).toMatchObject({ start: 1, count: 1 });
    expect(column(checkedPage(kernel.rows(id, 1, 1)), 'X').values).toEqual(new Float64Array([2]));
    expect(checkedPage(kernel.rows(id, 2, 100))).toMatchObject({ start: 2, count: 1 });
    const past = checkedPage(kernel.rows(id, 3, 5));
    expect(past).toMatchObject({ start: 3, count: 0 });
    expect(past.columns.map((c) => c.name)).toEqual(['X', 'Y']);
    expect(checkedPage(kernel.rows(id, 0, 0)).count).toBe(0);
  });

  it('pages an imported file with the geometry columns of its kind', () => {
    const kernel = createKernel();
    const mapping: ImportMapping = {
      datasetName: 'Collars',
      kind: 'points',
      columns: [
        { source: 'Easting', role: 'x' },
        { source: 'Northing', role: 'y' },
        { source: 'RL', role: 'z' },
        { source: 'Hole', role: 'attribute' },
      ],
      nodata: { tokens: [''], numbers: [-999] },
      emptyCoordinates: 'error',
      decimalSeparator: '.',
      crs: { kind: 'epsg', code: 32640 },
    };
    const importId = kernel.startImport('points.csv', fixtureBytes('points.csv'), mapping);
    let status = checkedImportStatus(kernel.stepImport(importId, 1000));
    while (status.status === 'progress')
      status = checkedImportStatus(kernel.stepImport(importId, 1000));
    const page = checkedPage(kernel.rows(1, 0, 3));
    expect(page.columns.map((c) => c.name)).toEqual(['X', 'Y', 'Z', 'Hole']);
    expect(column(page, 'X').values).toEqual(new Float64Array([500010.5, 500035, 500060.5]));
    expect(column(page, 'Hole').values).toEqual(['DH001', 'DH001', 'DH002']);

    const mixed = kernel.startImport('mixed.geojson', fixtureBytes('mixed.geojson'), {
      ...mapping,
      datasetName: '',
      columns: [],
      crs: null,
    });
    status = checkedImportStatus(kernel.stepImport(mixed, 1000));
    while (status.status === 'progress')
      status = checkedImportStatus(kernel.stepImport(mixed, 1000));
    const names = (id: number) => checkedPage(kernel.rows(id, 0, 5)).columns.map((c) => c.name);
    expect(names(2)).toEqual(['X', 'Y', 'depth', 'name']);
    expect(names(3)).toEqual(['line #', 'vertex count', 'feature_id', 'lanes', 'name']);
    expect(names(4)).toEqual([
      'polygon #',
      'ring count',
      'vertex count',
      'feature_id',
      'area_ha',
      'name',
    ]);
  });

  it('gives each of the other shapes its geometry columns', () => {
    const kernel = createKernel();
    const lattice = { origin: [100, 200, 0] as const, spacing: [10, 10, 5] as const };
    const grid = loadOne(kernel, {
      kind: 'grid',
      name: 'G',
      crs: METRES,
      ...lattice,
      dims: [2, 2, 1],
      columns: [{ name: 'v', type: 'float', values: new Float64Array([1, 2, 3, 4]) }],
    });
    const blocksId = loadOne(kernel, {
      kind: 'blocks',
      name: 'B',
      crs: METRES,
      ...lattice,
      dims: [2, 2, 2],
      ijk: new Uint32Array([1, 1, 0, 0, 0, 1]),
      columns: [{ name: 'g', type: 'float', values: new Float64Array([1, 2]) }],
    });
    const meshId = loadOne(kernel, {
      kind: 'mesh',
      name: 'M',
      crs: METRES,
      x: new Float64Array([0, 1, 0]),
      y: new Float64Array([0, 0, 1]),
      z: new Float64Array([0, 0, 0]),
      indices: new Uint32Array([0, 1, 2]),
    });
    const gridPage = checkedPage(kernel.rows(grid, 0, 4));
    expect(gridPage.columns.map((c) => c.name)).toEqual([
      'i',
      'j',
      'cell centre X',
      'cell centre Y',
      'v',
    ]);
    expect(column(gridPage, 'cell centre X').values).toEqual(
      new Float64Array([105, 115, 105, 115]),
    );
    const blocksPage = checkedPage(kernel.rows(blocksId, 0, 2));
    expect(column(blocksPage, 'centre Z').values).toEqual(new Float64Array([2.5, 7.5]));
    expect(column(blocksPage, 'i').values).toEqual(new Int32Array([1, 0]));
    expect(checkedPage(kernel.rows(meshId, 0, 1)).columns.map((c) => c.name)).toEqual([
      'triangle #',
      'v1',
      'v2',
      'v3',
    ]);
  });

  it('describes one dataset, and removes it', () => {
    const kernel = createKernel();
    const id = loadOne(kernel, {
      kind: 'points',
      name: 'P',
      crs: METRES,
      x: new Float64Array([1]),
      y: new Float64Array([2]),
    });
    expect(checkedSummary(kernel.summary(id))).toMatchObject({ id, name: 'P' });
    expect(kernel.summary(99)).toBeUndefined();
    expect(kernel.remove(id)).toBe(true);
    expect(kernel.remove(id)).toBe(false);
    expect(kernel.summary(id)).toBeUndefined();
    expect(kernel.datasets()).toEqual([]);
    expect(() => kernel.rows(id, 0, 1)).toThrow(/no dataset with that id/);
    // A removed dataset's id is not given again.
    expect(
      loadOne(kernel, {
        kind: 'points',
        name: 'Q',
        crs: METRES,
        x: new Float64Array([1]),
        y: new Float64Array([2]),
      }),
    ).toBe(id + 1);
  });

  it('refuses rows of a dataset that does not exist, as misuse', () => {
    expect(() => createKernel().rows(1, 0, 10)).toThrow(/no dataset with that id/);
  });
});
