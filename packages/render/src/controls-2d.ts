/**
 * How a person moves the 2D map, in plain arithmetic: what a drag, a turn of the wheel and a key do to the camera. Nothing
 * here touches the page, so every rule is tested without a browser; `controller-2d.ts` is the part that listens. A camera is
 * the scene's (`centre`, `unitsPerPixel`, `heading`), the map area's size is in CSS pixels, a point of the screen is from the
 * top left of the map area, and nothing tilts: a 2D map can be moved, scaled and turned and that is all.
 */
import type { Camera2d } from '@karmania/scene';
import { screenToMap } from './camera-2d.js';
import type { Size } from './camera-2d.js';

/** How far the scale may go, in map units to a pixel: the smaller is the closer. */
export interface ScaleLimits {
  readonly min: number;
  readonly max: number;
}

/**
 * The limits when nothing is known of the data: wide, since the units of a map are metres or feet or degrees. The
 * viewer narrows them to the extent that is drawn.
 */
export const DEFAULT_SCALE_LIMITS: ScaleLimits = { min: 1e-6, max: 1e9 };

/** A key moves the map by this many pixels. */
export const KEY_PAN_PIXELS = 50;
/** Shift and an arrow turns the map by this many degrees. */
export const KEY_ROTATE_DEGREES = 15;
/** A key press of `+` or `-` changes the scale by this factor; two presses make it twice or half. */
export const KEY_ZOOM_FACTOR = Math.SQRT2;
/** The scale changes by `exp(-delta * this)` for a wheel that turns `delta` pixels, and faster for a pinch on a trackpad. */
export const WHEEL_ZOOM_PER_PIXEL = 0.0015;
export const PINCH_ZOOM_PER_PIXEL = 0.01;
/** What a turn of the wheel in lines or pages comes to in pixels, when it is not in pixels (a page is a screen high). */
export const WHEEL_LINE_PIXELS = 16;

/** The same, for a camera that is changed: the part of it that is. */
export interface CameraChange {
  readonly centre?: readonly [number, number];
  readonly unitsPerPixel?: number;
  readonly heading?: number;
}

/** `value` held between the limits (a limit that is not a number above 0 is not applied). */
export function clampScale(value: number, limits: ScaleLimits): number {
  const low = limits.min > 0 ? limits.min : 0;
  const high = limits.max > 0 ? limits.max : Infinity;
  return Math.min(Math.max(value, low), Math.max(high, low));
}

/**
 * The camera with the map point that was under `(x, y)` still under it: `next` has a scale and a heading, and the centre that
 * goes with them is that point less where `(x, y)` is from the centre (found with the centre at 0, so that the numbers are
 * small however far from 0 the map is).
 */
function holdPoint(
  before: Camera2d,
  next: Pick<Camera2d, 'unitsPerPixel' | 'heading'>,
  size: Size,
  x: number,
  y: number,
): Camera2d {
  const [px, py] = screenToMap(before, size, x, y);
  const [ox, oy] = screenToMap({ ...next, centre: [0, 0] }, size, x, y);
  return { ...next, centre: [px - ox, py - oy] };
}

/** What a drag of `dx` and `dy` pixels does: the map follows the pointer, so the centre goes the other way. */
export function panBy(camera: Camera2d, size: Size, dx: number, dy: number): CameraChange {
  const [x, y] = screenToMap(camera, size, size.width / 2 - dx, size.height / 2 - dy);
  return { centre: [x, y] };
}

/**
 * Multiplies the scale by `factor` (less than 1 comes closer), held between the limits, so that the point under `(x, y)` stays
 * under it: zoom to the pointer. `undefined` if nothing would change (a factor that is not above 0, or the limit is reached).
 */
export function zoomAt(
  camera: Camera2d,
  size: Size,
  factor: number,
  x: number,
  y: number,
  limits: ScaleLimits,
): CameraChange | undefined {
  if (!(factor > 0) || !Number.isFinite(factor)) {
    return undefined;
  }
  const unitsPerPixel = clampScale(camera.unitsPerPixel * factor, limits);
  if (unitsPerPixel === camera.unitsPerPixel) {
    return undefined;
  }
  const next = holdPoint(camera, { unitsPerPixel, heading: camera.heading }, size, x, y);
  return { centre: next.centre, unitsPerPixel };
}

/** Turns the map by `degrees` clockwise (the top of the screen faces further clockwise from north) about `(x, y)`. */
export function rotateAbout(
  camera: Camera2d,
  size: Size,
  degrees: number,
  x: number,
  y: number,
): CameraChange | undefined {
  if (degrees === 0 || !Number.isFinite(degrees)) {
    return undefined;
  }
  const heading = camera.heading + degrees;
  const next = holdPoint(camera, { unitsPerPixel: camera.unitsPerPixel, heading }, size, x, y);
  return { centre: next.centre, heading };
}

/**
 * The angle, in degrees clockwise from straight up, of the pointer at `(x, y)` about the middle of the map area. A drag
 * round the middle turns the map by the angle the pointer went through, the map following it.
 */
export function angleAbout(size: Size, x: number, y: number): number {
  return (Math.atan2(x - size.width / 2, size.height / 2 - y) * 180) / Math.PI;
}

/** The shortest turn from one angle to another, from -180 up to 180 (half a turn is -180), so a drag across the top is not a turn of nearly 360. */
export function turnBetween(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * What a turn of the wheel does to the scale: the factor to multiply it by. A pixel of `deltaY` and a line or page (`deltaMode`
 * 1 and 2) are made pixels, and a pinch on a trackpad (the wheel with the control key down) is faster than the wheel.
 */
export function wheelFactor(
  event: { readonly deltaY: number; readonly deltaMode: number; readonly ctrlKey: boolean },
  areaHeight: number,
): number {
  const pixels =
    event.deltaMode === 1
      ? event.deltaY * WHEEL_LINE_PIXELS
      : event.deltaMode === 2
        ? event.deltaY * areaHeight
        : event.deltaY;
  return Math.exp(pixels * (event.ctrlKey ? PINCH_ZOOM_PER_PIXEL : WHEEL_ZOOM_PER_PIXEL));
}

/** What a key does. */
export type KeyAction =
  | { readonly type: 'pan'; readonly dx: number; readonly dy: number }
  | { readonly type: 'zoom'; readonly factor: number }
  | { readonly type: 'rotate'; readonly degrees: number }
  | { readonly type: 'north' }
  | { readonly type: 'fit' };

/** The parts of a key event that decide what it does. */
export interface KeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

/**
 * The action of a key when the map has the focus (section 10.2 of the brief): the arrows move the map (the view goes the way of
 * the arrow, so the map goes the other way), Shift and the left or right arrow turn it by 15 degrees (right turns the top of the
 * screen clockwise), `+` and `-` zoom, `0` puts north up and Home fits to the data. A key with Control, Meta or Alt down is the
 * browser's, and Shift with the up or down arrow is nothing: both are `undefined`, and are left alone.
 */
export function keyAction(input: KeyInput): KeyAction | undefined {
  if (input.ctrlKey || input.metaKey || input.altKey) {
    return undefined;
  }
  if (input.shiftKey) {
    if (input.key === 'ArrowLeft') {
      return { type: 'rotate', degrees: -KEY_ROTATE_DEGREES };
    }
    if (input.key === 'ArrowRight') {
      return { type: 'rotate', degrees: KEY_ROTATE_DEGREES };
    }
  }
  switch (input.key) {
    case 'ArrowLeft':
      return { type: 'pan', dx: KEY_PAN_PIXELS, dy: 0 };
    case 'ArrowRight':
      return { type: 'pan', dx: -KEY_PAN_PIXELS, dy: 0 };
    case 'ArrowUp':
      return input.shiftKey ? undefined : { type: 'pan', dx: 0, dy: KEY_PAN_PIXELS };
    case 'ArrowDown':
      return input.shiftKey ? undefined : { type: 'pan', dx: 0, dy: -KEY_PAN_PIXELS };
    case '+':
    case '=':
      return { type: 'zoom', factor: 1 / KEY_ZOOM_FACTOR };
    case '-':
    case '_':
      return { type: 'zoom', factor: KEY_ZOOM_FACTOR };
    case '0':
      return { type: 'north' };
    case 'Home':
      return { type: 'fit' };
    default:
      return undefined;
  }
}
