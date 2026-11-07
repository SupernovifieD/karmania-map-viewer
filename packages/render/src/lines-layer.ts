/**
 * The layer of lines (section 9.3 of the brief): a width in screen pixels, one colour for the layer. Each segment is one instance of
 * a quad that the shader makes as big as the segment and a half width more all round; the fragment shader draws the segment with
 * round ends at the distance of each pixel from it, smoothed over a pixel. The ends being round, a vertex between two segments is
 * joined as a circle, and in the flat view the segments of a layer are all at one depth, so the depth test (strictly nearer) lets the first
 * of them draw a pixel that two cover and not the second: a half opaque line is not darker at a joint, whatever the heights of its
 * segments are (which, of one colour, could not show).
 * There is no outline: the brief gives lines none. A layer of a million segments is put on the card in parts, as points are.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LessDepth,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { LayerObject } from './layer-set.js';
import { colourOf } from './look.js';
import type { FrameInfo, LayerLook } from './look.js';

/** The segments are put on the card this many at a time (2.4 MB of ends), the first part at once. */
export const SEGMENTS_PER_PART = 100_000;

const VERTEX = /* glsl */ `
attribute vec2 corner;
attribute vec3 aStart;
attribute vec3 aEnd;
uniform vec2 uViewport;
uniform float uWidth;
uniform float uDepthScale;
varying vec2 vStart;
varying vec2 vEnd;

void main() {
  vec4 a = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
  // The ends in pixels of the buffer.
  vec2 pa = (a.xy / a.w * 0.5 + 0.5) * uViewport;
  vec2 pb = (b.xy / b.w * 0.5 + 0.5) * uViewport;
  vec2 along = pb - pa;
  float length_ = length(along);
  vec2 dir = length_ > 0.0 ? along / length_ : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  // The box of the segment with round ends: half a width, and a pixel for the smoothed edge, beyond it on every side.
  float reach = uWidth * 0.5 + 1.0;
  vec2 pixel = (corner.x < 0.0 ? pa - dir * reach : pb + dir * reach) + normal * corner.y * reach;
  vec4 clip = corner.x < 0.0 ? a : b;
  vStart = pa;
  vEnd = pb;
  // In the flat view every part of the layer is at one depth, so a pixel that two segments cover is drawn by the first of them only.
  gl_Position = vec4((pixel / uViewport * 2.0 - 1.0) * clip.w, clip.z * uDepthScale, clip.w);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uWidth;
uniform vec3 uColour;
uniform float uOpacity;
varying vec2 vStart;
varying vec2 vEnd;

void main() {
  vec2 along = vEnd - vStart;
  float length2 = dot(along, along);
  float t = length2 > 0.0 ? clamp(dot(gl_FragCoord.xy - vStart, along) / length2, 0.0, 1.0) : 0.0;
  float away = length(gl_FragCoord.xy - (vStart + along * t));
  float inside = clamp(uWidth * 0.5 - away + 0.5, 0.0, 1.0);
  if (inside <= 0.0) {
    discard;
  }
  gl_FragColor = vec4(uColour, inside * uOpacity);
}
`;

type LinesBuffers = Extract<RenderBuffers, { kind: 'lines' }>;

/**
 * The two ends of segments `from` up to `to` as positions, three numbers each: what the instances of a part are made of. A segment
 * that names a vertex that is not there (the engine does not make one) is NaN at both ends, which draws nothing.
 */
export function gatherSegments(
  positions: Float32Array,
  segments: Uint32Array,
  from: number,
  to: number,
): { starts: Float32Array; ends: Float32Array } {
  const count = Math.max(0, to - from);
  const starts = new Float32Array(count * 3);
  const ends = new Float32Array(count * 3);
  const vertices = Math.floor(positions.length / 3);
  for (let i = 0; i < count; i += 1) {
    const a = segments[(from + i) * 2];
    const b = segments[(from + i) * 2 + 1];
    if (a === undefined || b === undefined || a >= vertices || b >= vertices) {
      starts.fill(NaN, i * 3, i * 3 + 3);
      ends.fill(NaN, i * 3, i * 3 + 3);
      continue;
    }
    starts.set(positions.subarray(a * 3, a * 3 + 3), i * 3);
    ends.set(positions.subarray(b * 3, b * 3 + 3), i * 3);
  }
  return { starts, ends };
}

/** The layer of `buffers`, looking as `look` says. */
export function createLinesLayer(buffers: LinesBuffers, look: LayerLook): LayerObject {
  const uniforms = {
    uViewport: { value: new Vector2(1, 1) },
    uWidth: { value: 0 },
    uDepthScale: { value: 0 },
    uColour: { value: new Vector3() },
    uOpacity: { value: 1 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    blending: NormalBlending,
    depthTest: true,
    // Strictly nearer (three's own is nearer or as near): a fragment at the depth of one that is there does not overdraw it.
    depthFunc: LessDepth,
    depthWrite: true,
    // The quad of a segment faces whichever way the segment goes on the screen: it is never a back.
    side: DoubleSide,
  });
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const total = Math.floor(buffers.segments.length / 2);
  let built = 0;
  let width = look.lineWidth;
  let ratio = 1;

  /** Puts the next part of the segments on the card. `true` if there are more to come. */
  function addPart(): boolean {
    if (built >= total) {
      return false;
    }
    const end = Math.min(total, built + SEGMENTS_PER_PART);
    const { starts, ends } = gatherSegments(buffers.positions, buffers.segments, built, end);
    const geometry = new InstancedBufferGeometry();
    // A quad: x is which end of the segment (-1 the start, 1 the end), y which side.
    geometry.setIndex(new BufferAttribute(Uint16Array.of(0, 1, 2, 2, 1, 3), 1));
    geometry.setAttribute(
      'corner',
      new BufferAttribute(Float32Array.of(-1, -1, -1, 1, 1, -1, 1, 1), 2),
    );
    // (three wants a position to count the vertices of a geometry that is not indexed; this one is, and it is not used.)
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    geometry.setAttribute('aStart', new InstancedBufferAttribute(starts, 3));
    geometry.setAttribute('aEnd', new InstancedBufferAttribute(ends, 3));
    geometry.instanceCount = end - built;
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
      width = next.lineWidth;
      uniforms.uWidth.value = width * ratio;
      group.visible = next.visible;
    },
    prepareFrame(info: FrameInfo) {
      ratio = info.pixelRatio;
      uniforms.uWidth.value = width * ratio;
      uniforms.uViewport.value.set(info.viewport[0], info.viewport[1]);
      uniforms.uDepthScale.value = info.flat ? 0 : 1;
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
