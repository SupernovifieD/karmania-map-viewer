import type { Finding, Preview, PreviewGroup } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import {
  describeFile,
  entriesOf,
  formatCount,
  IMPORT_FILE_ACCEPT,
  isImportable,
  KIND_NAMES,
  KINDS_BY_FORMAT,
} from './import-files.js';

const csv: Preview = {
  fileName: 'points.csv',
  format: 'csv',
  suggestedKind: 'points',
  encoding: 'UTF-8',
  table: {
    delimiter: 'comma',
    hasHeader: true,
    header: ['x', 'y'],
    rows: [],
    estimatedRows: 1203,
    decimalSeparator: '.',
    columnTypes: ['float', 'float'],
    roles: [],
    nodata: { tokens: [], numbers: [] },
  },
  findings: [],
};

const finding = (severity: Finding['severity']): Finding => ({
  code: 'file.something',
  severity,
  message: 'Something.',
  count: 1,
  examples: [],
});

describe('what the picker offers', () => {
  it('is the extensions the kernel reads, and .txt', () => {
    expect(IMPORT_FILE_ACCEPT.split(',')).toEqual([
      '.csv',
      '.tsv',
      '.tab',
      '.txt',
      '.geojson',
      '.json',
      '.asc',
      '.obj',
      '.prj',
    ]);
  });
});

describe('pairing files with their previews', () => {
  it('takes the nth preview for the nth group, and drops a group that has none', () => {
    const groups: PreviewGroup[] = [
      { file: new File([''], 'a.csv'), sidecars: [] },
      { file: new File([''], 'b.csv'), sidecars: [] },
    ];
    const [first] = groups;
    const entries = entriesOf(groups, [csv]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ group: first, preview: csv });
  });
});

describe('which files can be imported', () => {
  it('are data files that nothing has an error about', () => {
    expect(isImportable(csv)).toBe(true);
    expect(isImportable({ ...csv, findings: [finding('warning'), finding('info')] })).toBe(true);
    expect(isImportable({ ...csv, findings: [finding('error')] })).toBe(false);
  });

  it('are not unreadable files, and not a projection file on its own', () => {
    expect(isImportable({ fileName: 'x.shp', findings: [finding('error')] })).toBe(false);
    expect(isImportable({ fileName: 'x.shp', findings: [] })).toBe(false);
    expect(isImportable({ fileName: 'a.prj', format: 'prj', findings: [] })).toBe(false);
  });
});

describe('the kinds a format can be imported as', () => {
  it('are points, lines and blocks for CSV, one for grids and meshes, and none to choose for GeoJSON', () => {
    expect(KINDS_BY_FORMAT.csv).toEqual(['points', 'lines', 'blocks']);
    expect(KINDS_BY_FORMAT.ascii_grid).toEqual(['grid']);
    expect(KINDS_BY_FORMAT.obj).toEqual(['mesh']);
    expect(KINDS_BY_FORMAT.geojson).toEqual([]);
  });

  it('all have a name', () => {
    for (const kinds of Object.values(KINDS_BY_FORMAT)) {
      for (const kind of kinds) {
        expect(KIND_NAMES[kind]).not.toBe('');
      }
    }
  });
});

describe('describing a file', () => {
  it('names the format, the encoding, the delimiter and about how many rows', () => {
    expect(describeFile(csv)).toBe('CSV · UTF-8 · comma-separated · about 1,203 rows');
  });

  it('says "row", not "rows", for one', () => {
    const one = {
      ...csv,
      table: { ...(csv.table as NonNullable<Preview['table']>), estimatedRows: 1 },
    };
    expect(describeFile(one)).toBe('CSV · UTF-8 · comma-separated · about 1 row');
  });

  it('leaves out what a format does not have', () => {
    expect(
      describeFile({ fileName: 'a.geojson', format: 'geojson', encoding: 'UTF-8', findings: [] }),
    ).toBe('GeoJSON · UTF-8');
    expect(describeFile({ fileName: 'a.asc', format: 'ascii_grid', findings: [] })).toBe(
      'ESRI ASCII grid',
    );
  });

  it('has nothing to say about a file that cannot be read', () => {
    expect(describeFile({ fileName: 'x.shp', findings: [finding('error')] })).toBeUndefined();
  });
});

describe('writing a count', () => {
  it('groups the thousands, as for ten million', () => {
    expect(formatCount(8)).toBe('8');
    expect(formatCount(1203)).toBe('1,203');
    expect(formatCount(10_000_000)).toBe('10,000,000');
  });
});
