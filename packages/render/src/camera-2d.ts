/**
 * The 2D camera in plain arithmetic: the box that an orthographic camera shows for a `Camera2d` of the scene, and the
 * conversions between a point of the screen and a point of the map. Map units are those of the map CRS, in f64; the
 * camera is placed relative to the origin of the frame (which is how the positions on the card are), so that the numbers
 * the card gets are small. x is east, y north, z up; the screen has x to the right and y down, from the top left of
 * the map area, in CSS pixels. A heading is degrees clockwise from grid north: the direction the top of the screen faces.
 */
import type { Camera2d } from '@karmania/scene';

/** The size of the map area in CSS pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The range of heights (relative to the origin) that are drawn, in map units. */
export interface DepthRange {
  readonly min: number;
  readonly max: number;
}

/** What to give an orthographic camera: the frustum in the units of the map, where it is, and how it is turned. */
export interface OrthographicFrame {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly near: number;
  readonly far: number;
  /** The place of the camera relative to the origin of the frame: above the highest height drawn, over the centre. */
  readonly position: readonly [number, number, number];
  /** Radians about z. A heading turns the top of the screen clockwise, which turns the camera by its negative. */
  readonly rotation: number;
}

const RADIANS = Math.PI / 180;

/**
 * The orthographic frame of `camera` for a map area of `size`, with `origin` as the point the card's positions are
 * relative to and `depth` the heights that are drawn (relative to the origin). A side of the area that is 0 (a box that is not
 * laid out yet) is taken as 1, so that the frame is never degenerate.
 */
export function orthographicFrame(
  camera: Camera2d,
  origin: readonly [number, number, number],
  size: Size,
  depth: DepthRange,
): OrthographicFrame {
  const halfWidth = (Math.max(size.width, 1) * camera.unitsPerPixel) / 2;
  const halfHeight = (Math.max(size.height, 1) * camera.unitsPerPixel) / 2;
  return {
    left: -halfWidth,
    right: halfWidth,
    top: halfHeight,
    bottom: -halfHeight,
    // The camera is one unit above the highest height, looking down: what is at the lowest height is the farthest.
    near: 0,
    far: depth.max - depth.min + 2,
    position: [camera.centre[0] - origin[0], camera.centre[1] - origin[1], depth.max + 1],
    rotation: -camera.heading * RADIANS,
  };
}

/** The point of the map under a point of the screen (`x` and `y` in CSS pixels from the top left of the map area). */
export function screenToMap(camera: Camera2d, size: Size, x: number, y: number): [number, number] {
  const heading = camera.heading * RADIANS;
  const [sin, cos] = [Math.sin(heading), Math.cos(heading)];
  // Right on the screen is (cos, -sin) on the map, and up on the screen is (sin, cos).
  const right = (x - size.width / 2) * camera.unitsPerPixel;
  const up = (size.height / 2 - y) * camera.unitsPerPixel;
  return [camera.centre[0] + right * cos + up * sin, camera.centre[1] - right * sin + up * cos];
}

/** Where on the screen a point of the map is, in CSS pixels from the top left of the map area. */
export function mapToScreen(camera: Camera2d, size: Size, x: number, y: number): [number, number] {
  const heading = camera.heading * RADIANS;
  const [sin, cos] = [Math.sin(heading), Math.cos(heading)];
  const east = x - camera.centre[0];
  const north = y - camera.centre[1];
  const right = east * cos - north * sin;
  const up = east * sin + north * cos;
  return [
    size.width / 2 + right / camera.unitsPerPixel,
    size.height / 2 - up / camera.unitsPerPixel,
  ];
}
