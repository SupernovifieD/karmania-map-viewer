import { describe, expect, it } from 'vitest';
import { sinCos } from './rotation.js';

describe('sinCos', () => {
  it('is exact for the quarter turns, which are not what Math.sin and Math.cos say of them', () => {
    expect(sinCos(0)).toEqual([0, 1]);
    expect(sinCos(90)).toEqual([1, 0]);
    expect(sinCos(180)).toEqual([0, -1]);
    expect(sinCos(270)).toEqual([-1, 0]);
    // (`Math.cos(Math.PI / 2)` is 6e-17, which is why they are not worked out.)
    expect(Math.cos(Math.PI / 2)).not.toBe(0);
  });

  it('takes an angle for the one it is the same as: any number of turns, either way', () => {
    expect(sinCos(360)).toEqual(sinCos(0));
    expect(sinCos(450)).toEqual(sinCos(90));
    expect(sinCos(-90)).toEqual(sinCos(270));
    expect(sinCos(-180)).toEqual(sinCos(180));
    expect(sinCos(-270)).toEqual(sinCos(90));
    expect(sinCos(720 + 30)).toEqual(sinCos(30));
    expect(sinCos(-330)[0]).toBeCloseTo(sinCos(30)[0], 12);
  });

  it('is the sine and cosine, anticlockwise, for any other angle', () => {
    const [sin, cos] = sinCos(30);
    expect(sin).toBeCloseTo(0.5, 12);
    expect(cos).toBeCloseTo(Math.sqrt(3) / 2, 12);
    const [s45, c45] = sinCos(45);
    expect(s45).toBeCloseTo(c45, 12);
    const [s210, c210] = sinCos(210);
    expect(s210).toBeCloseTo(-0.5, 12);
    expect(c210).toBeCloseTo(-Math.sqrt(3) / 2, 12);
    for (const angle of [1, 17, 89.5, 135, 359.9]) {
      const [a, b] = sinCos(angle);
      expect(a * a + b * b).toBeCloseTo(1, 12);
    }
  });
});
