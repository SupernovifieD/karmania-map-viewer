import { describe, expect, it } from 'vitest';
import { bufferSize } from './buffer-size.js';

describe('bufferSize', () => {
  it('is the box times the ratio, in whole pixels', () => {
    expect(bufferSize(800, 600, 1, 8192)).toEqual({ width: 800, height: 600, pixelRatio: 1 });
    expect(bufferSize(800, 600, 2, 8192)).toEqual({ width: 1600, height: 1200, pixelRatio: 2 });
    expect(bufferSize(1024, 640, 1.5, 8192)).toEqual({ width: 1536, height: 960, pixelRatio: 1.5 });
  });

  it('rounds each side to the nearest pixel, and does not lose the ratio it was given', () => {
    expect(bufferSize(801, 601, 1.25, 8192)).toEqual({
      width: 1001,
      height: 751,
      pixelRatio: 1.25,
    });
    expect(bufferSize(100.4, 100.6, 1, 8192)).toEqual({ width: 100, height: 101, pixelRatio: 1 });
    // Exactly halfway goes up, as Math.round does.
    expect(bufferSize(10.5, 20.5, 1, 8192)).toEqual({ width: 11, height: 21, pixelRatio: 1 });
  });

  it('is 1 by 1 for a box that has no size, which a canvas can have, and never 0', () => {
    expect(bufferSize(0, 0, 2, 8192)).toEqual({ width: 1, height: 1, pixelRatio: 2 });
    expect(bufferSize(0, 300, 1, 8192)).toEqual({ width: 1, height: 300, pixelRatio: 1 });
    expect(bufferSize(-5, NaN, 1, 8192)).toEqual({ width: 1, height: 1, pixelRatio: 1 });
    expect(bufferSize(0.2, 0.2, 1, 8192)).toEqual({ width: 1, height: 1, pixelRatio: 1 });
  });

  it('takes a ratio that is not a number above 0 for 1', () => {
    for (const ratio of [0, -2, NaN, Infinity, -Infinity]) {
      expect(bufferSize(800, 600, ratio, 8192), String(ratio)).toEqual({
        width: 800,
        height: 600,
        pixelRatio: 1,
      });
    }
  });

  it('lowers the ratio, not the shape, where the card cannot draw as many pixels', () => {
    const size = bufferSize(5000, 3000, 2, 8192);
    expect(size.width).toBe(8192);
    expect(size.height).toBe(Math.round((3000 * 8192) / 5000));
    expect(size.pixelRatio).toBeCloseTo(8192 / 5000, 12);
    // The taller side is the one that is held to the limit.
    expect(bufferSize(3000, 5000, 2, 8192)).toEqual({
      width: Math.round((3000 * 8192) / 5000),
      height: 8192,
      pixelRatio: 8192 / 5000,
    });
  });

  it('keeps a box that is at the limit exactly as it is, and one just past it at the limit', () => {
    expect(bufferSize(4096, 100, 2, 8192)).toEqual({ width: 8192, height: 200, pixelRatio: 2 });
    expect(bufferSize(4097, 100, 2, 8192).width).toBe(8192);
    // A box wider than the card at ratio 1 is brought down to it as well.
    expect(bufferSize(10000, 10, 1, 8192).width).toBe(8192);
  });

  it('refuses a limit that is not a whole number from 1: the card does not say that', () => {
    for (const limit of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => bufferSize(10, 10, 1, limit), String(limit)).toThrow(RangeError);
    }
    expect(bufferSize(10, 10, 1, 1)).toEqual({ width: 1, height: 1, pixelRatio: 0.1 });
  });
});
