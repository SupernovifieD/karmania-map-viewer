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
  const depth = dot(offset, forward);
  if (depth <= 0) {
    return undefined;
  }
  const half = Math.tan((view.fov * Math.PI) / 360);
  const ndcX = dot(offset, right) / (depth * half * view.aspect);
  const ndcY = dot(offset, up) / (depth * half);
  return {
    x: Math.floor((ndcX * 0.5 + 0.5) * stats.width),
    y: Math.floor((ndcY * 0.5 + 0.5) * stats.height),
  };
}
