import { MeshBasicMaterial } from 'three';
import type { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { TRIANGLES_PER_PART, createTriangleParts } from './triangle-parts.js';

/** `count` triangles on a strip of `count + 2` vertices. */
const strip = (count: number) => ({
  positions: Float32Array.from({ length: (count + 2) * 3 }, (_, i) => i),
  triangles: Uint32Array.from({ length: count * 3 }, (_, i) => Math.floor(i / 3) + (i % 3)),
});

const meshes = (parts: ReturnType<typeof createTriangleParts>): Mesh[] =>
  parts.group.children as Mesh[];

describe('createTriangleParts', () => {
  it('puts few triangles in one part and has nothing to step', () => {
    const parts = createTriangleParts(strip(5), new MeshBasicMaterial());
    expect(meshes(parts)).toHaveLength(1);
    expect(parts.step).toBeUndefined();
    expect(meshes(parts)[0]?.geometry.index?.count).toBe(15);
  });

  it('has no part for no triangles', () => {
    const parts = createTriangleParts(strip(0), new MeshBasicMaterial());
    expect(meshes(parts)).toHaveLength(0);
    expect(parts.step).toBeUndefined();
  });

  it('takes the triangles in parts of 250,000, the first at once, and the last part is what is left', () => {
    expect(TRIANGLES_PER_PART).toBe(250_000);
    const parts = createTriangleParts(strip(2 * TRIANGLES_PER_PART + 4), new MeshBasicMaterial());
    expect(meshes(parts)).toHaveLength(1);
    expect(parts.step?.()).toBe(true);
    expect(parts.step?.()).toBe(false);
    expect(meshes(parts).map((part) => part.geometry.index?.count)).toEqual([
      TRIANGLES_PER_PART * 3,
      TRIANGLES_PER_PART * 3,
      12,
    ]);
    // Nothing more to put on the card once it is all there.
    expect(parts.step?.()).toBe(false);
    expect(meshes(parts)).toHaveLength(3);
  });

  it('is exactly one part, with nothing to step, for exactly 250,000 triangles', () => {
    const parts = createTriangleParts(strip(TRIANGLES_PER_PART), new MeshBasicMaterial());
    expect(meshes(parts)).toHaveLength(1);
    expect(parts.step).toBeUndefined();
  });

  it('gives the card the positions once for all parts, and a view of the indices of each part, not a copy', () => {
    const buffers = strip(TRIANGLES_PER_PART + 1);
    const parts = createTriangleParts(buffers, new MeshBasicMaterial());
    parts.step?.();
    const [first, second] = meshes(parts);
    expect(first?.geometry.getAttribute('position')).toBe(
      second?.geometry.getAttribute('position'),
    );
    const indices = second?.geometry.index?.array;
    expect(indices?.buffer).toBe(buffers.triangles.buffer);
    expect(indices?.byteOffset).toBe(TRIANGLES_PER_PART * 3 * 4);
    expect(indices?.length).toBe(3);
  });

  it('draws every part with the one material it is given, and does not free that material', () => {
    const material = new MeshBasicMaterial();
    const parts = createTriangleParts(strip(TRIANGLES_PER_PART + 1), material);
    parts.step?.();
    expect(meshes(parts).map((part) => part.material)).toEqual([material, material]);
    // Not culled: that would work out a bounding sphere of every part, a pass over all its positions, for a frame that draws the layer whole.
    expect(meshes(parts).map((part) => part.frustumCulled)).toEqual([false, false]);
    const freed: string[] = [];
    material.addEventListener('dispose', () => freed.push('material'));
    for (const [i, part] of meshes(parts).entries()) {
      part.geometry.addEventListener('dispose', () => freed.push(`geometry ${String(i)}`));
    }
    parts.dispose();
    expect(freed.sort()).toEqual(['geometry 0', 'geometry 1']);
    expect(meshes(parts)).toHaveLength(0);
  });
});
