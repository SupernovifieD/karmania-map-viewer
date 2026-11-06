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
  it('uses no decimals when the bounds are apart without them', () => {
    expect(formatBounds([0, 10, 20, 30])).toEqual(['0', '10', '20', '30']);
    expect(formatBounds([1000000, 2000000, 3000000])).toEqual([
      '1,000,000',
      '2,000,000',
      '3,000,000',
    ]);
  });

  it('uses the fewest decimals that keep neighbours apart, the same for every bound', () => {
    expect(formatBounds([0, 2.5, 5, 7.5, 10])).toEqual(['0.0', '2.5', '5.0', '7.5', '10.0']);
    expect(formatBounds([0, 0.001, 0.002])).toEqual(['0.000', '0.001', '0.002']);
    expect(formatBounds([0.1, 0.25, 0.4])).toEqual(['0.10', '0.25', '0.40']);
    expect(formatBounds([1.14, 1.2, 1.3])).toEqual(['1.14', '1.20', '1.30']);
  });

  it('rounds bounds that are not clean, to what keeps them apart', () => {
    const seven = Array.from({ length: 8 }, (_, k) => (8 * k) / 7);
    expect(formatBounds(seven)).toEqual(['0.0', '1.1', '2.3', '3.4', '4.6', '5.7', '6.9', '8.0']);
  });

  it('goes no further than 6 significant digits, so two bounds that are closer than that have the same label', () => {
    expect(formatBounds([0.1234567, 0.1234568])).toEqual(['0.123457', '0.123457']);
    expect(formatBounds([123456.7, 123456.8])).toEqual(['123,457', '123,457']);
    expect(formatBounds([1234.5678, 1234.5679])).toEqual(['1,234.57', '1,234.57']);
  });

  it('does not write what is not there: bounds that are far apart do not get the decimals of one that has many', () => {
    expect(formatBounds([0.000123456, 1000])).toEqual(['0', '1,000']);
    expect(formatBounds([100000.4, 200000.4])).toEqual(['100,000', '200,000']);
  });

  it('does not let rounding turn a bound into another number: 2.5 is not 3, and 7 is not 7.0 where no bound needs a decimal', () => {
    // The fewest decimals that keep these apart is none (0, 3, 5, 8, 10), but those are not the bounds.
    expect(formatBounds([0, 2.5, 5, 7.5, 10])).toEqual(['0.0', '2.5', '5.0', '7.5', '10.0']);
    expect(formatBounds([0, 7, 14])).toEqual(['0', '7', '14']);
    // 10.5 would read 11, which is exactly a tenth of the narrowest class (5) away: that is not less than a tenth.
    expect(formatBounds([0, 5, 10.5])).toEqual(['0.0', '5.0', '10.5']);
    expect(formatBounds([3.7])).toEqual(['3.7']);
    expect(formatBounds([3.7, 3.7])).toEqual(['3.7', '3.7']);
    // With no class to measure by, a bound reads as itself to a millionth.
    expect(formatBounds([1.0000001])).toEqual(['1']);
    expect(formatBounds([1.001])).toEqual(['1.001']);
    expect(formatBounds([5, 5.1, 9])).toEqual(['5.0', '5.1', '9.0']);
    expect(formatBounds([0, 0.4, 100])).toEqual(['0.0', '0.4', '100.0']);
  });

  it('does not count equal neighbours, a largest value that is a class of its own, as bounds to keep apart', () => {
    expect(formatBounds([3, 5, 5])).toEqual(['3', '5', '5']);
    expect(formatBounds([2.5, 7, 7])).toEqual(['2.5', '7.0', '7.0']);
    // A bound that could have six decimals does not make the equal ones at the end ask for them.
    expect(formatBounds([0.4, 9, 9])).toEqual(['0', '9', '9']);
  });

  it('writes negative bounds with the minus sign, zero without one, and a single bound, and none', () => {
    expect(formatBounds([-10, 0, 10])).toEqual([`${MINUS}10`, '0', '10']);
    expect(formatBounds([-0.5, 0, 0.5])).toEqual([`${MINUS}0.5`, '0.0', '0.5']);
    expect(formatBounds([42])).toEqual(['42']);
    expect(formatBounds([])).toEqual([]);
  });
});
