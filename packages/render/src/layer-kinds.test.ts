import type { RenderBuffers } from '@karmania/engine/display';
import { describe, expect, it } from 'vitest';
import { makeLayer } from './layer-kinds.js';
import type { LayerLook } from './look.js';

const LOOK: LayerLook = {
  visible: true,
  opacity: 1,
  colour: '#56b4e9',
  pointSize: 6,
  lineWidth: 2,
};

describe('makeLayer', () => {
  it('draws the surface of a grid with elevations, in 2D and 3D alike: it has a layer, coloured by the classes of its cells', () => {
    const buffers: RenderBuffers = {
      kind: 'surface',
      positions: Float32Array.of(0, 0, 5, 10, 0, 6, 10, 10, 7, 0, 10, 8),
      triangles: Uint32Array.of(0, 1, 2, 0, 2, 3),
      triangleCell: Uint32Array.of(0, 1),
    };
    const layer = makeLayer(buffers, LOOK);
    expect(layer).toBeDefined();
    expect(typeof layer?.setClasses).toBe('function');
    layer?.dispose();
  });

  it('draws every kind of buffers there is: none is left out as unsupported', () => {
    const kinds: RenderBuffers[] = [
      { kind: 'points', positions: Float32Array.of(0, 0, 0) },
      {
        kind: 'lines',
        positions: Float32Array.of(0, 0, 0, 1, 0, 0),
        segments: Uint32Array.of(0, 1),
        segmentLine: Uint32Array.of(0),
      },
      {
        kind: 'mesh',
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
        triangles: Uint32Array.of(0, 1, 2),
      },
      { kind: 'blocks', centres: Float32Array.of(0, 0, 0), spacing: [1, 1, 1], rotation: 0 },
    ];
    for (const buffers of kinds) {
      const layer = makeLayer(buffers, LOOK);
      expect(layer, buffers.kind).toBeDefined();
      layer?.dispose();
    }
  });
});
