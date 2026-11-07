import type { Camera2d } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import { screenToMap } from './camera-2d.js';
import {
  DEFAULT_SCALE_LIMITS,
  KEY_PAN_PIXELS,
  KEY_ROTATE_DEGREES,
  KEY_ZOOM_FACTOR,
  angleAbout,
  clampScale,
  keyAction,
  panBy,
  rotateAbout,
  turnBetween,
  wheelFactor,
  zoomAt,
} from './controls-2d.js';
import type { CameraChange } from './controls-2d.js';

const SIZE = { width: 800, height: 600 };
const camera = (patch: Partial<Camera2d> = {}): Camera2d => ({
  centre: [1000, 2000],
  unitsPerPixel: 2,
  heading: 0,
  ...patch,
});
const apply = (view: Camera2d, change: CameraChange | undefined): Camera2d => ({
  centre: change?.centre ?? view.centre,
  unitsPerPixel: change?.unitsPerPixel ?? view.unitsPerPixel,
  heading: change?.heading ?? view.heading,
});

/** A small seeded generator, so that the same cameras come every run. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
const randomCamera = (next: () => number): Camera2d => ({
  centre: [166_000 + next() * 668_000, next() * 9_000_000],
  unitsPerPixel: 10 ** (next() * 5 - 3),
  heading: next() * 360,
});

describe('clampScale', () => {
  it('holds a scale between the limits', () => {
    const limits = { min: 0.5, max: 100 };
    expect(clampScale(7, limits)).toBe(7);
    expect(clampScale(0.1, limits)).toBe(0.5);
    expect(clampScale(1000, limits)).toBe(100);
    expect(clampScale(0.5, limits)).toBe(0.5);
    expect(clampScale(100, limits)).toBe(100);
  });

  it('does not apply a limit that is not above 0, and lets the lower limit win if they cross', () => {
    expect(clampScale(0.001, { min: 0, max: 100 })).toBe(0.001);
    expect(clampScale(1e12, { min: 1, max: 0 })).toBe(1e12);
    expect(clampScale(1e12, { min: 1, max: -5 })).toBe(1e12);
    expect(clampScale(3, { min: 10, max: 5 })).toBe(10);
  });
});

describe('panBy', () => {
  it('moves the centre the other way: the map follows the pointer', () => {
    const view = camera();
    // The pointer goes 100 right and 50 down; the map goes with it, so the centre goes left and up (north).
    expect(panBy(view, SIZE, 100, 50).centre).toEqual([800, 2100]);
    expect(panBy(view, SIZE, -100, -50).centre).toEqual([1200, 1900]);
    expect(panBy(view, SIZE, 0, 0).centre).toEqual([1000, 2000]);
  });

  it('keeps the point that was under the pointer under it, at any heading, scale and place', () => {
    const next = generator(7);
    for (let i = 0; i < 200; i += 1) {
      const view = randomCamera(next);
      const [x, y] = [next() * SIZE.width, next() * SIZE.height];
      const [dx, dy] = [(next() - 0.5) * 600, (next() - 0.5) * 600];
      const under = screenToMap(view, SIZE, x, y);
      const moved = apply(view, panBy(view, SIZE, dx, dy));
      const after = screenToMap(moved, SIZE, x + dx, y + dy);
      expect(after[0], String(i)).toBeCloseTo(under[0], 5);
      expect(after[1], String(i)).toBeCloseTo(under[1], 5);
      // And only the centre changed.
      expect(moved.unitsPerPixel).toBe(view.unitsPerPixel);
      expect(moved.heading).toBe(view.heading);
    }
  });
});

describe('zoomAt', () => {
  it('multiplies the scale by the factor and keeps the point under the pointer where it was', () => {
    const next = generator(11);
    for (let i = 0; i < 200; i += 1) {
      const view = randomCamera(next);
      const factor = 10 ** (next() * 2 - 1);
      const [x, y] = [next() * SIZE.width, next() * SIZE.height];
      const under = screenToMap(view, SIZE, x, y);
      const zoomed = apply(view, zoomAt(view, SIZE, factor, x, y, DEFAULT_SCALE_LIMITS));
      expect(zoomed.unitsPerPixel, String(i)).toBeCloseTo(view.unitsPerPixel * factor, 9);
      const after = screenToMap(zoomed, SIZE, x, y);
      expect(after[0], String(i)).toBeCloseTo(under[0], 5);
      expect(after[1], String(i)).toBeCloseTo(under[1], 5);
      expect(zoomed.heading).toBe(view.heading);
    }
  });

  it('keeps the centre where it is when the pointer is at the middle', () => {
    expect(zoomAt(camera(), SIZE, 0.5, 400, 300, DEFAULT_SCALE_LIMITS)).toEqual({
      centre: [1000, 2000],
      unitsPerPixel: 1,
    });
  });

  it('moves the centre towards the pointer when it comes closer, and away when it goes back', () => {
    const closer = zoomAt(camera(), SIZE, 0.5, 600, 300, DEFAULT_SCALE_LIMITS);
    // A point 200 pixels (400 units) to the right of the middle stays there; at half the scale it is 400 pixels away.
    expect(closer?.centre?.[0]).toBeCloseTo(1200, 9);
    expect(closer?.centre?.[1]).toBeCloseTo(2000, 9);
    const back = zoomAt({ ...camera(), ...closer }, SIZE, 2, 600, 300, DEFAULT_SCALE_LIMITS);
    expect(back?.centre?.[0]).toBeCloseTo(1000, 9);
  });

  it('stops at the limits: held to them, and nothing at all once there', () => {
    const limits = { min: 1, max: 8 };
    expect(zoomAt(camera({ unitsPerPixel: 1.5 }), SIZE, 0.1, 400, 300, limits)?.unitsPerPixel).toBe(
      1,
    );
    expect(zoomAt(camera({ unitsPerPixel: 1 }), SIZE, 0.5, 400, 300, limits)).toBeUndefined();
    expect(zoomAt(camera({ unitsPerPixel: 6 }), SIZE, 10, 400, 300, limits)?.unitsPerPixel).toBe(8);
    expect(zoomAt(camera({ unitsPerPixel: 8 }), SIZE, 2, 400, 300, limits)).toBeUndefined();
  });

  it('does nothing for a factor that is not a number above 0, or is 1', () => {
    for (const factor of [0, -1, NaN, Infinity, 1]) {
      expect(
        zoomAt(camera(), SIZE, factor, 100, 100, DEFAULT_SCALE_LIMITS),
        String(factor),
      ).toBeUndefined();
    }
  });
});

describe('rotateAbout', () => {
  it('adds the angle to the heading and keeps the point under the pointer where it was', () => {
    const next = generator(13);
    for (let i = 0; i < 200; i += 1) {
      const view = randomCamera(next);
      const degrees = (next() - 0.5) * 400;
      const [x, y] = [next() * SIZE.width, next() * SIZE.height];
      const under = screenToMap(view, SIZE, x, y);
      const turned = apply(view, rotateAbout(view, SIZE, degrees, x, y));
      expect(turned.heading, String(i)).toBeCloseTo(view.heading + degrees, 9);
      const after = screenToMap(turned, SIZE, x, y);
      expect(after[0], String(i)).toBeCloseTo(under[0], 5);
      expect(after[1], String(i)).toBeCloseTo(under[1], 5);
      expect(turned.unitsPerPixel).toBe(view.unitsPerPixel);
    }
  });

  it('turns about the middle without moving the centre', () => {
    const turned = rotateAbout(camera(), SIZE, 15, 400, 300);
    expect(turned?.heading).toBe(15);
    expect(turned?.centre?.[0]).toBeCloseTo(1000, 9);
    expect(turned?.centre?.[1]).toBeCloseTo(2000, 9);
  });

  it('does nothing for no turn, or one that is not a number', () => {
    for (const degrees of [0, NaN, Infinity]) {
      expect(rotateAbout(camera(), SIZE, degrees, 10, 10), String(degrees)).toBeUndefined();
    }
  });
});

describe('angleAbout and turnBetween', () => {
  it('measure the pointer round the middle, clockwise from straight up', () => {
    expect(angleAbout(SIZE, 400, 100)).toBeCloseTo(0, 9);
    expect(angleAbout(SIZE, 600, 300)).toBeCloseTo(90, 9);
    expect(Math.abs(angleAbout(SIZE, 400, 500))).toBeCloseTo(180, 9);
    expect(angleAbout(SIZE, 200, 300)).toBeCloseTo(-90, 9);
    expect(angleAbout(SIZE, 600, 100)).toBeCloseTo(Math.atan2(200, 200) * (180 / Math.PI), 9);
  });

  it('give the shorter way round, so that a drag across the top is not nearly a whole turn', () => {
    expect(turnBetween(350, 10)).toBe(20);
    expect(turnBetween(10, 350)).toBe(-20);
    expect(turnBetween(0, 0)).toBe(0);
    expect(turnBetween(90, 90)).toBe(0);
    expect(turnBetween(-170, 170)).toBe(-20);
    expect(Math.abs(turnBetween(0, 180))).toBe(180);
    expect(turnBetween(0, 270)).toBe(-90);
  });
});

describe('wheelFactor', () => {
  const wheel = (deltaY: number, deltaMode = 0, ctrlKey = false) => ({
    deltaY,
    deltaMode,
    ctrlKey,
  });

  it('is 1 for a wheel that did not turn, comes closer for up and goes away for down', () => {
    expect(wheelFactor(wheel(0), 600)).toBe(1);
    expect(wheelFactor(wheel(-100), 600)).toBeLessThan(1);
    expect(wheelFactor(wheel(100), 600)).toBeGreaterThan(1);
    expect(wheelFactor(wheel(100), 600) * wheelFactor(wheel(-100), 600)).toBeCloseTo(1, 12);
    expect(wheelFactor(wheel(100), 600)).toBeCloseTo(Math.exp(0.15), 12);
  });

  it('takes a line as 16 pixels and a page as the height of the area', () => {
    expect(wheelFactor(wheel(3, 1), 600)).toBeCloseTo(wheelFactor(wheel(48), 600), 12);
    expect(wheelFactor(wheel(1, 2), 600)).toBeCloseTo(wheelFactor(wheel(600), 600), 12);
  });

  it('is faster for a pinch, which is the wheel with the control key down', () => {
    expect(wheelFactor(wheel(-10, 0, true), 600)).toBeCloseTo(Math.exp(-0.1), 12);
    expect(wheelFactor(wheel(-10, 0, true), 600)).toBeLessThan(wheelFactor(wheel(-10), 600));
  });
});

describe('keyAction', () => {
  const key = (
    name: string,
    down: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
  ) =>
    keyAction({
      key: name,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...down,
    });

  it('pans with the arrows, the map going the other way from the view', () => {
    expect(key('ArrowLeft')).toEqual({ type: 'pan', dx: KEY_PAN_PIXELS, dy: 0 });
    expect(key('ArrowRight')).toEqual({ type: 'pan', dx: -KEY_PAN_PIXELS, dy: 0 });
    expect(key('ArrowUp')).toEqual({ type: 'pan', dx: 0, dy: KEY_PAN_PIXELS });
    expect(key('ArrowDown')).toEqual({ type: 'pan', dx: 0, dy: -KEY_PAN_PIXELS });
  });

  it('turns by 15 degrees with Shift and the left or right arrow, right being clockwise', () => {
    expect(key('ArrowRight', { shiftKey: true })).toEqual({
      type: 'rotate',
      degrees: KEY_ROTATE_DEGREES,
    });
    expect(key('ArrowLeft', { shiftKey: true })).toEqual({
      type: 'rotate',
      degrees: -KEY_ROTATE_DEGREES,
    });
    expect(KEY_ROTATE_DEGREES).toBe(15);
  });

  it('does nothing for Shift and the up or down arrow', () => {
    expect(key('ArrowUp', { shiftKey: true })).toBeUndefined();
    expect(key('ArrowDown', { shiftKey: true })).toBeUndefined();
  });

  it('zooms with + and -, whether or not Shift is down to make them', () => {
    for (const name of ['+', '=']) {
      expect(key(name), name).toEqual({ type: 'zoom', factor: 1 / KEY_ZOOM_FACTOR });
      expect(key(name, { shiftKey: true }), name).toEqual({
        type: 'zoom',
        factor: 1 / KEY_ZOOM_FACTOR,
      });
    }
    for (const name of ['-', '_']) {
      expect(key(name), name).toEqual({ type: 'zoom', factor: KEY_ZOOM_FACTOR });
      expect(key(name, { shiftKey: true }), name).toEqual({
        type: 'zoom',
        factor: KEY_ZOOM_FACTOR,
      });
    }
    // Two presses are twice the scale.
    expect(KEY_ZOOM_FACTOR * KEY_ZOOM_FACTOR).toBeCloseTo(2, 12);
  });

  it('puts north up with 0 and fits to the data with Home', () => {
    expect(key('0')).toEqual({ type: 'north' });
    expect(key('Home')).toEqual({ type: 'fit' });
  });

  it('leaves a key with Control, Meta or Alt down to the browser, and any other key', () => {
    for (const down of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      for (const name of ['ArrowLeft', '+', '-', '0', 'Home']) {
        expect(key(name, down), `${name} ${JSON.stringify(down)}`).toBeUndefined();
      }
    }
    for (const name of ['a', 'Enter', ' ', '1', 'Tab', 'Escape', 'PageUp', 'End', 'Shift']) {
      expect(key(name), name).toBeUndefined();
    }
  });
});
