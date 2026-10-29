import type { Preview } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import { draftFor, fileStem } from './import-draft.js';

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
