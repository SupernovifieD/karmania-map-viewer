/**
 * The layer of a mesh (section 9.3 of the brief): its triangles in the one colour of the layer, or, given their classes (`setClasses`: one for
 * each triangle), each in the colour of its class, lit from above. Each triangle is
 * shaded flat, with a normal that the fragment shader works out from how the position changes from one pixel to the next
 * (`dFdx`, `dFdy`), so that the vertices are not made again for each triangle and are shared as the engine sent them. The light
 * comes from straight above: a triangle that lies flat has the colour of the layer as it is, and one that slopes is darker the
 * steeper it is, which shows the slope as a hillshade does.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import { DoubleSide, LessDepth, NormalBlending, ShaderMaterial, Vector3 } from 'three';
import { createClassedTriangles } from './class-triangles.js';
import type { LayerObject } from './layer-set.js';
import { colourOf } from './look.js';
import type { ClassColouring } from './look.js';
import { createTriangleParts } from './triangle-parts.js';

/**
 * How much of the colour a triangle that faces away from the light keeps: the rest is the light, which is all of it for a triangle
 * that faces it. A steep slope is dark and not black, so that its shape is seen in the layer's own colour.
 */
export const MESH_AMBIENT = 0.25;

const VERTEX = /* glsl */ `
varying vec3 vView;

void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vView = view.xyz;
  gl_Position = projectionMatrix * view;
}
`;

/**
 * The normal of the triangle is the cross product of how the position changes along a row of pixels and down a column of them, in
 * the space of the camera. It faces the viewer whichever way the triangle is wound, so a triangle is lit the same from either side.
 * `uLight` is the direction to the light in that space: in the view from above, straight up is +z, and turning the map does not
 * change it.
 */
const FRAGMENT = /* glsl */ `
uniform vec3 uColour;
uniform float uOpacity;
uniform vec3 uLight;
uniform float uAmbient;
varying vec3 vView;

void main() {
  vec3 normal = normalize(cross(dFdx(vView), dFdy(vView)));
  float lit = max(dot(normal, uLight), 0.0);
  float shade = uAmbient + (1.0 - uAmbient) * lit;
  gl_FragColor = vec4(uColour * shade, uOpacity);
}
`;

type MeshBuffers = Pick<Extract<RenderBuffers, { kind: 'mesh' }>, 'positions' | 'triangles'>;

type MeshUniforms = {
  uColour: { value: Vector3 };
  uOpacity: { value: number };
  uLight: { value: Vector3 };
  uAmbient: { value: number };
};

/** A material that lights triangles flat from `uniforms.uLight` and colours them `uniforms.uColour`. */
function meshMaterial(uniforms: MeshUniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    blending: NormalBlending,
    // Within a layer depth decides, so that the highest part shows (section 9.4).
    depthTest: true,
    depthFunc: LessDepth,
    depthWrite: true,
    side: DoubleSide,
  });
}

/** The layer of the triangles of `buffers`, looking as `look` says. */
export function createMeshLayer(
  buffers: MeshBuffers,
  look: Parameters<LayerObject['setLook']>[0],
): LayerObject {
  const uniforms = {
    uColour: { value: new Vector3() },
    uOpacity: { value: 1 },
    uLight: { value: new Vector3(0, 0, 1) },
    uAmbient: { value: MESH_AMBIENT },
  };
  const material = meshMaterial(uniforms);
  const triangles = createTriangleParts(buffers, material);
  // By class, each triangle is drawn in the colour of its class, still lit: a mesh for each class, sharing the light and the opacity.
  const classed = createClassedTriangles({
    positions: triangles.positions,
    triangles: buffers.triangles,
    parent: triangles.group,
    make: () => {
      const colour = new Vector3();
      return {
        material: meshMaterial({ ...uniforms, uColour: { value: colour } }),
        colour,
      };
    },
  });

  const layer: LayerObject = {
    object: triangles.group,
    setLook(next) {
      const [r, g, b] = colourOf(next.colour);
      uniforms.uColour.value.set(r, g, b);
      uniforms.uOpacity.value = next.opacity;
      triangles.group.visible = next.visible;
    },
    // The light is the same at every pixel ratio and on every theme.
    prepareFrame() {
      // (nothing: it has no size in pixels and no outline)
    },
    setClasses(next: ClassColouring | undefined) {
      // The triangles by class are drawn in place of the layer's own, which are not drawn while they are (and are, when they are not).
      material.visible = !classed.set(next);
    },
    dispose() {
      classed.dispose();
      triangles.dispose();
      material.dispose();
    },
  };
  layer.setLook(look);
  return triangles.step === undefined ? layer : { ...layer, step: triangles.step };
}
