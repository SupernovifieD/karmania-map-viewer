/**
 * Which kinds of buffers are drawn, and how: one maker for each kind of `RenderBuffers` (section 11.4 of the brief). A kind
 * that has none yet is `undefined`, which the renderer says as "unsupported" and draws nothing for; the type makes a new kind
 * of buffers a compile error until it has an entry here.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import type { LayerMaker } from './layer-set.js';

/** The makers of the layers, by the kind of buffers they are made from. */
const MAKERS: { readonly [K in RenderBuffers['kind']]: LayerMaker | undefined } = {
  points: undefined,
  lines: undefined,
  polygons: undefined,
  mesh: undefined,
  grid: undefined,
  surface: undefined,
  blocks: undefined,
};

/** The layer for some buffers, or `undefined` if buffers of that kind are not drawn (yet). */
export const makeLayer: LayerMaker = (buffers) => MAKERS[buffers.kind]?.(buffers);
