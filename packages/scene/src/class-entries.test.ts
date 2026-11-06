import type { ClassBreaks } from '@karmania/engine/display';
import { describe, expect, it } from 'vitest';
import { OTHER_COLOUR, classColours, classCount, classEntries } from './class-entries.js';
import { MINUS } from './numbers.js';
import { contrastOnMaps } from './palettes.js';
import { rampById, sampleRamp } from './ramps.js';
import type { ClassColour } from './types.js';

const style: ClassColour = {
  mode: 'classes',
  column: 'z',
  method: 'equal',
  classes: 3,
  ramp: 'viridis',
  reverse: false,
};
const ranges = (bounds: number[], counts: number[], nulls = 0): ClassBreaks => ({
  kind: 'ranges',
  column: 'z',
  bounds,
  counts,
  nulls,
});
const viridis = (n: number, reverse = false): readonly string[] =>
  sampleRamp(rampById('viridis') ?? never(), n, reverse);

function never(): never {
  throw new Error('no ramp');
}

describe('the colours of the classes', () => {
  it('are the ramp sampled to as many colours as the breaks have classes, not as many as were asked for', () => {
    expect(classColours(style, ranges([0, 10, 20, 30], [5, 5, 5]))).toEqual(viridis(3));
    expect(classColours({ ...style, classes: 7 }, ranges([0, 10, 20, 30], [5, 5, 5]))).toEqual(
      viridis(3),
    );
    expect(classColours(style, ranges([4, 4], [9]))).toEqual(viridis(1));
  });

  it('run from the last colour of the ramp when it is reversed', () => {
    expect(classColours({ ...style, reverse: true }, ranges([0, 10, 20, 30], [5, 5, 5]))).toEqual(
      viridis(3, true),
    );
  });

  it('are the colours of a categorical palette in order for categories, with Other not among them', () => {
    const breaks: ClassBreaks = {
      kind: 'categories',
      column: 'rock',
      values: ['a', 'b', 'c'],
      counts: [3, 2, 1],
      other: 4,
      nulls: 0,
    };
    const okabe = rampById('okabe-ito')?.colours ?? [];
    expect(classColours({ ...style, method: 'categories', ramp: 'okabe-ito' }, breaks)).toEqual(
      okabe.slice(0, 3),
    );
  });

  it('are none for no classes, and a mistake for a ramp that is not one', () => {
    expect(classColours(style, ranges([], []))).toEqual([]);
    expect(() => classColours({ ...style, ramp: 'rainbow' }, ranges([0, 1], [1]))).toThrow(
      RangeError,
    );
  });

  it('count the classes of ranges, and the categories that are listed without Other', () => {
    expect(classCount(ranges([0, 1, 2], [1, 1]))).toBe(2);
    expect(
      classCount({
        kind: 'categories',
        column: 'r',
        values: ['a', 'b'],
        counts: [1, 1],
        other: 5,
        nulls: 0,
      }),
    ).toBe(2);
  });

  it('have a grey for Other that is under 3 to 1 on the light map and over on the dark map, as an independent calculation says', () => {
    expect(OTHER_COLOUR).toBe('#8c8c8c');
    const { light, dark } = contrastOnMaps(OTHER_COLOUR);
    expect([Number(light.toFixed(2)), Number(dark.toFixed(2))]).toEqual([2.84, 5.67]);
  });
});

describe('the lines under a layer, by ranges', () => {
  it('are each class with its label, its count and its colour', () => {
    const entries = classEntries(style, ranges([0, 10, 20, 30], [5, 1500, 7]));
    expect(entries).toEqual([
      { label: '0 – 10', count: 5, countLabel: '5', colour: viridis(3)[0] },
      { label: '10 – 20', count: 1500, countLabel: '1,500', colour: viridis(3)[1] },
      { label: '20 – 30', count: 7, countLabel: '7', colour: viridis(3)[2] },
    ]);
  });

  it('write the bounds with the decimals they need, the same for all, and the minus sign', () => {
    const labels = classEntries(style, ranges([-2.5, 0, 2.5, 5], [1, 1, 1])).map((e) => e.label);
    expect(labels).toEqual([`${MINUS}2.5 – 0.0`, '0.0 – 2.5', '2.5 – 5.0']);
  });

  it('read a class of one value, the largest being a class of its own, as that value and not as a range of it', () => {
    const entries = classEntries(style, ranges([0, 5, 5], [8, 2]));
    expect(entries.map((e) => e.label)).toEqual(['0 – 5', '5']);
    expect(classEntries(style, ranges([42, 42], [10])).map((e) => e.label)).toEqual(['42']);
  });

  it('end with "No value" and no colour when elements have none, and have no such line when none lacks one', () => {
    const entries = classEntries(style, ranges([0, 10], [5], 3));
    expect(entries.at(-1)).toEqual({ label: 'No value', count: 3, countLabel: '3', colour: null });
    expect(classEntries(style, ranges([0, 10], [5], 0)).map((e) => e.label)).toEqual(['0 – 10']);
  });

  it('keep a class with no element, which is as the engine counted it', () => {
    expect(classEntries(style, ranges([0, 10, 20], [0, 4])).map((e) => e.count)).toEqual([0, 4]);
  });
});

describe('the lines under a layer, by categories', () => {
  const breaks: ClassBreaks = {
    kind: 'categories',
    column: 'rock',
    values: ['granite', 'basalt', 2024, true],
    counts: [10, 2000, 3, 1],
    other: 6,
    nulls: 2,
  };
  const by: ClassColour = { ...style, method: 'categories', ramp: 'okabe-ito' };

  it('are the categories as they are, most common first as the engine gave them, then Other, then No value', () => {
    const entries = classEntries(by, breaks);
    expect(entries.map((e) => [e.label, e.count, e.countLabel])).toEqual([
      ['granite', 10, '10'],
      ['basalt', 2000, '2,000'],
      ['2024', 3, '3'],
      ['true', 1, '1'],
      ['Other', 6, '6'],
      ['No value', 2, '2'],
    ]);
  });

  it('give each category the colour of its place, Other its grey and No value none', () => {
    const okabe = rampById('okabe-ito')?.colours ?? [];
    expect(classEntries(by, breaks).map((e) => e.colour)).toEqual([
      ...okabe.slice(0, 4),
      OTHER_COLOUR,
      null,
    ]);
  });

  it('have no Other when there is none, and none of the lines that are not needed', () => {
    const entries = classEntries(by, {
      kind: 'categories',
      column: 'r',
      values: ['a'],
      counts: [4],
      nulls: 0,
    });
    expect(entries.map((e) => e.label)).toEqual(['a']);
  });
});
