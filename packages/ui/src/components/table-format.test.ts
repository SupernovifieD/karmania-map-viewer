import { describe, expect, it } from 'vitest';
import { formatCell, formatNumber, isNull, isNumeric, NULL_TEXT } from './table-format.js';
import type { TableColumn } from './table.js';

const column = (values: TableColumn['values'], nulls: number[] = []): TableColumn => ({
  name: 'c',
  values,
  nulls: Uint8Array.from({ length: values.length }, (_, index) => (nulls.includes(index) ? 1 : 0)),
});

describe('a number in a cell', () => {
  it('is whole when it is whole, and has no zeros after the point', () => {
    expect(formatNumber(500_000)).toBe('500000');
    expect(formatNumber(500_000.5)).toBe('500000.5');
    expect(formatNumber(1_235_066.891)).toBe('1235066.891');
    expect(formatNumber(-12.25)).toBe('-12.25');
  });

  it('has no thousands separators, so that it can be matched with the file it came from', () => {
    expect(formatNumber(1_234_567)).toBe('1234567');
    expect(formatNumber(4_649_776.2249)).toBe('4649776.2249');
  });

  it('loses the noise of arithmetic, and keeps what was written', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(0.1 * 3)).toBe('0.3');
    expect(formatNumber(100.5 - 0.0000000000000142)).toBe('100.5');
    expect(formatNumber(0.123456789012345)).toBe('0.123456789012345');
  });

  it('is never minus zero', () => {
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(0)).toBe('0');
  });

  it('keeps small and large numbers as they are, as an exponent where JavaScript has one', () => {
    expect(formatNumber(0.000012345)).toBe('0.000012345');
    expect(formatNumber(1.5e-7)).toBe('1.5e-7');
    expect(formatNumber(1.5e25)).toBe('1.5e+25');
  });

  it('says so when it is not a number or is not finite', () => {
    expect(formatNumber(Number.NaN)).toBe('NaN');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe('-Infinity');
  });
});

describe('a cell', () => {
  it('has the number of a decimal or a whole number column in its own form', () => {
    expect(formatCell(column(Float64Array.of(0.1 + 0.2, 7)), 0)).toBe('0.3');
    expect(formatCell(column(Float64Array.of(0.1 + 0.2, 7)), 1)).toBe('7');
    expect(formatCell(column(Int32Array.of(-3, 1_000_000)), 1)).toBe('1000000');
  });

  it('has true or false for a flag', () => {
    const flags = column(Uint8Array.of(1, 0, 2));
    expect([0, 1, 2].map((row) => formatCell(flags, row))).toEqual(['true', 'false', 'true']);
  });

  it('has text as it is, with nothing taken off, and nothing for empty text', () => {
    const text = column(['  spaced  ', '', 'Ünï, "quoted" & <tagged>', 'null']);
    expect([0, 1, 2, 3].map((row) => formatCell(text, row))).toEqual([
      '  spaced  ',
      '',
      'Ünï, "quoted" & <tagged>',
      'null',
    ]);
  });

  it('says null for a null, of any kind of column, and not what is in its place', () => {
    for (const values of [Float64Array.of(5), Int32Array.of(5), Uint8Array.of(1), ['x']] as const) {
      const nulls = column(values, [0]);
      expect(isNull(nulls, 0)).toBe(true);
      expect(formatCell(nulls, 0)).toBe(NULL_TEXT);
    }
    expect(isNull(column(['x']), 0)).toBe(false);
  });

  it('is empty for a row there is no value for', () => {
    expect(formatCell(column(['a']), 5)).toBe('');
  });

  it('has numbers set on the right, and nothing else', () => {
    expect(isNumeric(Float64Array.of(1))).toBe(true);
    expect(isNumeric(Int32Array.of(1))).toBe(true);
    expect(isNumeric(Uint8Array.of(1))).toBe(false);
    expect(isNumeric(['1'])).toBe(false);
  });
});
