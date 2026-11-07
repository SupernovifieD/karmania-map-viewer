import type { Camera2d } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import { mapToScreen, orthographicFrame, screenToMap } from './camera-2d.js';

const SIZE = { width: 800, height: 600 };
const camera = (patch: Partial<Camera2d> = {}): Camera2d => ({
  centre: [1000, 2000],
  unitsPerPixel: 2,
  heading: 0,
  ...patch,
});

/** A pair of numbers, to within a tenth of a millimetre of a map unit of metres (a good deal less than a pixel). */
const near = (actual: readonly number[], expected: readonly number[], digits = 9): void => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => {
    expect(actual[i] ?? NaN).toBeCloseTo(value, digits);
  });
};

describe('orthographicFrame', () => {
  it('shows half the box on each side of the middle, in map units: the pixels of the area times the scale', () => {
    const frame = orthographicFrame(camera(), [0, 0, 0], SIZE, { min: 0, max: 0 });
    expect([frame.left, frame.right, frame.top, frame.bottom]).toEqual([-800, 800, 600, -600]);
  });

  it('is placed over the centre relative to the origin, one unit above the highest height', () => {
    const frame = orthographicFrame(camera(), [900, 1500, 50], SIZE, { min: -20, max: 30 });
    expect(frame.position).toEqual([100, 500, 31]);
    // Everything from the highest height (1 away) to the lowest (51 away) is between near and far.
    expect(frame.near).toBe(0);
    expect(frame.far).toBe(52);
  });

  it('turns the camera by minus the heading, in radians', () => {
    expect(orthographicFrame(camera(), [0, 0, 0], SIZE, { min: 0, max: 0 }).rotation).toBeCloseTo(
      0,
      15,
    );
    expect(
      orthographicFrame(camera({ heading: 90 }), [0, 0, 0], SIZE, { min: 0, max: 0 }).rotation,
    ).toBeCloseTo(-Math.PI / 2, 15);
    expect(
      orthographicFrame(camera({ heading: 30 }), [0, 0, 0], SIZE, { min: 0, max: 0 }).rotation,
    ).toBeCloseTo((-30 * Math.PI) / 180, 15);
  });

  it('is never degenerate: an area that has no size yet is taken as a pixel', () => {
    const frame = orthographicFrame(
      camera({ unitsPerPixel: 4 }),
      [0, 0, 0],
      { width: 0, height: 0 },
      { min: 0, max: 0 },
    );
    expect([frame.left, frame.right, frame.top, frame.bottom]).toEqual([-2, 2, 2, -2]);
  });
});

describe('screenToMap and mapToScreen', () => {
  it('put the centre of the map at the middle of the screen', () => {
    near(screenToMap(camera(), SIZE, 400, 300), [1000, 2000]);
    near(mapToScreen(camera(), SIZE, 1000, 2000), [400, 300]);
  });

  it('have east to the right and north up when the heading is 0, a pixel being the scale', () => {
    near(screenToMap(camera(), SIZE, 410, 300), [1020, 2000]);
    near(screenToMap(camera(), SIZE, 400, 290), [1000, 2020]);
    near(mapToScreen(camera(), SIZE, 1020, 2000), [410, 300]);
    near(mapToScreen(camera(), SIZE, 1000, 2020), [400, 290]);
  });

  it('turn so that the top of the screen faces the heading, clockwise from north', () => {
    // Heading 90: the top of the screen faces east, and east is up.
    near(screenToMap(camera({ heading: 90 }), SIZE, 400, 290), [1020, 2000]);
    near(mapToScreen(camera({ heading: 90 }), SIZE, 1020, 2000), [400, 290]);
    // And north is then to the left, as the sun's side of a map turned to face east.
    near(mapToScreen(camera({ heading: 90 }), SIZE, 1000, 2020), [390, 300]);
    // Heading 180: the top faces south, so north is down and east is to the left.
    near(mapToScreen(camera({ heading: 180 }), SIZE, 1000, 2020), [400, 310]);
    near(mapToScreen(camera({ heading: 180 }), SIZE, 1020, 2000), [390, 300]);
    // Heading 45: the top faces north-east.
    const half = Math.SQRT1_2;
    near(screenToMap(camera({ heading: 45, unitsPerPixel: 1 }), SIZE, 400, 290), [
      1000 + 10 * half,
      2000 + 10 * half,
    ]);
  });

  it('keep a pixel a pixel at any heading: a step of one on the screen is the scale on the map', () => {
    for (const heading of [0, 17, 90, 133, 180, 271, 359.5]) {
      const a = screenToMap(camera({ heading }), SIZE, 100, 100);
      const b = screenToMap(camera({ heading }), SIZE, 101, 100);
      const c = screenToMap(camera({ heading }), SIZE, 100, 101);
      expect(Math.hypot(b[0] - a[0], b[1] - a[1]), String(heading)).toBeCloseTo(2, 9);
      expect(Math.hypot(c[0] - a[0], c[1] - a[1]), String(heading)).toBeCloseTo(2, 9);
      // And the two directions are at right angles.
      expect(
        (b[0] - a[0]) * (c[0] - a[0]) + (b[1] - a[1]) * (c[1] - a[1]),
        String(heading),
      ).toBeCloseTo(0, 9);
    }
  });

  it('are the inverse of each other, at the coordinates of a UTM zone and from a millimetre to a kilometre a pixel', () => {
    // A small seeded generator (no Math.random: the same numbers every run).
    let seed = 0x2545f491;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 300; i += 1) {
      const view = camera({
        centre: [166_000 + next() * 668_000, next() * 9_000_000],
        unitsPerPixel: 10 ** (next() * 6 - 3),
        heading: next() * 360,
      });
      const size = { width: 100 + next() * 3000, height: 100 + next() * 2000 };
      const [x, y] = [next() * size.width, next() * size.height];
      const [mx, my] = screenToMap(view, size, x, y);
      const [sx, sy] = mapToScreen(view, size, mx, my);
      // To a ten-thousandth of a pixel, which is what a position of 9 million map units at f64 allows at a millimetre a pixel.
      expect(sx).toBeCloseTo(x, 3);
      expect(sy).toBeCloseTo(y, 3);
    }
  });
});
