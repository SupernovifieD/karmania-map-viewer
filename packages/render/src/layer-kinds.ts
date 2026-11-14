/**
 * Which kinds of buffers are drawn, and how: one maker for each kind of `RenderBuffers` (section 11.4 of the brief). A kind
 * that has none is `undefined`, which the renderer says as "unsupported" and draws nothing for; the type makes a new kind
 * of buffers a compile error until it has an entry here.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import { createBlocksLayer } from './blocks-layer.js';
import { createGridLayer } from './grid-layer.js';
import { createLinesLayer } from './lines-layer.js';
import { createMeshLayer } from './mesh-layer.js';
import { createPolygonsLayer } from './polygons-layer.js';
import type { LayerMaker } from './layer-set.js';
import { createPointsLayer } from './points-layer.js';

/** The makers of the layers, by the kind of buffers they are made from. */
const MAKERS: { readonly [K in RenderBuffers['kind']]: LayerMaker | undefined } = {
  points: (buffers, look) =>
    buffers.kind === 'points' ? createPointsLayer(buffers, look) : undefined,
  lines: (buffers, look) =>
    buffers.kind === 'lines' ? createLinesLayer(buffers, look) : undefined,
  polygons: (buffers, look) =>
    buffers.kind === 'polygons' ? createPolygonsLayer(buffers, look) : undefined,
  mesh: (buffers, look) => (buffers.kind === 'mesh' ? createMeshLayer(buffers, look) : undefined),
  grid: (buffers, look) => (buffers.kind === 'grid' ? createGridLayer(buffers, look) : undefined),
  // A surface is a mesh whose triangles take their colour from a cell: the classes of a grid are of its cells.
  surface: (buffers, look) =>
    buffers.kind === 'surface'
      ? createMeshLayer(
          {
            positions: buffers.positions,
            triangles: buffers.triangles,
            owners: buffers.triangleCell,
          },
          look,
        )
      : undefined,
  blocks: (buffers, look) =>
    buffers.kind === 'blocks' ? createBlocksLayer(buffers, look) : undefined,
};

/** The layer for some buffers, or `undefined` if buffers of that kind are not drawn (yet). */
export const makeLayer: LayerMaker = (buffers, look) => MAKERS[buffers.kind]?.(buffers, look);
