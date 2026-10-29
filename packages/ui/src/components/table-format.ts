import type { TableColumn, TableValues } from './table.js';

/** What a null looks like in a cell. */
export const NULL_TEXT = 'null';

/** How many significant digits a decimal keeps: all a double has, less the one or two of its noise. */
const SIGNIFICANT_DIGITS = 15;

/** Whether a column holds numbers, which are set on the right. */
export function isNumeric(values: TableValues): boolean {
  return values instanceof Float64Array || values instanceof Int32Array;
}

/**
 * A number as it was written in the file, without anything added: no thousands separators, which
 * would make a coordinate or an id differ from its source, and no zeros after the decimal point. A
 * result that is not quite its own value, as 0.1 + 0.2 is not 0.3, has the noise rounded off.
 */
export function formatNumber(value: number): string {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (!Number.isFinite(value)) {
    return value < 0 ? '-Infinity' : 'Infinity';
  }
  return String(Number(value.toPrecision(SIGNIFICANT_DIGITS)));
}

/** Whether the value of `column` at `row` is a null. */
export function isNull(column: TableColumn, row: number): boolean {
  return column.nulls[row] === 1;
}

/**
 * The words in a cell: a number as `formatNumber` has it, `true` or `false` for a flag, text as
 * it is, and `null` for a null. Text and categories are both text: the rows do not tell them apart.
 */
export function formatCell(column: TableColumn, row: number): string {
  if (isNull(column, row)) {
    return NULL_TEXT;
  }
  const value = column.values[row];
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return column.values instanceof Uint8Array ? String(value !== 0) : formatNumber(value);
}
