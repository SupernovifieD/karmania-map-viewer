import { EXPORT_COLOURS, LEGEND_ROW, exportLayout } from '@karmania/scene';
import type { ClassEntry, ExportLine } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import { recording } from './canvas-recording.js';
import { drawLegend, drawLegendLine, fitText, measureLegendLine } from './export-legend.js';

const entry = (label: string, count: number, colour: string | null = '#e69f00'): ClassEntry => ({
  label,
  count,
  countLabel: count.toLocaleString('en-US'),
  colour,
});
const GROUP: ExportLine = { kind: 'group', id: 'g', name: 'Assays' };
const LAYER: ExportLine = {
  kind: 'layer',
  id: 'a',
  name: 'Gold',
  swatch: { kind: 'colour', colour: '#e69f00' },
  hasClasses: true,
  indented: true,
};
const RAMP: ExportLine = {
  kind: 'layer',
  id: 'b',
  name: 'Elevation',
  swatch: { kind: 'ramp', colours: ['#440154', '#21908c', '#fde725'] },
  hasClasses: false,
  indented: false,
};
const CLASS: ExportLine = {
  kind: 'class',
  layerId: 'a',
  entry: entry('10 – 20', 1204),
  indented: true,
};

describe('fitText', () => {
  const { ctx } = recording();
  ctx.font = '10px x';

  it('is the text when it fits, and the start of it with an ellipsis when it does not, as long as fits', () => {
    // A character is 5 pixels wide in the recording.
    expect(fitText(ctx, 'abcdef', 30)).toBe('abcdef');
    expect(fitText(ctx, 'abcdefgh', 30)).toBe('abcde…');
    expect(fitText(ctx, 'abcdefgh', 31)).toBe('abcde…');
    expect(fitText(ctx, 'abcdefgh', 35)).toBe('abcdef…'.slice(0, 7));
  });

  it('is only the ellipsis when not even one letter fits, and never more than the room', () => {
    expect(fitText(ctx, 'abcdefgh', 8)).toBe('…');
    for (const room of [5, 12, 40, 100]) {
      expect(
        ctx.measureText(fitText(ctx, 'a long name that does not fit', room)).width,
      ).toBeLessThanOrEqual(Math.max(room, 5));
    }
  });

  it('does not leave a space before the ellipsis', () => {
    expect(fitText(ctx, 'ab cdefgh', 20)).toBe('ab…');
  });
});

describe('measureLegendLine', () => {
  const { ctx } = recording();

  it('gives the rows of the Legend tab: 32 for a group and a layer, 24 for a class, at the scale of the picture', () => {
    expect(measureLegendLine(ctx, GROUP, 1).height).toBe(LEGEND_ROW.group);
    expect(measureLegendLine(ctx, LAYER, 1).height).toBe(LEGEND_ROW.layer);
    expect(measureLegendLine(ctx, CLASS, 1).height).toBe(LEGEND_ROW.class);
    expect(measureLegendLine(ctx, LAYER, 3.125).height).toBe(100);
    expect(measureLegendLine(ctx, CLASS, 3.125).height).toBe(75);
  });

  it('is as wide as what is in the row: the indent, the room of the swatch, a gap and the name for a layer', () => {
    // "Gold" is 4 characters of half the 14 pixel font: 28. In a group (24 in), a room of 24 for the swatch, a gap of 8.
    expect(measureLegendLine(ctx, LAYER, 1).width).toBe(24 + 24 + 8 + 28);
    // Not in a group: no indent.
    expect(measureLegendLine(ctx, { ...LAYER, indented: false }, 1).width).toBe(24 + 8 + 28);
    // A group is its name alone, in the medium weight ("Assays": 6 characters).
    expect(measureLegendLine(ctx, GROUP, 1).width).toBe(42);
  });

  it('is as wide as the label, the count and the space between them for a class, which starts under the name of its layer', () => {
    // 24 (indent) + 24 + 8 (to the name), 12 for the swatch, 8, "10 – 20" (7 characters of 6.5: 46, rounded up), 16, "1,204" (5 of 6.5: 33, rounded up).
    expect(measureLegendLine(ctx, CLASS, 1).width).toBe(24 + 24 + 8 + 12 + 8 + 46 + 16 + 33);
  });
});

describe('drawLegendLine', () => {
  it('draws a layer’s swatch with the border colour round it, and its name after the room of the swatch in the text colour', () => {
    const { ctx, log } = recording();
    drawLegendLine(ctx, { line: LAYER, rect: { x: 1000, y: 100, width: 240, height: 32 } }, 1);
    // In a group: 24 in. The swatch is 16 by 16 in the middle of the row (100 + 16 - 8 = 108).
    expect(log).toContain('roundRect(1024, 108, 16, 16, 4)');
    expect(log).toContain('fillStyle = #e69f00');
    expect(log).toContain('fillRect(1024, 108, 16, 16)');
    expect(log).toContain(`strokeStyle = ${EXPORT_COLOURS.border}`);
    expect(log).toContain('roundRect(1024.5, 108.5, 15, 15, 3.5)');
    // The name starts 24 + 8 after that: 1024 + 32.
    expect(log).toContain('fillText(Gold, 1056, 116)');
    expect(log).toContain(`fillStyle = ${EXPORT_COLOURS.text}`);
    expect(log[0]).toBe('save()');
    expect(log.at(-1)).toBe('restore()');
  });

  it('draws a ramp as stripes of one width, 24 by 12, with hard edges on whole pixels', () => {
    const { ctx, log } = recording();
    drawLegendLine(ctx, { line: RAMP, rect: { x: 1000, y: 100, width: 240, height: 32 } }, 1);
    expect(log).toContain('roundRect(1000, 110, 24, 12, 4)');
    expect(log).toContain('fillStyle = #440154');
    expect(log).toContain('fillRect(1000, 110, 8, 12)');
    expect(log).toContain('fillRect(1008, 110, 8, 12)');
    expect(log).toContain('fillRect(1016, 110, 8, 12)');
    expect(log).toContain('fillStyle = #fde725');
  });

  it('puts the edges of the stripes of a ramp that does not divide into whole pixels on the nearest pixel, with no gap and no overlap', () => {
    const { ctx, log } = recording();
    const five: ExportLine = {
      ...RAMP,
      swatch: { kind: 'ramp', colours: ['#000001', '#000002', '#000003', '#000004', '#000005'] },
    };
    drawLegendLine(ctx, { line: five, rect: { x: 1000, y: 100, width: 240, height: 32 } }, 1);
    // 24 wide in 5 stripes: the edges are at 4.8, 9.6, 14.4 and 19.2, which are the pixels 5, 10, 14 and 19.
    const stripes = log
      .filter((line) => line.startsWith('fillRect('))
      .map((line) => /fillRect\((\d+), \d+, (\d+),/.exec(line)?.slice(1).map(Number));
    expect(stripes).toEqual([
      [1000, 5],
      [1005, 5],
      [1010, 4],
      [1014, 5],
      [1019, 5],
    ]);
  });

  it('draws a class under the name of its layer, with its count at the right edge of the column in the muted colour, right-aligned', () => {
    const { ctx, log } = recording();
    drawLegendLine(ctx, { line: CLASS, rect: { x: 1000, y: 200, width: 240, height: 24 } }, 1);
    // The swatch (12) is where the name of the layer starts: 1000 + 24 + 24 + 8; the label 8 after it.
    expect(log).toContain('roundRect(1056, 206, 12, 12, 4)');
    expect(log).toContain('fillText(10 – 20, 1076, 212)');
    expect(log).toContain('textAlign = right');
    expect(log).toContain('fillText(1,204, 1240, 212)');
    expect(log.indexOf(`fillStyle = ${EXPORT_COLOURS.muted}`)).toBeLessThan(
      log.indexOf('fillText(1,204, 1240, 212)'),
    );
  });

  it('cuts the label of a class so that it, a gap and the count fit in the column, and the count is whole', () => {
    const { ctx, log } = recording();
    const long: ExportLine = {
      ...CLASS,
      entry: entry('A category name that is much too long to fit', 1204),
    };
    drawLegendLine(ctx, { line: long, rect: { x: 0, y: 0, width: 200, height: 24 } }, 1);
    const label = log.find((line) => line.startsWith('fillText(') && line.includes('…'));
    expect(label).toBeDefined();
    const [text, x] = /fillText\((.*), (\d+), \d+\)/.exec(label ?? '')?.slice(1) ?? [];
    // The label starts at 24 + 24 + 8 + 12 + 8 = 76 and ends 16 before the count ("1,204": 33 wide at the right edge, 200): at most 200 - 33 - 16 = 151.
    expect(Number(x) + String(text).length * 6.5).toBeLessThanOrEqual(151);
    expect(log).toContain('fillText(1,204, 200, 12)');
  });

  it('draws a class that has no value as an empty swatch: the border and no fill', () => {
    const { ctx, log } = recording();
    drawLegendLine(
      ctx,
      {
        line: { ...CLASS, entry: entry('No value', 3, null) },
        rect: { x: 0, y: 0, width: 240, height: 24 },
      },
      1,
    );
    expect(log.some((line) => line.startsWith('fillRect('))).toBe(false);
    expect(log.filter((line) => line.startsWith('stroke('))).toHaveLength(1);
  });

  it('cuts a name that is longer than its room, so that it never goes into the next column', () => {
    const { ctx, log } = recording();
    const long = {
      ...RAMP,
      name: 'A very long name of a layer that has no room in its column at all',
    };
    drawLegendLine(ctx, { line: long, rect: { x: 0, y: 0, width: 200, height: 32 } }, 1);
    const text = log.find((line) => line.startsWith('fillText('));
    expect(text).toMatch(/…, /);
    // The name starts at 32 and has 168 to the right edge: 24 characters of 7.
    expect(text?.split(',')[0]?.length).toBeLessThanOrEqual('fillText('.length + 24);
  });

  it('is a group’s name alone, in the medium weight, at the left of the column', () => {
    const { ctx, log } = recording();
    drawLegendLine(ctx, { line: GROUP, rect: { x: 1000, y: 100, width: 240, height: 32 } }, 1);
    expect(log.some((line) => line.startsWith('font = 500 14px'))).toBe(true);
    expect(log).toContain('fillText(Assays, 1000, 116)');
  });

  it('scales the swatch, the room and the text with the picture, in whole pixels', () => {
    const { ctx, log } = recording();
    drawLegendLine(ctx, { line: RAMP, rect: { x: 0, y: 0, width: 750, height: 100 } }, 3.125);
    // 24 and 12 at 3.125 are 75 and 38 (37.5 rounded): in the middle of 100.
    expect(log).toContain('roundRect(0, 31, 75, 38, 13)');
    expect(log.some((line) => line.startsWith('font = 400 44px'))).toBe(true);
  });
});

describe('drawLegend', () => {
  it('draws every line in the column and the place the layout gave it, in order', () => {
    const lines: ExportLine[] = [GROUP, LAYER, CLASS, RAMP];
    const { ctx, log } = recording();
    const layout = exportLayout({
      size: { width: 1000, height: 600 },
      dpi: 96,
      lines,
      measure: (line) => measureLegendLine(ctx, line, 1),
      scaleBar: null,
    });
    log.length = 0;
    drawLegend(ctx, layout, 1);
    const texts = log.filter((line) => line.startsWith('fillText('));
    expect(texts.map((line) => line.split(',')[0])).toEqual([
      'fillText(Assays',
      'fillText(Gold',
      'fillText(10 – 20',
      'fillText(1',
      'fillText(Elevation',
    ]);
    // Each line is below the one before it by the height of that one and half of its own: rows of 32, 32, 24 and 32, the text in the middle of each.
    const ys = texts.map((line) => Number(line.split(', ').at(-1)?.replace(')', '')));
    const [group, layer, label, count, ramp] = ys;
    expect([layer, label, count, ramp].map((y, k) => (y ?? 0) - (ys[k] ?? 0))).toEqual([
      32, 28, 0, 28,
    ]);
    expect(group).toBe(layout.legend?.y === undefined ? undefined : layout.legend.y + 16);
  });

  it('draws nothing for no lines', () => {
    const { ctx, log } = recording();
    const layout = exportLayout({
      size: { width: 1000, height: 600 },
      dpi: 96,
      lines: [],
      measure: () => ({ width: 0, height: 0 }),
      scaleBar: null,
    });
    drawLegend(ctx, layout, 1);
    expect(log).toEqual([]);
  });
});
