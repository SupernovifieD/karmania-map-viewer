import type { RenderBuffers } from '@karmania/engine/display';
import { DoubleSide, LessDepth } from 'three';
import type { Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createFillLayer } from './fill-layer.js';
import type { LayerLook } from './look.js';
import { TRIANGLES_PER_PART } from './triangle-parts.js';

const LOOK: LayerLook = {
  visible: true,
  opacity: 0.6,
  colour: '#56b4e9',
  pointSize: 6,
  lineWidth: 2,
};

/** `count` triangles on a strip of `count + 2` vertices, which are all of the one polygon. */
const fill = (
  count: number,
): Pick<
  Extract<RenderBuffers, { kind: 'polygons' }>,
  'positions' | 'triangles' | 'trianglePolygon'
> => ({
  positions: Float32Array.from({ length: (count + 2) * 3 }, (_, i) => i),
  triangles: Uint32Array.from({ length: count * 3 }, (_, i) => Math.floor(i / 3) + (i % 3)),
  trianglePolygon: new Uint32Array(count),
});

const parts = (layer: ReturnType<typeof createFillLayer>): Mesh[] =>
  layer.object.children as Mesh[];
const uniforms = (layer: ReturnType<typeof createFillLayer>) =>
  (parts(layer)[0]?.material as ShaderMaterial).uniforms;

describe('createFillLayer', () => {
  it('puts a layer of few triangles in one part, and has nothing to step', () => {
    const layer = createFillLayer(fill(5), LOOK);
    expect(parts(layer)).toHaveLength(1);
    expect('step' in layer).toBe(false);
    expect(parts(layer)[0]?.geometry.index?.count).toBe(15);
  });

  it('has no part for no triangles: a polygon that could not be triangulated has only its outline', () => {
    expect(parts(createFillLayer(fill(0), LOOK))).toHaveLength(0);
  });

  it('puts the triangles in parts of 100,000, the first at once, and the positions once for all of them', () => {
    expect(TRIANGLES_PER_PART).toBe(100_000);
    const layer = createFillLayer(fill(TRIANGLES_PER_PART + 4), LOOK);
    expect(parts(layer)).toHaveLength(1);
    expect(layer.step?.()).toBe(false);
    expect(parts(layer).map((part) => part.geometry.index?.count)).toEqual([
      TRIANGLES_PER_PART * 3,
      12,
    ]);
    const [first, second] = parts(layer).map((part) => part.geometry.getAttribute('position'));
    expect(first).toBe(second);
    expect(layer.step?.()).toBe(false);
    expect(parts(layer)).toHaveLength(2);
  });

  it('gives the card a view of the indices of each part, not a copy', () => {
    const buffers = fill(TRIANGLES_PER_PART + 1);
    const layer = createFillLayer(buffers, LOOK);
    layer.step?.();
    const second = parts(layer)[1]?.geometry.index?.array;
    expect(second?.buffer).toBe(buffers.triangles.buffer);
    expect(second?.byteOffset).toBe(TRIANGLES_PER_PART * 3 * 4);
    expect(second?.length).toBe(3);
  });

  it('is drawn over what is there without writing depth, strictly nearer, from either side', () => {
    const material = parts(createFillLayer(fill(2), LOOK))[0]?.material as ShaderMaterial;
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.depthFunc).toBe(LessDepth);
    expect(material.side).toBe(DoubleSide);
    expect(material.transparent).toBe(true);
  });

  it('is in the colour and opacity of its look, shown or hidden, and takes a new look without being built again', () => {
    const layer = createFillLayer(fill(2), LOOK);
    const before = parts(layer)[0];
    expect(uniforms(layer)['uColour']?.value).toMatchObject({
      x: 86 / 255,
      y: 180 / 255,
      z: 233 / 255,
    });
    expect(uniforms(layer)['uOpacity']?.value).toBe(0.6);
    layer.setLook({ ...LOOK, colour: '#cc79a7', opacity: 0.3, visible: false });
    expect(uniforms(layer)['uColour']?.value).toMatchObject({
      x: 204 / 255,
      y: 121 / 255,
      z: 167 / 255,
    });
    expect(uniforms(layer)['uOpacity']?.value).toBe(0.3);
    expect(layer.object.visible).toBe(false);
    expect(parts(layer)[0]).toBe(before);
  });

  it('frees every part and its material when it is disposed', () => {
    const layer = createFillLayer(fill(TRIANGLES_PER_PART + 1), LOOK);
    layer.step?.();
    const freed: string[] = [];
    for (const [i, part] of parts(layer).entries()) {
      part.geometry.addEventListener('dispose', () => freed.push(`geometry ${String(i)}`));
    }
    (parts(layer)[0]?.material as ShaderMaterial).addEventListener('dispose', () =>
      freed.push('material'),
    );
    layer.dispose();
    expect(freed.sort()).toEqual(['geometry 0', 'geometry 1', 'material']);
    expect(parts(layer)).toHaveLength(0);
  });

  describe('coloured by classes', () => {
    /** Four triangles of two polygons (the first two of polygon 0, the others of polygon 1), on a strip of 6 vertices. */
    const two = () => ({
      ...fill(4),
      trianglePolygon: Uint32Array.of(0, 0, 1, 1),
    });
    const classMeshes = (layer: ReturnType<typeof createFillLayer>): Mesh[] =>
      (layer.object.children as Mesh[]).filter(
        (mesh) => mesh.material !== parts(layer)[0]?.material,
      );
    const colours = ['#ff0000', '#00ff00'];

    it('draws the triangles of each polygon in the colour of its class, and not the layer in its one colour', () => {
      const layer = createFillLayer(two(), LOOK);
      const own = parts(layer)[0]?.material as ShaderMaterial;
      layer.setClasses?.({ indices: Uint8Array.of(1, 0), colours });
      expect(own.visible).toBe(false);
      const meshes = (layer.object.children as Mesh[]).filter((mesh) => mesh.material !== own);
      // Class 0 is polygon 1 (triangles 2 and 3) and class 1 is polygon 0 (triangles 0 and 1).
      expect(meshes.map((mesh) => [...(mesh.geometry.index?.array ?? [])])).toEqual([
        [2, 3, 4, 3, 4, 5],
        [0, 1, 2, 1, 2, 3],
      ]);
      expect(
        meshes.map(
          (mesh) => (mesh.material as ShaderMaterial).uniforms['uColour']?.value as unknown,
        ),
      ).toMatchObject([
        // (Class 0 is red and class 1 green: the mesh of polygon 1 is red and that of polygon 0 is green.)
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ]);
    });

    it('draws no triangle of a polygon with no value', () => {
      const layer = createFillLayer(two(), LOOK);
      layer.setClasses?.({ indices: Uint8Array.of(255, 0), colours });
      expect(classMeshes(layer).map((mesh) => [...(mesh.geometry.index?.array ?? [])])).toEqual([
        [2, 3, 4, 3, 4, 5],
      ]);
    });

    it('draws them in the opacity of the layer, whichever it is, and shows or hides them with the layer', () => {
      const layer = createFillLayer(two(), LOOK);
      layer.setClasses?.({ indices: Uint8Array.of(0, 1), colours });
      layer.setLook({ ...LOOK, opacity: 0.25 });
      for (const mesh of classMeshes(layer)) {
        expect((mesh.material as ShaderMaterial).uniforms['uOpacity']?.value).toBe(0.25);
      }
      layer.setLook({ ...LOOK, visible: false });
      expect(layer.object.visible).toBe(false);
    });

    it('is its one colour again when the classes are taken away, or are not for every polygon', () => {
      const layer = createFillLayer(two(), LOOK);
      const own = parts(layer)[0]?.material as ShaderMaterial;
      layer.setClasses?.({ indices: Uint8Array.of(0, 1), colours });
      expect(own.visible).toBe(false);
      layer.setClasses?.(undefined);
      expect(own.visible).toBe(true);
      expect(classMeshes(layer)).toHaveLength(0);
      layer.setClasses?.({ indices: Uint8Array.of(0), colours });
      expect(own.visible).toBe(true);
      expect(classMeshes(layer)).toHaveLength(0);
    });

    it('shares the positions of its parts with the meshes of the classes, and keeps the meshes for the same classes with other colours', () => {
      const layer = createFillLayer(two(), LOOK);
      const indices = Uint8Array.of(0, 1);
      layer.setClasses?.({ indices, colours });
      const before = classMeshes(layer);
      expect(before[0]?.geometry.getAttribute('position')).toBe(
        parts(layer)[0]?.geometry.getAttribute('position'),
      );
      layer.setClasses?.({ indices, colours: ['#0000ff', '#ffffff'] });
      expect(classMeshes(layer)).toEqual(before);
    });

    it('frees the meshes of the classes when it is disposed', () => {
      const layer = createFillLayer(two(), LOOK);
      layer.setClasses?.({ indices: Uint8Array.of(0, 1), colours });
      const freed: string[] = [];
      for (const [i, mesh] of classMeshes(layer).entries()) {
        mesh.geometry.addEventListener('dispose', () => freed.push(`class ${String(i)}`));
      }
      layer.dispose();
      expect(freed.sort()).toEqual(['class 0', 'class 1']);
    });
  });
});
