import type { Finding, Preview, Summary } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import { draftFor } from './import-draft.js';
import type { ImportDraft } from './import-draft.js';
import { withRename, withType } from './import-mapping.js';
import { buildMapping, groupFindings, loadBlocker, loadLabel } from './import-run.js';

const csv: Preview = {
  fileName: 'collars.csv',
  format: 'csv',
  suggestedKind: 'points',
  encoding: 'UTF-8',
  crs: { crs: { kind: 'epsg', code: 32640 }, source: 'prj_file' },
  table: {
    delimiter: 'comma',
    hasHeader: true,
    header: ['E', 'N', 'Au'],
    rows: [],
    estimatedRows: 3,
    decimalSeparator: '.',
    columnTypes: ['float', 'float', 'float'],
    roles: [
      { role: 'x', confidence: 0.95 },
      { role: 'y', confidence: 0.95 },
      { role: 'attribute', confidence: 0.5 },
    ],
    nodata: { tokens: [{ token: 'NA', count: 2 }], numbers: [{ value: -999, count: 1 }] },
  },
  findings: [],
};
const entry = { group: { file: new File([''], 'collars.csv'), sidecars: [] }, preview: csv };

describe('the mapping the kernel is given', () => {
  it('has what the draft has, and the coordinate system that was chosen', () => {
    expect(buildMapping(draftFor(entry), entry)).toEqual({
      datasetName: 'collars',
      kind: 'points',
      columns: [
        { source: 'E', role: 'x' },
        { source: 'N', role: 'y' },
        { source: 'Au', role: 'attribute' },
      ],
      nodata: { tokens: ['NA'], numbers: [-999] },
      emptyCoordinates: 'error',
      decimalSeparator: '.',
      crs: { kind: 'epsg', code: 32640 },
    });
  });

  it('gives a type and a name only where a person set one, and trims the name of the dataset', () => {
    const draft: ImportDraft = {
      ...draftFor(entry),
      datasetName: '  Collars 2024 ',
    };
    const edited = {
      ...draft,
      columns: withRename(withType(draft.columns, 2, 'text'), 2, ' Gold '),
    };
    const mapping = buildMapping(edited, entry);
    expect(mapping.datasetName).toBe('Collars 2024');
    expect(mapping.columns[2]).toEqual({
      source: 'Au',
      role: 'attribute',
      type: 'text',
      rename: 'Gold',
    });
    expect(mapping.columns[0]).toEqual({ source: 'E', role: 'x' });
  });

  it('gives a name to an attribute only: the name of a coordinate or an ignored column is not used', () => {
    const draft = draftFor(entry);
    const renamed = { ...draft, columns: withRename(draft.columns, 0, 'East') };
    expect(buildMapping(renamed, entry).columns[0]).toEqual({ source: 'E', role: 'x' });
  });

  it('has a block size for a block model, and for nothing else', () => {
    const draft = {
      ...draftFor(entry),
      kind: 'blocks' as const,
      blockSize: { x: '10', y: '10', z: '5' },
    };
    expect(buildMapping(draft, entry).blockSize).toEqual([10, 10, 5]);
    expect(buildMapping({ ...draft, kind: 'points' }, entry)).not.toHaveProperty('blockSize');
  });

  it('is for points when a file has no kind to choose, which the kernel ignores for it', () => {
    const geojson: Preview = { fileName: 'a.geojson', format: 'geojson', findings: [] };
    const made = { group: { file: new File([''], 'a.geojson'), sidecars: [] }, preview: geojson };
    const mapping = buildMapping(
      { ...draftFor(made), crs: { mode: 'local', epsg: '', units: 'ft' } },
      made,
    );
    expect(mapping.kind).toBe('points');
    expect(mapping.columns).toEqual([]);
    expect(mapping.crs).toEqual({ kind: 'local', units: 'ft' });
  });

  it('has the nodata values that are ticked and typed, and what to do about an empty coordinate', () => {
    const draft = draftFor(entry);
    const changed: ImportDraft = {
      ...draft,
      emptyCoordinates: 'skip',
      decimalSeparator: ',',
      nodata: { ...draft.nodata, other: 'none, -1' },
    };
    const mapping = buildMapping(changed, entry);
    expect(mapping.nodata).toEqual({ tokens: ['NA', 'none'], numbers: [-999, -1] });
    expect(mapping.emptyCoordinates).toBe('skip');
    expect(mapping.decimalSeparator).toBe(',');
  });
});

const finding = (severity: Finding['severity'], code: string, message = code): Finding => ({
  code,
  severity,
  message,
  count: 1,
  examples: [],
});

describe('findings by how serious they are', () => {
  it('are sorted into errors, warnings and notes, each in the order they came', () => {
    const groups = groupFindings([
      finding('warning', 'a'),
      finding('error', 'b'),
      finding('info', 'c'),
      finding('error', 'd'),
      finding('warning', 'e'),
    ]);
    expect(groups.errors.map((f) => f.code)).toEqual(['b', 'd']);
    expect(groups.warnings.map((f) => f.code)).toEqual(['a', 'e']);
    expect(groups.notes.map((f) => f.code)).toEqual(['c']);
  });

  it('have each finding once, though several datasets from one file carry it', () => {
    const same = finding('warning', 'csv.number.invalid', 'A value is not a number.');
    expect(
      groupFindings([
        same,
        { ...same },
        finding('warning', 'csv.number.invalid', 'Another message.'),
      ]).warnings,
    ).toHaveLength(2);
  });
});

describe('what Load says, and when it cannot be used', () => {
  it('says Load, or Load with the number of warnings', () => {
    expect(loadLabel(0)).toBe('Load');
    expect(loadLabel(1)).toBe('Load with 1 warning');
    expect(loadLabel(12)).toBe('Load with 12 warnings');
  });

  it('can be used only once the import has been done, and has no errors', () => {
    expect(
      loadBlocker({ status: 'loaded', summaries: [] as readonly Summary[], findings: [] }),
    ).toBeUndefined();
    expect(loadBlocker({ status: 'running', phase: 'parsing', fraction: 0.5 })).toBe('Importing…');
    expect(loadBlocker({ status: 'idle' })).toBe('Importing…');
    expect(
      loadBlocker({
        status: 'blocked',
        findings: [finding('error', 'a'), finding('error', 'b'), finding('warning', 'c')],
      }),
    ).toBe('2 errors to fix before anything can be loaded.');
    expect(loadBlocker({ status: 'blocked', findings: [finding('error', 'a')] })).toBe(
      '1 error to fix before anything can be loaded.',
    );
    expect(loadBlocker({ status: 'cancelled' })).toContain('cancelled');
    expect(loadBlocker({ status: 'failed', message: 'x' })).toContain('could not be done');
  });
});
