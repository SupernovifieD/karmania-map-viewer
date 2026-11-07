/**
 * The layer of polygons: the fill, in the colour of the layer at its opacity, and over it an outline 1 CSS pixel wide in the same colour and
 * not transparent (so that the shape of a pale or thin polygon is seen). A polygon that could not be triangulated has no triangles and
 * is its outline alone: the engine says so in its findings, and nothing is made up here.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import { createFillLayer } from './fill-layer.js';
import { combineLayers } from './layer-combine.js';
import type { LayerObject } from './layer-set.js';
import { createLinesLayer } from './lines-layer.js';
import type { LayerLook } from './look.js';

/** The width of the outline of a polygon, in CSS pixels. */
export const POLYGON_OUTLINE_WIDTH = 1;

type PolygonBuffers = Extract<RenderBuffers, { kind: 'polygons' }>;

/** The look of the outline from the look of the layer: the same colour, never transparent, a pixel wide. */
function outlineLook(look: LayerLook): LayerLook {
  return { ...look, opacity: 1, lineWidth: POLYGON_OUTLINE_WIDTH };
}

/** The layer of `buffers`, looking as `look` says. */
export function createPolygonsLayer(buffers: PolygonBuffers, look: LayerLook): LayerObject {
  return combineLayers({
    parts: [
      createFillLayer(buffers, look),
      createLinesLayer(
        {
          kind: 'lines',
          positions: buffers.positions,
          segments: buffers.outline,
          segmentLine: buffers.outlinePolygon,
        },
        outlineLook(look),
      ),
    ],
    lookOf: (index, next) => (index === 0 ? next : outlineLook(next)),
  });
}
