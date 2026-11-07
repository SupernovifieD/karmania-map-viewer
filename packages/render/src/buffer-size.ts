/**
 * How big the drawing buffer of a canvas is: the box it fills, in CSS pixels, times the device pixel ratio, in whole pixels
 * and no larger than the graphics card draws. Plain arithmetic, so that it is tested without a browser.
 */

/** The drawing buffer, and the ratio of its pixels to CSS pixels that it really has. */
export interface BufferSize {
  /** In device pixels, a whole number from 1. */
  readonly width: number;
  readonly height: number;
  /** Device pixels to a CSS pixel: the one asked for, or less where the card's limit would have been passed. */
  readonly pixelRatio: number;
}

/**
 * The buffer for a box of `cssWidth` by `cssHeight` CSS pixels at `devicePixelRatio`. A side is rounded to the nearest
 * whole pixel and is at least 1 (a box that has no size yet, as one that is not shown, gets 1 by 1: a canvas of 0 is an error
 * for the card). A ratio that is not a number above 0 is 1. If a side would pass `maxSize`, the ratio is lowered so that the
 * longer side is exactly `maxSize` and the box keeps its shape.
 *
 * @throws RangeError if `maxSize` is not a whole number from 1: it is what the card says, so it is a mistake.
 */
export function bufferSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxSize: number,
): BufferSize {
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new RangeError(
      `The largest buffer must be a whole number from 1, not ${String(maxSize)}.`,
    );
  }
  const usable = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
  const width = usable(cssWidth);
  const height = usable(cssHeight);
  let ratio = usable(devicePixelRatio) || 1;
  const longest = Math.max(width, height);
  if (longest * ratio > maxSize) {
    ratio = maxSize / longest;
  }
  const side = (css: number): number => Math.max(1, Math.round(css * ratio));
  return { width: side(width), height: side(height), pixelRatio: ratio };
}
