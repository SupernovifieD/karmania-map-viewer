/**
 * The triangles of a layer that is coloured by classes (the fill of polygons, a mesh): one mesh for each class, each with the triangles of
 * that class as its indices and the colour of the class, and all of them with the one set of positions that the layer has. A triangle has no
 * colour of its own on the card, and an indexed vertex is shared by triangles of different classes, so the triangles are sorted by class (a
 * counting sort of the indices, which is all that is made again when the classes change) and each class is drawn with its colour. A triangle with
 * no value, or whose class has no colour, is in no mesh and so is not drawn.
 */
import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import type { Object3D, ShaderMaterial, Vector3 } from 'three';
import { classesOfPieces, coversOwners } from './class-map.js';
import { MAX_CLASSES, colourOf } from './look.js';
import type { ClassColouring } from './look.js';

/** What a layer gives to have its triangles drawn by class. */
export interface ClassedTrianglesOptions {
  /** The positions of the layer, which every mesh of a class uses. */
  readonly positions: BufferAttribute;
  readonly triangles: Uint32Array;
  /** The element each triangle belongs to (the polygon of a triangle), if the classes are not of the triangles themselves. */
  readonly owners?: Uint32Array;
  /** What the meshes are added to. */
  readonly parent: Object3D;
  /** A material for a class, and the colour in it that the class sets. */
  readonly make: () => { readonly material: ShaderMaterial; readonly colour: Vector3 };
}

export interface ClassedTriangles {
  /**
   * Draws the triangles by the classes given, in place of any it had, or draws none by class for `undefined`. `true` if they are drawn by
   * class: classes that are not one for each element are not used, and then none is.
   */
  set(classes: ClassColouring | undefined): boolean;
  /** Frees the meshes' geometries and materials. */
  dispose(): void;
}

interface Entry {
  readonly kind: number;
  readonly mesh: Mesh;
  readonly colour: Vector3;
}

export function createClassedTriangles(options: ClassedTrianglesOptions): ClassedTriangles {
  const { positions, triangles, owners, parent, make } = options;
  const total = Math.floor(triangles.length / 3);
  const entries: Entry[] = [];
  /** The classes that the meshes are made from. */
  let held: Uint8Array | undefined;

  /** The colours of the classes: a class with a colour is drawn in it, and one without is not drawn. */
  function paint(colours: readonly string[]): void {
    for (const entry of entries) {
      const hex = colours[entry.kind];
      if (hex !== undefined) {
        const [r, g, b] = colourOf(hex);
        entry.colour.set(r, g, b);
      }
      entry.mesh.visible = hex !== undefined;
    }
  }

  function clear(): void {
    for (const { mesh } of entries) {
      parent.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
    }
    entries.length = 0;
    held = undefined;
  }

  return {
    set(next) {
      if (next !== undefined && next.indices === held) {
        // The same classes with other colours (another ramp): the meshes are what they were and only the colours change.
        paint(next.colours);
        return true;
      }
      clear();
      if (next === undefined) {
        return false;
      }
      const covered =
        owners === undefined ? next.indices.length === total : coversOwners(next.indices, owners);
      if (!covered) {
        return false;
      }
      const kinds =
        owners === undefined ? next.indices : classesOfPieces(next.indices, owners, 0, total);
      // A counting sort of the triangles by class: how many of each, where each class starts, and the triangles put in their places.
      const counts = new Uint32Array(MAX_CLASSES);
      for (let t = 0; t < total; t += 1) {
        const kind = kinds[t] ?? MAX_CLASSES;
        if (kind < MAX_CLASSES) {
          counts[kind] = (counts[kind] ?? 0) + 1;
        }
      }
      const starts = new Uint32Array(MAX_CLASSES);
      let kept = 0;
      for (let k = 0; k < MAX_CLASSES; k += 1) {
        starts[k] = kept;
        kept += counts[k] ?? 0;
      }
      const sorted = new Uint32Array(kept * 3);
      const cursor = starts.slice();
      for (let t = 0; t < total; t += 1) {
        const kind = kinds[t] ?? MAX_CLASSES;
        if (kind < MAX_CLASSES) {
          const place = (cursor[kind] ?? 0) * 3;
          cursor[kind] = (cursor[kind] ?? 0) + 1;
          sorted[place] = triangles[t * 3] ?? 0;
          sorted[place + 1] = triangles[t * 3 + 1] ?? 0;
          sorted[place + 2] = triangles[t * 3 + 2] ?? 0;
        }
      }
      for (let kind = 0; kind < MAX_CLASSES; kind += 1) {
        const count = counts[kind] ?? 0;
        if (count === 0) {
          continue;
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', positions);
        const from = (starts[kind] ?? 0) * 3;
        geometry.setIndex(new BufferAttribute(sorted.subarray(from, from + count * 3), 1));
        const { material, colour } = make();
        const mesh = new Mesh(geometry, material);
        mesh.frustumCulled = false;
        parent.add(mesh);
        entries.push({ kind, mesh, colour });
      }
      held = next.indices;
      paint(next.colours);
      return true;
    },
    dispose() {
      clear();
    },
  };
}
