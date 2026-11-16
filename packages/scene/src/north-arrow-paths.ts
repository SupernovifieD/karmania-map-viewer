/**
 * The drawing of the north arrow's needle (section 10.2 of the brief) in a box of 40 by 40, turned about the middle of it by the angle of `northArrow`. The three
 * parts are SVG path data, which the screen draws as `<path>` and the export draws with `new Path2D(d)`, so that there is one drawing and the picture's
 * arrow is the screen's.
 */

/** The side of the box the paths are in. */
export const NORTH_ARROW_BOX = 40;
/** The point the needle turns about. */
export const NORTH_ARROW_CENTRE = 20;

/** The letter N above the needle: a stroke, round at its ends, 1.5 wide. */
export const NORTH_ARROW_LETTER = 'M17 11V5L23 11V5';
/** The head of the needle: a filled arrow head. */
export const NORTH_ARROW_HEAD = 'M20 14L25.5 29L20 25.5L14.5 29Z';
/** The tail of the needle: a stroke, round at its ends, 1.5 wide. */
export const NORTH_ARROW_TAIL = 'M20 25.5V34';
/** The width of the strokes of the letter and the tail. */
export const NORTH_ARROW_STROKE = 1.5;
