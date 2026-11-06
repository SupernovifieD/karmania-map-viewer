import { describe, expect, it } from 'vitest';
import { BREWER_DIVERGING, BREWER_PAIRED, BREWER_SEQUENTIAL, MAGMA, VIRIDIS } from './ramp-data.js';

/** FNV-1a, 32 bits, over the characters: a checksum that is the same everywhere and needs no library. */
function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const TABLES: [string, string, number, string][] = [
  ['viridis', VIRIDIS, 256, 'e9921c7b'],
  ['magma', MAGMA, 256, 'dbf31a7c'],
  ['blues', BREWER_SEQUENTIAL.blues, 9, '9ef5de15'],
  ['greens', BREWER_SEQUENTIAL.greens, 9, '02805fd0'],
  ['oranges', BREWER_SEQUENTIAL.oranges, 9, 'c78e5898'],
  ['reds', BREWER_SEQUENTIAL.reds, 9, '08ce5d40'],
  ['purples', BREWER_SEQUENTIAL.purples, 9, '79416275'],
  ['ylgnbu', BREWER_SEQUENTIAL.ylgnbu, 9, '1637a8a1'],
  ['ylorrd', BREWER_SEQUENTIAL.ylorrd, 9, '2c68da54'],
  ['rdbu', BREWER_DIVERGING.rdbu, 11, '4841b56c'],
  ['puor', BREWER_DIVERGING.puor, 11, 'f4bd1b81'],
  ['brbg', BREWER_DIVERGING.brbg, 11, '6487f3cb'],
  ['paired', BREWER_PAIRED, 12, '5094fee5'],
];

describe('the colour data', () => {
  it.each(TABLES)(
    '%s is the table that was taken from its source, %i colours of #rrggbb',
    (_name, data, count, sum) => {
      expect(data).toMatch(/^(#[0-9a-f]{6})+$/);
      expect(data.length / 7).toBe(count);
      expect(checksum(data)).toBe(sum);
    },
  );

  it('has the end points that viridis and magma are known by', () => {
    expect([VIRIDIS.slice(0, 7), VIRIDIS.slice(-7)]).toEqual(['#440154', '#fde725']);
    expect([MAGMA.slice(0, 7), MAGMA.slice(-7)]).toEqual(['#000004', '#fcfdbf']);
  });

  it('has the end points that ColorBrewer`s schemes are known by', () => {
    expect([BREWER_SEQUENTIAL.blues.slice(0, 7), BREWER_SEQUENTIAL.blues.slice(-7)]).toEqual([
      '#f7fbff',
      '#08306b',
    ]);
    expect([BREWER_DIVERGING.rdbu.slice(0, 7), BREWER_DIVERGING.rdbu.slice(-7)]).toEqual([
      '#67001f',
      '#053061',
    ]);
    expect(BREWER_PAIRED.slice(0, 7)).toBe('#a6cee3');
  });
});
