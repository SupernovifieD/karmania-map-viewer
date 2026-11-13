/**
 * Layers that lie in one plane (section 9.4 of the brief). In 3D all layers share one depth test, so where two of them are at the same depth, as the
 * layers of data that has no heights are (everything at z = 0), the depth buffer has no way to say which is on top: what was drawn first wins, or, as the
 * triangles of the two are not the same triangles, the winner changes from pixel to pixel as rounding goes one way or the other. The legend's order
 * breaks the tie: the layer that is `rank` from the bottom of the legend is moved `rank` steps towards the camera, a step that is far less than
 * anything that can be seen (a few millionths of the depth range) and more than the rounding it has to beat, so a layer that is higher in
 * the legend is on top of one that is in its plane, and a layer that is not in its plane is where it is.
 *
 * Triangles are moved by the card's polygon offset. A marker or a line writes the depth of its plane itself (`plane-depth.ts`), as that is what puts
 * it in the plane of the layers under it, and its material says so by having a `uTieBreak` uniform, the rank, which its shader moves the depth it writes by,
 * by the same step and part of the slope.
 */
import type { Material, Object3D } from 'three';

/** How far each rank moves a triangle: this many units of the depth buffer (its smallest step, whatever its depth), and this much of its slope. */
export const TIE_UNITS = 64;
export const TIE_SLOPE = 1;

/** The same step as a depth, for what writes its own (`plane-depth.ts`): the depth buffer has 2 to the 24 steps from 0 to 1. */
export const TIE_DEPTH = TIE_UNITS * 2 ** -24;

/** What a material had before it was moved, which is what rank 0 gives back (the depth pass of a block is already offset). */
interface Base {
  readonly enabled: boolean;
  readonly factor: number;
  readonly units: number;
}

const bases = new WeakMap<Material, Base>();

function movedMaterials(object: Object3D): Material[] {
  const material = (object as { material?: Material | Material[] }).material;
  return material === undefined ? [] : Array.isArray(material) ? material : [material];
}

function move(material: Material, rank: number): void {
  const marker = (material as { uniforms?: Record<string, { value: unknown } | undefined> })
    .uniforms?.['uTieBreak'];
  if (marker !== undefined) {
    marker.value = rank;
    return;
  }
  let base = bases.get(material);
  if (base === undefined) {
    base = {
      enabled: material.polygonOffset,
      factor: material.polygonOffsetFactor,
      units: material.polygonOffsetUnits,
    };
    bases.set(material, base);
  }
  material.polygonOffset = base.enabled || rank > 0;
  // Towards the camera is negative.
  material.polygonOffsetFactor = base.factor - rank * TIE_SLOPE;
  material.polygonOffsetUnits = base.units - rank * TIE_UNITS;
}

/**
 * Puts everything in `root` where a layer that is `rank` from the bottom of the legend goes: rank 0 is where it was made. It looks at every object, as
 * a layer may have made more since the last frame (the triangles of a class, a part of a big layer), and writes only what is different.
 */
export function tieBreak(root: Object3D, rank: number): void {
  root.traverse((object) => {
    for (const material of movedMaterials(object)) {
      move(material, rank);
    }
  });
}
