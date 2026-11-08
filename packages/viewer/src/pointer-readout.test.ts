import { describe, expect, it } from 'vitest';
import { decimalsFor, MOST_DECIMALS, readoutAt, readoutWidth } from './pointer-readout.js';

const SIZE = { width: 800, height: 600 };
const camera = (
  unitsPerPixel: number,
  centre: readonly [number, number] = [500_000, 2_765_000],
  heading = 0,
) => ({ centre, unitsPerPixel, heading });

describe('the decimals of the pointer readout', () => {
  it('make the last digit not more than a pixel, and more than a tenth of one', () => {
    for (const unitsPerPixel of [1e-6, 3e-6, 0.0004, 0.0099, 0.01, 0.07, 0.1, 0.25, 0.5, 0.999]) {
      const resolution = 10 ** -decimalsFor(unitsPerPixel);
      expect(resolution, String(unitsPerPixel)).toBeLessThanOrEqual(unitsPerPixel * (1 + 1e-9));
      expect(resolution, String(unitsPerPixel)).toBeGreaterThan(unitsPerPixel / 10);
    }
  });

  it('are none for a pixel of one unit or more', () => {
    for (const unitsPerPixel of [1, 1.5, 2.5, 10, 1000, 1e9]) {
      expect(decimalsFor(unitsPerPixel), String(unitsPerPixel)).toBe(0);
    }
  });

  it('are the exact ones at the powers of ten and just either side of them', () => {
    expect(decimalsFor(0.1)).toBe(1);
    expect(decimalsFor(0.01)).toBe(2);
    expect(decimalsFor(0.001)).toBe(3);
    expect(decimalsFor(0.0999)).toBe(2);
    expect(decimalsFor(0.25)).toBe(1);
    expect(decimalsFor(0.05)).toBe(2);
  });

  it('are at most six, however close the map is', () => {
    expect(decimalsFor(1e-7)).toBe(MOST_DECIMALS);
    expect(decimalsFor(1e-12)).toBe(MOST_DECIMALS);
  });

  it('are none for a scale that is not a number above 0', () => {
    for (const unitsPerPixel of [0, -1, NaN, Infinity]) {
      expect(decimalsFor(unitsPerPixel), String(unitsPerPixel)).toBe(0);
    }
  });
});

describe('what the pointer is over', () => {
  it('is the centre of the camera in the middle of the map area', () => {
    expect(readoutAt(camera(1), SIZE, 400, 300)).toEqual({ x: '500,000', y: '2,765,000' });
  });

  it('is east of the centre to the right and north of it above, with north up', () => {
    expect(readoutAt(camera(1), SIZE, 0, 0)).toEqual({ x: '499,600', y: '2,765,300' });
    expect(readoutAt(camera(1), SIZE, 800, 600)).toEqual({ x: '500,400', y: '2,764,700' });
  });

  it('follows the heading: with east at the top, right is south and up is east', () => {
    const turned = camera(1, [500_000, 2_765_000], 90);
    expect(readoutAt(turned, SIZE, 500, 300)).toEqual({ x: '500,000', y: '2,764,900' });
    expect(readoutAt(turned, SIZE, 400, 200)).toEqual({ x: '500,100', y: '2,765,000' });
  });

  it('has the decimals of the scale', () => {
    expect(readoutAt(camera(0.1), SIZE, 400, 300)).toEqual({ x: '500,000.0', y: '2,765,000.0' });
    expect(readoutAt(camera(0.001), SIZE, 410, 290)).toEqual({
      x: '500,000.010',
      y: '2,765,000.010',
    });
  });

  it('writes a negative coordinate with the true minus, and no sign for what rounds to nothing', () => {
    expect(readoutAt(camera(0.1, [-1234.5, -0.5]), SIZE, 400, 300)).toEqual({
      x: '−1,234.5',
      y: '−0.5',
    });
    expect(readoutAt(camera(1, [0.2, -0.2]), SIZE, 400, 300)).toEqual({ x: '0', y: '0' });
  });

  it('is nothing when the camera puts the point nowhere', () => {
    expect(readoutAt(camera(NaN), SIZE, 400, 300)).toBeUndefined();
    expect(readoutAt(camera(1, [Infinity, 0]), SIZE, 400, 300)).toBeUndefined();
  });
});

describe('how wide the pointer readout can be', () => {
  it('is the longest of the corners', () => {
    // At a pixel a unit the corners are 499,600 to 500,400 and 2,764,700 to 2,765,300: nine characters.
    expect(readoutWidth(camera(1), SIZE)).toBe(9);
    // With two decimals the same numbers have three characters more.
    expect(readoutWidth(camera(0.01), SIZE)).toBe(12);
  });

  it('is made from every corner of the map area, and the area decides how far they reach', () => {
    // Only the corner at the right has four digits and a comma (1,000): the one at the top left has three.
    expect(readoutWidth(camera(1, [600, 0]), SIZE)).toBe('1,000'.length);
    // A bigger area reaches farther, and the corners with it.
    expect(readoutWidth(camera(1, [5, 5]), { width: 2000, height: 1200 })).toBe(5);
    expect(readoutWidth(camera(1, [5, 5]), { width: 20, height: 20 })).toBe(2);
  });

  it('counts the minus sign of a corner that is negative', () => {
    expect(readoutWidth(camera(1, [0, 0]), SIZE)).toBe('−400'.length);
  });

  it('is never less than the text anywhere in the area, with no margin on it', () => {
    // Cameras that cross zero, a power of ten and a rounding (999.96 at one decimal is 1,000.0), turned and not, and the most the map can reach.
    const cameras = [
      camera(1, [0, 0]),
      camera(1, [600, 600]),
      camera(0.1, [999.5, -999.5]),
      camera(0.1, [999.9, 99.9]),
      camera(0.01, [0.2, -0.2]),
      camera(2.5, [-1_000, 1_000], 37),
      camera(0.25, [499_800, 2_764_900], 123),
      camera(1e-7, [9_999_999.123456, 19_999_999.123456]),
      camera(1e-7, [-9_999_999.123456, -19_999_999.123456], 211),
    ];
    for (const each of cameras) {
      const width = readoutWidth(each, SIZE);
      for (let i = 0; i <= 40; i += 1) {
        for (let j = 0; j <= 30; j += 1) {
          const readout = readoutAt(each, SIZE, (SIZE.width * i) / 40, (SIZE.height * j) / 30);
          expect(
            Math.max(readout?.x.length ?? 0, readout?.y.length ?? 0),
            `${JSON.stringify(each)} at ${String(i)}, ${String(j)}`,
          ).toBeLessThanOrEqual(width);
        }
      }
    }
  });
});
