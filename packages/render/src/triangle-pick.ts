/**
 * Picking the triangles of a layer (the fill of polygons, a mesh, a surface; `pick.ts`). The triangles of a layer share their vertices, and what a
 * triangle is of (its polygon, its cell, itself) is not a thing of a vertex, so for picking each triangle is given three vertices of its own that say
 * what it is of: made when the first pick wants them, in the order the layer draws the triangles (the order of the indices, or for a layer by class the
 * order of the classes, without the triangles that no colour is given to, which are not drawn), and made again only when that order changes. The
 * pick triangles are drawn in place of the layer's own, with the layer's own depth rules.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh } from 'three';
import type { Object3D, ShaderMaterial } from 'three';
import { PICK_FRAGMENT_GLSL, pickMaterial } from './pick.js';
import { TRIANGLES_PER_PART } from './triangle-parts.js';

const VERTEX = /* glsl */ `
attribute float aElement;
flat varying float vElement;

void main() {
  vElement = aElement;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
flat varying float vElement;
${PICK_FRAGMENT_GLSL}

void main() {
  gl_FragColor = pickColour(vElement);
}
`;

/** What the triangles of a layer are, for picking. */
export interface TrianglePickOptions {
  readonly positions: Float32Array;
  readonly triangles: Uint32Array;
  /** What each triangle is of (the polygon of a triangle, the cell of a triangle of a surface); without it a triangle is of itself. */
  readonly owners?: Uint32Array;
  /** The object the layer's triangles are children of: the pick triangles are put in it, and shown in place of the others. */
  readonly parent: Object3D;
  /** Whether the layer's triangles write depth (a mesh does, the fill of polygons does not): the pick triangles do as the layer's do. */
  readonly depthWrite: boolean;
}

export interface TrianglePicker {
  /**
   * Shows the pick triangles of the layer in place of its own and says how to put them back. `drawn` is the triangles that a layer by class draws, in the
   * order it draws them, with a `version` that changes when it does (the pick triangles are made again then); `undefined` for a layer that is not by class,
   * which draws the first `onTheCard` triangles in the order of the indices (the others are not on the card yet, if the layer is still being built).
   */
  show(
    drawn: { readonly order: Uint32Array; readonly version: number } | undefined,
    onTheCard: number,
  ): () => void;
  /** Frees the pick triangles and the material. */
  dispose(): void;
}

/** The pick triangles of `options`, with `layerNumber` the uniform that says which layer they are written as. */
export function createTrianglePicker(
  options: TrianglePickOptions,
  layerNumber: { value: number },
): TrianglePicker {
  const { positions, triangles, owners, parent } = options;
  const total = Math.floor(triangles.length / 3);
  let material: ShaderMaterial | undefined;
  const group = new Group();
  group.visible = false;
  let added = false;
  const geometries: BufferGeometry[] = [];
  let made: { readonly order: Uint32Array | undefined; readonly version: number } | undefined;

  function clear(): void {
    group.clear();
    for (const geometry of geometries) {
      geometry.dispose();
    }
    geometries.length = 0;
    made = undefined;
  }

  /** Makes the pick triangles of `order` (or all), a part of `TRIANGLES_PER_PART` at a time, each triangle with three vertices of its own. */
  function build(order: Uint32Array | undefined, version: number): void {
    const count = order === undefined ? Math.min(total, version) : order.length;
    // A layer that is not by class and is still being built grows: the parts that are made are kept (they hold the triangles before `made.version`, whatever their
    // size), and only the triangles after it are made. (Made again whole in each frame of the building, a layer of a million triangles would copy them ten times
    // over, and each time more.)
    const grown =
      order === undefined &&
      made !== undefined &&
      made.order === undefined &&
      made.version > 0 &&
      made.version < version;
    const first = grown && made !== undefined ? made.version : 0;
    if (!grown) {
      clear();
    }
    material ??= pickMaterial({
      uniforms: { uPickLayer: layerNumber },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: DoubleSide,
    });
    material.depthWrite = options.depthWrite;
    for (let from = first; from < count; from += TRIANGLES_PER_PART) {
      const size = Math.min(TRIANGLES_PER_PART, count - from);
      const places = new Float32Array(size * 9);
      const elements = new Float32Array(size * 3);
      for (let i = 0; i < size; i += 1) {
        const triangle = order === undefined ? from + i : (order[from + i] ?? 0);
        const element = owners === undefined ? triangle : (owners[triangle] ?? 0);
        for (let corner = 0; corner < 3; corner += 1) {
          const vertex = triangles[triangle * 3 + corner] ?? 0;
          // (A vertex that is not there is NaN, which draws nothing, as the layer's own do.)
          const at = vertex * 3 + 2 < positions.length ? vertex * 3 : -1;
          for (let axis = 0; axis < 3; axis += 1) {
            places[(i * 3 + corner) * 3 + axis] = at < 0 ? NaN : (positions[at + axis] ?? NaN);
          }
          elements[i * 3 + corner] = element;
        }
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(places, 3));
      geometry.setAttribute('aElement', new BufferAttribute(elements, 1));
      geometries.push(geometry);
      const part = new Mesh(geometry, material);
      part.frustumCulled = false;
      group.add(part);
    }
    made = { order, version };
  }

  return {
    show(drawn, onTheCard) {
      if (!added) {
        parent.add(group);
        added = true;
      }
      const order = drawn?.order;
      // (A layer that is not by class is made again as it is built: the number on the card is its version.)
      const version = drawn === undefined ? onTheCard : drawn.version;
      if (made === undefined || made.order !== order || made.version !== version) {
        build(order, version);
      }
      // The layer's own triangles are not drawn while the others are.
      const was = parent.children.map((child) => [child, child.visible] as const);
      for (const [child] of was) {
        child.visible = child === group;
      }
      return () => {
        for (const [child, visible] of was) {
          child.visible = visible;
        }
        group.visible = false;
      };
    },
    dispose() {
      clear();
      parent.remove(group);
      material?.dispose();
    },
  };
}
