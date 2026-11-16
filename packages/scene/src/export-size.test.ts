import { describe, expect, it } from 'vitest';
import {
  MAX_EXPORT_SIDE,
  MIN_EXPORT_SIDE,
  maxSide,
  sizeInPixels,
  sizeProblems,
} from './export-size.js';

const SCREEN = { width: 1160, height: 648 };

describe('sizeInPixels', () => {
  it('is A4 landscape at 300 dpi 3,508 by 2,480 pixels, as the brief says', () => {
    expect(sizeInPixels('a4-landscape', 300, SCREEN)).toEqual({ width: 3508, height: 2480 });
  });

  it('turns the other papers and dpi into whole pixels', () => {
    expect(sizeInPixels('a4-portrait', 300, SCREEN)).toEqual({ width: 2480, height: 3508 });
    expect(sizeInPixels('a3-landscape', 300, SCREEN)).toEqual({ width: 4961, height: 3508 });
    expect(sizeInPixels('a3-portrait', 300, SCREEN)).toEqual({ width: 3508, height: 4961 });
    expect(sizeInPixels('a4-landscape', 150, SCREEN)).toEqual({ width: 1754, height: 1240 });
    expect(sizeInPixels('a4-landscape', 96, SCREEN)).toEqual({ width: 1123, height: 794 });
  });

  it('is the map on screen at dpi / 96 for "same as the map on screen"', () => {
    expect(sizeInPixels('screen', 96, SCREEN)).toEqual(SCREEN);
    expect(sizeInPixels('screen', 300, SCREEN)).toEqual({ width: 3625, height: 2025 });
    expect(sizeInPixels('screen', 150, { width: 1001, height: 333 })).toEqual({
      width: 1564,
      height: 520,
    });
  });

  it('is the size that was typed for a custom size, whatever the dpi', () => {
    expect(sizeInPixels('custom', 300, SCREEN, { width: 640, height: 480 })).toEqual({
      width: 640,
      height: 480,
    });
  });
});

describe('maxSide', () => {
  it('is 8,192 unless the card allows less, and then the least of what it says', () => {
    expect(maxSide({ renderbuffer: 16_384, texture: 16_384, viewport: 16_384 })).toBe(
      MAX_EXPORT_SIDE,
    );
    expect(maxSide({ renderbuffer: 16_384, texture: 4096, viewport: 16_384 })).toBe(4096);
    expect(maxSide({ renderbuffer: 2048, texture: 8192, viewport: 8192 })).toBe(2048);
    expect(maxSide({ renderbuffer: 16_384, texture: 16_384, viewport: 3000 })).toBe(3000);
  });
});

describe('sizeProblems', () => {
  it('has none for a size that can be exported, the edges included', () => {
    expect(sizeProblems({ width: 3508, height: 2480 }, 8192)).toEqual([]);
    expect(sizeProblems({ width: MIN_EXPORT_SIDE, height: 8192 }, 8192)).toEqual([]);
  });

  it('says which side is too large and what the most is, and which is too small', () => {
    expect(sizeProblems({ width: 9000, height: 100 }, 8192)).toEqual([
      { code: 'too_large', side: 'width', most: 8192 },
    ]);
    expect(sizeProblems({ width: 100, height: 4097 }, 4096)).toEqual([
      { code: 'too_large', side: 'height', most: 4096 },
    ]);
    expect(sizeProblems({ width: 10, height: 100 }, 8192)).toEqual([
      { code: 'too_small', side: 'width', least: MIN_EXPORT_SIDE },
    ]);
    expect(sizeProblems({ width: 9000, height: 9000 }, 8192)).toHaveLength(2);
  });

  it('says it is not a size when a side is not a whole number', () => {
    expect(sizeProblems({ width: 100.5, height: 100 }, 8192)).toEqual([{ code: 'not_a_size' }]);
    expect(sizeProblems({ width: Number.NaN, height: 100 }, 8192)).toEqual([
      { code: 'not_a_size' },
    ]);
  });
});
