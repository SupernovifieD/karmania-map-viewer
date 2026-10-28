import { describe, expect, it } from 'vitest';
import { placeTooltip } from './tooltip-position.js';

const viewport = { width: 1000, height: 600 };
const tip = { width: 100, height: 24 };
const GAP = 4;
const MARGIN = 8;
const place = (left: number, top: number, width = 32, height = 32, preferred?: 'top' | 'bottom') =>
  placeTooltip({ left, top, width, height }, tip, viewport, GAP, MARGIN, preferred);

describe('where a tooltip goes', () => {
  it('is above the control, centred on it, a gap away', () => {
    expect(place(484, 300)).toEqual({ left: 450, top: 272, placement: 'top' });
  });

  it('is below the control when asked, and has room', () => {
    expect(place(484, 300, 32, 32, 'bottom')).toEqual({ left: 450, top: 336, placement: 'bottom' });
  });

  it('flips to the other side when there is no room on the preferred one', () => {
    // 20 pixels from the top: not enough for 24 and a gap and a margin above.
    expect(place(484, 20)).toEqual({ left: 450, top: 56, placement: 'bottom' });
    expect(place(484, 560, 32, 32, 'bottom')).toEqual({ left: 450, top: 532, placement: 'top' });
  });

  it('stays where it was asked when it only just fits', () => {
    // Room above is 36 - 4 - 8 = 24, exactly the tooltip's height.
    expect(place(484, 36).placement).toBe('top');
    expect(place(484, 35).placement).toBe('bottom');
  });

  it('is slid in from the left and right edges, a margin from them', () => {
    expect(place(0, 300).left).toBe(MARGIN);
    expect(place(968, 300).left).toBe(1000 - MARGIN - 100);
    expect(place(10, 300).left).toBe(MARGIN);
  });

  it('is inside the window in every corner, whatever the control', () => {
    const corners = [
      [0, 0],
      [968, 0],
      [0, 568],
      [968, 568],
      [484, 0],
      [484, 568],
    ] as const;
    for (const [left, top] of corners) {
      for (const preferred of ['top', 'bottom'] as const) {
        const spot = place(left, top, 32, 32, preferred);
        expect(spot.left, `${String(left)},${String(top)}`).toBeGreaterThanOrEqual(MARGIN);
        expect(spot.top).toBeGreaterThanOrEqual(MARGIN);
        expect(spot.left + tip.width).toBeLessThanOrEqual(viewport.width - MARGIN);
        expect(spot.top + tip.height).toBeLessThanOrEqual(viewport.height - MARGIN);
      }
    }
  });

  it('takes the roomier side, and slides in, when neither side has enough', () => {
    // A window 60 high: 8 pixels of room above the control and 8 below, for 40 pixels of tooltip.
    const equal = placeTooltip(
      { left: 100, top: 20, width: 32, height: 20 },
      { width: 100, height: 40 },
      { width: 300, height: 60 },
      GAP,
      MARGIN,
    );
    expect(equal.placement).toBe('top');
    expect(equal.top).toBe(MARGIN);
    expect(equal.top + 40).toBeLessThanOrEqual(60 - MARGIN);
    // 24 above, 50 below, for 30 pixels of tooltip: below it is.
    const roomier = placeTooltip(
      { left: 100, top: 36, width: 32, height: 10 },
      { width: 100, height: 30 },
      { width: 300, height: 100 },
      GAP,
      MARGIN,
    );
    expect(roomier.placement).toBe('bottom');
    expect(roomier.top).toBe(36 + 10 + GAP);
  });

  it('is as far in from the edge as the margin even when it is wider than the window allows', () => {
    const spot = placeTooltip(
      { left: 10, top: 300, width: 32, height: 32 },
      { width: 500, height: 24 },
      { width: 300, height: 600 },
      GAP,
      MARGIN,
    );
    expect(spot.left).toBe(MARGIN);
  });
});
