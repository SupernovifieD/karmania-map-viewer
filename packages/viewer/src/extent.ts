/**
 * The extent, in map units, of what some render buffers draw: what "fit to data" shows and what the scale of the map is
 * limited by. The positions in the buffers are relative to the origin of the frame, as the card has them, so the origin is
 * added back, in f64.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import type { BBox } from '@karmania/engine/types';

/** The extent of the positions (`x y z` interleaved) that are numbers, relative to `origin`; `undefined` if there are none. */
function ofPositions(
  positions: Float32Array,
  origin: readonly [number, number, number],
): BBox | undefined {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at + 2 < positions.length; at += 3) {
    const x = positions[at];
    const y = positions[at + 1];
    const z = positions[at + 2];
    // A position that could not be placed (a grid's corner that does not convert) is NaN and is not part of the extent.
    if (
      x === undefined ||
      y === undefined ||
      z === undefined ||
      ![x, y, z].every(Number.isFinite)
    ) {
      continue;
    }
    min[0] = Math.min(min[0] ?? Infinity, x);
    min[1] = Math.min(min[1] ?? Infinity, y);
    min[2] = Math.min(min[2] ?? Infinity, z);
    max[0] = Math.max(max[0] ?? -Infinity, x);
    max[1] = Math.max(max[1] ?? -Infinity, y);
    max[2] = Math.max(max[2] ?? -Infinity, z);
  }
  if (min[0] === Infinity) {
    return undefined;
  }
  return {
    min: [(min[0] ?? 0) + origin[0], (min[1] ?? 0) + origin[1], (min[2] ?? 0) + origin[2]],
    max: [(max[0] ?? 0) + origin[0], (max[1] ?? 0) + origin[1], (max[2] ?? 0) + origin[2]],
  };
}

/**
 * The extent of the layer that `buffers` make, in map units: the positions for points, lines, polygons, meshes, surfaces and a
 * warped grid; the four corners of the image for a grid that is placed (turned as it is); and for blocks the centres, with half a
 * block's diagonal added on each side (a turned block reaches no further than that). `undefined` for buffers with nothing in them.
 */
export function extentOf(
  buffers: RenderBuffers,
  origin: readonly [number, number, number],
): BBox | undefined {
  switch (buffers.kind) {
    case 'points':
    case 'lines':
    case 'polygons':
    case 'mesh':
    case 'surface':
      return ofPositions(buffers.positions, origin);
    case 'grid': {
      if (buffers.warp !== undefined) {
        return ofPositions(buffers.warp.positions, origin);
      }
      const { origin: corner, spacing, rotation } = buffers.placement;
      const [width, height] = [buffers.size[0] * spacing[0], buffers.size[1] * spacing[1]];
      const turn = (rotation * Math.PI) / 180;
      const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
      const corners = [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height],
      ].flatMap(([x = 0, y = 0]) => [
        corner[0] + x * cos - y * sin,
        corner[1] + x * sin + y * cos,
        corner[2],
      ]);
      return ofPositions(Float32Array.from(corners), origin);
    }
    case 'blocks': {
      const within = ofPositions(buffers.centres, origin);
      if (within === undefined) {
        return undefined;
      }
      const [dx, dy, dz] = buffers.spacing;
      const reach = Math.hypot(dx, dy) / 2;
      return {
        min: [within.min[0] - reach, within.min[1] - reach, within.min[2] - dz / 2],
        max: [within.max[0] + reach, within.max[1] + reach, within.max[2] + dz / 2],
      };
    }
  }
}
