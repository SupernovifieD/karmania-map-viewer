/**
 * Timings of the built WebAssembly kernel in Node, on a million rows. They run only
 * when asked for, since they take seconds and the numbers mean little on a busy
 * machine:
 *
 *     KARMANIA_TIMING=1 pnpm --filter @karmania/engine exec vitest run kernel-timing
 *
 * The results go in `docs/perf.md`. The limits are the brief's: a preview under 1 s and
 * an import with validation under 5 s for a 1,000,000-row CSV.
 */
import { describe, expect, it } from 'vitest';
import {
  checkedImportStatus,
  checkedLoadResult,
  checkedPage,
  checkedPreview,
} from './contract-check.js';
import { createKernel, loadKernel } from './test-support/kernel.js';
import type { ImportMapping } from './types.js';

const ROWS = 1_000_000;

/** A CSV of `ROWS` rows with X, Y, Z and five attributes, from a fixed seed. */
function bigCsv(): Uint8Array {
  let seed = 42;
  const next = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed;
  };
  const chunks: string[] = ['X,Y,Z,a0,a1,a2,a3,a4\n'];
  for (let start = 0; start < ROWS; start += 50_000) {
    const lines: string[] = [];
    for (let i = 0; i < 50_000; i += 1) {
      const attr = () => (next() % 10_000) / 100;
      lines.push(
        `${String(450_000 + (next() % 100_000))},${String(2_700_000 + (next() % 100_000))},${String(next() % 500)},` +
          `${String(attr())},${String(attr())},${String(attr())},${String(attr())},${String(attr())}`,
      );
    }
    chunks.push(lines.join('\n'), '\n');
  }
  return new TextEncoder().encode(chunks.join(''));
}

const MAPPING: ImportMapping = {
  datasetName: 'big',
  kind: 'points',
  columns: [
    { source: 'X', role: 'x' },
    { source: 'Y', role: 'y' },
    { source: 'Z', role: 'z' },
    ...['a0', 'a1', 'a2', 'a3', 'a4'].map((source) => ({ source, role: 'attribute' as const })),
  ],
  nodata: { tokens: [''], numbers: [] },
  emptyCoordinates: 'error',
  decimalSeparator: '.',
  crs: { kind: 'epsg', code: 32640 },
};

function milliseconds(since: number): number {
  return Math.round(performance.now() - since);
}

describe.runIf(process.env['KARMANIA_TIMING'] !== undefined)(
  'a million rows in WebAssembly',
  () => {
    it('previews, imports with validation, pages and builds within the brief', () => {
      const bytes = bigCsv();
      const megabytes = (bytes.length / 1_048_576).toFixed(1);
      const { preview } = loadKernel();

      let start = performance.now();
      const seen = checkedPreview(preview('big.csv', bytes, []));
      const previewMs = milliseconds(start);
      expect(seen.table?.estimatedRows).toBe(ROWS);

      const kernel = createKernel();
      start = performance.now();
      const id = kernel.startImport('big.csv', bytes, MAPPING);
      let steps = 0;
      let longest = 0;
      for (;;) {
        const stepStart = performance.now();
        const status = checkedImportStatus(kernel.stepImport(id, 50_000));
        longest = Math.max(longest, performance.now() - stepStart);
        steps += 1;
        if (status.status === 'done') {
          expect(status.result.status).toBe('loaded');
          break;
        }
      }
      const importMs = milliseconds(start);

      start = performance.now();
      const first = checkedPage(kernel.rows(1, 0, 256));
      const last = checkedPage(kernel.rows(1, ROWS - 256, 256));
      const pagesMs = milliseconds(start);
      expect([first.count, last.count]).toEqual([256, 256]);

      const x = Float64Array.from({ length: ROWS }, (_, i) => 450_000 + (i % 100_000));
      const y = Float64Array.from({ length: ROWS }, (_, i) => 2_700_000 + Math.floor(i / 10));
      start = performance.now();
      const built = checkedLoadResult(
        kernel.load({ kind: 'points', name: 'built', crs: { kind: 'epsg', code: 32640 }, x, y }),
      );
      const buildMs = milliseconds(start);
      expect(built.status).toBe('loaded');

      console.info(
        [
          `preview of ${megabytes} MB, ${String(ROWS)} rows: ${String(previewMs)} ms`,
          `import and validation in ${String(steps)} steps: ${String(importMs)} ms (longest step ${String(Math.round(longest))} ms)`,
          `two pages of 256 rows: ${String(pagesMs)} ms`,
          `building and validating ${String(ROWS)} points from arrays: ${String(buildMs)} ms`,
          `process memory: ${String(Math.round(process.memoryUsage().rss / 1_048_576))} MB`,
        ].join('\n'),
      );
      expect(previewMs).toBeLessThan(1000);
      expect(importMs).toBeLessThan(5000);
    }, 120_000);
  },
);
