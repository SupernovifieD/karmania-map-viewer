/** Data for tests that need a file big enough for an import to take several steps. */
import type { ImportMapping } from '../types.js';

/** A coordinate system for the points in these files. */
export const UTM40 = { kind: 'epsg', code: 32640 } as const;

/** A points CSV with `rows` rows of X, Y and Z, as a `File` called `big.csv`. */
export function bigPointsCsv(rows: number): File {
  const lines = ['X,Y,Z'];
  for (let row = 0; row < rows; row += 1) {
    lines.push(`${String(500_000 + row)},${String(2_700_000 + row)},${String(row % 100)}`);
  }
  return new File([lines.join('\n')], 'big.csv');
}

/** The mapping for `bigPointsCsv`. */
export const pointsMapping = (name: string): ImportMapping => ({
  datasetName: name,
  kind: 'points',
  columns: [
    { source: 'X', role: 'x' },
    { source: 'Y', role: 'y' },
    { source: 'Z', role: 'z' },
  ],
  nodata: { tokens: [], numbers: [] },
  emptyCoordinates: 'error',
  decimalSeparator: '.',
  crs: UTM40,
});
