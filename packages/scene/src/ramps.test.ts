import { describe, expect, it } from 'vitest';
import { parseHex, relativeLuminance } from './colour.js';
import { RAMPS, RAMP_IDS, colourList, rampById, sampleRamp, type Ramp } from './ramps.js';

function get(id: string): Ramp {
  const found = rampById(id);
  if (found === undefined) {
    throw new Error(`No ramp ${id}`);
  }
  return found;
}

const luminances = (colours: readonly string[]): number[] =>
  colours.map((c) => relativeLuminance(parseHex(c) ?? [0, 0, 0]));

describe('the ramps', () => {
  it('have an id, a name, a kind, colours, a source and a licence each, and no id twice', () => {
    expect(new Set(RAMP_IDS).size).toBe(RAMPS.length);
    expect(RAMP_IDS).toEqual(RAMPS.map((r) => r.id));
    for (const entry of RAMPS) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(['sequential', 'diverging', 'categorical']).toContain(entry.kind);
      expect(entry.colours.length).toBeGreaterThanOrEqual(entry.kind === 'categorical' ? 1 : 2);
      expect(entry.source.length).toBeGreaterThan(0);
      expect(['CC0-1.0', 'Apache-2.0']).toContain(entry.licence);
      expect(entry.colours.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
    }
  });

  it('say which are from matplotlib under CC0 and which from ColorBrewer under Apache-2.0', () => {
    for (const id of ['viridis', 'magma']) {
      expect([get(id).licence, get(id).source]).toEqual([
        'CC0-1.0',
        expect.stringContaining('matplotlib'),
      ]);
    }
    for (const id of ['blues', 'ylorrd', 'rdbu', 'brbg']) {
      expect([get(id).licence, get(id).source]).toEqual([
        'Apache-2.0',
        expect.stringContaining('ColorBrewer'),
      ]);
    }
  });

  it('are found by id, and an id that is not one gives nothing', () => {
    expect(rampById('viridis')?.name).toBe('Viridis');
    expect(rampById('rainbow')).toBeUndefined();
    expect(rampById('constructor')).toBeUndefined();
    expect(rampById('')).toBeUndefined();
  });

  it('have colour data that is cut into colours, and refused if it is not #rrggbb in lower case', () => {
    expect(colourList('#440154#fde725')).toEqual(['#440154', '#fde725']);
    expect(() => colourList('#44015')).toThrow(/not #rrggbb/);
    expect(() => colourList('#440154#FDE725')).toThrow(/lower case/);
  });

  it('run light to dark or dark to light without turning back, for every sequential ramp', () => {
    // Rounding to whole numbers from 0 to 255 lets viridis dip by 0.0002 and 0.0003 of the scale of lightness twice
    // in its 256 colours (measured); a turn of more than 0.001 is not rounding but a table that is wrong.
    const rounding = 0.001;
    for (const entry of RAMPS.filter((r) => r.kind === 'sequential')) {
      const light = luminances(entry.colours);
      const direction = (light.at(-1) ?? 0) > (light[0] ?? 0) ? 1 : -1;
      const worstTurn = Math.max(
        0,
        ...light.slice(1).map((value, i) => -direction * (value - (light[i] ?? 0))),
      );
      expect([entry.id, worstTurn < rounding]).toEqual([entry.id, true]);
    }
  });

  it('go through a light middle, for every diverging ramp', () => {
    for (const entry of RAMPS.filter((r) => r.kind === 'diverging')) {
      const middle = entry.colours[(entry.colours.length - 1) / 2] ?? '#000000';
      expect(relativeLuminance(parseHex(middle) ?? [0, 0, 0])).toBeGreaterThan(0.85);
    }
  });
});

describe('sampleRamp', () => {
  it('gives the stops themselves when asked for as many as there are', () => {
    for (const entry of RAMPS) {
      expect(sampleRamp(entry, entry.colours.length)).toEqual(entry.colours);
    }
  });

  it('puts the first colour first and the last colour last, for any number from 2', () => {
    const viridis = get('viridis');
    for (const n of [2, 3, 7, 12, 20]) {
      const colours = sampleRamp(viridis, n);
      expect(colours).toHaveLength(n);
      expect([colours[0], colours.at(-1)]).toEqual(['#440154', '#fde725']);
    }
  });

  it('mixes between stops: three of the nine blues are the first, the fifth and the last', () => {
    const blues = get('blues');
    expect(sampleRamp(blues, 3)).toEqual(['#f7fbff', blues.colours[4], '#08306b']);
    // Seven of the nine are in between: the second colour is a third of the way from the first stop to the second.
    expect(sampleRamp(blues, 5)[1]).toBe(blues.colours[2]);
  });

  it('gives the middle of the ramp for one class', () => {
    expect(sampleRamp(get('blues'), 1)).toEqual([get('blues').colours[4]]);
    expect(sampleRamp(get('viridis'), 1)).toHaveLength(1);
  });

  it('reverses: from the last colour of the ramp to the first, and not by changing the ramp', () => {
    const blues = get('blues');
    const before = [...blues.colours];
    expect(sampleRamp(blues, 7, true)).toEqual([...sampleRamp(blues, 7)].reverse());
    expect(sampleRamp(blues, 7, true)[0]).toBe('#08306b');
    expect(blues.colours).toEqual(before);
  });

  it('gives the same colours every time, and always #rrggbb in lower case', () => {
    for (const entry of RAMPS) {
      for (const n of [1, 2, 5, 12, 20]) {
        const first = sampleRamp(entry, n);
        expect(sampleRamp(entry, n)).toEqual(first);
        expect(first.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
      }
    }
  });

  it('gives a categorical ramp`s colours in order, and starts again after the last', () => {
    const palette: Ramp = {
      id: 'test',
      name: 'Test',
      kind: 'categorical',
      colours: ['#111111', '#222222', '#333333'],
      source: 'a test',
      licence: 'CC0-1.0',
    };
    expect(sampleRamp(palette, 2)).toEqual(['#111111', '#222222']);
    expect(sampleRamp(palette, 5)).toEqual(['#111111', '#222222', '#333333', '#111111', '#222222']);
    expect(sampleRamp(palette, 3, true)).toEqual(['#333333', '#222222', '#111111']);
  });

  it('is a mistake to ask for no colours, or half a colour, or not a number', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => sampleRamp(get('viridis'), bad)).toThrow(RangeError);
    }
  });
});
