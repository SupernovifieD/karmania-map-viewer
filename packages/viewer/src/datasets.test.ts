import type { Finding, Summary } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import {
  crsLabel,
  crsLabelNamed,
  crsTitleNamed,
  derivedRows,
  describeWarnings,
  extentRows,
  formatCoordinate,
  listedDatasets,
  madeFrom,
  selectionAfterRemoving,
  warningCount,
} from './datasets.js';

const finding = (severity: Finding['severity']): Finding => ({
  code: 'x.y',
  severity,
  message: 'm',
  count: 1,
  examples: [],
});

const dataset = (id: number, findings: Finding[] = []): Summary => ({
  id,
  name: `d${String(id)}`,
  kind: 'points',
  elementCount: 1,
  hasZ: false,
  columns: [],
  findings,
});

describe('the warnings of a dataset', () => {
  it('are counted as warnings only, not notes', () => {
    expect(warningCount(dataset(1))).toBe(0);
    expect(
      warningCount(dataset(1, [finding('warning'), finding('info'), finding('warning')])),
    ).toBe(2);
    expect(warningCount(dataset(1, [finding('info')]))).toBe(0);
  });

  it('are said in words, in the singular for one', () => {
    expect(describeWarnings(1)).toBe('1 warning');
    expect(describeWarnings(3)).toBe('3 warnings');
  });
});

describe('what is selected once a dataset is removed', () => {
  const three = [dataset(1), dataset(2), dataset(3)];

  it('stays, when it was another dataset that was removed', () => {
    expect(selectionAfterRemoving(three, 2, 3)).toBe(3);
    expect(selectionAfterRemoving(three, 1, undefined)).toBeUndefined();
  });

  it('is the dataset after the one that was selected, or before it if that was the last', () => {
    expect(selectionAfterRemoving(three, 2, 2)).toBe(3);
    expect(selectionAfterRemoving(three, 1, 1)).toBe(2);
    expect(selectionAfterRemoving(three, 3, 3)).toBe(2);
  });

  it('is nothing when the only dataset is removed', () => {
    expect(selectionAfterRemoving([dataset(7)], 7, 7)).toBeUndefined();
  });
});

/** A dataset made from `source` as contour lines, with the settings given. */
const contoursOf = (
  id: number,
  source: number,
  params: Partial<{ column: string; interval: number; base: number; indexEvery: number }> = {},
): Summary => ({
  ...dataset(id),
  kind: 'lines',
  derivedFrom: {
    id: source,
    kind: 'contours',
    params: { interval: 2.5, base: 0, indexEvery: 5, ...params },
  },
});

const idsOf = (list: readonly Summary[]): number[] => list.map((d) => d.id);

describe('the order of the datasets in the Data tab', () => {
  it('is the order they were loaded, each followed directly by what was made from it', () => {
    // 3 is the contours of 1, loaded after 2; 4 is the contours of 2; 5 is the contours of 3 (lines of lines).
    const loaded = [dataset(1), dataset(2), contoursOf(3, 1), contoursOf(4, 2), contoursOf(5, 3)];
    expect(idsOf(listedDatasets(loaded))).toStrictEqual([1, 3, 5, 2, 4]);
    expect(idsOf(listedDatasets([dataset(1), dataset(2)]))).toStrictEqual([1, 2]);
    expect(listedDatasets([])).toStrictEqual([]);
  });

  it('keeps a dataset whose source is not loaded, with the others, so that none is lost', () => {
    const loaded = [dataset(1), contoursOf(2, 99), dataset(3)];
    expect(idsOf(listedDatasets(loaded))).toStrictEqual([1, 2, 3]);
  });
});

describe('what removing a dataset removes with it', () => {
  const loaded = [dataset(1), dataset(2), contoursOf(3, 1), contoursOf(4, 2), contoursOf(5, 3)];

  it('is what was made from it, and from those, in the order they are listed', () => {
    expect(idsOf(madeFrom(loaded, 1))).toStrictEqual([3, 5]);
    expect(idsOf(madeFrom(loaded, 2))).toStrictEqual([4]);
    expect(idsOf(madeFrom(loaded, 3))).toStrictEqual([5]);
  });

  it('is nothing for a dataset that has nothing made from it, or is not there', () => {
    expect(madeFrom(loaded, 5)).toStrictEqual([]);
    expect(madeFrom(loaded, 99)).toStrictEqual([]);
    expect(madeFrom([], 1)).toStrictEqual([]);
  });
});

describe('what is selected once a dataset and what was made from it are removed', () => {
  const loaded = [dataset(1), contoursOf(2, 1), dataset(3), contoursOf(4, 3)];

  it('stays when it is not among what goes', () => {
    expect(selectionAfterRemoving(loaded, 1, 3)).toBe(3);
    expect(selectionAfterRemoving(loaded, 1, 4)).toBe(4);
  });

  it('is the dataset listed after them when the selected one goes, whether it is the dataset or what was made from it', () => {
    expect(selectionAfterRemoving(loaded, 1, 1)).toBe(3);
    expect(selectionAfterRemoving(loaded, 1, 2)).toBe(3);
  });

  it('is the one listed before them when they were last, and nothing when nothing is left', () => {
    expect(selectionAfterRemoving(loaded, 3, 4)).toBe(2);
    expect(selectionAfterRemoving(loaded, 3, 3)).toBe(2);
    expect(selectionAfterRemoving([dataset(1), contoursOf(2, 1)], 1, 2)).toBeUndefined();
  });

  it('is the source when only the lines are removed and they were selected', () => {
    expect(selectionAfterRemoving(loaded, 2, 2)).toBe(3);
    expect(selectionAfterRemoving([dataset(1), contoursOf(2, 1)], 2, 2)).toBe(1);
  });
});

describe('how a derived dataset says it was made', () => {
  it('names the dataset, the interval and the base, the index lines and the column of a grid', () => {
    const lines = contoursOf(2, 1, { column: 'height', interval: 0.0025, base: -10 });
    expect(derivedRows(lines, 'Cone')).toStrictEqual([
      { label: 'Made from', text: 'Cone' },
      { label: 'Contours', text: 'every 0.0025, counted from -10' },
      { label: 'Index lines', text: 'every 5th line' },
      { label: 'Column', text: 'height' },
    ]);
  });

  it('leaves out the column of a mesh, says "dataset 1" when the source is not loaded, and says every line for 1', () => {
    const lines = contoursOf(2, 1, { indexEvery: 1 });
    expect(derivedRows(lines, undefined)).toStrictEqual([
      { label: 'Made from', text: 'dataset 1' },
      { label: 'Contours', text: 'every 2.5, counted from 0' },
      { label: 'Index lines', text: 'every line' },
    ]);
  });

  it('counts the index lines as a person says it: 2nd, 3rd, 4th, 11th, 12th, 21st, 112th', () => {
    const said = (n: number): string | undefined =>
      derivedRows(contoursOf(2, 1, { indexEvery: n }), 'x').find((r) => r.label === 'Index lines')
        ?.text;
    expect(said(2)).toBe('every 2nd line');
    expect(said(3)).toBe('every 3rd line');
    expect(said(4)).toBe('every 4th line');
    expect(said(11)).toBe('every 11th line');
    expect(said(12)).toBe('every 12th line');
    expect(said(13)).toBe('every 13th line');
    expect(said(21)).toBe('every 21st line');
    expect(said(112)).toBe('every 112th line');
  });

  it('says nothing for a dataset that was not made from another', () => {
    expect(derivedRows(dataset(1), 'x')).toStrictEqual([]);
  });
});

describe('the coordinate system of a dataset', () => {
  it('is the code as given, or a local grid with its units', () => {
    expect(crsLabel({ kind: 'epsg', code: 32640 })).toBe('EPSG 32640');
    expect(crsLabel({ kind: 'local', units: 'm' })).toBe('Local grid, metres');
    expect(crsLabel({ kind: 'local', units: 'ft' })).toBe('Local grid, feet');
    expect(crsLabel({ kind: 'local', units: 'us_ft' })).toBe('Local grid, US survey feet');
    expect(crsLabel(undefined)).toBe('Not set');
  });

  const utm = {
    code: 32640,
    name: 'WGS 84 / UTM zone 40N',
    kind: 'projected',
    units: 'm',
  } as const;
  const wgs84 = { code: 4326, name: 'WGS 84', kind: 'geographic', units: 'degree' } as const;
  const epsg = (code: number) => ({ kind: 'epsg', code }) as const;

  it('has its name and unit when the definitions have been asked and know the code', () => {
    expect(crsLabelNamed(epsg(32640), { ...utm, metresPerUnit: 1 })).toBe(
      'EPSG 32640, WGS 84 / UTM zone 40N, metres',
    );
    expect(crsLabelNamed(epsg(4326), wgs84)).toBe('EPSG 4326, WGS 84, degrees');
    expect(
      crsLabelNamed(epsg(2229), {
        code: 2229,
        name: 'NAD83 / California zone 5 (ftUS)',
        kind: 'projected',
        units: 'us_ft',
        metresPerUnit: 1200 / 3937,
      }),
    ).toBe('EPSG 2229, NAD83 / California zone 5 (ftUS), US survey feet');
  });

  it('says that a code is not one that is known, and is as it was before anyone asked', () => {
    expect(crsLabelNamed(epsg(99999), null)).toBe('EPSG 99999, not one Karmania knows');
    expect(crsLabelNamed(epsg(32640), undefined)).toBe('EPSG 32640');
    // A local grid has no definition to ask for, whatever is given.
    expect(crsLabelNamed({ kind: 'local', units: 'm' }, { ...utm, metresPerUnit: 1 })).toBe(
      'Local grid, metres',
    );
    expect(crsLabelNamed(undefined, null)).toBe('Not set');
  });

  it('has, in its tooltip, what kind of system it is', () => {
    expect(crsTitleNamed(epsg(32640), { ...utm, metresPerUnit: 1 })).toBe(
      'EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres)',
    );
    expect(crsTitleNamed(epsg(4326), wgs84)).toBe(
      'EPSG 4326, WGS 84 (longitude and latitude, in degrees)',
    );
    expect(crsTitleNamed(epsg(99999), null)).toBe(
      'EPSG 99999 is not one of the coordinate systems Karmania knows',
    );
    expect(crsTitleNamed(epsg(32640), undefined)).toBe('EPSG 32640');
  });
});

describe('a coordinate as shown', () => {
  it('has up to six decimals, with no zeros at the end', () => {
    expect(formatCoordinate(500010.5)).toBe('500010.5');
    expect(formatCoordinate(2765020.25)).toBe('2765020.25');
    expect(formatCoordinate(120)).toBe('120');
    expect(formatCoordinate(55.3)).toBe('55.3');
  });

  it('is cut at six decimals, for a negative coordinate with twelve', () => {
    expect(formatCoordinate(-123.456789012345)).toBe('-123.456789');
    expect(formatCoordinate(0.1 + 0.2)).toBe('0.3');
  });

  it('is never minus zero', () => {
    expect(formatCoordinate(-0)).toBe('0');
    expect(formatCoordinate(-0.0000001)).toBe('0');
  });
});

describe('the box round a dataset', () => {
  const box = {
    min: [500010.5, 2765020.25, 109.3] as const,
    max: [500185.5, 2765205.25, 120.4] as const,
  };

  it('has a row for X and Y, and one for Z when the dataset has heights', () => {
    const flat = extentRows({ ...dataset(1), bbox: box, hasZ: false });
    expect(flat.map((row) => row.axis)).toEqual(['X', 'Y']);
    const tall = extentRows({ ...dataset(1), bbox: box, hasZ: true });
    expect(tall.map((row) => [row.axis, row.text])).toEqual([
      ['X', '500010.5 to 500185.5'],
      ['Y', '2765020.25 to 2765205.25'],
      ['Z', '109.3 to 120.4'],
    ]);
  });

  it('keeps every digit for the title, when the text is cut', () => {
    const [x] = extentRows({
      ...dataset(1),
      bbox: { min: [-123.456789012345, 0, 0], max: [-100, 1, 1] },
    });
    expect(x?.text).toBe('-123.456789 to -100');
    expect(x?.full).toBe('-123.456789012345 to -100');
  });

  it('has no rows when there is no box', () => {
    expect(extentRows(dataset(1))).toEqual([]);
  });
});
