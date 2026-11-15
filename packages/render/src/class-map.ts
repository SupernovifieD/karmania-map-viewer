/**
 * The class of each piece that is drawn, for a layer whose classes are of the elements the pieces belong to: a line's segments, a polygon's
 * triangles and outline. The engine says which element each piece belongs to (`segmentLine`, `trianglePolygon`, `outlinePolygon`) and
 * gives one class for each element; the card is given one for each piece. A piece whose element has no class here has no value.
 */
import { NO_VALUE } from './look.js';

/**
 * The classes of the pieces `from` up to `from + count` of `owners` (the element of each piece), taken from `classes` (one for each
 * element). A piece of an element that `classes` does not reach has no value.
 */
export function classesOfPieces(
  classes: Uint8Array,
  owners: Uint32Array,
  from: number,
  count: number,
): Uint8Array {
  const out = new Uint8Array(Math.max(0, count));
  for (let i = 0; i < out.length; i += 1) {
    const owner = owners[from + i];
    out[i] = owner === undefined ? NO_VALUE : (classes[owner] ?? NO_VALUE);
  }
  return out;
}

/** Whether `classes` has a class for every element that `owners` names (a layer is not coloured by classes that stop short of its pieces). */
export function coversOwners(classes: Uint8Array, owners: Uint32Array): boolean {
  // (An indexed loop: the iterator of a typed array is several times slower, and the lines of 4,000,000 cells of contours have three million owners to look at in one task.)
  let highest = -1;
  for (let i = 0; i < owners.length; i += 1) {
    const owner = owners[i];
    if (owner !== undefined && owner > highest) {
      highest = owner;
    }
  }
  return highest < classes.length;
}
