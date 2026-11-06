/**
 * The cameras that show a given extent, for the "fit to data" of the toolbar and the first view of a map. Plain geometry in
 * map units, with no clock and no DOM; a camera that cannot be made (an extent or a viewport that is not usable: a
 * container that has no size yet is common) is `undefined`, which means "leave the camera as it is".
 */
import type { BBox } from '@karmania/engine/types';
import { heldElevation, normalHeading } from './angles.js';
import type { Camera2d, Camera3d } from './types.js';

/** The size of the map area, in pixels. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** What the 2D camera is made from. */
export interface Fit2dInput {
  /** What to show, in map units. */
  readonly extent: BBox;
  readonly viewport: Viewport;
  /** The heading to keep, degrees clockwise from grid north; 0 by default. */
  readonly heading?: number;
  /** Pixels to leave free on each side, for the overlays; 0 by default. */
  readonly padding?: number;
}

/** What the 3D camera is made from. */
export interface Fit3dInput {
  readonly extent: BBox;
  readonly viewport: Viewport;
  /** The vertical field of view, in degrees, above 0 and below 180. */
  readonly fov: number;
  readonly heading?: number;
  /** Degrees above the horizon; 45 by default. */
  readonly elevation?: number;
  /** What the heights are multiplied by in 3D; 1 by default. */
  readonly verticalExaggeration?: number;
}

function finite(...numbers: readonly number[]): boolean {
  return numbers.every((n) => Number.isFinite(n));
}

/** Whether the box is made of numbers and has no side that is negative. */
function usableExtent(extent: BBox): boolean {
  return (
    finite(...extent.min, ...extent.max) &&
    extent.min[0] <= extent.max[0] &&
    extent.min[1] <= extent.max[1] &&
    extent.min[2] <= extent.max[2]
  );
}

function usableViewport(viewport: Viewport): boolean {
  return finite(viewport.width, viewport.height) && viewport.width > 0 && viewport.height > 0;
}

/** The scale used for an extent that has no size, such as a single point: one map unit to a pixel. */
const POINT_SCALE = 1;

/** The smallest sphere that is fitted in 3D: a unit of the map, for an extent that is a point. */
const LEAST_RADIUS = 1;

/**
 * The 2D camera that shows the whole extent: centred on it, at the heading given (the map is turned, so the extent is
 * measured across the screen's own axes, not across east and north), at the scale at which the extent just fills the
 * map area less the padding. An extent that is a point is centred at one map unit to a pixel. `undefined` if the
 * extent is not made of numbers or has a side that is negative, or the viewport has no size.
 */
export function fitCamera2d(input: Fit2dInput): Camera2d | undefined {
  const { extent, viewport } = input;
  const padding = input.padding ?? 0;
  if (
    !usableExtent(extent) ||
    !usableViewport(viewport) ||
    !Number.isFinite(padding) ||
    padding < 0 ||
    !Number.isFinite(input.heading ?? 0)
  ) {
    return undefined;
  }
  const heading = normalHeading(input.heading ?? 0);
  const radians = (heading * Math.PI) / 180;
  const [cos, sin] = [Math.abs(Math.cos(radians)), Math.abs(Math.sin(radians))];
  const [width, height] = [extent.max[0] - extent.min[0], extent.max[1] - extent.min[1]];
  // A turned rectangle is wider across the screen by the part of its sides that lie across it, and the sign of the turn does not matter.
  const across = cos * width + sin * height;
  const down = sin * width + cos * height;
  const room = [
    Math.max(1, viewport.width - 2 * padding),
    Math.max(1, viewport.height - 2 * padding),
  ] as const;
  const scale = Math.max(across / room[0], down / room[1]);
  return {
    centre: [(extent.min[0] + extent.max[0]) / 2, (extent.min[1] + extent.max[1]) / 2],
    unitsPerPixel: scale > 0 ? scale : POINT_SCALE,
    heading,
  };
}

/**
 * The 3D camera that shows the whole extent: looking at the middle of it from far enough that the sphere around it fits the
 * narrower of the two fields of view (the heights are those of the extent times the exaggeration), from the heading
 * and the elevation given (held between -89 and 89). `undefined` if the extent is not made of numbers or has a side that
 * is negative, the viewport has no size, the field of view is not above 0 and below 180, the exaggeration is not
 * above 0, or the heading or the elevation is not a number.
 */
export function fitCamera3d(input: Fit3dInput): Camera3d | undefined {
  const { extent, viewport, fov } = input;
  const exaggeration = input.verticalExaggeration ?? 1;
  if (
    !usableExtent(extent) ||
    !usableViewport(viewport) ||
    !(fov > 0 && fov < 180) ||
    !(exaggeration > 0 && Number.isFinite(exaggeration)) ||
    !finite(input.heading ?? 0, input.elevation ?? 0)
  ) {
    return undefined;
  }
  const size = [
    extent.max[0] - extent.min[0],
    extent.max[1] - extent.min[1],
    (extent.max[2] - extent.min[2]) * exaggeration,
  ] as const;
  const radius = Math.max(LEAST_RADIUS, Math.hypot(...size) / 2);
  const vertical = (fov * Math.PI) / 180 / 2;
  const horizontal = Math.atan(Math.tan(vertical) * (viewport.width / viewport.height));
  return {
    target: [
      (extent.min[0] + extent.max[0]) / 2,
      (extent.min[1] + extent.max[1]) / 2,
      (extent.min[2] + extent.max[2]) / 2,
    ],
    distance: radius / Math.sin(Math.min(vertical, horizontal)),
    heading: normalHeading(input.heading ?? 0),
    elevation: heldElevation(input.elevation ?? 45),
    fov,
  };
}

/** What the 3D camera of a 2D one is made from. */
export interface To3dInput {
  readonly camera2d: Camera2d;
  readonly viewport: Viewport;
  /** The vertical field of view of the 3D camera, in degrees, above 0 and below 180. */
  readonly fov: number;
  /** Degrees above the horizon; 45 by default. */
  readonly elevation?: number;
  /** The height of the point looked at, in map units; 0 by default. */
  readonly targetZ?: number;
}

/** What the 2D camera of a 3D one is made from. */
export interface To2dInput {
  readonly camera3d: Camera3d;
  readonly viewport: Viewport;
}

/** How many map units the map area is high at a distance `d` from the camera: `2 d tan(fov / 2)`. */
function heightAt(distance: number, fov: number): number {
  return 2 * distance * Math.tan((fov * Math.PI) / 360);
}

/**
 * The 3D camera that shows the same place as a 2D one: the same centre (looked at, at the height given), the same
 * heading, and the distance at which the map area is as high, in map units, as it was, so that what is at the centre has
 * the same scale on the screen. Switching views keeps the centre, the heading and the scale there, and the 3D camera
 * adds what 2D has not got: the elevation and the field of view. `undefined` if the 2D camera, the viewport or the
 * field of view cannot be used.
 */
export function cameraTo3d(input: To3dInput): Camera3d | undefined {
  const { camera2d, viewport, fov } = input;
  if (
    !usableViewport(viewport) ||
    !(fov > 0 && fov < 180) ||
    !finite(...camera2d.centre, camera2d.unitsPerPixel, camera2d.heading) ||
    !(camera2d.unitsPerPixel > 0)
  ) {
    return undefined;
  }
  const targetZ = input.targetZ ?? 0;
  if (!finite(targetZ, input.elevation ?? 0)) {
    return undefined;
  }
  return {
    target: [camera2d.centre[0], camera2d.centre[1], targetZ],
    distance: (viewport.height * camera2d.unitsPerPixel) / heightAt(1, fov),
    heading: normalHeading(camera2d.heading),
    elevation: heldElevation(input.elevation ?? 45),
    fov,
  };
}

/**
 * The 2D camera that shows the same place as a 3D one: the same centre (where it looks, without the height), the same
 * heading, and the scale that the 3D camera has at what it looks at. `undefined` if the 3D camera or the viewport
 * cannot be used.
 */
export function cameraTo2d(input: To2dInput): Camera2d | undefined {
  const { camera3d, viewport } = input;
  if (
    !usableViewport(viewport) ||
    !(camera3d.fov > 0 && camera3d.fov < 180) ||
    !finite(...camera3d.target, camera3d.distance, camera3d.heading) ||
    !(camera3d.distance > 0)
  ) {
    return undefined;
  }
  return {
    centre: [camera3d.target[0], camera3d.target[1]],
    unitsPerPixel: heightAt(camera3d.distance, camera3d.fov) / viewport.height,
    heading: normalHeading(camera3d.heading),
  };
}
