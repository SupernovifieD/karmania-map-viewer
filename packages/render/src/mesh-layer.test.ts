import type { RenderBuffers } from '@karmania/engine/display';
import { DoubleSide, LessDepth } from 'three';
import type { Vector3 } from 'three';
import type { Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { MESH_AMBIENT, createMeshLayer } from './mesh-layer.js';
import type { LayerLook } from './look.js';
import { TRIANGLES_PER_PART } from './triangle-parts.js';

const LOOK: LayerLook = {
  visible: true,
  opacity: 1,
  colour: '#56b4e9',
  pointSize: 6,
  lineWidth: 2,
};

/** A square of two triangles, as a mesh of the engine, with a vertex that is shared by both. */
const square = (): Extract<RenderBuffers, { kind: 'mesh' }> => ({
  kind: 'mesh',
  positions: Float32Array.of(0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0),
  triangles: Uint32Array.of(0, 1, 2, 0, 2, 3),
});

/** `count` triangles on a strip of `count + 2` vertices. */
const strip = (count: number): Extract<RenderBuffers, { kind: 'mesh' }> => ({
  kind: 'mesh',
  positions: Float32Array.from({ length: (count + 2) * 3 }, (_, i) => i),
  triangles: Uint32Array.from({ length: count * 3 }, (_, i) => Math.floor(i / 3) + (i % 3)),
});

const parts = (layer: ReturnType<typeof createMeshLayer>): Mesh[] =>
  layer.object.children as Mesh[];
const material = (layer: ReturnType<typeof createMeshLayer>) =>
  parts(layer)[0]?.material as ShaderMaterial;

describe('createMeshLayer', () => {
  it('shares the vertices the engine sent: no vertex is made again for a triangle, and there is no attribute of normals', () => {
    const layer = createMeshLayer(square(), LOOK);
    const geometry = parts(layer)[0]?.geometry;
    expect(geometry?.getAttribute('position').count).toBe(4);
    expect(geometry?.index?.count).toBe(6);
    expect(Object.keys(geometry?.attributes ?? {})).toEqual(['position']);
  });

  it('reads the change of the position from one pixel to the next in the fragment shader, which the normal is worked out from (the shading is tested in the browser)', () => {
    const { fragmentShader } = material(createMeshLayer(square(), LOOK));
    expect(fragmentShader).toContain('dFdx(vView)');
    expect(fragmentShader).toContain('dFdy(vView)');
  });

  it('is lit from straight above, with a quarter of the colour kept in the dark', () => {
    expect(MESH_AMBIENT).toBe(0.25);
    const { uniforms } = material(createMeshLayer(square(), LOOK));
    expect(uniforms['uLight']?.value).toMatchObject({ x: 0, y: 0, z: 1 });
    expect(uniforms['uAmbient']?.value).toBe(0.25);
  });

  it('takes the light of each frame, the same for the layer and for the triangles it has by class, and starts straight above', () => {
    const layer = createMeshLayer(square(), LOOK);
    layer.setClasses?.({ indices: Uint8Array.of(1, 0), colours: ['#ff0000', '#00ff00'] });
    const own = material(layer).uniforms['uLight']?.value as Vector3;
    expect(own).toMatchObject({ x: 0, y: 0, z: 1 });
    layer.prepareFrame({
      pixelRatio: 1,
      flat: false,
      viewport: [800, 600],
      light: [0.6, 0, 0.8],
      outline: [0, 0, 0],
    });
    expect(own).toMatchObject({ x: 0.6, y: 0, z: 0.8 });
    // The triangles by class use the same uniform object, so they are lit by it too.
    const others = parts(layer).filter((mesh) => mesh.material !== material(layer));
    expect(others.length).toBeGreaterThan(0);
    for (const mesh of others) {
      expect((mesh.material as ShaderMaterial).uniforms['uLight']?.value).toBe(own);
    }
  });

  it('is drawn with depth, strictly nearer, so that the highest part shows, from either side', () => {
    const m = material(createMeshLayer(square(), LOOK));
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(true);
    expect(m.depthFunc).toBe(LessDepth);
    expect(m.side).toBe(DoubleSide);
    expect(m.transparent).toBe(true);
  });

  it('is in the colour and opacity of its look, shown or hidden, and takes a new look without being built again', () => {
    const layer = createMeshLayer(square(), LOOK);
    const before = parts(layer)[0];
    expect(material(layer).uniforms['uColour']?.value).toMatchObject({
      x: 86 / 255,
      y: 180 / 255,
      z: 233 / 255,
    });
    expect(material(layer).uniforms['uOpacity']?.value).toBe(1);
    layer.setLook({ ...LOOK, colour: '#cc79a7', opacity: 0.4, visible: false });
    expect(material(layer).uniforms['uColour']?.value).toMatchObject({
      x: 204 / 255,
      y: 121 / 255,
      z: 167 / 255,
    });
    expect(material(layer).uniforms['uOpacity']?.value).toBe(0.4);
    expect(layer.object.visible).toBe(false);
    expect(parts(layer)[0]).toBe(before);
  });

  it('is built a part at a time when it has many triangles, and in one when it has few', () => {
    expect('step' in createMeshLayer(square(), LOOK)).toBe(false);
    const layer = createMeshLayer(strip(TRIANGLES_PER_PART + 4), LOOK);
    expect(parts(layer)).toHaveLength(1);
    expect(layer.step?.()).toBe(false);
    expect(parts(layer)).toHaveLength(2);
  });

  it('has no triangle to draw for a mesh that has none, and says nothing is left to build', () => {
    const layer = createMeshLayer(strip(0), LOOK);
    expect(parts(layer)).toHaveLength(0);
    expect('step' in layer).toBe(false);
  });

  it('frees its geometry and its material when it is disposed', () => {
    const layer = createMeshLayer(square(), LOOK);
    const freed: string[] = [];
    parts(layer)[0]?.geometry.addEventListener('dispose', () => freed.push('geometry'));
    material(layer).addEventListener('dispose', () => freed.push('material'));
    layer.dispose();
    expect(freed.sort()).toEqual(['geometry', 'material']);
    expect(parts(layer)).toHaveLength(0);
  });

  describe('coloured by classes', () => {
    const colours = ['#ff0000', '#00ff00'];
    const others = (layer: ReturnType<typeof createMeshLayer>): Mesh[] =>
      parts(layer).filter((mesh) => mesh.material !== parts(layer)[0]?.material);

    it('draws each triangle in the colour of its class, and not the layer in its one colour', () => {
      const layer = createMeshLayer(square(), LOOK);
      const own = parts(layer)[0]?.material as ShaderMaterial;
      layer.setClasses?.({ indices: Uint8Array.of(1, 0), colours });
      expect(own.visible).toBe(false);
      const meshes = others(layer);
      // The square's triangles are 0, 1, 2 and 0, 2, 3: class 0 is the second of them and class 1 the first.
      expect(meshes.map((mesh) => [...(mesh.geometry.index?.array ?? [])])).toEqual([
        [0, 2, 3],
        [0, 1, 2],
      ]);
      expect(
        meshes.map(
          (mesh) => (mesh.material as ShaderMaterial).uniforms['uColour']?.value as unknown,
        ),
      ).toMatchObject([
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ]);
    });

    it('is lit as the layer is: the meshes of the classes share its light, its ambient and its opacity, and its shader', () => {
      const layer = createMeshLayer(square(), LOOK);
      const own = parts(layer)[0]?.material as ShaderMaterial;
      layer.setClasses?.({ indices: Uint8Array.of(0, 1), colours });
      for (const mesh of others(layer)) {
        const material = mesh.material as ShaderMaterial;
        expect(material.uniforms['uLight']).toBe(own.uniforms['uLight']);
        expect(material.uniforms['uAmbient']).toBe(own.uniforms['uAmbient']);
        expect(material.uniforms['uOpacity']).toBe(own.uniforms['uOpacity']);
        expect(material.fragmentShader).toBe(own.fragmentShader);
        expect(material.depthWrite).toBe(true);
        expect(material.depthFunc).toBe(LessDepth);
      }
      layer.setLook({ ...LOOK, opacity: 0.3 });
      expect(own.uniforms['uOpacity']?.value).toBe(0.3);
    });

    it('draws no triangle with no value, and the one colour again when the classes are taken away or are not for every triangle', () => {
      const layer = createMeshLayer(square(), LOOK);
      const own = parts(layer)[0]?.material as ShaderMaterial;
      layer.setClasses?.({ indices: Uint8Array.of(255, 0), colours });
      expect(others(layer).map((mesh) => [...(mesh.geometry.index?.array ?? [])])).toEqual([
        [0, 2, 3],
      ]);
      layer.setClasses?.(undefined);
      expect(own.visible).toBe(true);
      expect(others(layer)).toHaveLength(0);
      layer.setClasses?.({ indices: Uint8Array.of(0), colours });
      expect(own.visible).toBe(true);
      expect(others(layer)).toHaveLength(0);
    });

    it('keeps the meshes for the same classes with other colours, and frees them when it is disposed', () => {
      const layer = createMeshLayer(square(), LOOK);
      const indices = Uint8Array.of(0, 1);
      layer.setClasses?.({ indices, colours });
      const before = others(layer);
      layer.setClasses?.({ indices, colours: ['#0000ff', '#ffffff'] });
      expect(others(layer)).toEqual(before);
      const freed: string[] = [];
      for (const [i, mesh] of before.entries()) {
        mesh.geometry.addEventListener('dispose', () => freed.push(`class ${String(i)}`));
      }
      layer.dispose();
      expect(freed.sort()).toEqual(['class 0', 'class 1']);
    });
  });
});
