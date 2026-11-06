import { describe, expect, it } from 'vitest';
import { contrastRatio, mix, parseHex, relativeLuminance, toHex } from './colour.js';

describe('colours', () => {
  it('reads #rrggbb in either case, and nothing else', () => {
    expect(parseHex('#e69f00')).toEqual([230, 159, 0]);
    expect(parseHex('#E69F00')).toEqual([230, 159, 0]);
    for (const bad of ['e69f00', '#e69f0', '#e69f000', '#e69g00', '#fff', 'red', '', ' #e69f00']) {
      expect(parseHex(bad)).toBeUndefined();
    }
  });

  it('writes #rrggbb in lower case, rounding and keeping each number from 0 to 255', () => {
    expect(toHex([230, 159, 0])).toBe('#e69f00');
    expect(toHex([0.4, 0.5, 254.5])).toBe('#0001ff');
    expect(toHex([-20, 300, 15.49])).toBe('#00ff0f');
    expect(toHex([255, 255, 255])).toBe('#ffffff');
  });

  it('writes what it reads, for every colour of a sweep of the cube', () => {
    const wrong: string[] = [];
    for (let r = 0; r < 256; r += 51) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 15) {
          const back = parseHex(toHex([r, g, b]));
          if (back?.[0] !== r || back[1] !== g || back[2] !== b) {
            wrong.push(`${String(r)},${String(g)},${String(b)}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  }, 20_000);

  it('mixes each channel on its own, from the first colour at 0 to the second at 1', () => {
    expect(mix([0, 100, 255], [100, 200, 55], 0)).toEqual([0, 100, 255]);
    expect(mix([0, 100, 255], [100, 200, 55], 1)).toEqual([100, 200, 55]);
    expect(mix([0, 100, 255], [100, 200, 55], 0.5)).toEqual([50, 150, 155]);
  });

  it('measures how light a colour is, from black at 0 to white at 1', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 12);
    // The weights of red, green and blue, and the part of the curve below the knee.
    expect(relativeLuminance([255, 0, 0])).toBeCloseTo(0.2126, 12);
    expect(relativeLuminance([0, 255, 0])).toBeCloseTo(0.7152, 12);
    expect(relativeLuminance([0, 0, 255])).toBeCloseTo(0.0722, 12);
    expect(relativeLuminance([10, 10, 10])).toBeCloseTo(10 / 255 / 12.92, 12);
  });

  it('measures contrast as published: 21 for black on white, 1 for the same colour, and either way round', () => {
    const white = [255, 255, 255] as const;
    expect(contrastRatio([0, 0, 0], white)).toBeCloseTo(21, 10);
    expect(contrastRatio(white, [0, 0, 0])).toBeCloseTo(21, 10);
    expect(contrastRatio(white, white)).toBe(1);
    // The grey that is just enough for text on white (4.5 to 1) is #767676, and #777777 is just under.
    expect(contrastRatio([0x76, 0x76, 0x76], white)).toBeCloseTo(4.54, 2);
    expect(contrastRatio([0x77, 0x77, 0x77], white)).toBeCloseTo(4.48, 2);
  });
});
