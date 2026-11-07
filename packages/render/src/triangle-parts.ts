/**
 * The triangles of a layer on the card (the fill of polygons, a mesh): the positions go to the card once and the triangles in parts
 * of 250,000, the first at once, each part a view of the indices and a mesh of its own, all with the one material the layer gives. The size of a
 * part is a number of triangles and never a time, so that the same data is built the same way on every machine.
 */
import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three';
import type { Material } from 'three';

/** The triangles are put on the card this many at a time (3 MB of indices), the first part at once. */
export const TRIANGLES_PER_PART = 250_000;

/** The triangles of a layer: the positions, and the triangles as indices into them. */
export interface TriangleBuffers {
  readonly positions: Float32Array;
  readonly triangles: Uint32Array;
}

/** The triangles that are on the card, and what is left to put there. */
export interface TriangleParts {
  readonly group: Group;
  /** Puts the next part on the card and says whether any is left; there is none when everything was put on at once. */
  readonly step: (() => boolean) | undefined;
  /** Frees the geometries (the material is the layer's, and it frees that). */
  dispose(): void;
}

/** The triangles of `buffers` in parts, drawn with `material`. */
export function createTriangleParts(buffers: TriangleBuffers, material: Material): TriangleParts {
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const total = Math.floor(buffers.triangles.length / 3);
  // The positions are one attribute that every part uses, so the card has them once.
  const positions = new BufferAttribute(buffers.positions, 3);
  let built = 0;

  /** Puts the next part of the triangles on the card. `true` if there are more to come. */
  function addPart(): boolean {
    if (built >= total) {
      return false;
    }
    const end = built + TRIANGLES_PER_PART;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', positions);
    geometry.setIndex(new BufferAttribute(buffers.triangles.subarray(built * 3, end * 3), 1));
    geometries.push(geometry);
    const part = new Mesh(geometry, material);
    part.frustumCulled = false;
    group.add(part);
    built = end;
    return built < total;
  }

  const more = addPart();
  return {
    group,
    step: more ? addPart : undefined,
    dispose() {
      group.clear();
      for (const geometry of geometries) {
        geometry.dispose();
      }
    },
  };
}
