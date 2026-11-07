import type { RenderBuffers } from '@karmania/engine/display';
import { DoubleSide, LessDepth } from 'three';
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

  it('works out the normal in the fragment shader, from the change of the position from one pixel to the next', () => {
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
});
