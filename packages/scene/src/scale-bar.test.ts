import type { CrsUnits } from '@karmania/engine/types';
import { describe, expect, it } from 'vitest';
import { SCALE_BAR_MAX_PIXELS, scaleBar, type ScaleBar, type ScaleBarModel } from './scale-bar.js';

function bar(unitsPerPixel: number, units: CrsUnits = 'm', maxPixels?: number): ScaleBar {
  const result = scaleBar({
    viewMode: '2d',
    units,
    unitsPerPixel,
    ...(maxPixels === undefined ? {} : { maxPixels }),
  });
  if (result.kind !== 'bar') {
    throw new Error(`No bar for ${String(unitsPerPixel)} ${units}: ${result.reason}`);
  }
  return result;
}

const summary = (b: ScaleBar): [string, number] => [b.label, b.widthPx];

describe('the scale bar of a map in metres', () => {
  it('is a nice length that fits in 160 pixels, as wide as the map says that length is', () => {
    expect(summary(bar(1))).toEqual(['100 m', 100]);
    expect(summary(bar(0.5))).toEqual(['50 m', 100]);
    expect(summary(bar(2))).toEqual(['200 m', 100]);
    expect(summary(bar(0.01))).toEqual(['1 m', 100]);
    expect(summary(bar(0.3))).toEqual(['20 m', 20 / 0.3]);
    expect(bar(1)).toMatchObject({ kind: 'bar', value: 100, unit: 'm', mapUnits: 100 });
  });

  it('uses the whole 160 pixels when the room is exactly a nice length, and the next one down just under', () => {
    expect(summary(bar(0.625))).toEqual(['100 m', 160]);
    expect(summary(bar(1.25))).toEqual(['200 m', 160]);
    expect(summary(bar(3.125))).toEqual(['500 m', 160]);
    expect(summary(bar(12.5))).toEqual(['2 km', 160]);
    expect(summary(bar(0.6249))).toEqual(['50 m', 50 / 0.6249]);
    expect(bar(0.6251).label).toBe('100 m');
  });

  it('writes kilometres from 1,000 metres, and metres below', () => {
    expect(summary(bar(6.25))).toEqual(['1 km', 160]);
    expect(bar(6.24375).label).toBe('500 m');
    expect(summary(bar(10))).toEqual(['1 km', 100]);
    expect(bar(100).label).toBe('10 km');
    expect(bar(1e4).label).toBe('1,000 km');
    expect(bar(31.25).label).toBe('5 km');
  });

  it('writes parts of a metre with the decimals they need, and nothing below a millionth', () => {
    expect(bar(0.001).label).toBe('0.1 m');
    expect(bar(0.00002).label).toBe('0.002 m');
    expect(bar(1e-5).label).toBe('0.001 m');
    expect(bar(1e-6).label).toBe('0.0001 m');
    expect(scaleBar({ viewMode: '2d', units: 'm', unitsPerPixel: 1e-9 })).toMatchObject({
      kind: 'none',
      reason: 'no_scale',
    });
  });
});

describe('the scale bar of a map in feet', () => {
  it('is in feet, then in miles from 5,280, for feet and for US survey feet alike', () => {
    for (const units of ['ft', 'us_ft'] as const) {
      expect(summary(bar(1, units))).toEqual(['100 ft', 100]);
      expect(bar(30, units).label).toBe('2,000 ft');
      // 160 pixels of 32.99 feet are 5,278 feet, which is not yet a mile.
      expect(bar(32.99, units).label).toBe('5,000 ft');
      expect(summary(bar(33, units))).toEqual(['1 mi', 5280 / 33]);
      expect(bar(40, units)).toMatchObject({ value: 1, unit: 'mi', mapUnits: 5280 });
      expect(bar(330, units).label).toBe('10 mi');
    }
  });

  it('writes a nice number of miles, not a nice number of feet that is a fraction of one', () => {
    expect(bar(100, 'ft').label).toBe('2 mi');
    expect(bar(200, 'us_ft').label).toBe('5 mi');
  });
});

describe('the scale bar, for any map', () => {
  it('is never wider than the room, and never under 0.4 of it (a nice number is within 2.5 times of what it fits in)', () => {
    let state = 7;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    // Every check is made for every scale, but a failure is noted and said once at the end: thousands of `expect` calls,
    // each with a message made for it, took 2.5 s and a loaded machine took more than the 5 s a test is given.
    const wrong: string[] = [];
    for (let i = 0; i < 3000; i += 1) {
      const unitsPerPixel = 10 ** (next() * 10 - 4);
      for (const units of ['m', 'ft', 'us_ft'] as const) {
        const b = bar(unitsPerPixel, units);
        const lead = Number((b.value / 10 ** Math.floor(Math.log10(b.value))).toPrecision(9));
        const checks = [
          b.widthPx <= SCALE_BAR_MAX_PIXELS,
          b.widthPx >= SCALE_BAR_MAX_PIXELS * 0.4 - 1e-9,
          lead === 1 || lead === 2 || lead === 5,
          Math.abs(b.widthPx - b.mapUnits / unitsPerPixel) < 1e-6,
        ];
        if (checks.includes(false)) {
          wrong.push(`${String(unitsPerPixel)} ${units}: ${JSON.stringify(checks)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  }, 20_000);

  it('is never wider than the room even where the arithmetic overshoots it by a rounding error', () => {
    // 5e-7 units to a pixel and 100 pixels is room for 5.000000000000001e-5, and 5e-5 over 5e-7 is 100.00000000000001.
    expect(bar(5e-7, 'm', 100).widthPx).toBe(100);
    expect(bar(3.1249999999999997e-7, 'm').widthPx).toBe(160);
  });

  it('takes the widest it can be from the caller', () => {
    expect(summary(bar(1, 'm', 100))).toEqual(['100 m', 100]);
    expect(summary(bar(1, 'm', 50))).toEqual(['50 m', 50]);
    expect(bar(1, 'm', 1000).label).toBe('1 km');
    expect(() => scaleBar({ viewMode: '2d', units: 'm', unitsPerPixel: 1, maxPixels: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      scaleBar({ viewMode: '2d', units: 'm', unitsPerPixel: 1, maxPixels: NaN }),
    ).toThrow(RangeError);
    expect(() => scaleBar({ viewMode: '2d', units: 'm', unitsPerPixel: 1, maxPixels: -5 })).toThrow(
      RangeError,
    );
  });
});

describe('no scale bar, and why', () => {
  const none = (input: Parameters<typeof scaleBar>[0]): ScaleBarModel => scaleBar(input);

  it('is none in 3D, even for a map that has a scale', () => {
    expect(none({ viewMode: '3d', units: 'm', unitsPerPixel: 1 })).toEqual({
      kind: 'none',
      reason: 'three_d',
      message: 'The scale bar is only shown in the 2D view.',
    });
  });

  it('is none for a map in degrees, and for units that are not known', () => {
    expect(none({ viewMode: '2d', units: 'degree', unitsPerPixel: 0.001 })).toEqual({
      kind: 'none',
      reason: 'geographic',
      message: 'A map in degrees has no scale bar.',
    });
    expect(none({ viewMode: '2d', units: 'other', unitsPerPixel: 1 })).toMatchObject({
      kind: 'none',
      reason: 'unknown_units',
    });
  });

  it('is none when there is no map yet', () => {
    expect(none({ viewMode: '2d', units: undefined, unitsPerPixel: 1 })).toEqual({
      kind: 'none',
      reason: 'no_map',
      message: 'There is no map to measure yet.',
    });
  });

  it('is none while the units are being looked up, and says so and not that there is no map', () => {
    expect(none({ viewMode: '2d', units: 'pending', unitsPerPixel: 1 })).toEqual({
      kind: 'none',
      reason: 'units_pending',
      message: 'The units of this coordinate system are being looked up.',
    });
  });

  it('is none when the map has no scale: not above 0, not a number, or too small to write', () => {
    for (const unitsPerPixel of [0, -1, NaN, Infinity, 1e-9]) {
      expect(none({ viewMode: '2d', units: 'm', unitsPerPixel })).toEqual({
        kind: 'none',
        reason: 'no_scale',
        message: 'The map has no scale yet.',
      });
    }
  });

  it('says the reason that comes first: 3D before units, units before scale', () => {
    expect(none({ viewMode: '3d', units: 'degree', unitsPerPixel: NaN })).toMatchObject({
      reason: 'three_d',
    });
    expect(none({ viewMode: '2d', units: 'degree', unitsPerPixel: NaN })).toMatchObject({
      reason: 'geographic',
    });
    expect(none({ viewMode: '2d', units: undefined, unitsPerPixel: NaN })).toMatchObject({
      reason: 'no_map',
    });
    expect(none({ viewMode: '3d', units: 'pending', unitsPerPixel: NaN })).toMatchObject({
      reason: 'three_d',
    });
    expect(none({ viewMode: '2d', units: 'pending', unitsPerPixel: NaN })).toMatchObject({
      reason: 'units_pending',
    });
  });
});
