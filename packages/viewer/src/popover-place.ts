/**
 * Where the identify popover goes (brief 10.2 and 10.5): next to the click, kept inside the map area minus an inset of 16, never over the column on the right that
 * the north arrow and the navigation group use, and at most half as high as the map (its body scrolls). It is put to the right of and below the click, so that the
 * element that was clicked is not under it, and moved to the other side of the click where that does not fit.
 */

/** How far inside the edges of the map the popover is kept. */
export const POPOVER_INSET = 16;

/** The space between the click and the popover. */
export const POPOVER_GAP = 12;

/** What is kept clear on the right: the column of the north arrow and the navigation group (40 wide) and a space of 8 between it and the popover. */
export const FURNITURE_COLUMN = 48;

/** The widest the popover is (brief 10.5: 240 to 320). */
export const POPOVER_MAX_WIDTH = 320;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where the popover is put, and the size it must not be larger than. */
export interface Placement {
  /** From the left and top of the map. */
  readonly left: number;
  readonly top: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * The place of a popover of `size` for a click at `anchor` on a map of `area`. `size` is what the popover is when it is as large as its content (and its
 * width) wants; where it does not fit it is made smaller (`maxWidth`, `maxHeight`) and placed as the smaller.
 */
export function placePopover(anchor: Point, size: Size, area: Size): Placement {
  const box = {
    left: POPOVER_INSET,
    top: POPOVER_INSET,
    right: area.width - POPOVER_INSET - FURNITURE_COLUMN,
    bottom: area.height - POPOVER_INSET,
  };
  const maxWidth = Math.max(0, Math.min(POPOVER_MAX_WIDTH, box.right - box.left));
  const maxHeight = Math.max(0, Math.min(area.height / 2, box.bottom - box.top));
  const width = Math.min(size.width, maxWidth);
  const height = Math.min(size.height, maxHeight);
  // To the right of the click and below it; the other side where that does not fit.
  let left = anchor.x + POPOVER_GAP;
  if (left + width > box.right) {
    left = anchor.x - POPOVER_GAP - width;
  }
  let top = anchor.y + POPOVER_GAP;
  if (top + height > box.bottom) {
    top = anchor.y - POPOVER_GAP - height;
  }
  return {
    left: clamp(left, box.left, box.right - width),
    top: clamp(top, box.top, box.bottom - height),
    maxWidth,
    maxHeight,
  };
}
