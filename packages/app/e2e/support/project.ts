/** Where a point of the map lands in the picture of the 3D camera, worked out here from what the renderer says of its camera (the arithmetic, said again). */
import type { Stats } from './render.js';

type Vector = readonly [number, number, number];

const sub = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vector): Vector => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** A point of the map in the camera's own terms: how far in front of the camera it is, and how far to the right of and above the line of sight. */
function inCamera(stats: Stats, origin: Vector, point: Vector, exaggeration: number) {
  const view = stats.perspective;
  if (view === null) {
    throw new Error('The view is not in 3D.');
  }
  const local: Vector = [
    point[0] - origin[0],
    point[1] - origin[1],
    (point[2] - origin[2]) * exaggeration,
  ];
  const forward = unit(sub(view.target, view.position));
  const right = unit(cross(forward, view.up));
  const up = cross(right, forward);
  const offset = sub(local, view.position);
  return { view, depth: dot(offset, forward), across: dot(offset, right), upward: dot(offset, up) };
}

/**
 * How far in front of the camera `point` is, along the line of sight, in the units the camera's `near` and `far` are in (negative if it is behind
 * the camera). `origin` and `exaggeration` are as for `pixelOf3d`.
 */
export function depthOf3d(stats: Stats, origin: Vector, point: Vector, exaggeration = 1): number {
  return inCamera(stats, origin, point, exaggeration).depth;
}

/**
 * The pixel of the drawing buffer (counted from its bottom left, as `pixels` reads it) that shows `point`, a point of the map in map units,
 * or `undefined` if it is behind the camera. `origin` is the frame's origin and `exaggeration` the factor that heights are drawn with: the
 * camera is relative to the origin, with heights multiplied, as the renderer places it.
 */
export function pixelOf3d(
  stats: Stats,
  origin: Vector,
  point: Vector,
  exaggeration = 1,
): { x: number; y: number } | undefined {
  const { view, depth, across, upward } = inCamera(stats, origin, point, exaggeration);
  if (depth <= 0) {
    return undefined;
  }
  const half = Math.tan((view.fov * Math.PI) / 360);
  const ndcX = across / (depth * half * view.aspect);
  const ndcY = upward / (depth * half);
  return {
    x: Math.floor((ndcX * 0.5 + 0.5) * stats.width),
    y: Math.floor((ndcY * 0.5 + 0.5) * stats.height),
  };
}
