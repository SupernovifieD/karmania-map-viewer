/**
 * The layer of lines (section 9.3 of the brief): a width in screen pixels, one colour for the layer, or the colour of the class of each line when
 * it is given its classes (`setClasses`: a class for each line, which each of its segments takes; a line with no value, or whose class has no
 * colour, is not drawn). Each segment is one instance of
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
import { classesOfPieces, coversOwners } from './class-map.js';
import { MAX_CLASSES, colourOf } from './look.js';
import { PLANE_DEPTH_GLSL, RIBBON_GLSL } from './plane-depth.js';
import type { ClassColouring, FrameInfo, LayerLook } from './look.js';

/** The segments are put on the card this many at a time (2.4 MB of ends), the first part at once. */
export const SEGMENTS_PER_PART = 100_000;

/** The vertex shader; for 3D it also says where the ends of the segment are in the space of the camera, for the plane it lies in. */
const vertex = (plane: boolean): string => /* glsl */ `
attribute vec2 corner;
attribute vec3 aStart;
attribute vec3 aEnd;
attribute float aClass;
uniform vec2 uViewport;
uniform float uWidth;
uniform float uDepthScale;
varying vec2 vStart;
varying vec2 vEnd;
varying float vClass;
${plane ? 'varying vec3 vStartV;\nvarying vec3 vEndV;' : ''}

void main() {
  vClass = aClass;
  ${plane ? 'vStartV = (modelViewMatrix * vec4(aStart, 1.0)).xyz;\n  vEndV = (modelViewMatrix * vec4(aEnd, 1.0)).xyz;' : ''}
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

/**
 * The fragment shader: the segment at the distance of each pixel from it. For 3D it also writes the depth of the plane the segment lies in at each
 * pixel of it (`plane-depth.ts`), where the depth of its ends would put it behind the plane of the layers under it over half of its width.
 */
const fragment = (plane: boolean): string => /* glsl */ `
uniform float uWidth;
uniform vec3 uColour;
uniform float uOpacity;
uniform vec3 uPalette[${String(MAX_CLASSES)}];
uniform float uCount;
uniform float uClassed;
varying vec2 vStart;
varying vec2 vEnd;
varying float vClass;
${plane ? 'varying vec3 vStartV;\nvarying vec3 vEndV;' : ''}
${plane ? PLANE_DEPTH_GLSL + RIBBON_GLSL : ''}

void main() {
  ${plane ? 'vec2 plane = planeDepth(vStartV, ribbonNormal(vStartV, vEndV));' : ''}
  vec2 along = vEnd - vStart;
  float length2 = dot(along, along);
  float t = length2 > 0.0 ? clamp(dot(gl_FragCoord.xy - vStart, along) / length2, 0.0, 1.0) : 0.0;
  float away = length(gl_FragCoord.xy - (vStart + along * t));
  float inside = clamp(uWidth * 0.5 - away + 0.5, 0.0, 1.0);
  if (inside <= 0.0) {
    discard;
  }
  vec3 colour = uColour;
  if (uClassed > 0.5) {
    // By class: a line with no colour for its class (255 is no value) is not drawn.
    float line = floor(vClass + 0.5);
    if (line >= uCount) {
      discard;
    }
    colour = uPalette[int(line)];
  }
  gl_FragColor = vec4(colour, inside * uOpacity);
  ${plane ? 'gl_FragDepth = tiedDepth(plane);' : ''}
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
    uTieBreak: { value: 0 },
    uColour: { value: new Vector3() },
    uOpacity: { value: 1 },
    uPalette: { value: Array.from({ length: MAX_CLASSES }, () => new Vector3()) },
    uCount: { value: 0 },
    uClassed: { value: 0 },
  };
  /** The material for a view; the one for 3D writes the depth of the plane the segments lie in. The two share their uniforms. */
  const materialFor = (plane: boolean): ShaderMaterial =>
    new ShaderMaterial({
      uniforms,
      vertexShader: vertex(plane),
      fragmentShader: fragment(plane),
      transparent: true,
      blending: NormalBlending,
      depthTest: true,
      // Strictly nearer (three's own is nearer or as near): a fragment at the depth of one that is there does not overdraw it.
      depthFunc: LessDepth,
      depthWrite: true,
      // The quad of a segment faces whichever way the segment goes on the screen: it is never a back.
      side: DoubleSide,
    });
  const material = materialFor(false);
  // (Made when first wanted: a layer that is only seen from above does not have it.)
  let material3d: ShaderMaterial | undefined;
  let current = material;
  const group = new Group();
  const parts: { geometry: InstancedBufferGeometry; first: number; count: number }[] = [];
  const total = Math.floor(buffers.segments.length / 2);
  /** The classes of the lines that the segments are coloured by, if they are. */
  let classes: Uint8Array | undefined;
  let built = 0;
  let width = look.lineWidth;
  let ratio = 1;

  /** Gives a part the class of each of its segments (that of its line), or takes the classes away. */
  function classesOf(part: {
    geometry: InstancedBufferGeometry;
    first: number;
    count: number;
  }): void {
    if (classes === undefined) {
      part.geometry.deleteAttribute('aClass');
      return;
    }
    part.geometry.setAttribute(
      'aClass',
      new InstancedBufferAttribute(
        classesOfPieces(classes, buffers.segmentLine, part.first, part.count),
        1,
      ),
    );
  }

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
    const entry = { geometry, first: built, count: end - built };
    parts.push(entry);
    classesOf(entry);
    const part = new Mesh(geometry, current);
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
      // The view from above and the view in 3D draw a segment's depth differently, so each has its own material.
      if (info.flat) {
        current = material;
      } else {
        material3d ??= materialFor(true);
        current = material3d;
      }
      for (const part of group.children) {
        (part as Mesh).material = current;
      }
    },
    setClasses(next: ClassColouring | undefined) {
      if (next !== undefined && coversOwners(next.indices, buffers.segmentLine)) {
        const same = next.indices === classes;
        classes = next.indices;
        const count = Math.min(next.colours.length, MAX_CLASSES);
        next.colours.slice(0, count).forEach((hex, k) => {
          const [r, g, b] = colourOf(hex);
          uniforms.uPalette.value[k]?.set(r, g, b);
        });
        uniforms.uCount.value = count;
        uniforms.uClassed.value = 1;
        if (same) {
          // The same classes with other colours (another ramp): the attributes are what they were and only the palette changes.
          return;
        }
      } else {
        // Not coloured by classes: the segments are the colour of the layer, whatever the classes were.
        classes = undefined;
        uniforms.uClassed.value = 0;
        uniforms.uCount.value = 0;
      }
      for (const part of parts) {
        classesOf(part);
      }
    },
    dispose() {
      group.clear();
      for (const { geometry } of parts) {
        geometry.dispose();
      }
      material.dispose();
      material3d?.dispose();
    },
  };
  layer.setLook(look);
  if (addPart()) {
    return { ...layer, step: addPart };
  }
  return layer;
}
