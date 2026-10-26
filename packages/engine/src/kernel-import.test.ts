import { describe, expect, it } from 'vitest';
import { checkedImportStatus, checkedSummary } from './contract-check.js';
import { createKernel, fixtureBytes, type TestKernelInstance } from './test-support/kernel.js';
import type { CrsRef, ImportMapping, ImportStatus, LoadResult } from './types.js';

const UTM40: CrsRef = { kind: 'epsg', code: 32640 };

/** A mapping for the points sample file. */
function collars(crs: CrsRef | null): ImportMapping {
  return {
    datasetName: 'Collars',
    kind: 'points',
    columns: [
      { source: 'Easting', role: 'x' },
      { source: 'Northing', role: 'y' },
      { source: 'RL', role: 'z' },
      { source: 'Hole', role: 'attribute' },
      { source: 'Au_ppm', role: 'attribute' },
    ],
    nodata: { tokens: [''], numbers: [-999] },
    emptyCoordinates: 'error',
    decimalSeparator: '.',
    crs,
  };
}

/** A mapping for files that need no column settings. */
function plain(name: string, crs: CrsRef | null): ImportMapping {
  return { ...collars(crs), datasetName: name, columns: [] };
}

interface Finished {
  readonly progress: readonly ImportStatus[];
  readonly result: LoadResult;
}

/** Steps an import to the end, checking every status against the contract. */
function runImport(
  kernel: TestKernelInstance,
  fileName: string,
  mapping: ImportMapping,
  budget = 1000,
): Finished {
  const id = kernel.startImport(fileName, fixtureBytes(fileName), mapping);
  const progress: ImportStatus[] = [];
  for (let i = 0; i < 10_000; i += 1) {
    const status = checkedImportStatus(kernel.stepImport(id, budget));
    if (status.status === 'done') return { progress, result: status.result };
    progress.push(status);
  }
  throw new Error('the import did not finish');
}

function loaded(result: LoadResult) {
  if (result.status !== 'loaded') throw new Error('expected a loaded result');
  return result.summaries;
}

describe('importing through the kernel object', () => {
  it('loads the points sample, with progress through parsing and validating', () => {
    const kernel = createKernel();
    const { progress, result } = runImport(kernel, 'points.csv', collars(UTM40), 3);
    const phases = progress.map((p) => (p.status === 'progress' ? p.phase : 'done'));
    expect(phases).toEqual(['parsing', 'parsing', 'validating']);
    const [summary] = loaded(result);
    expect(summary).toMatchObject({
      id: 1,
      name: 'Collars',
      kind: 'points',
      elementCount: 8,
      hasZ: true,
      crs: UTM40,
    });
    expect('vertexCount' in (summary ?? {})).toBe(false);
    expect(summary?.columns).toEqual([
      { name: 'Hole', type: 'category', nullCount: 0 },
      { name: 'Au_ppm', type: 'float', nullCount: 2 },
    ]);
    expect(summary?.bbox?.min[0]).toBe(500010.5);
    expect(summary?.bbox?.max[0]).toBe(500185.5);
    kernel.free();
  });

  it('blocks a file with an error, with findings and no dataset', () => {
    const kernel = createKernel();
    const { result } = runImport(kernel, 'points.csv', collars(null));
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    const missing = result.findings.find((f) => f.code === 'crs.missing');
    expect(missing?.severity).toBe('error');
    expect(missing?.step).toBe('crs');
    expect(kernel.datasets()).toEqual([]);
  });

  it('loads a GeoJSON file as one dataset per kind, with the reader notes on each', () => {
    const kernel = createKernel();
    const { result } = runImport(kernel, 'mixed.geojson', plain('Survey', null));
    const summaries = loaded(result);
    expect(summaries.map((s) => [s.id, s.name, s.kind])).toEqual([
      [1, 'Survey (points)', 'points'],
      [2, 'Survey (lines)', 'lines'],
      [3, 'Survey (polygons)', 'polygons'],
    ]);
    expect(summaries[1]?.vertexCount).toBe(3);
    expect(summaries[2]?.vertexCount).toBe(8);
    for (const s of summaries) {
      expect(s.crs).toEqual({ kind: 'epsg', code: 4326 });
      expect(s.findings.some((f) => f.code === 'geojson.kinds.mixed')).toBe(true);
    }
  });

  it('loads a grid and a mesh, applying the chosen coordinate system', () => {
    const kernel = createKernel();
    const [grid] = loaded(runImport(kernel, 'grid.asc', plain('Topography', UTM40)).result);
    expect(grid).toMatchObject({ name: 'Topography', kind: 'grid', elementCount: 12, hasZ: false });
    expect(grid?.crs).toEqual(UTM40);
    const [mesh] = loaded(runImport(kernel, 'mesh.obj', plain('Pyramid', UTM40)).result);
    expect(mesh).toMatchObject({ kind: 'mesh', elementCount: 6, vertexCount: 5, hasZ: true });
    // Both are now in the kernel, in the order they were loaded.
    const listed = kernel.datasets() as unknown[];
    expect(listed.map((s) => checkedSummary(s).id)).toEqual([1, 2]);
  });

  it('reports a file it cannot read as blocked in its first step', () => {
    const kernel = createKernel();
    const id = kernel.startImport('wells.shp', new Uint8Array([0, 0, 1]), plain('x', UTM40));
    const status = checkedImportStatus(kernel.stepImport(id, 1));
    expect(status.status).toBe('done');
    if (status.status !== 'done' || status.result.status !== 'blocked') return;
    expect(status.result.findings[0]?.code).toBe('file.format.unrecognized');
  });

  it('keeps kernels apart', () => {
    const one = createKernel();
    const two = createKernel();
    runImport(one, 'grid.asc', plain('A', UTM40));
    expect((one.datasets() as unknown[]).length).toBe(1);
    expect(two.datasets()).toEqual([]);
    // The same import in another kernel gives the same answer.
    const again = runImport(two, 'grid.asc', plain('A', UTM40));
    expect(again.result).toEqual(runImport(createKernel(), 'grid.asc', plain('A', UTM40)).result);
  });

  it('cancels an import, which then no longer exists', () => {
    const kernel = createKernel();
    const id = kernel.startImport('points.csv', fixtureBytes('points.csv'), collars(UTM40));
    expect(checkedImportStatus(kernel.stepImport(id, 2)).status).toBe('progress');
    expect(kernel.cancelImport(id)).toBe(true);
    expect(kernel.cancelImport(id)).toBe(false);
    expect(() => kernel.stepImport(id, 2)).toThrow(/no import with that id/);
    expect(kernel.datasets()).toEqual([]);
  });

  it('moves forward even with a budget of zero', () => {
    const kernel = createKernel();
    const id = kernel.startImport('points.csv', fixtureBytes('points.csv'), collars(UTM40));
    const status = checkedImportStatus(kernel.stepImport(id, 0));
    expect(status).toMatchObject({ status: 'progress', phase: 'parsing' });
  });

  it('throws, with a clear message, only for misuse', () => {
    // A mapping with a field the kernel does not know is not refused at run time: the
    // conversion ignores it, and the ImportMapping type is what guards against it.
    const kernel = createKernel();
    expect(() => kernel.startImport('a.csv', new Uint8Array(), 'nope')).toThrow(
      /import mapping is not valid/,
    );
    expect(() => kernel.startImport('a.csv', new Uint8Array(), { datasetName: 'x' })).toThrow(
      /import mapping is not valid/,
    );
    expect(() => kernel.stepImport(99, 1)).toThrow(/no import with that id/);
  });
});
