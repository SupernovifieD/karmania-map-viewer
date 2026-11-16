import { describe, expect, it } from 'vitest';
import {
  FURNITURE_COLUMN,
  POPOVER_GAP,
  POPOVER_INSET,
  POPOVER_MAX_WIDTH,
  placePopover,
} from './popover-place.js';

const AREA = { width: 1000, height: 600 };
const SIZE = { width: 280, height: 200 };

describe('where the popover goes', () => {
  it('is to the right of the click and below it, a gap away, when that fits', () => {
    expect(placePopover({ x: 300, y: 150 }, SIZE, AREA)).toMatchObject({
      left: 300 + POPOVER_GAP,
      top: 150 + POPOVER_GAP,
    });
  });

  it('is on the left of the click where it does not fit on the right, and above it where it does not fit below', () => {
    // The right edge that is kept clear is 1000 - 16 - 48 = 936: a click at 800 has room for 936 - 812 = 124 of 280.
    const left = placePopover({ x: 800, y: 150 }, SIZE, AREA);
    expect(left.left).toBe(800 - POPOVER_GAP - SIZE.width);
    expect(left.top).toBe(150 + POPOVER_GAP);
    const above = placePopover({ x: 300, y: 500 }, SIZE, AREA);
    expect(above.top).toBe(500 - POPOVER_GAP - SIZE.height);
    expect(above.left).toBe(300 + POPOVER_GAP);
  });

  it('is never nearer the edges than the inset, wherever the click is', () => {
    for (const anchor of [
      { x: 0, y: 0 },
      { x: 5, y: 590 },
      { x: 995, y: 3 },
      { x: 500, y: 0 },
      { x: 0, y: 300 },
    ]) {
      const at = placePopover(anchor, SIZE, AREA);
      expect(at.left, JSON.stringify(anchor)).toBeGreaterThanOrEqual(POPOVER_INSET);
      expect(at.top, JSON.stringify(anchor)).toBeGreaterThanOrEqual(POPOVER_INSET);
      expect(at.top + SIZE.height, JSON.stringify(anchor)).toBeLessThanOrEqual(
        AREA.height - POPOVER_INSET,
      );
    }
  });

  it('is never over the column on the right of the north arrow and the navigation group, however far right the click is', () => {
    for (const x of [600, 800, 936, 960, 999]) {
      const at = placePopover({ x, y: 100 }, SIZE, AREA);
      expect(at.left + SIZE.width, `click at ${String(x)}`).toBeLessThanOrEqual(
        AREA.width - POPOVER_INSET - FURNITURE_COLUMN,
      );
    }
  });

  it('is at most as wide as 320 and as the room between the inset and the column leaves, and at most half as high as the map', () => {
    expect(placePopover({ x: 100, y: 100 }, SIZE, AREA).maxWidth).toBe(POPOVER_MAX_WIDTH);
    expect(placePopover({ x: 100, y: 100 }, SIZE, AREA).maxHeight).toBe(300);
    // A narrow map: 16 + 48 + 16 of the 400 are not the popover's.
    expect(placePopover({ x: 100, y: 100 }, SIZE, { width: 300, height: 400 })).toMatchObject({
      maxWidth: 300 - POPOVER_INSET - FURNITURE_COLUMN - POPOVER_INSET,
      maxHeight: 200,
    });
  });

  it('is placed as the smaller popover when it is larger than it may be: a tall one is as high as half the map and is kept inside', () => {
    const tall = { width: 280, height: 900 };
    const at = placePopover({ x: 300, y: 500 }, tall, AREA);
    // Half the map is 300: above the click (500 - 12 - 300 = 188) it fits.
    expect(at.top).toBe(500 - POPOVER_GAP - 300);
    expect(at.maxHeight).toBe(300);
    const wide = placePopover({ x: 100, y: 100 }, { width: 900, height: 100 }, AREA);
    expect(wide.maxWidth).toBe(POPOVER_MAX_WIDTH);
    expect(wide.left).toBeGreaterThanOrEqual(POPOVER_INSET);
    expect(wide.left + POPOVER_MAX_WIDTH).toBeLessThanOrEqual(
      AREA.width - POPOVER_INSET - FURNITURE_COLUMN,
    );
  });

  it('is put at the inset when the map is too small to hold it, and has no negative size', () => {
    const at = placePopover({ x: 50, y: 50 }, SIZE, { width: 60, height: 40 });
    expect(at.left).toBe(POPOVER_INSET);
    expect(at.top).toBe(POPOVER_INSET);
    expect(at.maxWidth).toBe(0);
    expect(at.maxHeight).toBeGreaterThanOrEqual(0);
  });
});
