import { describe, expect, it } from 'vitest';
import {
  exportLayout,
  type ExportLayout,
  type PlacedLine,
  type Rect,
  type Size,
} from './export-layout.js';
import type { ExportLine } from './export-lines.js';

const swatch = { kind: 'colour', colour: '#e69f00' } as const;
const group = (name: string): ExportLine => ({ kind: 'group', id: name, name });
const layer = (name: string, hasClasses = false): ExportLine => ({
  kind: 'layer',
  id: name,
  name,
  swatch,
  hasClasses,
  indented: false,
});
const klass = (label: string): ExportLine => ({
  kind: 'class',
  layerId: 'x',
  entry: { label, count: 1, countLabel: '1', colour: '#000000' },
  indented: false,
});

/** A fake measure: a group is 30 high, a layer 40, a class 20, and a line is 8 wide for each letter of its text. */
function measure(line: ExportLine): Size {
  if (line.kind === 'group') {
    return { width: line.name.length * 8, height: 30 };
  }
  return line.kind === 'layer'
    ? { width: line.name.length * 8, height: 40 }
    : { width: line.entry.label.length * 8, height: 20 };
}

function layout(
  lines: ExportLine[],
  width = 1200,
  height = 800,
  dpi = 96,
  scaleBar: Size | null = null,
  m = measure,
): ExportLayout {
  return exportLayout({ size: { width, height }, dpi, lines, measure: m, scaleBar });
}

const names = (placed: readonly PlacedLine[]): string[] =>
  placed.map((p) =>
    p.line.kind === 'group'
      ? `G:${p.line.name}`
      : p.line.kind === 'layer'
        ? `L:${p.line.name}`
        : `C:${p.line.entry.label}`,
  );

describe('exportLayout: the map, its furniture and one column', () => {
  const lines = [layer('Topography'), layer('Assays')];

  it('has a margin of 24, the map on the left, and the legend 24 from it with the same top', () => {
    const l = layout(lines, 1200, 800, 96, { width: 100, height: 24 });
    expect(l.scale).toBe(1);
    // The column is 200 wide (the widest line is 80), so the map is what is left: 1200 - 48 - 24 - 200.
    expect(l.map).toEqual({ x: 24, y: 24, width: 928, height: 752 });
    expect(l.columns).toHaveLength(1);
    expect(l.legend).toEqual({ x: 976, y: 24, width: 200, height: 80 });
    expect(l.columns[0]?.rect).toEqual({ x: 976, y: 24, width: 200, height: 80 });
    expect(l.legend?.y).toBe(l.map.y);
    expect(l.legend && l.legend.x + l.legend.width).toBe(1200 - 24);
  });

  it('puts the north arrow at the top right of the map and the scale bar at the bottom left, 16 in', () => {
    const l = layout(lines, 1200, 800, 96, { width: 100, height: 24 });
    expect(l.northArrow).toEqual({ x: 24 + 928 - 16 - 40, y: 24 + 16, width: 40, height: 40 });
    expect(l.scaleBar).toEqual({ x: 24 + 16, y: 24 + 752 - 16 - 24, width: 100, height: 24 });
  });

  it('has no scale bar when there is none, and no legend and a map the whole width when there is nothing to list', () => {
    const l = layout([], 1200, 800);
    expect(l.scaleBar).toBeNull();
    expect(l.columns).toEqual([]);
    expect(l.legend).toBeNull();
    expect(l.map).toEqual({ x: 24, y: 24, width: 1152, height: 752 });
    expect(l.warnings).toEqual([]);
    expect(l.northArrow).toEqual({ x: 24 + 1152 - 16 - 40, y: 40, width: 40, height: 40 });
  });

  it('stacks the lines in the column, top to bottom, each as wide as the column and as high as it was measured', () => {
    const l = layout([layer('A'), klass('0 – 10'), klass('10 – 20'), layer('B')]);
    const placed = l.columns[0]?.lines ?? [];
    expect(placed.map((p) => [p.rect.y, p.rect.height])).toEqual([
      [24, 40],
      [64, 20],
      [84, 20],
      [104, 40],
    ]);
    expect(new Set(placed.map((p) => p.rect.width))).toEqual(new Set([200]));
    expect(new Set(placed.map((p) => p.rect.x))).toEqual(new Set([976]));
    expect(l.columns[0]?.rect.height).toBe(120);
  });
});

describe('exportLayout: the width of a column', () => {
  const wide = (letters: number): ExportLine[] => [layer('x'.repeat(letters))];

  it('is the widest line, but not under 200 nor over 320', () => {
    expect(layout(wide(10)).columns[0]?.rect.width).toBe(200);
    expect(layout(wide(25)).columns[0]?.rect.width).toBe(200);
    expect(layout(wide(30)).columns[0]?.rect.width).toBe(240);
    expect(layout(wide(40)).columns[0]?.rect.width).toBe(320);
    expect(layout(wide(100)).columns[0]?.rect.width).toBe(320);
  });

  it('is the same for every column: the widest line of the whole legend', () => {
    const many = [
      layer('x'.repeat(30)),
      ...Array.from({ length: 30 }, (_, i) => layer(`n${String(i)}`)),
    ];
    const l = layout(many, 2000, 400);
    expect(l.columns.length).toBeGreaterThan(1);
    expect(new Set(l.columns.map((c) => c.rect.width))).toEqual(new Set([240]));
  });

  it('gives a line that is wider than the column the width of the column, and no more: it is drawn within its rectangle', () => {
    // The brief clamps the column to 320 and says nothing of a line that is wider: the layout never puts a rectangle
    // across the next column, and the export draws the text of such a line cut short within its rectangle.
    const l = layout([layer('A'), layer('B'), layer('C')], 3000, 100, 96, null, () => ({
      width: 500,
      height: 40,
    }));
    expect(l.columns.length).toBeGreaterThan(1);
    expect(new Set(l.columns.flatMap((c) => c.lines.map((p) => p.rect.width)))).toEqual(
      new Set([320]),
    );
    for (const [index, column] of l.columns.entries()) {
      const next = l.columns[index + 1];
      if (next !== undefined) {
        expect(column.rect.x + column.rect.width).toBeLessThan(next.rect.x);
      }
    }
  });

  it('rounds the size of a line up to a whole pixel', () => {
    const l = layout([layer('A')], 1200, 800, 96, { width: 10.2, height: 5.1 }, () => ({
      width: 249.2,
      height: 40.1,
    }));
    expect(l.columns[0]?.rect.width).toBe(250);
    expect(l.columns[0]?.lines[0]?.rect.height).toBe(41);
    expect(l.scaleBar).toMatchObject({ width: 11, height: 6 });
  });
});

describe('exportLayout: several columns', () => {
  it('continues in a column to the right when the lines do not fit in the height between the margins', () => {
    // 300 high leaves 252 between the margins: two lines of 100 fit in a column, and a third does not.
    const five = Array.from({ length: 5 }, (_, i) => layer(`L${String(i)}`));
    const tall = (): Size => ({ width: 50, height: 100 });
    const l = layout(five, 1200, 300, 96, null, tall);
    expect(l.columns.map((c) => c.lines.length)).toEqual([2, 2, 1]);
    // Three columns of 200 with 16 between them are 632 wide; the map has what is left.
    expect(l.legend).toEqual({ x: 1200 - 24 - 632, y: 24, width: 632, height: 200 });
    expect(l.columns.map((c) => c.rect.x)).toEqual([544, 760, 976]);
    expect(l.map.width).toBe(1200 - 48 - 24 - 632);
    expect(l.columns.map((c) => c.rect.y)).toEqual([24, 24, 24]);
  });

  it('keeps the lines in order, column after column', () => {
    const l = layout([layer('A'), layer('B'), layer('C'), layer('D')], 1200, 150);
    // 102 between the margins: two layers of 40 fit.
    expect(l.columns.map((c) => names(c.lines))).toEqual([
      ['L:A', 'L:B'],
      ['L:C', 'L:D'],
    ]);
  });

  it('does not make an empty column of what is before a first line that is taller than a column', () => {
    const l = layout([layer('tall')], 1200, 100, 96, null, () => ({ width: 50, height: 400 }));
    expect(l.columns.map((c) => names(c.lines))).toEqual([['L:tall']]);
  });

  it('gives a line that is taller than a column a column of its own, which runs past the margin', () => {
    const l = layout([layer('A'), layer('tall'), layer('B')], 1200, 300, 96, null, (line) => ({
      width: 50,
      height: line.kind === 'layer' && line.name === 'tall' ? 400 : 40,
    }));
    expect(l.columns.map((c) => names(c.lines))).toEqual([['L:A'], ['L:tall'], ['L:B']]);
    expect(l.columns[1]?.rect.height).toBe(400);
  });
});

describe('exportLayout: a heading is never the last line of a column', () => {
  it('moves a group heading that would end a column to the next one, with what follows it', () => {
    // 100 between the margins (the picture is 148 high): the layer is 40, the heading 30, and the next layer would be 110.
    const l = layout([layer('A'), group('Survey'), layer('B')], 1200, 148);
    expect(l.columns.map((c) => names(c.lines))).toEqual([['L:A'], ['G:Survey', 'L:B']]);
    expect(l.columns[1]?.lines[0]?.rect).toMatchObject({ y: 24, height: 30 });
  });

  it('leaves a group heading where it is when what follows it fits', () => {
    const l = layout([layer('A'), group('Survey'), layer('B')], 1200, 148 + 10);
    expect(l.columns.map((c) => names(c.lines))).toEqual([['L:A', 'G:Survey', 'L:B']]);
  });

  it('keeps a layer with the lines of its classes: its name is not left at the end of a column', () => {
    // 90 between the margins (138 - 48): A (40) and Grade (40) fit, and its first class (20) does not.
    const l = layout(
      [layer('A'), layer('Grade', true), klass('0 \u2013 10'), klass('10 \u2013 20')],
      1200,
      138,
    );
    expect(l.columns.map((c) => names(c.lines))).toEqual([
      ['L:A'],
      ['L:Grade', 'C:0 \u2013 10', 'C:10 \u2013 20'],
    ]);
    // With room for the first class the name stays, and only the second class goes on.
    const roomy = layout(
      [layer('A'), layer('Grade', true), klass('0 \u2013 10'), klass('10 \u2013 20')],
      1200,
      158,
    );
    expect(roomy.columns.map((c) => names(c.lines))).toEqual([
      ['L:A', 'L:Grade', 'C:0 \u2013 10'],
      ['C:10 \u2013 20'],
    ]);
  });

  it('moves a group heading and the layer under it together, when both would end a column', () => {
    // 100 between the margins: A 40, heading 30, Grade 30 make 100, and the class does not fit.
    const lines = [layer('A'), group('Survey'), layer('Grade', true), klass('0 – 10')];
    const l = layout(lines, 1200, 148, 96, null, (line) =>
      line.kind === 'layer' && line.name === 'Grade' ? { width: 50, height: 30 } : measure(line),
    );
    expect(l.columns.map((c) => names(c.lines))).toEqual([
      ['L:A'],
      ['G:Survey', 'L:Grade', 'C:0 – 10'],
    ]);
  });

  it('does not move a heading that would be too tall, with what follows it, for a column of its own: it stays', () => {
    // Found by the review of the milestone: A (10) and the name of Grade (54) fill a column, and the first class (40) does not
    // fit. Moving the name takes it to the next column, where it and the class (94) are taller than the 73 there is.
    const heights: Record<string, number> = { A: 10, Grade: 54, '0 \u2013 10': 40 };
    const lines = [layer('A'), layer('Grade', true), klass('0 \u2013 10')];
    const l = layout(lines, 1012, 149, 150, null, (line) => ({
      width: 50,
      height:
        heights[
          line.kind === 'class' ? line.entry.label : line.kind === 'layer' ? line.name : ''
        ] ?? 0,
    }));
    expect(l.map.height).toBe(73);
    expect(l.columns.map((c) => names(c.lines))).toEqual([['L:A', 'L:Grade'], ['C:0 \u2013 10']]);
    expect(l.columns.map((c) => c.rect.height)).toEqual([64, 40]);
  });

  it('cannot move a heading that is alone in its column, and does not loop for ever', () => {
    const lines = [group('Survey'), layer('tall')];
    const l = layout(lines, 1200, 148, 96, null, (line) =>
      line.kind === 'layer' ? { width: 50, height: 400 } : measure(line),
    );
    expect(l.columns.map((c) => names(c.lines))).toEqual([['G:Survey'], ['L:tall']]);
  });
});

describe('exportLayout: the size of the picture', () => {
  it('multiplies every length of the brief by dpi / 96: at 192 they are double', () => {
    const l = layout([layer('Topography')], 2400, 1600, 192, { width: 200, height: 48 });
    expect(l.scale).toBe(2);
    expect(l.map).toMatchObject({ x: 48, y: 48 });
    expect(l.columns[0]?.rect.width).toBe(400);
    expect(l.northArrow).toMatchObject({ width: 80, height: 80, y: 48 + 32 });
    expect(l.legend?.x).toBe(2400 - 48 - 400);
    expect(l.map.width).toBe(2400 - 96 - 48 - 400);
  });

  it('gives whole pixels at 300 dpi, where a length of a screen is a fraction of a pixel', () => {
    const l = layout([layer('A')], 3508, 2480, 300, { width: 400, height: 75 });
    expect(l.scale).toBe(3.125);
    expect(l.map.x).toBe(75);
    expect(l.northArrow).toMatchObject({ width: 125 });
    expect(l.columns[0]?.rect.width).toBe(625);
    const odd = layout([layer('A')], 1000, 800, 150, null);
    for (const value of [
      odd.map.x,
      odd.map.y,
      odd.map.width,
      odd.map.height,
      odd.northArrow.x,
      odd.northArrow.y,
      odd.northArrow.width,
    ]) {
      expect(Number.isInteger(value), String(value)).toBe(true);
    }
  });

  it('is a mistake to give a picture or a dpi that is not above 0', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => layout([], bad, 800)).toThrow(RangeError);
      expect(() => layout([], 1200, bad)).toThrow(RangeError);
      expect(() => layout([], 1200, 800, bad)).toThrow(RangeError);
    }
  });
});

describe('exportLayout: warnings', () => {
  const lines = Array.from({ length: 5 }, (_, i) => layer(`L${String(i)}`));
  const tall = (): Size => ({ width: 50, height: 100 });

  it('warns that the map is narrow when it gets less than half the width of the picture', () => {
    // Three columns of 200 with gaps are 632; in a picture 1,000 wide the map is 1000 - 48 - 24 - 632 = 296.
    const l = layout(lines, 1000, 300, 96, null, tall);
    expect(l.map.width).toBe(296);
    expect(l.warnings).toEqual(['map_narrow']);
  });

  it('does not warn when the map has exactly half, or more', () => {
    // One column of 200 leaves a map of the width of the picture less 272.
    const widths = (width: number): [number, ExportLayout['warnings']] => {
      const l = layout([layer('A')], width, 800);
      return [l.map.width, l.warnings];
    };
    expect(widths(1000)).toEqual([728, []]);
    expect(widths(560)).toEqual([288, []]);
    expect(widths(548)).toEqual([276, []]);
    // Exactly half is not less than half.
    expect(widths(544)).toEqual([272, []]);
    expect(widths(543)).toEqual([271, ['map_narrow']]);
    expect(widths(500)).toEqual([228, ['map_narrow']]);
  });

  it('says there is no room for a map when it has no width at all, and not that it is narrow', () => {
    // One column of 200 and the margins and the gap are 272: a picture that wide leaves nothing.
    const l = layout([layer('A')], 272, 800);
    expect([l.map.width, l.warnings]).toEqual([0, ['no_room_for_map']]);
    expect(layout([layer('A')], 273, 800).warnings).toEqual(['map_narrow']);
  });

  it('says so when the legend leaves no room for a map at all, and the map has no width', () => {
    const l = layout(lines, 500, 300, 96, null, tall);
    expect(l.map.width).toBe(0);
    expect(l.warnings).toEqual(['no_room_for_map']);
  });

  it('has no warning for a picture with no legend', () => {
    expect(layout([], 100, 100).warnings).toEqual([]);
  });
});

describe('exportLayout: for any legend and picture', () => {
  it('keeps each column inside the margins, the columns apart, and every line inside its column', () => {
    let state = 9;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const kinds = ['group', 'layer', 'layerc', 'class'] as const;
    for (let run = 0; run < 400; run += 1) {
      const lines: ExportLine[] = Array.from({ length: Math.floor(next() * 60) }, (_, i) => {
        const kind = kinds[Math.floor(next() * kinds.length)];
        const name = `n${String(i)}${'x'.repeat(Math.floor(next() * 40))}`;
        return kind === 'group'
          ? group(name)
          : kind === 'class'
            ? klass(name)
            : layer(name, kind === 'layerc');
      });
      // Pictures that are low as well as high, so that columns are short and lines are moved often.
      const size = { width: 800 + next() * 3000, height: 90 + next() * 900 };
      const dpi = 72 + next() * 300;
      const l = exportLayout({
        size,
        dpi,
        lines,
        measure: () => ({ width: next() * 400, height: 10 + next() * 60 }),
        scaleBar: null,
      });
      const margin = Math.round(24 * (dpi / 96));
      const inside = (r: Rect, outer: Rect): boolean =>
        r.x >= outer.x &&
        r.y >= outer.y &&
        r.x + r.width <= outer.x + outer.width &&
        r.y + r.height <= outer.y + outer.height;
      expect(l.columns.flatMap((c) => c.lines).map((p) => p.line)).toEqual(lines);
      for (const [index, column] of l.columns.entries()) {
        expect(column.rect.x + column.rect.width, `run ${String(run)}`).toBeLessThanOrEqual(
          size.width - margin + (l.map.width === 0 ? Infinity : 0),
        );
        const previous = l.columns[index - 1];
        if (previous !== undefined) {
          expect(column.rect.x).toBeGreaterThan(previous.rect.x + previous.rect.width - 1);
        }
        for (const placed of column.lines) {
          expect(
            inside(placed.rect, {
              x: column.rect.x,
              y: column.rect.y,
              width: column.rect.width,
              height: column.rect.height,
            }),
          ).toBe(true);
        }
        // Lines are one under the other with nothing between them.
        column.lines.reduce((y, placed) => {
          expect(placed.rect.y).toBe(y);
          return y + placed.rect.height;
        }, column.rect.y);
      }
      // No column but one with a single line that is too tall goes beyond the bottom margin.
      for (const column of l.columns) {
        if (column.lines.length > 1) {
          expect(column.rect.y + column.rect.height).toBeLessThanOrEqual(size.height - margin);
        }
      }
    }
  });
});
