/**
 * The layer of points (section 9.3 of the brief): round markers of a fixed size in pixels, with an outline of 1 pixel so that they read
 * whatever colour they are on whatever map. One colour for the layer. Each marker is one vertex that the card makes into a square
 * of the size of the marker, and the shader draws the disc in it, with an edge a pixel wide that is smoothed, so that the same marker
 * is the same size on every screen (the size is in CSS pixels times the device pixel ratio). A layer of a million points
 * is put on the card a part at a time, so that no frame has to take all of it: a part is a number of points and never a time.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { LayerObject } from './layer-set.js';
import { colourOf } from './look.js';
import type { FrameInfo, LayerLook } from './look.js';

/** The points are put on the card this many at a time (3 MB of positions), the first part at once. */
export const POINTS_PER_PART = 250_000;
/** The outline of a marker is this wide, in CSS pixels, and is inside the size of the marker. */
export const OUTLINE_WIDTH = 1;

const VERTEX = /* glsl */ `
uniform float uDiameter;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // A pixel more than the marker, so that the smoothed edge is not cut off by the square.
  gl_PointSize = uDiameter + 1.0;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uDiameter;
uniform float uOutlineWidth;
uniform vec3 uFill;
uniform vec3 uOutline;
uniform float uOpacity;

void main() {
  float reach = uDiameter * 0.5;
  float away = length(gl_PointCoord - vec2(0.5)) * (uDiameter + 1.0);
  // How much of the pixel is inside the disc, and inside the fill that the outline leaves.
  float inside = clamp(reach - away + 0.5, 0.0, 1.0);
  if (inside <= 0.0) {
    discard;
  }
  float fill = clamp(reach - uOutlineWidth - away + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(uOutline, uFill, fill), inside * uOpacity);
}
`;

type PointsBuffers = Extract<RenderBuffers, { kind: 'points' }>;

/** The layer of `buffers`, looking as `look` says. */
export function createPointsLayer(buffers: PointsBuffers, look: LayerLook): LayerObject {
  const uniforms = {
    uDiameter: { value: 0 },
    uOutlineWidth: { value: OUTLINE_WIDTH },
    uFill: { value: new Vector3() },
    uOutline: { value: new Vector3() },
    uOpacity: { value: 1 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // Smoothed edges and a layer's opacity are alpha; within the layer the nearer marker (the higher one) is the one that is seen.
    transparent: true,
    blending: NormalBlending,
    depthTest: true,
    depthWrite: true,
  });
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const total = Math.floor(buffers.positions.length / 3);
  let built = 0;
  let size = look.pointSize;
  let ratio = 1;

  /** Puts the next part of the points on the card. `true` if there are more to come. */
  function addPart(): boolean {
    if (built >= total) {
      return false;
    }
    // (The last part is shorter: a view stops at the end of the array.)
    const end = built + POINTS_PER_PART;
    const geometry = new BufferGeometry();
    // A view of the part: the card is given those bytes and no others, and the whole array stays here for a context that is lost.
    geometry.setAttribute(
      'position',
      new BufferAttribute(buffers.positions.subarray(built * 3, end * 3), 3),
    );
    geometries.push(geometry);
    const part = new Points(geometry, material);
    // The camera is looked through, not around: nothing is culled by a box that was never worked out.
    part.frustumCulled = false;
    group.add(part);
    built = end;
    return built < total;
  }

  const layer: LayerObject = {
    object: group,
    setLook(next) {
      const [r, g, b] = colourOf(next.colour);
      uniforms.uFill.value.set(r, g, b);
      uniforms.uOpacity.value = next.opacity;
      size = next.pointSize;
      uniforms.uDiameter.value = size * ratio;
      group.visible = next.visible;
    },
    prepareFrame(info: FrameInfo) {
      ratio = info.pixelRatio;
      uniforms.uDiameter.value = size * ratio;
      uniforms.uOutlineWidth.value = OUTLINE_WIDTH * ratio;
      uniforms.uOutline.value.set(...info.outline);
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
