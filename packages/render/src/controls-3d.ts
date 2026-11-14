/** Plain camera arithmetic for the 3D orbit controller. */
import type { Camera3d } from '@karmania/scene';
import type { Size } from './camera-2d.js';
import { KEY_PAN_PIXELS, KEY_ZOOM_FACTOR } from './controls-2d.js';
import type { KeyInput } from './controls-2d.js';

const normalHeading = (degrees: number): number => ((degrees % 360) + 360) % 360;
const heldElevation = (degrees: number): number => Math.min(89, Math.max(-89, degrees));

/** The part of a 3D camera changed by an interaction. */
export interface Camera3dChange {
  readonly target?: readonly [number, number, number];
  readonly distance?: number;
  readonly heading?: number;
  readonly elevation?: number;
}

/** How near to or far from the target an orbit camera may go. */
export interface DistanceLimits {
  readonly min: number;
  readonly max: number;
}

/** Broad limits for a camera whose data extent is not known yet. */
export const DEFAULT_DISTANCE_LIMITS: DistanceLimits = { min: 1e-6, max: 1e15 };
/** A key orbits by this many degrees. */
export const KEY_ORBIT_DEGREES = 15;

/** The camera's unit vectors along the right and top of the screen. */
function axes(camera: Camera3d) {
  const heading = (camera.heading * Math.PI) / 180;
  const elevation = (camera.elevation * Math.PI) / 180;
  return {
    right: [Math.cos(heading), -Math.sin(heading), 0] as const,
    up: [
      Math.sin(heading) * Math.sin(elevation),
      Math.cos(heading) * Math.sin(elevation),
      Math.cos(elevation),
    ] as const,
  };
}

function usable(size: Size, ...values: readonly number[]): boolean {
  return (
    size.width > 0 &&
    size.height > 0 &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    values.every(Number.isFinite)
  );
}

/** Orbits by a pointer's movement. A drag across the map's height is half a turn. */
export function orbit3dBy(
  camera: Camera3d,
  size: Size,
  dx: number,
  dy: number,
): Camera3dChange | undefined {
  if (!usable(size, dx, dy) || (dx === 0 && dy === 0)) {
    return undefined;
  }
  const degreesPerPixel = 180 / size.height;
  return {
    heading: normalHeading(camera.heading - dx * degreesPerPixel),
    elevation: heldElevation(camera.elevation - dy * degreesPerPixel),
  };
}

/** Pans in the plane of the screen at the target, with the map following the pointer. */
export function pan3dBy(
  camera: Camera3d,
  size: Size,
  dx: number,
  dy: number,
): Camera3dChange | undefined {
  if (!usable(size, dx, dy) || (dx === 0 && dy === 0)) {
    return undefined;
  }
  const unitsPerPixel =
    (2 * camera.distance * Math.tan((camera.fov * Math.PI) / 360)) / size.height;
  const { right, up } = axes(camera);
  return {
    target: camera.target.map(
      (value, axis) =>
        value - (right[axis] ?? 0) * dx * unitsPerPixel + (up[axis] ?? 0) * dy * unitsPerPixel,
    ) as [number, number, number],
  };
}

/** `value` held between usable positive distance limits. */
export function clampDistance(value: number, limits: DistanceLimits): number {
  const low = limits.min > 0 ? limits.min : 0;
  const high = limits.max > 0 ? limits.max : Infinity;
  return Math.min(Math.max(value, low), Math.max(high, low));
}

/**
 * Changes the orbit distance while keeping the point on the target plane under the pointer. The
 * plane is parallel to the screen and goes through the camera target.
 */
export function zoom3dAt(
  camera: Camera3d,
  size: Size,
  factor: number,
  x: number,
  y: number,
  limits: DistanceLimits,
): Camera3dChange | undefined {
  if (!usable(size, factor, x, y) || !(factor > 0)) {
    return undefined;
  }
  const distance = clampDistance(camera.distance * factor, limits);
  if (distance === camera.distance) {
    return undefined;
  }
  const tangent = Math.tan((camera.fov * Math.PI) / 360);
  const oldHalfHeight = camera.distance * tangent;
  const newHalfHeight = distance * tangent;
  const difference = oldHalfHeight - newHalfHeight;
  const offsetRight = ((2 * x) / size.width - 1) * difference * (size.width / size.height);
  const offsetUp = (1 - (2 * y) / size.height) * difference;
  const { right, up } = axes(camera);
  return {
    distance,
    target: camera.target.map(
      (value, axis) => value + (right[axis] ?? 0) * offsetRight + (up[axis] ?? 0) * offsetUp,
    ) as [number, number, number],
  };
}

/** What a key does to a 3D orbit camera. */
export type KeyAction3d =
  | { readonly type: 'orbit'; readonly heading: number; readonly elevation: number }
  | { readonly type: 'pan'; readonly dx: number; readonly dy: number }
  | { readonly type: 'zoom'; readonly factor: number }
  | { readonly type: 'fit' };

/** Arrows orbit; Shift-arrows pan; `+` and `-` zoom; Home fits to the visible data. */
export function keyAction3d(input: KeyInput): KeyAction3d | undefined {
  if (input.ctrlKey || input.metaKey || input.altKey) {
    return undefined;
  }
  if (input.shiftKey) {
    switch (input.key) {
      case 'ArrowLeft':
        return { type: 'pan', dx: KEY_PAN_PIXELS, dy: 0 };
      case 'ArrowRight':
        return { type: 'pan', dx: -KEY_PAN_PIXELS, dy: 0 };
      case 'ArrowUp':
        return { type: 'pan', dx: 0, dy: KEY_PAN_PIXELS };
      case 'ArrowDown':
        return { type: 'pan', dx: 0, dy: -KEY_PAN_PIXELS };
    }
  }
  switch (input.key) {
    case 'ArrowLeft':
      return { type: 'orbit', heading: -KEY_ORBIT_DEGREES, elevation: 0 };
    case 'ArrowRight':
      return { type: 'orbit', heading: KEY_ORBIT_DEGREES, elevation: 0 };
    case 'ArrowUp':
      return { type: 'orbit', heading: 0, elevation: KEY_ORBIT_DEGREES };
    case 'ArrowDown':
      return { type: 'orbit', heading: 0, elevation: -KEY_ORBIT_DEGREES };
    case '+':
    case '=':
      return { type: 'zoom', factor: 1 / KEY_ZOOM_FACTOR };
    case '-':
    case '_':
      return { type: 'zoom', factor: KEY_ZOOM_FACTOR };
    case 'Home':
      return { type: 'fit' };
    default:
      return undefined;
  }
}
