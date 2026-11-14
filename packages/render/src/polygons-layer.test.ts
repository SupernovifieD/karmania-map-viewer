import type { RenderBuffers } from '@karmania/engine/display';
import type { InstancedBufferGeometry, Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { TRIANGLES_PER_PART } from './triangle-parts.js';
import type { FrameInfo, LayerLook } from './look.js';
import { POLYGON_OUTLINE_WIDTH, createPolygonsLayer } from './polygons-layer.js';

const LOOK: LayerLook = {
  visible: true,
  opacity: 0.6,
  colour: '#009e73',
  pointSize: 6,
  lineWidth: 4,
};
const INFO: FrameInfo = {
  pixelRatio: 2,
  viewport: [800, 600],
  flat: true,
  light: [0, 0, 1],
  outline: [0, 0, 0],
};

/** One square polygon of two triangles and a closed outline of four segments, as the engine makes them. */
const square = (): Extract<RenderBuffers, { kind: 'polygons' }> => ({
  kind: 'polygons',
  positions: Float32Array.of(0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0),
  triangles: Uint32Array.of(0, 1, 2, 0, 2, 3),
  trianglePolygon: Uint32Array.of(0, 0),
  outline: Uint32Array.of(0, 1, 1, 2, 2, 3, 3, 0),
  outlinePolygon: Uint32Array.of(0, 0, 0, 0),
});

/** The fill's parts and the outline's, which are the two groups in the layer. */
const groups = (layer: ReturnType<typeof createPolygonsLayer>) => {
  const [fill, outline] = layer.object.children;
  return { fill: (fill?.children ?? []) as Mesh[], outline: (outline?.children ?? []) as Mesh[] };
};
const uniformsOf = (part: Mesh | undefined) => (part?.material as ShaderMaterial).uniforms;

describe('createPolygonsLayer', () => {
  it('is a fill and an outline, the fill under the outline', () => {
    const layer = createPolygonsLayer(square(), LOOK);
    expect(layer.object.children).toHaveLength(2);
    const { fill, outline } = groups(layer);
    expect(fill).toHaveLength(1);
    expect(outline).toHaveLength(1);
    expect(fill[0]?.geometry.index?.count).toBe(6);
    expect((outline[0]?.geometry as InstancedBufferGeometry).instanceCount).toBe(4);
  });

  it('fills at the opacity of the layer and outlines in the same colour, not transparent, 1 CSS pixel wide at any size of the style', () => {
    expect(POLYGON_OUTLINE_WIDTH).toBe(1);
    const layer = createPolygonsLayer(square(), LOOK);
    layer.prepareFrame(INFO);
    const { fill, outline } = groups(layer);
    expect(uniformsOf(fill[0])['uOpacity']?.value).toBe(0.6);
    expect(uniformsOf(outline[0])['uOpacity']?.value).toBe(1);
    expect(uniformsOf(outline[0])['uWidth']?.value).toBe(2);
    expect(uniformsOf(outline[0])['uColour']?.value).toMatchObject({
      x: 0,
      y: 158 / 255,
      z: 115 / 255,
    });
    expect(uniformsOf(fill[0])['uColour']?.value).toMatchObject({
      x: 0,
      y: 158 / 255,
      z: 115 / 255,
    });
  });

  it('takes a new look in both parts, and hides both', () => {
    const layer = createPolygonsLayer(square(), LOOK);
    layer.setLook({ ...LOOK, colour: '#d55e00', opacity: 0.2, visible: false });
    const { fill, outline } = groups(layer);
    expect(uniformsOf(fill[0])['uOpacity']?.value).toBe(0.2);
    expect(uniformsOf(outline[0])['uOpacity']?.value).toBe(1);
    expect(uniformsOf(outline[0])['uColour']?.value).toMatchObject({
      x: 213 / 255,
      y: 94 / 255,
      z: 0,
    });
    expect(fill[0]?.parent?.visible).toBe(false);
    expect(outline[0]?.parent?.visible).toBe(false);
  });

  it('is its outline alone where no triangle could be made, and the fill alone where there is no outline', () => {
    const outlineOnly = createPolygonsLayer(
      { ...square(), triangles: new Uint32Array(0), trianglePolygon: new Uint32Array(0) },
      LOOK,
    );
    expect(groups(outlineOnly).fill).toHaveLength(0);
    expect(groups(outlineOnly).outline).toHaveLength(1);
    const fillOnly = createPolygonsLayer(
      { ...square(), outline: new Uint32Array(0), outlinePolygon: new Uint32Array(0) },
      LOOK,
    );
    expect(groups(fillOnly).fill).toHaveLength(1);
    expect(groups(fillOnly).outline).toHaveLength(0);
  });

  it('is built a part at a time while either part is big, and is done when both are', () => {
    const big = {
      ...square(),
      triangles: Uint32Array.from({ length: (TRIANGLES_PER_PART + 1) * 3 }, () => 0),
    };
    const layer = createPolygonsLayer(big, LOOK);
    expect(groups(layer).fill).toHaveLength(1);
    expect(layer.step?.()).toBe(false);
    expect(groups(layer).fill).toHaveLength(2);
    expect(layer.step?.()).toBe(false);
  });

  it('frees both parts when it is disposed', () => {
    const layer = createPolygonsLayer(square(), LOOK);
    const freed: string[] = [];
    const { fill, outline } = groups(layer);
    fill[0]?.geometry.addEventListener('dispose', () => freed.push('fill'));
    outline[0]?.geometry.addEventListener('dispose', () => freed.push('outline'));
    layer.dispose();
    expect(freed.sort()).toEqual(['fill', 'outline']);
    expect(layer.object.children).toHaveLength(0);
  });

  describe('coloured by classes', () => {
    /** Two squares, each of two triangles and an outline of four segments, as the engine makes them. */
    const squares = (): Extract<RenderBuffers, { kind: 'polygons' }> => ({
      kind: 'polygons',
      positions: Float32Array.of(
        0,
        0,
        0,
        10,
        0,
        0,
        10,
        10,
        0,
        0,
        10,
        0,
        20,
        0,
        0,
        30,
        0,
        0,
        30,
        10,
        0,
        20,
        10,
        0,
      ),
      triangles: Uint32Array.of(0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7),
      trianglePolygon: Uint32Array.of(0, 0, 1, 1),
      outline: Uint32Array.of(0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4),
      outlinePolygon: Uint32Array.of(0, 0, 0, 0, 1, 1, 1, 1),
    });
    const colouring = { indices: Uint8Array.of(1, 0), colours: ['#ff0000', '#00ff00'] };

    it('colours the fill and the outline of a polygon by its class', () => {
      const layer = createPolygonsLayer(squares(), LOOK);
      layer.setClasses?.(colouring);
      const { fill, outline } = groups(layer);
      // The fill has its own part (not drawn, with no classes) and a mesh for each class.
      expect(fill.length).toBeGreaterThanOrEqual(3);
      const outlineClasses = outline.map((mesh) => [
        ...(mesh.geometry as InstancedBufferGeometry).getAttribute('aClass').array,
      ]);
      expect(outlineClasses).toEqual([[1, 1, 1, 1, 0, 0, 0, 0]]);
      expect(uniformsOf(outline[0])['uClassed']?.value).toBe(1);
    });

    it('is the one colour again when the classes are taken away', () => {
      const layer = createPolygonsLayer(squares(), LOOK);
      layer.setClasses?.(colouring);
      layer.setClasses?.(undefined);
      const { fill, outline } = groups(layer);
      expect(fill).toHaveLength(1);
      expect((fill[0]?.material as ShaderMaterial).visible).toBe(true);
      expect(uniformsOf(outline[0])['uClassed']?.value).toBe(0);
    });

    it('does not draw the outline of a polygon with no value either', () => {
      const layer = createPolygonsLayer(squares(), LOOK);
      layer.setClasses?.({ indices: Uint8Array.of(255, 0), colours: colouring.colours });
      const { outline } = groups(layer);
      const classes = [
        ...(outline[0]?.geometry as InstancedBufferGeometry).getAttribute('aClass').array,
      ];
      expect(classes).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
    });
  });
});
