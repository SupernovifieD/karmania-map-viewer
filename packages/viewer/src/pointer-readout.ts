/**
 * What the status chip says of where the pointer is (section 10.2 of the brief): the point of the map under it, in the units of the map's
 * coordinate system, with as many decimals as make the last digit about one pixel of the screen, so that the figure says as much as the
 * eye can see and no more. Plain arithmetic on the scene's camera, with no page in it.
 */
import { screenToMap } from '@karmania/render';
import type { Size } from '@karmania/render';
import { formatNumber } from '@karmania/scene';
import type { Camera2d } from '@karmania/scene';

/** The most decimals a coordinate is shown with: a millionth of a unit, which no screen resolves. */
export const MOST_DECIMALS = 6;

/**
 * The decimals for a map in which one pixel is `unitsPerPixel` map units: the fewest for which the last digit is not more than a pixel,
 * so that the last digit is between a tenth of a pixel and a pixel (a pixel of 0.25 units gives one decimal, a tenth, and one of 2.5
 * gives none). From 0 up to 6; a scale that is not a number above 0 gives none.
 */
export function decimalsFor(unitsPerPixel: number): number {
  if (!(unitsPerPixel > 0) || !Number.isFinite(unitsPerPixel)) {
    return 0;
  }
  // The power of ten at or below the scale, read from its decimal form, which is exact (logarithms are not: `Math.log10(1000)` may not be 3).
  const power = Number(unitsPerPixel.toExponential().split('e')[1]);
  return Math.min(Math.max(-power, 0), MOST_DECIMALS);
}

/** The two coordinates of a point, written. */
export interface Readout {
  readonly x: string;
  readonly y: string;
}

/**
 * The point of the map under `(x, y)`, in CSS pixels from the top left of the map area, written with thousands separated and the decimals
 * of the scale; `undefined` if the camera puts it nowhere (a number that is not finite).
 */
export function readoutAt(camera: Camera2d, size: Size, x: number, y: number): Readout | undefined {
  const [east, north] = screenToMap(camera, size, x, y);
  if (!Number.isFinite(east) || !Number.isFinite(north)) {
    return undefined;
  }
  const decimals = decimalsFor(camera.unitsPerPixel);
  return { x: formatNumber(east, decimals), y: formatNumber(north, decimals) };
}

/**
 * How many characters wide a coordinate can be anywhere in the map area at this camera: the longest of the four corners (a coordinate is
 * greatest or least there) and one more, for the digit that a coordinate crossing a power of ten gains. The chip reserves this much for
 * each, so that it does not change as the pointer moves.
 */
export function readoutWidth(camera: Camera2d, size: Size): number {
  let longest = 0;
  for (const [x, y] of [
    [0, 0],
    [size.width, 0],
    [0, size.height],
    [size.width, size.height],
  ] as const) {
    const corner = readoutAt(camera, size, x, y);
    if (corner !== undefined) {
      longest = Math.max(longest, corner.x.length, corner.y.length);
    }
  }
  return longest + 1;
}
