/**
 * The fill of a layer of polygons (section 9.3 of the brief): the triangles the engine made of them (holes are kept: they were
 * triangulated round), in the colour of the layer at its opacity. The triangles are put on the card in parts (`createTriangleParts`).
 * It writes no depth: the polygons of a layer that overlap
 * show through each other, and the outline of the layer is drawn over the fill without depth fighting it.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import { DoubleSide, LessDepth, NormalBlending, ShaderMaterial, Vector3 } from 'three';
import type { LayerObject } from './layer-set.js';
import { colourOf } from './look.js';
import { createTriangleParts } from './triangle-parts.js';

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
  const triangles = createTriangleParts(buffers, material);

  const layer: LayerObject = {
    object: triangles.group,
    setLook(next) {
      const [r, g, b] = colourOf(next.colour);
      uniforms.uColour.value.set(r, g, b);
      uniforms.uOpacity.value = next.opacity;
      triangles.group.visible = next.visible;
    },
    // The fill is the same at every pixel ratio and on every theme.
    prepareFrame() {
      // (nothing: it has no size in pixels and no outline of its own)
    },
    dispose() {
      triangles.dispose();
      material.dispose();
    },
  };
  layer.setLook(look);
  return triangles.step === undefined ? layer : { ...layer, step: triangles.step };
}
