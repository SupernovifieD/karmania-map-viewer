import type { Preview, Role } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import { applyDraftChange, draftFor, fileStem } from './import-draft.js';

const entry = (preview: Partial<Preview> & { fileName: string }) => ({
  group: { file: new File([''], preview.fileName), sidecars: [] },
  preview: { findings: [], ...preview } satisfies Preview,
});

describe('the name a dataset starts with', () => {
  it('is the file name without its extension, however many dots it has', () => {
    expect(fileStem('collars.csv')).toBe('collars');
    expect(fileStem('survey.2024.csv')).toBe('survey.2024');
    expect(fileStem('README')).toBe('README');
    expect(fileStem('.hidden')).toBe('.hidden');
  });
});

describe('the draft for a file', () => {
  it('takes the kind the kernel suggested, when the format offers it', () => {
    expect(
      draftFor(entry({ fileName: 'lines.csv', format: 'csv', suggestedKind: 'lines' })),
    ).toEqual({
      datasetName: 'lines',
      kind: 'lines',
      columns: [],
      blockSize: { x: '', y: '', z: '' },
    });
  });

  it('takes the first kind the format offers when the suggestion is not one of them, or there is none', () => {
    expect(draftFor(entry({ fileName: 'a.csv', format: 'csv', suggestedKind: 'mesh' })).kind).toBe(
      'points',
    );
    expect(draftFor(entry({ fileName: 'a.csv', format: 'csv' })).kind).toBe('points');
  });

  it('has the one kind of a format that has only one, and none for GeoJSON, which has no choice', () => {
    expect(
      draftFor(entry({ fileName: 'g.asc', format: 'ascii_grid', suggestedKind: 'grid' })).kind,
    ).toBe('grid');
    expect(draftFor(entry({ fileName: 'm.obj', format: 'obj' })).kind).toBe('mesh');
    expect(draftFor(entry({ fileName: 'x.geojson', format: 'geojson' })).kind).toBeUndefined();
  });
});

const withTable = (roles: Role[]) =>
  entry({
    fileName: 'l.csv',
    format: 'csv',
    suggestedKind: 'lines',
    table: {
      delimiter: 'comma',
      hasHeader: true,
      header: ['Line', 'X', 'Y'],
      rows: [],
      estimatedRows: 0,
      decimalSeparator: '.',
      columnTypes: ['text', 'float', 'float'],
      roles: roles.map((role) => ({ role, confidence: 0.9 })),
      nodata: { tokens: [], numbers: [] },
    },
  });

describe('the columns of a draft', () => {
  it('start as the kernel suggested them, and are none for a file without columns', () => {
    expect(draftFor(withTable(['line_id', 'x', 'y'])).columns.map((c) => c.role)).toEqual([
      'line_id',
      'x',
      'y',
    ]);
    expect(draftFor(entry({ fileName: 'g.asc', format: 'ascii_grid' })).columns).toEqual([]);
  });
});

describe('changing a draft', () => {
  it('changes what was changed, and nothing else', () => {
    const draft = draftFor(withTable(['line_id', 'x', 'y']));
    expect(applyDraftChange(draft, { datasetName: 'Survey' })).toEqual({
      ...draft,
      datasetName: 'Survey',
    });
  });

  it('turns a column whose role the new kind has not into an attribute when the kind changes', () => {
    const draft = draftFor(withTable(['line_id', 'x', 'y']));
    const points = applyDraftChange(draft, { kind: 'points' });
    expect(points.kind).toBe('points');
    expect(points.columns.map((c) => c.role)).toEqual(['attribute', 'x', 'y']);
  });

  it('takes the columns it is given along with a new kind as they are', () => {
    const draft = draftFor(withTable(['line_id', 'x', 'y']));
    const columns = [{ source: 'Line', role: 'line_id' as const, suggested: false }];
    expect(applyDraftChange(draft, { kind: 'points', columns }).columns).toBe(columns);
  });

  it('leaves the columns alone when the kind is set to what it was', () => {
    const draft = draftFor(withTable(['line_id', 'x', 'y']));
    expect(applyDraftChange(draft, { kind: 'lines' }).columns).toBe(draft.columns);
  });
});
