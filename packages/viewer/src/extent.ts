/**
 * The extent, in map units, of what some render buffers draw: what "fit to data" shows and what the scale of the map is
 * limited by. The positions in the buffers are relative to the origin of the frame, as the card has them, so the origin is
 * added back, in f64 (the corners of a grid are made as floats first, an error of the size of the offset from the origin times 6e-8,
 * which a fit does not see).
 *
 * It is a pass over every position (3,000,000 numbers for a million points), which is 10 to 40 ms of the page's thread and more on a slow
 * machine, so `extentOfInParts` does it a slice at a time and gives the page a turn between the slices; `extentOf` is the same in one go.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import type { BBox } from '@karmania/engine/types';

/** How many positions are looked at before the page is given a turn: about 3 ms of work for each, which a task can take. */
export const POSITIONS_PER_TURN = 200_000;

/** What is known of the positions looked at so far. */
interface Bounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

const nothingYet = (): Bounds => ({
  minX: Infinity,
  minY: Infinity,
  minZ: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
  maxZ: -Infinity,
});

/**
 * Takes in the positions (`x y z` interleaved) from the number `from` to the number `to` (of the numbers in the array, not of the
 * positions). Variables and no allocation: with an array made and six indexed calls for each position it held the page for 30 to 70 ms.
 */
function widen(bounds: Bounds, positions: Float32Array, from: number, to: number): void {
  let { minX, minY, minZ, maxX, maxY, maxZ } = bounds;
  const end = Math.min(to, positions.length) - 2;
  for (let at = from; at < end; at += 3) {
    const x = positions[at] ?? NaN;
    const y = positions[at + 1] ?? NaN;
    const z = positions[at + 2] ?? NaN;
    // A position that could not be placed (a grid's corner that does not convert) is NaN and is not part of the extent: nor is an infinite
    // one. The sum of the three is a number only if each is (NaN and an infinity both make `sum - sum` not 0).
    const sum = x + y + z;
    if (sum - sum !== 0) {
      continue;
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  Object.assign(bounds, { minX, minY, minZ, maxX, maxY, maxZ });
}

/** What was looked at, as a box with the origin put back; `undefined` if no position was a number. */
function boxOf(bounds: Bounds, origin: readonly [number, number, number]): BBox | undefined {
  if (bounds.minX === Infinity) {
    return undefined;
  }
  return {
    min: [bounds.minX + origin[0], bounds.minY + origin[1], bounds.minZ + origin[2]],
    max: [bounds.maxX + origin[0], bounds.maxY + origin[1], bounds.maxZ + origin[2]],
  };
}

/** The extent of the positions that are numbers, relative to `origin`; `undefined` if there are none. */
function ofPositions(
  positions: Float32Array,
  origin: readonly [number, number, number],
): BBox | undefined {
  const bounds = nothingYet();
  widen(bounds, positions, 0, positions.length);
  return boxOf(bounds, origin);
}

/** What the extent of some buffers is made from: a box that is known already, or positions to look at and what to do with their extent. */
type Plan =
  | { readonly box: BBox | undefined }
  | { readonly positions: Float32Array; readonly finish: (within: BBox) => BBox };

/**
 * What the extent of the layer that `buffers` make is made from: the positions for points, lines, polygons, meshes, surfaces and a warped
 * grid; the four corners of the image for a grid that is placed (turned as it is); and for blocks the centres, with half a block's
 * diagonal added on each side (a turned block reaches no further than that).
 */
function planOf(buffers: RenderBuffers, origin: readonly [number, number, number]): Plan {
  switch (buffers.kind) {
    case 'points':
    case 'lines':
    case 'polygons':
    case 'mesh':
    case 'surface':
      return { positions: buffers.positions, finish: (within) => within };
    case 'grid': {
      if (buffers.warp !== undefined) {
        return { positions: buffers.warp.positions, finish: (within) => within };
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
      return { box: ofPositions(Float32Array.from(corners), origin) };
    }
    case 'blocks': {
      const [dx, dy, dz] = buffers.spacing;
      const reach = Math.hypot(dx, dy) / 2;
      return {
        positions: buffers.centres,
        finish: (within) => ({
          min: [within.min[0] - reach, within.min[1] - reach, within.min[2] - dz / 2],
          max: [within.max[0] + reach, within.max[1] + reach, within.max[2] + dz / 2],
        }),
      };
    }
  }
}

/** The extent of the layer that `buffers` make, in map units, in one go. `undefined` for buffers with nothing in them. */
export function extentOf(
  buffers: RenderBuffers,
  origin: readonly [number, number, number],
): BBox | undefined {
  const plan = planOf(buffers, origin);
  if ('box' in plan) {
    return plan.box;
  }
  const within = ofPositions(plan.positions, origin);
  return within === undefined ? undefined : plan.finish(within);
}

/** Gives the page a turn: what runs next is another task, so that what the page has to do (a frame, a click) is not kept waiting. */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * The same extent as `extentOf`, looked at `perTurn` positions at a time, with `turn` awaited between the slices (the next task, by
 * default), so that no task is made long by a layer of millions. Buffers of fewer than `perTurn` positions are done without a turn.
 */
export async function extentOfInParts(
  buffers: RenderBuffers,
  origin: readonly [number, number, number],
  turn: () => Promise<void> = nextTask,
  perTurn: number = POSITIONS_PER_TURN,
): Promise<BBox | undefined> {
  const plan = planOf(buffers, origin);
  if ('box' in plan) {
    return plan.box;
  }
  const { positions } = plan;
  const bounds = nothingYet();
  const slice = Math.max(1, Math.floor(perTurn)) * 3;
  for (let from = 0; from < positions.length; from += slice) {
    widen(bounds, positions, from, from + slice);
    if (from + slice < positions.length) {
      await turn();
    }
  }
  const within = boxOf(bounds, origin);
  return within === undefined ? undefined : plan.finish(within);
}
