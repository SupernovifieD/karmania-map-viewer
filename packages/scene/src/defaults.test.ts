import type { ColumnSummary, Kind } from '@karmania/engine/types';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLASSES,
  LAYER_COLOURS,
  defaultStyle,
  firstNumericColumn,
  layerColour,
  type DatasetBrief,
} from './defaults.js';
import { problemsAfter } from './test-support/documents.js';

const column = (name: string, type: ColumnSummary['type'], nullCount = 0): ColumnSummary => ({
  name,
  type,
  nullCount,
});

function brief(
  kind: Kind,
  columns: readonly ColumnSummary[] = [],
  elementCount = 10,
): DatasetBrief {
  return { kind, elementCount, columns };
}

describe('the colour of a new layer', () => {
  it('is the next of the eight of the palette, in order, and the first again after the eighth', () => {
    expect(LAYER_COLOURS).toEqual([
      '#e69f00',
      '#56b4e9',
      '#009e73',
      '#d55e00',
      '#0072b2',
      '#cc79a7',
      '#f0e442',
      '#000000',
    ]);
    expect([0, 1, 2, 7, 8, 9, 16].map(layerColour)).toEqual([
      '#e69f00',
      '#56b4e9',
      '#009e73',
      '#000000',
      '#e69f00',
      '#56b4e9',
      '#e69f00',
    ]);
  });

  it('is a mistake to ask for the colour of a layer before the first', () => {
    expect(() => layerColour(-1)).toThrow(RangeError);
    expect(() => layerColour(NaN)).toThrow(RangeError);
  });
});

describe('the first numeric column', () => {
  it('is the first of whole or decimal numbers that has a value, whatever comes before it', () => {
    const cols = [
      column('rock', 'text'),
      column('ok', 'bool'),
      column('zone', 'category'),
      column('grade', 'float'),
      column('n', 'int'),
    ];
    expect(firstNumericColumn(brief('grid', cols))).toBe('grade');
    expect(firstNumericColumn(brief('grid', [column('n', 'int'), column('grade', 'float')]))).toBe(
      'n',
    );
  });

  it('passes over a column of numbers that has no value at all, and has none if there is no other', () => {
    expect(
      firstNumericColumn(
        brief('grid', [column('empty', 'float', 10), column('grade', 'float', 9)]),
      ),
    ).toBe('grade');
    expect(firstNumericColumn(brief('grid', [column('empty', 'float', 10)]))).toBeUndefined();
    expect(firstNumericColumn(brief('grid', [column('rock', 'text')]))).toBeUndefined();
    expect(firstNumericColumn(brief('grid'))).toBeUndefined();
  });
});

describe('the style of a new layer', () => {
  it('is a single colour for points, 6 px wide, solid', () => {
    expect(defaultStyle(brief('points', [column('grade', 'float')]), 0)).toEqual({
      colour: { mode: 'single', value: '#e69f00' },
      opacity: 1,
      pointSize: 6,
    });
  });

  it('is a single colour for lines, 2 px wide, solid', () => {
    expect(defaultStyle(brief('lines'), 1)).toEqual({
      colour: { mode: 'single', value: '#56b4e9' },
      opacity: 1,
      lineWidth: 2,
    });
  });

  it('is a single colour for polygons, at 0.6 so that what is under them shows', () => {
    expect(defaultStyle(brief('polygons'), 2)).toEqual({
      colour: { mode: 'single', value: '#009e73' },
      opacity: 0.6,
    });
  });

  it('is a single colour for meshes, solid, even when they have a column of numbers', () => {
    expect(defaultStyle(brief('mesh', [column('height', 'float')]), 3)).toEqual({
      colour: { mode: 'single', value: '#d55e00' },
      opacity: 1,
    });
  });

  it.each(['grid', 'blocks'] as const)(
    'is the first numeric column in 7 equal classes of viridis for %s',
    (kind) => {
      const style = defaultStyle(
        brief(kind, [column('rock', 'text'), column('grade', 'float')]),
        4,
      );
      expect(style).toEqual({
        colour: {
          mode: 'classes',
          column: 'grade',
          method: 'equal',
          classes: DEFAULT_CLASSES,
          ramp: 'viridis',
          reverse: false,
        },
        opacity: 1,
      });
      expect(DEFAULT_CLASSES).toBe(7);
    },
  );

  it('is the next colour of the palette for a grid or blocks that have no column of numbers', () => {
    expect(defaultStyle(brief('grid', [column('rock', 'text')]), 4).colour).toEqual({
      mode: 'single',
      value: '#0072b2',
    });
    expect(defaultStyle(brief('blocks'), 5).colour).toEqual({ mode: 'single', value: '#cc79a7' });
  });

  it('is the same every time for the same dataset and place in the order', () => {
    const grid = brief('grid', [column('grade', 'float')]);
    expect(defaultStyle(grid, 3)).toEqual(defaultStyle(grid, 3));
  });

  it('is a style that validateScene accepts, for every kind, with and without a column of numbers', () => {
    const kinds: Kind[] = ['points', 'lines', 'polygons', 'mesh', 'grid', 'blocks'];
    for (const kind of kinds) {
      for (const columns of [[], [column('grade', 'float')]]) {
        for (const ordinal of [0, 7, 13]) {
          const style = defaultStyle(brief(kind, columns), ordinal);
          expect(problemsAfter(['layers', 'layer-2', 'style'], style)).toEqual([]);
        }
      }
    }
  });
});
