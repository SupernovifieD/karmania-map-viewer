/**
 * The long and the unexpected of section 7.3 of the brief, and the means of putting them in: a
 * dataset name of 120 characters, a column name of 60, 10 million as a count, and a negative
 * coordinate with 12 decimals. The long-content tests and the long-content states share them.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { fixturePath } from './picker.js';
import type { Sample } from './picker.js';

/** A dataset name of 120 characters with nowhere to break it: the worst a name can be. */
export const NAME = 'dataset_name_'.repeat(10).slice(0, 120);
/** The same length with spaces in it, which can wrap where the other can only be cut. */
export const SPACED_NAME = 'Collars from the northern lease '.repeat(4).slice(0, 120);
/** A column name of 60 characters. */
export const COLUMN = 'column_name_'.repeat(6).slice(0, 60);
/** A negative coordinate with 12 decimals. */
export const COORDINATE = '-123.456789012345';
export const COUNT = 10_000_000;
export const COUNT_TEXT = '10,000,000';

/** A dataset, as the engine describes one, with the long things in it. */
export function longDataset(id: number, name: string): Record<string, unknown> {
  return {
    id,
    name,
    kind: 'points',
    elementCount: COUNT,
    hasZ: true,
    crs: { kind: 'epsg', code: 32640 },
    bbox: {
      min: [Number(COORDINATE), Number(COORDINATE), Number(COORDINATE)],
      max: [-0.000123456789012, 1_234_567.123456, 99_999_999.123456],
    },
    columns: [
      { name: COLUMN, type: 'float', nullCount: COUNT },
      { name: 'short', type: 'text', nullCount: 0 },
    ],
    findings: [
      {
        code: 'values.points.duplicate',
        severity: 'warning',
        message: `The column ${COLUMN} has ${COUNT_TEXT} values that are not numbers, the first at ${COORDINATE}.`,
        hint: `Check ${COLUMN} in the file.`,
        count: COUNT,
        examples: [{ row: COUNT }, { row: COUNT - 1 }],
      },
      {
        code: 'geojson.crs.assumed',
        severity: 'info',
        message: `The file ${NAME}.csv names no coordinate system.`,
        count: 1,
        examples: [],
      },
    ],
  };
}

export async function setDatasets(
  page: Page,
  list: readonly Record<string, unknown>[],
): Promise<void> {
  await page.locator('karmania-app').evaluate(
    async (element, [datasets, coordinate, column]) => {
      const target = element as unknown as {
        datasets: readonly unknown[];
        selected: number | undefined;
        engine: unknown;
        updateComplete: Promise<boolean>;
      };
      // An engine that has the rows of any dataset: text and decimals, with the long things in them.
      target.engine = {
        rows: (_id: number, start: number, count: number) => {
          const nulls = (): Uint8Array => new Uint8Array(count);
          const decimals = (): Float64Array =>
            Float64Array.from(
              { length: count },
              (_, at) => Number(coordinate) - (start + at) * 1e-6,
            );
          return Promise.resolve({
            start,
            count,
            columns: [
              { name: 'X', values: decimals(), nulls: nulls() },
              { name: 'Y', values: decimals(), nulls: nulls() },
              { name: 'Z', values: decimals(), nulls: nulls() },
              {
                name: column,
                values: Array.from(
                  { length: count },
                  (_, at) => `text of row ${String(start + at + 1)}`,
                ),
                nulls: nulls(),
              },
            ],
          });
        },
        datasets: () => [],
        remove: () => Promise.resolve(),
        dispose: () => undefined,
      };
      target.datasets = datasets;
      target.selected = (datasets[0] as { id: number } | undefined)?.id;
      await target.updateComplete;
    },
    [list, COORDINATE, COLUMN] as const,
  );
  await page.locator('karmania-panel k-tabs [role="tab"]').filter({ hasText: 'Data' }).click();
}

/** A points file named with 120 characters, with two columns of 60 and coordinates of 12 decimals. */
export function longFile(): [Sample, Sample] {
  const second = `${COLUMN.slice(0, 59)}b`;
  const lines = [`Easting,Northing,RL,${COLUMN},${second}`];
  for (let row = 0; row < 12; row += 1) {
    const value = (Number(COORDINATE) - row * 1e-12).toFixed(12);
    lines.push(`${value},${value},${value},${value},a text`);
  }
  return [
    { name: `${NAME}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`${lines.join('\n')}\n`) },
    {
      name: `${NAME}.prj`,
      mimeType: 'text/plain',
      buffer: readFileSync(fixturePath('points.prj')),
    },
  ];
}

/** An engine that previews a file of 10 million rows with the long things in it, and imports as the test says. */
export const LONG_ENGINE = `(() => {
  const control = { calls: 0, report: undefined, finish: undefined, fail: undefined, signal: undefined };
  const preview = ${JSON.stringify({
    format: 'csv',
    suggestedKind: 'points',
    encoding: 'UTF-8',
    crs: { crs: { kind: 'epsg', code: 32640 }, source: 'prj_file' },
    table: {
      delimiter: 'comma',
      hasHeader: true,
      header: ['Easting', 'Northing', 'RL', COLUMN],
      rows: [
        [COORDINATE, COORDINATE, COORDINATE, COORDINATE],
        [COORDINATE, COORDINATE, COORDINATE, 'a text'],
      ],
      estimatedRows: COUNT,
      decimalSeparator: '.',
      columnTypes: ['float', 'float', 'float', 'text'],
      roles: [
        { role: 'x', confidence: 0.9 },
        { role: 'y', confidence: 0.9 },
        { role: 'z', confidence: 0.9 },
        { role: 'attribute', confidence: 0.5 },
      ],
      nodata: { tokens: [], numbers: [] },
    },
    findings: [
      {
        code: 'values.points.duplicate',
        severity: 'warning',
        message: `The column ${COLUMN} has ${COUNT_TEXT} values that are not numbers, the first at ${COORDINATE}.`,
        hint: `Check ${COLUMN} in the file ${NAME}.csv.`,
        count: COUNT,
        examples: [{ row: COUNT }],
      },
    ],
  })};
  const engine = {
    preview: async (files) => files.map((file) => ({ ...preview, fileName: file.name })),
    importFiles: (files, mapping, options) => new Promise((resolve, reject) => {
      control.calls += 1;
      control.report = options.onProgress;
      control.signal = options.signal;
      control.finish = resolve;
      control.fail = (message) => reject(new Error(message));
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    }),
    remove: async () => undefined,
    datasets: () => [],
    dispose: () => undefined,
  };
  window.fake = control;
  return engine;
})()`;
