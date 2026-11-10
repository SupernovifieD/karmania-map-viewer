/**
 * The perspective camera in plain arithmetic. Scene camera values and extents are absolute map
 * coordinates; the frame given to three is relative to the map origin, with heights exaggerated
 * about that origin. Heading is clockwise from north and elevation is above the horizon.
 */
import type { BBox } from '@karmania/engine/types';
import type { Camera3d } from '@karmania/scene';
import type { Size } from './camera-2d.js';

/** What to give a perspective camera: its lens, clipping planes and pose. */
export interface PerspectiveFrame {
  readonly fov: number;
  readonly aspect: number;
  readonly near: number;
  readonly far: number;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly up: readonly [0, 0, 1];
}

const RADIANS = Math.PI / 180;

/** A position in the card's coordinates: relative to the origin, with only z exaggerated. */
function local(
  point: readonly [number, number, number],
  origin: readonly [number, number, number],
  verticalExaggeration: number,
): [number, number, number] {
  return [
    point[0] - origin[0],
    point[1] - origin[1],
    (point[2] - origin[2]) * verticalExaggeration,
  ];
}

/** The eight corners of an extent, or the target when there is no extent yet. */
function corners(extent: BBox | null, fallback: readonly [number, number, number]) {
  if (extent === null) {
    return [fallback];
  }
  const out: [number, number, number][] = [];
  for (const x of [extent.min[0], extent.max[0]]) {
    for (const y of [extent.min[1], extent.max[1]]) {
      for (const z of [extent.min[2], extent.max[2]]) {
        out.push([x, y, z]);
      }
    }
  }
  return out;
}

/**
 * The perspective frame of `camera`. Near and far are the depths of the extent's corners along the
 * view, with five per cent of its diagonal left around them. The small distance-relative floor
 * keeps a point extent and a camera very near its target non-degenerate.
 */
export function perspectiveFrame(
  camera: Camera3d,
  origin: readonly [number, number, number],
  size: Size,
  extent: BBox | null,
  verticalExaggeration = 1,
): PerspectiveFrame {
  const heading = camera.heading * RADIANS;
  const elevation = camera.elevation * RADIANS;
  const horizontal = Math.cos(elevation);
  const forward = [
    Math.sin(heading) * horizontal,
    Math.cos(heading) * horizontal,
    -Math.sin(elevation),
  ] as const;
  const target = local(camera.target, origin, verticalExaggeration);
  const position = target.map((value, axis) => value - (forward[axis] ?? 0) * camera.distance) as [
    number,
    number,
    number,
  ];
  const localCorners = corners(extent, camera.target).map((point) =>
    local(point, origin, verticalExaggeration),
  );
  const depths = localCorners.map((point) =>
    point.reduce(
      (sum, value, axis) => sum + (value - (position[axis] ?? 0)) * (forward[axis] ?? 0),
      0,
    ),
  );
  const diagonal =
    extent === null
      ? 0
      : Math.hypot(
          extent.max[0] - extent.min[0],
          extent.max[1] - extent.min[1],
          (extent.max[2] - extent.min[2]) * verticalExaggeration,
        );
  const padding = Math.max(diagonal * 0.05, camera.distance * 1e-6, 0.01);
  const floor = Math.max(camera.distance * 1e-6, Number.EPSILON);
  const near = Math.max(floor, Math.min(...depths) - padding);
  const far = Math.max(near + padding * 2, Math.max(...depths) + padding);
  return {
    fov: camera.fov,
    aspect: Math.max(size.width, 1) / Math.max(size.height, 1),
    near,
    far,
    position,
    target,
    up: [0, 0, 1],
  };
}
