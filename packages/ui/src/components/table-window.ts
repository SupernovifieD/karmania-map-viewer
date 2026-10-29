/**
 * Which rows of a long table are in view, worked out from how far it has been scrolled. Nothing here
 * touches the page: a table gives it the numbers and draws what it says.
 */

/**
 * The most that the box a table scrolls in is made tall, in pixels. A browser has a limit to how tall
 * an element can be, about 33 million in Chromium and 17 million in Firefox, and goes wrong past it:
 * rows would be where they are not, and the end could not be reached. Chromium also holds a scroll
 * position to every other pixel once the box is taller than about 8.4 million, which is where its
 * numbers for it run out of whole pixels (2 to the power of 23), so the box is kept under that, where
 * every pixel of the scroll bar can be scrolled to. Below this, the scroll bar is for the rows as
 * they are; past it, the scroll bar is for all of the rows, drawn smaller.
 */
export const MAX_SCROLL_HEIGHT = 8_000_000;

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
  /** How tall the box that scrolls may be: `MAX_SCROLL_HEIGHT`, unless a test says otherwise. */
  readonly maxScrollHeight?: number;
  /**
   * Pixels of rows added to how far down the scroll bar says the rows are. With millions of rows a
   * pixel of scrolling is more than a row, so the scroll bar cannot stop at each; the keyboard can,
   * by taking up what the scroll bar's whole pixels leave out. Nothing, unless the keyboard has.
   */
  readonly fine?: number;
}

/** The rows to draw. */
export interface WindowResult {
  /** How tall the box that scrolls is, for the rows: all of them, or as much as a browser allows. */
  readonly scrollHeight: number;
  /** Whether the rows are too many to scroll as they are, so that a pixel of scrolling is more than a pixel of rows. */
  readonly scaled: boolean;
  /** The first row to draw (counting from 0), including the extra rows before those in view. */
  readonly firstRow: number;
  /** One past the last row to draw, including the extra rows after those in view. */
  readonly endRow: number;
  /** How far down the rows the top of the table is, in pixels of rows: not of scrolling. */
  readonly top: number;
  /**
   * Where the first row drawn goes, in pixels from the top of the box that scrolls. When the rows
   * are scrolled as they are, it is where the row would be if all of them were drawn. When they are
   * not, it is wherever puts the row that belongs at the top of the table at the top of the table,
   * which is not where it would be: the box is not as tall as the rows.
   */
  readonly layerTop: number;
}

type Sizes = Pick<WindowInput, 'rowCount' | 'rowHeight' | 'viewportHeight' | 'maxScrollHeight'>;

/** The most the top of the table can be down the rows, in pixels of rows: so that the last row is the last. */
export function maxTop(input: Sizes): number {
  return Math.max(0, input.rowCount * input.rowHeight - input.viewportHeight);
}

/** How tall the box that scrolls is: the rows together, or the most a browser allows. */
export function scrollHeightOf(input: Sizes): number {
  return Math.min(input.rowCount * input.rowHeight, input.maxScrollHeight ?? MAX_SCROLL_HEIGHT);
}

/** The most the box can be scrolled, in pixels: nothing, if all its rows fit. */
export function maxScroll(input: Sizes): number {
  return Math.max(0, scrollHeightOf(input) - input.viewportHeight);
}

/** How many pixels of rows one pixel of scrolling is: 1, until there are too many rows. */
export function scrollRatio(input: Sizes): number {
  const real = maxScroll(input);
  const all = Math.max(0, input.rowCount * input.rowHeight - input.viewportHeight);
  return real === 0 ? 1 : all / real;
}

/** The rows to draw for a table that has been scrolled `scrollTop` pixels. */
export function windowFor(input: WindowInput): WindowResult {
  const { rowCount, rowHeight, viewportHeight, overscan } = input;
  const real = Math.min(Math.max(0, input.scrollTop), maxScroll(input));
  // How far down the rows it is, which is the same as how far it is scrolled until there are too many.
  const down = Math.min(Math.max(0, real * scrollRatio(input) + (input.fine ?? 0)), maxTop(input));
  const topRow = Math.floor(down / rowHeight);
  // One more than fits, since the rows at the top and the bottom may be part in view.
  const inView = Math.ceil(viewportHeight / rowHeight) + 1;
  const firstRow = Math.max(0, topRow - overscan);
  return {
    scrollHeight: scrollHeightOf(input),
    scaled: rowCount * rowHeight > (input.maxScrollHeight ?? MAX_SCROLL_HEIGHT),
    firstRow,
    endRow: Math.max(firstRow, Math.min(rowCount, topRow + inView + overscan)),
    top: down,
    layerTop: Math.round(real + firstRow * rowHeight - down),
  };
}

/**
 * How far to scroll, and the `fine` to go with it, to have the top of the table `top` pixels down
 * the rows. Scrolled as they are, that is the scroll bar's own position; with too many rows for that, it
 * is the nearest whole pixel of the scroll bar, and the rest is `fine`.
 */
export function scrollForTop(input: Sizes, top: number): { scrollTop: number; fine: number } {
  const wanted = Math.min(Math.max(0, top), maxTop(input));
  const ratio = scrollRatio(input);
  if (ratio === 1) {
    return { scrollTop: wanted, fine: 0 };
  }
  const scrollTop = Math.min(Math.max(0, Math.round(wanted / ratio)), maxScroll(input));
  return { scrollTop, fine: wanted - scrollTop * ratio };
}

/**
 * Where the top of the table has to be, `top` being where it is, for row `row` to be wholly in view:
 * the same if it is, as little further up or down as is needed if it is not.
 */
export function topToReveal(input: Sizes, top: number, row: number): number {
  const rowTop = row * input.rowHeight;
  const rowBottom = rowTop + input.rowHeight;
  const wanted =
    rowTop < top
      ? rowTop
      : rowBottom > top + input.viewportHeight
        ? rowBottom - input.viewportHeight
        : top;
  return Math.min(Math.max(0, wanted), maxTop(input));
}

/** How many rows a page of rows is: the rows that fit, and at least one. */
export function pageRows(viewportHeight: number, rowHeight: number): number {
  return Math.max(1, Math.floor(viewportHeight / rowHeight));
}
