/**
 * The whole path a file takes through the built kernel in Node, the way the import
 * wizard will use it: preview the file, make a mapping from the preview's own
 * suggestions, import, look at what loaded, page through every row, and remove it.
 */
import { describe, expect, it } from 'vitest';
import {
  checkedImportStatus,
  checkedPage,
  checkedPreview,
  checkedSummary,
} from './contract-check.js';
import { createKernel, fixtureBytes, loadKernel } from './test-support/kernel.js';
import { mappingFrom } from './test-support/mapping.js';
import type { CrsRef, ImportMapping, Kind, Summary } from './types.js';

const UTM40: CrsRef = { kind: 'epsg', code: 32640 };

/** Imports a file and returns what loaded, or the codes of what blocked it. */
function importFile(
  kernel: ReturnType<typeof createKernel>,
  fileName: string,
  mapping: ImportMapping,
): { summaries: readonly Summary[] } | { blocked: readonly string[] } {
  const id = kernel.startImport(fileName, fixtureBytes(fileName), mapping);
  for (;;) {
    const status = checkedImportStatus(kernel.stepImport(id, 1000));
    if (status.status === 'done') {
      return status.result.status === 'loaded'
        ? { summaries: status.result.summaries }
        : { blocked: status.result.findings.map((f) => f.code) };
    }
  }
}

/** Reads every row of a dataset in small pages and counts them. */
function countRows(kernel: ReturnType<typeof createKernel>, summary: Summary): number {
  let rows = 0;
  while (rows < summary.elementCount) {
    const page = checkedPage(kernel.rows(summary.id, rows, 3));
    expect(page.start).toBe(rows);
    expect(page.count).toBeGreaterThan(0);
    rows += page.count;
  }
  expect(checkedPage(kernel.rows(summary.id, rows, 3)).count).toBe(0);
  return rows;
}

describe('one sample file per format, from preview to removal', () => {
  const { preview } = loadKernel();
  const cases: readonly {
    readonly file: string;
    readonly kind: Kind;
    readonly crs: CrsRef | null;
    readonly datasets: readonly [Kind, number][];
  }[] = [
    { file: 'points.csv', kind: 'points', crs: UTM40, datasets: [['points', 8]] },
    { file: 'lines.csv', kind: 'lines', crs: UTM40, datasets: [['lines', 2]] },
    { file: 'blocks.csv', kind: 'blocks', crs: UTM40, datasets: [['blocks', 18]] },
    {
      file: 'mixed.geojson',
      kind: 'points',
      crs: null,
      datasets: [
        ['points', 2],
        ['lines', 1],
        ['polygons', 1],
      ],
    },
    { file: 'grid.asc', kind: 'grid', crs: UTM40, datasets: [['grid', 12]] },
    { file: 'mesh.obj', kind: 'mesh', crs: UTM40, datasets: [['mesh', 6]] },
  ];

  for (const { file, kind, crs, datasets } of cases) {
    it(`takes ${file} through the whole path`, () => {
      const kernel = createKernel();
      const seen = checkedPreview(preview(file, fixtureBytes(file), []), file);
      expect(seen.format).toBeDefined();
      expect(seen.findings.filter((f) => f.severity === 'error')).toEqual([]);

      const result = importFile(kernel, file, mappingFrom(seen, kind, crs));
      if (!('summaries' in result)) throw new Error(`blocked: ${result.blocked.join(', ')}`);
      expect(result.summaries.map((s) => [s.kind, s.elementCount])).toEqual(datasets);
      // What the kernel lists is what loaded, and each summary can be asked for again.
      const listed = kernel.datasets() as unknown[];
      expect(listed.map((s) => checkedSummary(s).id)).toEqual(result.summaries.map((s) => s.id));
      for (const summary of result.summaries) {
        expect(kernel.summary(summary.id)).toEqual(summary);
        expect(countRows(kernel, summary)).toBe(summary.elementCount);
      }
      for (const summary of result.summaries) expect(kernel.remove(summary.id)).toBe(true);
      expect(kernel.datasets()).toEqual([]);
    });
  }

  it('uses a .prj sidecar for the coordinate system and stops without one', () => {
    const kernel = createKernel();
    const bytes = fixtureBytes('points.csv');
    const withPrj = checkedPreview(
      preview('points.csv', bytes, [{ name: 'points.prj', bytes: fixtureBytes('points.prj') }]),
    );
    expect(withPrj.crs).toEqual({ crs: UTM40, source: 'prj_file' });
    const loaded = importFile(kernel, 'points.csv', mappingFrom(withPrj, 'points', null));
    expect('summaries' in loaded && loaded.summaries[0]?.crs).toEqual(UTM40);

    // A .prj with no EPSG code leaves the wizard without a coordinate system, and the
    // import says so instead of guessing.
    const esri = checkedPreview(
      preview('points.csv', bytes, [{ name: 'points.prj', bytes: fixtureBytes('esri.prj') }]),
    );
    expect(esri.crs).toBeUndefined();
    expect(esri.findings.map((f) => f.code)).toEqual(['prj.unrecognized']);
    const blocked = importFile(createKernel(), 'points.csv', mappingFrom(esri, 'points', null));
    expect(blocked).toEqual({ blocked: ['crs.missing'] });
  });

  it('suggests, for every sample, a mapping the kernel accepts without a single error', () => {
    // The roles, types and no-data values in a preview are good enough to import with.
    for (const { file, kind, crs } of cases.filter((c) => c.file.endsWith('.csv'))) {
      const seen = checkedPreview(preview(file, fixtureBytes(file), []));
      const result = importFile(createKernel(), file, mappingFrom(seen, kind, crs));
      expect('summaries' in result, `${file}: ${JSON.stringify(result)}`).toBe(true);
    }
  });
});
