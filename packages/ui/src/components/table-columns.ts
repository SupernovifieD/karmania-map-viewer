/**
 * How wide the columns of a table are, worked out from the widths of the words in them. Measuring
 * the words needs a browser and is done elsewhere: this is the arithmetic that follows.
 */

/** The room a cell leaves on each side of what is in it, added: 8 and 8. */
export const CELL_PADDING = 16;

/** The line down the right side of the row numbers. */
const ROW_NUMBER_BORDER = 1;

/** The narrowest a column of values is, whatever is in it. */
export const MIN_COLUMN_WIDTH = 72;

/** The widest a column of values is, whatever is in it. */
export const MAX_COLUMN_WIDTH = 320;

/** How many rows are looked at to see how wide a column has to be. */
export const SAMPLE_ROWS = 200;

/** How many digits the row numbers have room for at least. */
const MIN_ROW_NUMBER_DIGITS = 3;

/** How wide a column is that has `contentWidth` of words in it, as wide as the widest of them. */
export function columnWidth(contentWidth: number): number {
  const wanted = Math.ceil(contentWidth) + CELL_PADDING;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, wanted));
}

/** How wide the column of row numbers is, with room for the number of the last row. */
export function rowNumberWidth(rowCount: number, digitWidth: number): number {
  const digits = Math.max(MIN_ROW_NUMBER_DIGITS, String(rowCount).length);
  return Math.ceil(digits * digitWidth) + CELL_PADDING + ROW_NUMBER_BORDER;
}

/**
 * How wide some text is. The digits are set one width, as figures in a table are, and `measure`
 * is asked for the rest, the width of the text with them taken out.
 */
export function textWidth(
  text: string,
  digitWidth: number,
  measure: (text: string) => number,
): number {
  const rest = text.replace(/[0-9]/g, '');
  const digits = text.length - rest.length;
  return digits * digitWidth + (rest.length === 0 ? 0 : measure(rest));
}

/** Whether text that is `width` wide does not fit in a column that is `columnWidth` wide. */
export function isCut(width: number, column: number): boolean {
  return Math.ceil(width) > column - CELL_PADDING;
}
