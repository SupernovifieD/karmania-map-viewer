import { describe, expect, it } from 'vitest';
import { colourOf } from './look.js';

describe('colourOf', () => {
  it('reads #rrggbb as three numbers from 0 to 1, as they are', () => {
    expect(colourOf('#000000')).toEqual([0, 0, 0]);
    expect(colourOf('#ffffff')).toEqual([1, 1, 1]);
    expect(colourOf('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(colourOf('#e9ecf0')).toEqual([233 / 255, 236 / 255, 240 / 255]);
  });

  it('does not mind the case, and a byte is a byte after the round trip through 0 to 1', () => {
    expect(colourOf('#AbCdEf')).toEqual(colourOf('#abcdef'));
    for (const byte of [0, 1, 17, 127, 128, 200, 254, 255]) {
      const hex = `#${byte.toString(16).padStart(2, '0')}0000`;
      expect(Math.round(colourOf(hex)[0] * 255)).toBe(byte);
    }
  });

  it('is mid grey for what is not #rrggbb, rather than a fault in the middle of a frame', () => {
    for (const text of [
      '',
      'red',
      '#fff',
      '#12345',
      '#1234567',
      'e9ecf0',
      '#gg0000',
      'rgb(0,0,0)',
    ]) {
      expect(colourOf(text), JSON.stringify(text)).toEqual([0.5, 0.5, 0.5]);
    }
  });
});
