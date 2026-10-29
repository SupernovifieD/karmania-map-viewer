/**
 * Which rows of a long table are in view, worked out from how far it has been scrolled. Nothing here
 * touches the page: a table gives it the numbers and draws what it says.
 */

/** What a table knows when it asks which rows to draw. */
export interface WindowInput {
  /** How many rows the table has. */
  readonly rowCount: number;
  /** How high a row is, in pixels. */
  readonly rowHeight: number;
  /** How high the part of the table that shows rows is (the header is not in it). */
  readonly viewportHeight: number;
  /** How far the table has been scrolled, in pixels. */
  readonly scrollTop: number;
  /** How many rows beyond those in view are drawn at each end, so that a scroll does not show blank. */
  readonly overscan: number;
}

/** The rows to draw. */
export interface WindowResult {
  /** The height of all the rows together: what the scroll bar covers. */
  readonly scrollHeight: number;
  /** The first row to draw (counting from 0), including the extra rows before those in view. */
  readonly firstRow: number;
  /** One past the last row to draw, including the extra rows after those in view. */
  readonly endRow: number;
}

/** The most a table can be scrolled, in pixels: nothing, if all its rows fit. */
export function maxScroll(
  input: Pick<WindowInput, 'rowCount' | 'rowHeight' | 'viewportHeight'>,
): number {
  return Math.max(0, input.rowCount * input.rowHeight - input.viewportHeight);
}

/** The rows to draw for a table that has been scrolled `scrollTop` pixels. */
export function windowFor(input: WindowInput): WindowResult {
  const { rowCount, rowHeight, viewportHeight, overscan } = input;
  const top = Math.min(Math.max(0, input.scrollTop), maxScroll(input));
  const topRow = Math.floor(top / rowHeight);
  // One more than fits, since the rows at the top and the bottom may be part in view.
  const inView = Math.ceil(viewportHeight / rowHeight) + 1;
  const firstRow = Math.max(0, topRow - overscan);
  return {
    scrollHeight: rowCount * rowHeight,
    firstRow,
    endRow: Math.max(firstRow, Math.min(rowCount, topRow + inView + overscan)),
  };
}
