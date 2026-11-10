/** Plain camera arithmetic for the 3D orbit controller. */
import type { Camera3d } from '@karmania/scene';
import type { Size } from './camera-2d.js';

const normalHeading = (degrees: number): number => ((degrees % 360) + 360) % 360;
const heldElevation = (degrees: number): number => Math.min(89, Math.max(-89, degrees));

/** The part of a 3D camera changed by an interaction. */
export interface Camera3dChange {
  readonly target?: readonly [number, number, number];
  readonly distance?: number;
  readonly heading?: number;
  readonly elevation?: number;
}

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
