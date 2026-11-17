import { EXPORT_COLOURS } from '@karmania/scene';
import type { ScaleBar } from '@karmania/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recording } from './canvas-recording.js';
import { drawNorthArrow, drawScaleBar, measureScaleBar } from './export-furniture.js';

/** A `Path2D` that remembers the path data it was made from: there is none in the unit tests. */
class FakePath {
  readonly d: string;
  constructor(d: string) {
    this.d = d;
  }
}

beforeEach(() => {
  vi.stubGlobal('Path2D', FakePath);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const BAR: ScaleBar = {
  kind: 'bar',
  value: 200,
  unit: 'm',
  label: '200 m',
  widthPx: 112.4,
  mapUnits: 200,
};

describe('drawNorthArrow', () => {
  it('draws the box of the screen’s button and the three paths of its needle, turned about the middle by the angle, in the light colours', () => {
    const { ctx, log } = recording();
    drawNorthArrow(ctx, { x: 100, y: 50, width: 125, height: 125 }, 30, 3.125);
    // The box: a raised fill and a line of 3 pixels (1 at the screen's size, 3.125 rounded) just inside the rectangle, corners of 8 times the scale.
    expect(log).toContain('roundRect(101.5, 51.5, 122, 122, 23.5)');
    expect(log).toContain(`fillStyle = ${EXPORT_COLOURS.raised}`);
    expect(log).toContain(`strokeStyle = ${EXPORT_COLOURS.border}`);
    expect(log).toContain('lineWidth = 3');
    // The needle: the box of 40 is the rectangle, and it turns about 20, 20 (30 degrees is 0.524 radians).
    const at = (line: string): number => log.indexOf(line);
    expect(log).toContain('translate(100, 50)');
    expect(log).toContain('scale(3.125, 3.125)');
    expect(at('translate(20, 20)')).toBeLessThan(at('rotate(0.524)'));
    expect(at('rotate(0.524)')).toBeLessThan(at('translate(-20, -20)'));
    // The letter and the tail are strokes, the head is a fill in the accent colour, each with its own colour.
    expect(log.filter((line) => line === 'lineWidth = 1.5')).toHaveLength(1);
    expect(log).toContain(`strokeStyle = ${EXPORT_COLOURS.text}`);
    expect(log).toContain(`fillStyle = ${EXPORT_COLOURS.accent}`);
    expect(log).toContain(`strokeStyle = ${EXPORT_COLOURS.muted}`);
    expect(log.filter((line) => line === 'stroke([path])')).toHaveLength(2);
    expect(log.filter((line) => line === 'fill([path])')).toHaveLength(1);
    // And nothing it set is left set for what is drawn next.
    expect(log[0]).toBe('save()');
    expect(log.at(-1)).toBe('restore()');
  });

  it('turns the needle the other way for the other angle, and not at all for north up', () => {
    const turn = (angle: number): string | undefined => {
      const { ctx, log } = recording();
      drawNorthArrow(ctx, { x: 0, y: 0, width: 40, height: 40 }, angle, 1);
      return log.find((line) => line.startsWith('rotate('));
    };
    expect(turn(0)).toBe('rotate(0)');
    expect(turn(-90)).toBe('rotate(-1.571)');
    expect(turn(180)).toBe('rotate(3.142)');
  });
});

describe('measureScaleBar and drawScaleBar', () => {
  it('measure the box as the screen has it: the line, the padding, the bar, a gap and the label, 24 high, at the scale of the picture', () => {
    const { ctx } = recording();
    // At 96 dpi: a line of 1 each side, 8 of padding each side, the bar (112 whole pixels), 8, and the label ("200 m", 5 characters of half the 12 pixel font each).
    expect(measureScaleBar(ctx, BAR, 1)).toEqual({ width: 2 + 16 + 112 + 8 + 30, height: 24 });
    // At 300 dpi everything is 3.125 times as large, in whole pixels: the bar is 351 (112.4 * 3.125 = 351.25), the label is measured at its own size.
    expect(measureScaleBar(ctx, BAR, 3.125)).toEqual({
      width: 2 * 3 + 2 * 25 + 351 + 25 + 5 * 0.5 * 38 * 0 + Math.ceil(5 * 0.5 * 38),
      height: 75,
    });
  });

  it('draw a line with a tick up from each end, as wide as the bar is, and the label after it, in the picture’s colours', () => {
    const { ctx, log } = recording();
    const size = measureScaleBar(ctx, BAR, 1);
    log.length = 0;
    drawScaleBar(ctx, { x: 40, y: 500, ...size }, BAR, 1);
    // The bar starts after the line and the padding (40 + 1 + 8) and is 112 wide: the line along the bottom from 49 to 161 with the ticks at its ends.
    expect(log).toContain('moveTo(49.5, 508)');
    expect(log).toContain('lineTo(49.5, 515.5)');
    expect(log).toContain('lineTo(160.5, 515.5)');
    expect(log).toContain('lineTo(160.5, 508)');
    expect(log).toContain('lineWidth = 1');
    // The label after the bar and a gap, in the middle of the box, in text colour and the caption size.
    expect(log).toContain('fillText(200 m, 169, 512)');
    expect(log).toContain(`fillStyle = ${EXPORT_COLOURS.text}`);
    expect(log.some((line) => line.startsWith('font = 400 12px'))).toBe(true);
    expect(log).toContain('textBaseline = middle');
    expect(log[0]).toBe('save()');
    expect(log.at(-1)).toBe('restore()');
  });

  it('give the bar the width of the screen’s bar times the scale, whole, so that the ticks are on pixels', () => {
    const { ctx, log } = recording();
    const size = measureScaleBar(ctx, BAR, 2);
    log.length = 0;
    drawScaleBar(ctx, { x: 0, y: 0, ...size }, BAR, 2);
    // 112.4 * 2 is 225 whole pixels: from the left of the bar (2 + 16) to 18 + 225.
    const xs = log
      .filter((line) => line.startsWith('lineTo('))
      .map((line) => Number(/lineTo\(([\d.]+),/.exec(line)?.[1]));
    expect(Math.max(...xs) - Math.min(...xs)).toBe(225 - 2 * 0.5 * 2);
  });
});
