import type { CrsRef, ImportMapping, Kind, Preview } from '../types.js';

/** What the wizard does with a preview: take its suggestions as they are. */
export function mappingFrom(preview: Preview, kind: Kind, crs: CrsRef | null): ImportMapping {
  const table = preview.table;
  return {
    datasetName: preview.fileName,
    kind,
    columns:
      table?.header.map((source, index) => ({
        source,
        role: table.roles[index]?.role ?? 'attribute',
      })) ?? [],
    nodata: {
      tokens: table?.nodata.tokens.map((t) => t.token) ?? [],
      numbers: table?.nodata.numbers.map((n) => n.value) ?? [],
    },
    emptyCoordinates: 'error',
    ...(kind === 'blocks' ? { blockSize: [10, 10, 10] as const } : {}),
    decimalSeparator: table?.decimalSeparator ?? '.',
    crs: crs ?? preview.crs?.crs ?? null,
  };
}
