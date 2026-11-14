import type { RenderBuffers } from '@karmania/engine/display';
import type { Mesh } from 'three';
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
  it('draws the surface of a grid with elevations, each triangle in the colour of the class of the cell it belongs to: the classes are of the cells, which are more than the triangles', () => {
    // Four cells, and two triangles: the first belongs to cell 1 and the second to cell 3. (With as many classes as triangles they could be taken for
    // the triangles' own, and the layer would be coloured the same without the cells being said.)
    const buffers: RenderBuffers = {
      kind: 'surface',
      positions: Float32Array.of(0, 0, 5, 10, 0, 6, 10, 10, 7, 0, 10, 8),
      triangles: Uint32Array.of(0, 1, 2, 0, 2, 3),
      triangleCell: Uint32Array.of(1, 3),
    };
    const layer = makeLayer(buffers, LOOK);
    expect(layer).toBeDefined();
    const own = (layer?.object.children[0] as Mesh | undefined)?.material;
    layer?.setClasses?.({ indices: Uint8Array.of(0, 1, 0, 0), colours: ['#ff0000', '#00ff00'] });
    // Cell 1 is of class 1 and cell 3 of class 0: class 0 has the second triangle and class 1 the first. (The layer's own triangles, in one colour, are
    // not drawn then.)
    const byClass = (layer?.object.children as Mesh[]).filter((mesh) => mesh.material !== own);
    expect(byClass.map((mesh) => [...(mesh.geometry.index?.array ?? [])])).toEqual([
      [0, 2, 3],
      [0, 1, 2],
    ]);
    expect((own as { visible: boolean } | undefined)?.visible).toBe(false);
    layer?.dispose();
  });

  it('draws every kind of buffers there is: none is left out as unsupported', () => {
    // A record over the kinds, so that a kind that is added and not listed here is an error of the compiler.
    const kinds: { readonly [K in RenderBuffers['kind']]: Extract<RenderBuffers, { kind: K }> } = {
      points: { kind: 'points', positions: Float32Array.of(0, 0, 0) },
      lines: {
        kind: 'lines',
        positions: Float32Array.of(0, 0, 0, 1, 0, 0),
        segments: Uint32Array.of(0, 1),
        segmentLine: Uint32Array.of(0),
      },
      polygons: {
        kind: 'polygons',
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
        triangles: Uint32Array.of(0, 1, 2),
        trianglePolygon: Uint32Array.of(0),
        outline: Uint32Array.of(0, 1, 1, 2, 2, 0),
        outlinePolygon: Uint32Array.of(0, 0, 0),
      },
      mesh: {
        kind: 'mesh',
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
        triangles: Uint32Array.of(0, 1, 2),
      },
      grid: {
        kind: 'grid',
        size: [1, 1],
        tiles: [{ i0: 0, j0: 0, nx: 1, ny: 1 }],
        placement: { origin: [0, 0, 0], spacing: [1, 1], rotation: 0 },
      },
      surface: {
        kind: 'surface',
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
        triangles: Uint32Array.of(0, 1, 2),
        triangleCell: Uint32Array.of(0),
      },
      blocks: {
        kind: 'blocks',
        centres: Float32Array.of(0, 0, 0),
        spacing: [1, 1, 1],
        rotation: 0,
      },
    };
    for (const buffers of Object.values(kinds)) {
      const layer = makeLayer(buffers, LOOK);
      expect(layer, buffers.kind).toBeDefined();
      layer?.dispose();
    }
  });
});
