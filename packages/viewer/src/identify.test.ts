import type { Kind, Page, Summary } from '@karmania/engine/types';
import { describe, expect, it } from 'vitest';
import { IDENTIFY_ROWS, elementWord, identifyModel } from './identify.js';

const summary = (kind: Kind, columns: readonly string[], over: Partial<Summary> = {}): Summary => ({
  id: 4,
  name: 'Drillholes',
  kind,
  elementCount: 5000,
  hasZ: false,
  columns: columns.map((name) => ({ name, type: 'text', nullCount: 0 })),
  findings: [],
  ...over,
});

/** A page of one row with a value for each named column: the number is a decimal column, the string a text column. */
const page = (
  values: Record<string, number | string | boolean | null>,
  extra: Page['columns'] = [],
): Page => ({
  start: 0,
  count: 1,
  columns: [
    ...extra,
    ...Object.entries(values).map(([name, value]) => ({
      name,
      values:
        typeof value === 'number'
          ? Float64Array.of(value)
          : typeof value === 'boolean'
            ? Uint8Array.of(value ? 1 : 0)
            : [value ?? ''],
      nulls: Uint8Array.of(value === null ? 1 : 0),
    })),
  ],
});

describe('what the popover says of an element', () => {
  it('names the dataset and says what the element is, counted from 1 with thousands commas: "Point 1,204"', () => {
    const model = identifyModel(summary('points', []), 1203, undefined);
    expect(model.name).toBe('Drillholes');
    expect(model.caption).toBe('Point 1,204');
    expect(identifyModel(summary('points', []), 0, undefined).caption).toBe('Point 1');
    expect(identifyModel(summary('points', []), 999_999, undefined).caption).toBe(
      'Point 1,000,000',
    );
    expect([model.datasetId, model.element]).toEqual([4, 1203]);
  });

  it('calls an element of each kind of dataset what it is', () => {
    const kinds: [Kind, string][] = [
      ['points', 'Point'],
      ['lines', 'Line'],
      ['polygons', 'Polygon'],
      ['mesh', 'Triangle'],
      ['grid', 'Cell'],
      ['blocks', 'Block'],
    ];
    for (const [kind, word] of kinds) {
      expect(elementWord(kind)).toBe(word);
      expect(identifyModel(summary(kind, []), 2, undefined).caption).toBe(`${word} 3`);
    }
  });

  it('is loading until the row is there, and missing if the dataset has no such row', () => {
    expect(identifyModel(summary('points', ['Hole']), 3, undefined)).toMatchObject({
      state: 'loading',
      rows: [],
      more: 0,
    });
    expect(
      identifyModel(summary('points', ['Hole']), 3, { start: 3, count: 0, columns: [] }),
    ).toMatchObject({ state: 'missing', rows: [] });
  });

  it('has the attributes of the dataset, in the order of its columns, as the table has them', () => {
    const model = identifyModel(
      summary('points', ['Hole', 'Au_ppm', 'Rock', 'Sampled']),
      0,
      page({ Rock: 'granite', Sampled: true, Au_ppm: 0.1 + 0.2, Hole: 'DH001' }),
    );
    expect(model.state).toBe('ready');
    expect(model.rows).toEqual([
      { name: 'Hole', value: 'DH001', isNull: false, numeric: false },
      { name: 'Au_ppm', value: '0.3', isNull: false, numeric: true },
      { name: 'Rock', value: 'granite', isNull: false, numeric: false },
      { name: 'Sampled', value: 'true', isNull: false, numeric: false },
    ]);
    expect(model.more).toBe(0);
  });

  it('says null for a value that is not there, and does not set it as a number', () => {
    const model = identifyModel(
      summary('points', ['Au_ppm', 'Hole']),
      0,
      page({ Au_ppm: null, Hole: 'DH001' }),
    );
    expect(model.rows[0]).toEqual({ name: 'Au_ppm', value: 'null', isNull: true, numeric: false });
  });

  it('does not set a null as a number, even in a column of numbers', () => {
    const numbers = {
      name: 'Au_ppm',
      values: Float64Array.of(0),
      nulls: Uint8Array.of(1),
    };
    const model = identifyModel(summary('points', ['Au_ppm']), 0, {
      start: 0,
      count: 1,
      columns: [numbers],
    });
    expect(model.rows).toEqual([{ name: 'Au_ppm', value: 'null', isNull: true, numeric: false }]);
  });

  it('leaves out the columns that say what the row is (the position of a point), which are not attributes', () => {
    const position = [
      { name: 'X', values: Float64Array.of(500010.5), nulls: Uint8Array.of(0) },
      { name: 'Y', values: Float64Array.of(2765020.25), nulls: Uint8Array.of(0) },
    ];
    const model = identifyModel(summary('points', ['Hole']), 0, page({ Hole: 'DH001' }, position));
    expect(model.rows.map((row) => row.name)).toEqual(['Hole']);
  });

  it('says the attribute that has the name of a column that says what the row is, and not that column: an attribute called Z beside the Z of a point', () => {
    const position = [
      { name: 'X', values: Float64Array.of(500010.5), nulls: Uint8Array.of(0) },
      { name: 'Y', values: Float64Array.of(2765020.25), nulls: Uint8Array.of(0) },
      { name: 'Z', values: Float64Array.of(115), nulls: Uint8Array.of(0) },
    ];
    const model = identifyModel(
      summary('points', ['Z', 'Hole']),
      0,
      page({ Z: 7, Hole: 'DH001' }, position),
    );
    expect(model.rows.map((row) => [row.name, row.value])).toEqual([
      ['Z', '7'],
      ['Hole', 'DH001'],
    ]);
  });

  it('shows at most 8 attributes and says how many more there are', () => {
    const names = Array.from({ length: 11 }, (_, i) => `c${String(i)}`);
    const model = identifyModel(
      summary('grid', names),
      5,
      page(Object.fromEntries(names.map((name, i) => [name, i]))),
    );
    expect(IDENTIFY_ROWS).toBe(8);
    expect(model.rows.map((row) => row.name)).toEqual(names.slice(0, 8));
    expect(model.more).toBe(3);
    const exactly = identifyModel(
      summary('grid', names.slice(0, 8)),
      5,
      page(Object.fromEntries(names.slice(0, 8).map((name, i) => [name, i]))),
    );
    expect(exactly.rows).toHaveLength(8);
    expect(exactly.more).toBe(0);
  });

  it('has no attributes for a dataset that has none, which is not an error', () => {
    expect(identifyModel(summary('mesh', []), 0, page({}))).toMatchObject({
      state: 'ready',
      rows: [],
      more: 0,
    });
  });

  it('says the attributes of contour lines: the level, and whether the line is an index line', () => {
    const lines = summary('lines', ['level', 'index'], { name: 'Contours of Cone (every 2.5)' });
    const model = identifyModel(lines, 11, page({ level: 12.5, index: true }));
    expect(model.caption).toBe('Line 12');
    expect(model.rows).toEqual([
      { name: 'level', value: '12.5', isNull: false, numeric: true },
      { name: 'index', value: 'true', isNull: false, numeric: false },
    ]);
  });

  it('skips a column that the page does not have rather than making up a value', () => {
    const model = identifyModel(summary('points', ['Hole', 'Gone']), 0, page({ Hole: 'DH001' }));
    expect(model.rows.map((row) => row.name)).toEqual(['Hole']);
  });
});
