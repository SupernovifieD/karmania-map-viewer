import { describe, expect, it } from 'vitest';
import { heldElevation, normalHeading } from './angles.js';

describe('the heading and the elevation', () => {
  it('turns a heading into the degrees from 0 up to 360 that point the same way', () => {
    expect([0, 30, 359.5, 360, 361, 720, -30, -360, -720.5].map(normalHeading)).toEqual([
      0, 30, 359.5, 0, 1, 0, 330, 0, 359.5,
    ]);
    expect(Object.is(normalHeading(-0), 0)).toBe(true);
    expect(normalHeading(-1e-20)).toBe(0);
    expect(Number.isNaN(normalHeading(NaN))).toBe(true);
    expect(normalHeading(Infinity)).toBe(Infinity);
  });

  it('holds an elevation between -89 and 89 degrees', () => {
    expect([-120, -89, -88.9, 0, 45, 89, 89.1, 90, 1000].map(heldElevation)).toEqual([
      -89, -89, -88.9, 0, 45, 89, 89, 89, 89,
    ]);
    expect(Number.isNaN(heldElevation(NaN))).toBe(true);
  });
});
