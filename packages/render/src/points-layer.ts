/**
 * The layer of points (section 9.3 of the brief): round markers of a fixed size in pixels, with an outline of 1 pixel so that they read
 * whatever colour they are on whatever map. One colour for the layer, or the colour of the class of each point when it is given its classes
 * (`setClasses`: a byte for each point, looked up in a palette; a point with no value, or whose class has no colour, is not drawn). Each marker is one vertex that the card makes into a square
 * of the size of the marker, and the shader draws the disc in it, with an edge a pixel wide that is smoothed, so that the same marker
 * is the same size on every screen (the size is in CSS pixels times the device pixel ratio). A layer of a million points
 * is put on the card a part at a time, so that no frame has to take all of it: a part is a number of points and never a time.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LessDepth,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { LayerObject } from './layer-set.js';
import { MAX_CLASSES, colourOf } from './look.js';
import { PLANE_DEPTH_GLSL } from './plane-depth.js';
import type { ClassColouring, FrameInfo, LayerLook } from './look.js';

/**
 * The points are put on the card this many at a time (1.2 MB of positions), the first part at once. The first frame that draws a part took 33 to 45 ms
 * with 250,000 to a part (the card's own work, part of it in proportion to the size and part not), and about 20 ms with 50,000: the size is what keeps
 * that frame, and so a task, under the 50 ms of section 9.6.
 */
export const POINTS_PER_PART = 100_000;
/** The outline of a marker is this wide, in CSS pixels, and is inside the size of the marker. */
export const OUTLINE_WIDTH = 1;

/** The vertex shader; for 3D it also says where the centre of the marker is in the space of the camera, for the plane it lies in. */
const vertex = (plane: boolean): string => /* glsl */ `
uniform float uDiameter;
attribute float aClass;
varying float vClass;
${plane ? 'varying vec3 vCentre;' : ''}

void main() {
  vClass = aClass;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${plane ? 'vCentre = (modelViewMatrix * vec4(position, 1.0)).xyz;' : ''}
  // A pixel more than the marker, so that the smoothed edge is not cut off by the square.
  gl_PointSize = uDiameter + 1.0;
}
`;

/**
 * The fragment shader: the disc and its outline. For 3D it also writes the depth of the level plane through the marker's centre at each pixel
 * of it (`plane-depth.ts`), where the one depth of the point would be behind the plane of the layers under it over half of the marker.
 */
const fragment = (plane: boolean): string => /* glsl */ `
uniform float uDiameter;
uniform float uOutlineWidth;
uniform vec3 uFill;
uniform vec3 uOutline;
uniform float uOpacity;
uniform vec3 uPalette[${String(MAX_CLASSES)}];
uniform float uCount;
uniform float uClassed;
varying float vClass;
${plane ? 'varying vec3 vCentre;' : ''}
${plane ? PLANE_DEPTH_GLSL : ''}

void main() {
  ${plane ? 'vec2 plane = planeDepth(vCentre, levelUp());' : ''}
  float reach = uDiameter * 0.5;
  float away = length(gl_PointCoord - vec2(0.5)) * (uDiameter + 1.0);
  // How much of the pixel is inside the disc, and inside the fill that the outline leaves.
  float inside = clamp(reach - away + 0.5, 0.0, 1.0);
  if (inside <= 0.0) {
    discard;
  }
  vec3 colour = uFill;
  if (uClassed > 0.5) {
    // By class: one with no colour (255 is no value) is not drawn.
    float point = floor(vClass + 0.5);
    if (point >= uCount) {
      discard;
    }
    colour = uPalette[int(point)];
  }
  float fill = clamp(reach - uOutlineWidth - away + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(uOutline, colour, fill), inside * uOpacity);
  ${plane ? 'gl_FragDepth = tiedDepth(plane);' : ''}
}
`;

type PointsBuffers = Extract<RenderBuffers, { kind: 'points' }>;

/** The layer of `buffers`, looking as `look` says. */
export function createPointsLayer(buffers: PointsBuffers, look: LayerLook): LayerObject {
  const uniforms = {
    uDiameter: { value: 0 },
    uTieBreak: { value: 0 },
    uViewport: { value: new Vector2(1, 1) },
    uOutlineWidth: { value: OUTLINE_WIDTH },
    uFill: { value: new Vector3() },
    uOutline: { value: new Vector3() },
    uOpacity: { value: 1 },
    uPalette: { value: Array.from({ length: MAX_CLASSES }, () => new Vector3()) },
    uCount: { value: 0 },
    uClassed: { value: 0 },
  };
  /** The material for a view; the one for 3D writes the depth of the plane the markers lie in. The two share their uniforms. */
  const materialFor = (plane: boolean): ShaderMaterial =>
    new ShaderMaterial({
      uniforms,
      vertexShader: vertex(plane),
      fragmentShader: fragment(plane),
      // Smoothed edges and a layer's opacity are alpha; within the layer the nearer marker (the higher one) is the one that is seen.
      transparent: true,
      blending: NormalBlending,
      depthTest: true,
      // Strictly nearer (three's own is nearer or as near): a fragment at the depth of one that is there does not overdraw it.
      depthFunc: LessDepth,
      depthWrite: true,
    });
  const material = materialFor(false);
  // (Made when first wanted: a layer that is only seen from above does not have it.)
  let material3d: ShaderMaterial | undefined;
  let current = material;
  const group = new Group();
  const geometries: { geometry: BufferGeometry; first: number; count: number }[] = [];
  const total = Math.floor(buffers.positions.length / 3);
  /** The classes of the points that the markers are coloured by, if they are. */
  let classes: Uint8Array | undefined;
  let built = 0;
  let size = look.pointSize;
  let ratio = 1;

  /**
   * Gives a part the classes of its points. The attribute is made once, with an array of its own (a copy: it is written to, and the classes
   * are the caller's), and the next classes are put into it and sent to the card again, so that no buffer of the card is left behind by an
   * attribute that was replaced (three frees a buffer only when the geometry that holds its attribute is disposed). With no classes the attribute
   * is left as it is: the shader does not read it then (`uClassed`).
   */
  function classesOf(part: { geometry: BufferGeometry; first: number; count: number }): void {
    if (classes === undefined) {
      return;
    }
    const view = classes.subarray(part.first, part.first + part.count);
    const held = part.geometry.getAttribute('aClass') as BufferAttribute | undefined;
    if (held !== undefined) {
      (held.array as Uint8Array).set(view);
      held.needsUpdate = true;
      return;
    }
    part.geometry.setAttribute('aClass', new BufferAttribute(view.slice(), 1));
  }

  /** Puts the next part of the points on the card. `true` if there are more to come. */
  function addPart(): boolean {
    if (built >= total) {
      return false;
    }
    // (The last part is shorter.)
    const end = Math.min(built + POINTS_PER_PART, total);
    const geometry = new BufferGeometry();
    // A view of the part: the card is given those bytes and no others, and the whole array stays here for a context that is lost.
    geometry.setAttribute(
      'position',
      new BufferAttribute(buffers.positions.subarray(built * 3, end * 3), 3),
    );
    const entry = { geometry, first: built, count: end - built };
    geometries.push(entry);
    classesOf(entry);
    const part = new Points(geometry, current);
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
      uniforms.uViewport.value.set(info.viewport[0], info.viewport[1]);
      // The view from above and the view in 3D draw a marker's depth differently, so each has its own material.
      if (info.flat) {
        current = material;
      } else {
        material3d ??= materialFor(true);
        current = material3d;
      }
      for (const part of group.children) {
        (part as Points).material = current;
      }
      ratio = info.pixelRatio;
      uniforms.uDiameter.value = size * ratio;
      uniforms.uOutlineWidth.value = OUTLINE_WIDTH * ratio;
      uniforms.uOutline.value.set(...info.outline);
    },
    setClasses(next: ClassColouring | undefined) {
      if (next !== undefined && next.indices.length === total) {
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
        // Not coloured by classes: the markers are the colour of the layer, whatever the classes were.
        classes = undefined;
        uniforms.uClassed.value = 0;
        uniforms.uCount.value = 0;
      }
      for (const part of geometries) {
        classesOf(part);
      }
    },
    dispose() {
      group.clear();
      for (const { geometry } of geometries) {
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
