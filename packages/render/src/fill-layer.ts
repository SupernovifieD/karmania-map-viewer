/**
 * The fill of a layer of polygons (section 9.3 of the brief): the triangles the engine made of them (holes are kept: they were
 * triangulated round), in the colour of the layer at its opacity. The positions go to the card once and the triangles in parts
 * of 250,000, the first at once, as the points are, each part a view of the indices. It writes no depth: the polygons of a layer that overlap
 * show through each other, and the outline of the layer is drawn over the fill without depth fighting it.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LessDepth,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { LayerObject } from './layer-set.js';
import { colourOf } from './look.js';

/** The triangles are put on the card this many at a time (3 MB of indices), the first part at once. */
export const TRIANGLES_PER_PART = 250_000;

const VERTEX = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColour;
uniform float uOpacity;

void main() {
  gl_FragColor = vec4(uColour, uOpacity);
}
`;

type FillBuffers = Pick<Extract<RenderBuffers, { kind: 'polygons' }>, 'positions' | 'triangles'>;

/** The fill of the triangles of `buffers`, looking as `look` says. */
export function createFillLayer(
  buffers: FillBuffers,
  look: Parameters<LayerObject['setLook']>[0],
): LayerObject {
  const uniforms = { uColour: { value: new Vector3() }, uOpacity: { value: 1 } };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    blending: NormalBlending,
    depthTest: true,
    depthFunc: LessDepth,
    depthWrite: false,
    // A triangle is seen from above whichever way the engine wound it.
    side: DoubleSide,
  });
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

  const layer: LayerObject = {
    object: group,
    setLook(next) {
      const [r, g, b] = colourOf(next.colour);
      uniforms.uColour.value.set(r, g, b);
      uniforms.uOpacity.value = next.opacity;
      group.visible = next.visible;
    },
    // The fill is the same at every pixel ratio and on every theme.
    prepareFrame() {
      // (nothing: it has no size in pixels and no outline of its own)
    },
    dispose() {
      group.clear();
      for (const geometry of geometries) {
        geometry.dispose();
      }
      material.dispose();
    },
  };
  layer.setLook(look);
  if (addPart()) {
    return { ...layer, step: addPart };
  }
  return layer;
}
