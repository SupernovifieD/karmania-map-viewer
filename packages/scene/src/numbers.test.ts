import { describe, expect, it } from 'vitest';
import { BOUND_DASH, MINUS, formatBounds, formatCount, formatNumber } from './numbers.js';

describe('formatNumber', () => {
  it('puts commas between the thousands, and exactly the decimals asked for', () => {
    expect(formatNumber(1234567.891, 2)).toBe('1,234,567.89');
    expect(formatNumber(1234567.891, 0)).toBe('1,234,568');
    expect(formatNumber(999, 0)).toBe('999');
    expect(formatNumber(1000, 0)).toBe('1,000');
    expect(formatNumber(12, 3)).toBe('12.000');
    expect(formatNumber(0, 0)).toBe('0');
    expect(formatNumber(0.5, 2)).toBe('0.50');
  });

  it('writes a negative number with a true minus sign, and no sign for what rounds to nothing', () => {
    expect(MINUS).toBe('−');
    expect(formatNumber(-1234.5, 1)).toBe('−1,234.5');
    expect(formatNumber(-0.04, 1)).toBe('0.0');
    expect(formatNumber(-0, 0)).toBe('0');
    expect(formatNumber(-0.06, 1)).toBe('−0.1');
    expect(formatNumber(-1, 0)).toBe('−1');
  });

  it('is the same in every locale: it does not ask the platform', () => {
    expect(formatNumber(1234567.5, 1)).toBe('1,234,567.5');
    expect(formatNumber(0.001, 3)).toBe('0.001');
  });

  it('keeps decimals between 0 and 20, whatever it is asked, and does not mind a fraction of one', () => {
    expect(formatNumber(1.5, -3)).toBe('2');
    expect(formatNumber(1, 2.9)).toBe('1.00');
    expect(formatNumber(1, 99).split('.')[1]).toHaveLength(20);
    expect(formatNumber(1, NaN)).toBe('1');
  });

  it('writes a very large number with 6 significant digits and an exponent, and a number that is not one as it is', () => {
    expect(formatNumber(1e21, 2)).toBe('1.00000e+21');
    expect(formatNumber(-2.5e30, 0)).toBe(`${MINUS}2.50000e+30`);
    expect(formatNumber(NaN, 2)).toBe('NaN');
    expect(formatNumber(Infinity, 2)).toBe('Infinity');
    expect(formatNumber(1e20, 0)).toBe('100,000,000,000,000,000,000');
  });
});

describe('formatCount', () => {
  it('is a whole number with commas', () => {
    expect([0, 7, 999, 1000, 1234567].map(formatCount)).toEqual([
      '0',
      '7',
      '999',
      '1,000',
      '1,234,567',
    ]);
  });
});

describe('the dash between bounds', () => {
  it('is an en dash with a space on each side', () => {
    expect(BOUND_DASH).toBe(' – ');
  });
});

describe('formatBounds', () => {
  it('writes each bound as it is: no decimals added to the ones that have none, none taken off the ones that have them', () => {
    expect(formatBounds([0, 10, 20, 30])).toEqual(['0', '10', '20', '30']);
    expect(formatBounds([0, 2.5, 5, 7.5, 10])).toEqual(['0', '2.5', '5', '7.5', '10']);
    expect(formatBounds([0, 0.001, 0.002])).toEqual(['0', '0.001', '0.002']);
    expect(formatBounds([1.14, 1.2, 1.3])).toEqual(['1.14', '1.2', '1.3']);
    expect(formatBounds([3.7])).toEqual(['3.7']);
  });

  it('does not round: bounds that are close are as close as they are, and the digits of a bound are all there', () => {
    expect(formatBounds([0.1234567, 0.1234568])).toEqual(['0.1234567', '0.1234568']);
    expect(formatBounds([123456.7, 123456.8])).toEqual(['123,456.7', '123,456.8']);
    expect(formatBounds([1234.5678, 1234.5679])).toEqual(['1,234.5678', '1,234.5679']);
    expect(formatBounds([1.0000001])).toEqual(['1.0000001']);
    expect(formatBounds([0.000123456, 1000])).toEqual(['0.000123456', '1,000']);
    expect(formatBounds([100000.4, 200000.4])).toEqual(['100,000.4', '200,000.4']);
  });

  it('takes off only the noise of arithmetic, at 15 significant digits, so a sum is the number it was meant to be', () => {
    expect(formatBounds([0.1 + 0.2])).toEqual(['0.3']);
    expect(formatBounds([1 - 0.9])).toEqual(['0.1']);
    const seven = Array.from({ length: 8 }, (_, k) => (8 * k) / 7);
    expect(formatBounds(seven).slice(0, 3)).toEqual(['0', '1.14285714285714', '2.28571428571429']);
    expect(formatBounds([0.123456789012345])).toEqual(['0.123456789012345']);
    expect(formatBounds([123456789.012345])).toEqual(['123,456,789.012345']);
  });

  it('puts commas between the thousands of the whole part only', () => {
    expect(formatBounds([1000000, 2000000.5, 3000000])).toEqual([
      '1,000,000',
      '2,000,000.5',
      '3,000,000',
    ]);
    expect(formatBounds([999, 1000, 0.5])).toEqual(['999', '1,000', '0.5']);
    expect(formatBounds([1e20])).toEqual(['100,000,000,000,000,000,000']);
  });

  it('writes a bound the same whatever the bounds next to it are', () => {
    const bounds = [-1234.5, -0.25, 0, 0.1 + 0.2, 7, 1e-7, 9.5e21];
    const alone = bounds.map((bound) => formatBounds([bound])[0]);
    expect(formatBounds(bounds)).toEqual(alone);
    expect(formatBounds([...bounds].reverse())).toEqual([...alone].reverse());
  });

  it('keeps the exponent of a number that the platform writes with one, and writes one that is not finite as it is', () => {
    expect(formatBounds([1e-7, 1.5e-7])).toEqual(['1e-7', '1.5e-7']);
    expect(formatBounds([1e21, 2.5e30])).toEqual(['1e+21', '2.5e+30']);
    expect(formatBounds([-1e-7])).toEqual([`${MINUS}1e-7`]);
    expect(formatBounds([NaN, Infinity, -Infinity])).toEqual(['NaN', 'Infinity', '-Infinity']);
  });

  it('writes negative bounds with the minus sign, zero without one, and a single bound, and none', () => {
    expect(formatBounds([-10, 0, 10])).toEqual([`${MINUS}10`, '0', '10']);
    expect(formatBounds([-0.5, 0, 0.5])).toEqual([`${MINUS}0.5`, '0', '0.5']);
    expect(formatBounds([-0, 0])).toEqual(['0', '0']);
    expect(formatBounds([-1234567.5])).toEqual([`${MINUS}1,234,567.5`]);
    expect(formatBounds([42])).toEqual(['42']);
    expect(formatBounds([])).toEqual([]);
  });

  it('gives equal neighbours equal labels, as the largest value that is a class of its own needs', () => {
    expect(formatBounds([3, 5, 5])).toEqual(['3', '5', '5']);
    expect(formatBounds([2.5, 7, 7])).toEqual(['2.5', '7', '7']);
  });
});
