/**
 * Picking (brief 11.5 and step 21.1): which element of which layer is at a pixel of the map.
 *
 * The layers are drawn a second time, into a target that holds numbers and not colours: each fragment writes the layer it is of and the element it
 * is a part of, as the four bytes of a pixel (an RGBA8 target holding a 32-bit integer: the red, green and blue bytes are the element plus one, so
 * that a pixel nothing drew is 0, and the alpha byte is the layer's place in the drawing order plus one). A target of integers proper (`R32UI`) would
 * have meant a second copy of every shader, since three's materials write a colour of floats; this way a layer's shaders are its own, made with a
 * `PICK` define that says what is written, and so what is picked is exactly what is drawn (the same vertices, the same pixels left out, the same
 * depth). One pixel is read back, without waiting for the card.
 */

import { LessDepth, NoBlending, ShaderMaterial } from 'three';
import type { IUniform, Side } from 'three';

/** The most layers that can be told apart: the alpha byte holds the place plus one, and 0 is nothing. */
export const MAX_PICK_LAYERS = 254;

/** The largest element number that can be told: the three bytes hold the number plus one. */
export const MAX_PICK_ELEMENT = 0xff_fffe;

/** What is at a pixel: the layer (as the scene names it), and the element in it counted from 0, as the dataset has them. */
export interface PickHit {
  readonly layerId: string;
  readonly element: number;
}

/** The four bytes a pixel of layer `rank` (from 0) and element `element` (from 0) is written as. `undefined` if either does not fit. */
export function encodePick(
  rank: number,
  element: number,
): [number, number, number, number] | undefined {
  if (
    !Number.isInteger(rank) ||
    !Number.isInteger(element) ||
    rank < 0 ||
    rank >= MAX_PICK_LAYERS ||
    element < 0 ||
    element > MAX_PICK_ELEMENT
  ) {
    return undefined;
  }
  const n = element + 1;
  return [n & 0xff, (n >> 8) & 0xff, n >>> 16, rank + 1];
}

/** The layer's place and the element that four bytes say, or `undefined` for a pixel that nothing was drawn on. */
export function decodePick(
  bytes: ArrayLike<number>,
  offset = 0,
): { readonly rank: number; readonly element: number } | undefined {
  const [r = 0, g = 0, b = 0, a = 0] = [0, 1, 2, 3].map((i) => bytes[offset + i] ?? 0);
  if (a === 0) {
    return undefined;
  }
  return { rank: a - 1, element: r + g * 256 + b * 65536 - 1 };
}

/**
 * For the fragment shaders: `pickColour(element)` is what a fragment of that element writes (in a shader made with `PICK`). The number is a float
 * that is exact up to 2^24, which is why elements are not more than `MAX_PICK_ELEMENT`.
 */
export const PICK_FRAGMENT_GLSL = /* glsl */ `
uniform float uPickLayer;
vec4 pickColour(float element) {
  float n = element + 1.0;
  // An element that three bytes cannot say would be written as another one: it is not written.
  if (n > ${String(MAX_PICK_ELEMENT + 1)}.0) {
    discard;
  }
  float r = mod(n, 256.0);
  float g = mod(floor(n / 256.0), 256.0);
  float b = floor(n / 65536.0);
  return vec4(r, g, b, uPickLayer) / 255.0;
}
`;

/**
 * The material that picks for a layer: made from the layer's own shaders, which are written for a `PICK` define, and sharing its uniforms (so that
 * the layer's look, the viewport and the tie-break of the frame are the frame's). It writes a number and not a colour, so nothing is blended; the
 * depth test is the drawing's (strictly nearer).
 */
export function pickMaterial(options: {
  readonly uniforms: Record<string, IUniform>;
  readonly vertexShader: string;
  readonly fragmentShader: string;
  readonly side?: Side;
}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: options.uniforms,
    defines: { PICK: '' },
    vertexShader: options.vertexShader,
    fragmentShader: options.fragmentShader,
    transparent: false,
    blending: NoBlending,
    depthTest: true,
    depthFunc: LessDepth,
    depthWrite: true,
    ...(options.side === undefined ? {} : { side: options.side }),
  });
}

/**
 * The smallest a marker or a line is when it is picked, in CSS pixels: what is drawn is a few pixels, which a pointer does not hit on purpose, so what
 * is picked is a little larger than what is drawn.
 */
export const PICK_MIN_POINT = 12;
export const PICK_MIN_LINE = 8;
