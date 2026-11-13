/**
 * The light that meshes, surfaces and blocks are lit by (section 9.3 of the brief, and decision 18.4a). In the view from above the light
 * comes from straight above, so a flat top has the colour of its layer as it is and a slope is darker the steeper it is, which shows
 * slope as a hillshade does. In 3D the light is **fixed in the world**: from the north-west, 45 degrees above the horizon (the
 * convention of hillshades), so that what is lit does not change as the camera goes round and a face keeps its shade. Layers are given the
 * light in the space of the camera (`FrameInfo.light`), the space their normals are worked out in, and the renderer works it out once for
 * each frame.
 */

/** A direction, `[x, y, z]`, of length 1. */
export type Direction = readonly [number, number, number];

/** The light of the view from above: straight up. In that view the camera looks straight down, so up is the same in the world and the camera's space. */
export const LIGHT_FROM_ABOVE: Direction = [0, 0, 1];

/**
 * The direction to the light in the world in 3D: from the north-west (azimuth 315 degrees, clockwise from north), 45 degrees above the
 * horizon. x is east, y north, z up; the length is 1 (a quarter, a quarter and a half).
 */
export const WORLD_LIGHT: Direction = [-0.5, 0.5, Math.SQRT1_2];

/**
 * A direction of the world in the space of a camera: the turn that the camera's view matrix makes, without its move. `view` is that matrix as
 * three keeps it (`matrixWorldInverse.elements`: 16 numbers, a column after a column). The result has the length of `direction`.
 */
export function inViewSpace(view: ArrayLike<number>, direction: Direction): Direction {
  const [x, y, z] = direction;
  const at = (i: number): number => view[i] ?? 0;
  return [
    at(0) * x + at(4) * y + at(8) * z,
    at(1) * x + at(5) * y + at(9) * z,
    at(2) * x + at(6) * y + at(10) * z,
  ];
}

/**
 * The light for a frame, in the space of the camera that draws it: straight up for the view from above (exactly, so that what is lit there
 * is the same to the bit whatever the camera's matrix works out to), and the light of the world turned into the camera's space for 3D.
 * `view` is the camera's view matrix as three keeps it (`matrixWorldInverse.elements`).
 */
export function frameLight(flat: boolean, view: ArrayLike<number>): Direction {
  return flat ? LIGHT_FROM_ABOVE : inViewSpace(view, WORLD_LIGHT);
}
