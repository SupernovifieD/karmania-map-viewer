import { describe, expect, it } from 'vitest';
import {
  describeOther,
  nodataFromSuggestions,
  nodataOf,
  numberLabel,
  parseOther,
  tokenLabel,
  withNumber,
  withToken,
} from './import-nodata.js';

const suggested = nodataFromSuggestions({
  tokens: [
    { token: '', count: 1 },
    { token: 'NA', count: 4 },
  ],
  numbers: [
    { value: -999, count: 3 },
    { value: 1e30, count: 1 },
  ],
});

describe('the values that mean "no data" a file starts with', () => {
  it('are all that the kernel suggested, ticked', () => {
    expect(suggested.tokens.map((each) => [each.token, each.count, each.use])).toEqual([
      ['', 1, true],
      ['NA', 4, true],
    ]);
    expect(suggested.numbers.map((each) => [each.value, each.use])).toEqual([
      [-999, true],
      [1e30, true],
    ]);
    expect(suggested.other).toBe('');
  });

  it('can be unticked and ticked again, one at a time', () => {
    const off = withNumber(withToken(suggested, 1, false), 0, false);
    expect(off.tokens.map((each) => each.use)).toEqual([true, false]);
    expect(off.numbers.map((each) => each.use)).toEqual([false, true]);
    expect(withToken(off, 1, true).tokens[1]?.use).toBe(true);
    expect(suggested.tokens[1]?.use).toBe(true);
  });
});

describe('the other values a person types', () => {
  it('are numbers when they are, and words when they are not', () => {
    expect(parseOther('-1, none, 1e30, .5, 10., n/a')).toEqual({
      tokens: ['none', 'n/a'],
      numbers: [-1, 1e30, 0.5, 10],
    });
  });

  it('are nothing when they are not there, and empty parts are nothing', () => {
    expect(parseOther('')).toEqual({ tokens: [], numbers: [] });
    expect(parseOther(' , ,, ')).toEqual({ tokens: [], numbers: [] });
  });

  it('take a comma to be a separator, so a number with a decimal comma is two numbers', () => {
    expect(parseOther('1,5')).toEqual({ tokens: [], numbers: [1, 5] });
  });

  it('are words if they only look like numbers, such as an exponent with nothing before it or two points', () => {
    expect(parseOther('e5, 1.2.3, --1, 0x10, Infinity').numbers).toEqual([]);
    expect(parseOther('e5, 1.2.3, --1, 0x10, Infinity').tokens).toHaveLength(5);
  });
});

describe('the values that mean "no data" as an import takes them', () => {
  it('are the ticked suggestions, then the typed ones', () => {
    expect(nodataOf({ ...suggested, other: '-1, none' })).toEqual({
      tokens: ['', 'NA', 'none'],
      numbers: [-999, 1e30, -1],
    });
  });

  it('leave out what is not ticked', () => {
    expect(nodataOf(withToken(withNumber(suggested, 0, false), 0, false))).toEqual({
      tokens: ['NA'],
      numbers: [1e30],
    });
  });

  it('have each value once, words whatever their case', () => {
    expect(nodataOf({ ...suggested, other: 'na, NA, -999, -999' })).toEqual({
      tokens: ['', 'NA'],
      numbers: [-999, 1e30],
    });
  });

  it('are nothing when nothing is ticked or typed', () => {
    expect(nodataOf({ tokens: [], numbers: [], other: '' })).toEqual({ tokens: [], numbers: [] });
  });
});

describe('writing the values for people', () => {
  it('says an empty cell in words, and a number without a plus in its exponent', () => {
    expect(tokenLabel('')).toBe('(empty cell)');
    expect(tokenLabel('N/A')).toBe('N/A');
    expect(numberLabel(-999)).toBe('-999');
    expect(numberLabel(1e30)).toBe('1e30');
    expect(numberLabel(-1.70141e38)).toBe('-1.70141e38');
    expect(numberLabel(1e-7)).toBe('1e-7');
  });

  it('says how what was typed is read', () => {
    expect(describeOther('')).toBe('');
    expect(describeOther('none')).toBe('Read as the word "none".');
    expect(describeOther('-1, 2.5')).toBe('Read as the numbers -1, 2.5.');
    expect(describeOther('n/a, nil, -1')).toBe('Read as the words "n/a", "nil" and the number -1.');
  });
});
