/**
 * The layer of a block model (section 9.3 of the brief): one box for each block, of the model's spacing and turned by its rotation about
 * its own centre, each in the colour of its class, lit by the frame's light (from above in the view from above, so the tops are all of their colour; the
 * light of the world in 3D, where the sides show). The boxes are instanced: one box on the card, and for each block only its centre (and its
 * class), in parts of 100,000, the first at once and the others between frames. In the view from above only the tops show, so only the
 * tops are drawn (a sixth of the triangles); the nearest top wins, so where blocks are over each other the highest shows: also when the layer
 * is less than opaque, when a first pass writes only depth and the colour is then drawn once, where the nearest top is, and not once for each
 * block that is under another.
 *
 * The buffers do not have the values of the blocks: they come as the classes of the blocks (`setClasses`), one byte for each block in the
 * order of the centres. Until a model has them, or if what it is given is not one byte for each block, it draws nothing.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import {
  BoxGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LessDepth,
  EqualDepth,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { LayerObject } from './layer-set.js';
import { AMBIENT } from './light.js';
import { MAX_CLASSES, colourOf } from './look.js';
import type { ClassColouring, FrameInfo, LayerLook } from './look.js';
import { sinCos } from './rotation.js';

/** The blocks are put on the card this many at a time (1.2 MB of centres, 100 KB of classes), the first part at once (the size of a part of points, for the same reason). */
export const BLOCKS_PER_PART = 100_000;

/** The index of the top face (+z) among the six that `BoxGeometry` makes, in the order +x, -x, +y, -y, +z, -z. */
const TOP_FACE = 4;

/**
 * The box's own normals are along its axes, which making a box of the block's size leaves along them, so a face's normal is only turned about z with
 * the block, and then taken into the space of the camera by the matrix of normals (which also takes the layer's heights in 3D, scaled about the origin, into
 * account). Each face has corners of its own, so the normal is the same over the face: it is shaded flat.
 */
const VERTEX = /* glsl */ `
// The depth pass and the colour pass of a layer that is less than opaque are two programs of this one shader, and the colour is drawn only where its
// depth is the depth that the first wrote: so the position has to come out the same bit for bit in both.
invariant gl_Position;
attribute vec3 aCentre;
attribute float aClass;
uniform vec3 uSize;
uniform vec2 uTurn;
varying float vClass;
varying vec3 vNormal;

void main() {
  // The corner of a box of a size of 1, from -0.5 to 0.5, made the size of a block and turned about its centre (uTurn is sin and cos).
  vec3 corner = position * uSize;
  vec3 turned = vec3(
    uTurn.y * corner.x - uTurn.x * corner.y,
    uTurn.x * corner.x + uTurn.y * corner.y,
    corner.z
  );
  vec3 facing = vec3(
    uTurn.y * normal.x - uTurn.x * normal.y,
    uTurn.x * normal.x + uTurn.y * normal.y,
    normal.z
  );
  vClass = aClass;
  vNormal = normalize(normalMatrix * facing);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(aCentre + turned, 1.0);
}
`;

/**
 * The class of a block is a byte per instance, looked up in a palette; one with no colour (255 is no value) is not drawn. The colour is lit by the
 * frame's light: a face that faces it has all of its colour and one that faces away has `uAmbient` of it. (`vNormal` is of length 1 over the face, but
 * it is made so again here, as it comes from the corners.) In the view from above only the tops are drawn and the light is straight up, so they are
 * all of their colour.
 */
const FRAGMENT = /* glsl */ `
uniform vec3 uPalette[${String(MAX_CLASSES)}];
uniform float uCount;
uniform float uOpacity;
uniform vec3 uLight;
uniform float uAmbient;
varying float vClass;
varying vec3 vNormal;

void main() {
  float block = floor(vClass + 0.5);
  if (block >= uCount) {
    discard;
  }
  float lit = max(dot(normalize(vNormal), uLight), 0.0);
  float shade = uAmbient + (1.0 - uAmbient) * lit;
  gl_FragColor = vec4(uPalette[int(block)] * shade, uOpacity);
}
`;

/** The depth pass: the same blocks are discarded, and nothing is drawn (the colour is not written), so that only what has a colour hides. */
const DEPTH_FRAGMENT = /* glsl */ `
uniform float uCount;
varying float vClass;

void main() {
  if (floor(vClass + 0.5) >= uCount) {
    discard;
  }
  gl_FragColor = vec4(0.0);
}
`;

type BlockBuffers = Pick<
  Extract<RenderBuffers, { kind: 'blocks' }>,
  'centres' | 'spacing' | 'rotation'
>;

/** The layer of the blocks of `buffers`, looking as `look` says. */
export function createBlocksLayer(buffers: BlockBuffers, look: LayerLook): LayerObject {
  const total = Math.floor(buffers.centres.length / 3);
  const [sin, cos] = sinCos(buffers.rotation);
  const palette = Array.from({ length: MAX_CLASSES }, () => new Vector3());
  const uniforms = {
    uSize: { value: new Vector3(...buffers.spacing) },
    uTurn: { value: new Vector2(sin, cos) },
    uPalette: { value: palette },
    uCount: { value: 0 },
    uOpacity: { value: 1 },
    uLight: { value: new Vector3(0, 0, 1) },
    uAmbient: { value: AMBIENT },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    blending: NormalBlending,
    // Within a layer depth decides, so that the highest top shows (section 9.4); how it is written and compared is the look's to say
    // (`setLook`: one pass when the layer is opaque, the colour after a depth pass when it is not).
    depthTest: true,
    side: DoubleSide,
  });
  // A layer that is less than opaque is drawn in two passes: depth alone, and then the colour only where the depth is exactly what the first wrote
  // (`EqualDepth`, which both programs of the shader have to agree on, so the position is `invariant`), so that what is nearest is blended once, and
  // a face that is behind it, at a seam between blocks too, is not. (An opaque layer is one pass.)
  const depthMaterial = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: DEPTH_FRAGMENT,
    colorWrite: false,
    depthTest: true,
    depthFunc: LessDepth,
    depthWrite: true,
    side: DoubleSide,
  });
  // One box, with its triangles and corners, that every part uses: the blocks are the instances.
  const box = new BoxGeometry(1, 1, 1);
  const top = box.groups[TOP_FACE] ?? { start: 0, count: box.getIndex()?.count ?? 0 };
  const group = new Group();
  const parts: { geometry: InstancedBufferGeometry; first: number; count: number; depth: Mesh }[] =
    [];
  let built = 0;
  let shown = look.visible;
  let classes: Uint8Array | undefined;
  let flat = true;
  let translucent = false;

  function drawRange(geometry: InstancedBufferGeometry): void {
    geometry.setDrawRange(flat ? top.start : 0, flat ? top.count : Infinity);
  }

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
      new InstancedBufferAttribute(classes.subarray(part.first, part.first + part.count), 1),
    );
  }

  /** Puts the next part of the blocks on the card. `true` if there are more to come. */
  function addPart(): boolean {
    if (built >= total) {
      return false;
    }
    const count = Math.min(BLOCKS_PER_PART, total - built);
    const geometry = new InstancedBufferGeometry();
    geometry.setIndex(box.getIndex());
    geometry.setAttribute('position', box.getAttribute('position'));
    geometry.setAttribute('normal', box.getAttribute('normal'));
    geometry.setAttribute(
      'aCentre',
      new InstancedBufferAttribute(buffers.centres.subarray(built * 3, (built + count) * 3), 3),
    );
    geometry.instanceCount = count;
    const depth = new Mesh(geometry, depthMaterial);
    depth.frustumCulled = false;
    depth.visible = translucent;
    const part = { geometry, first: built, count, depth };
    parts.push(part);
    drawRange(geometry);
    classesOf(part);
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    group.add(depth, mesh);
    built += count;
    return built < total;
  }

  function show(): void {
    group.visible = shown && classes !== undefined;
  }

  const layer: LayerObject = {
    object: group,
    setLook(next) {
      uniforms.uOpacity.value = next.opacity;
      translucent = next.opacity < 1;
      // Less than opaque: the depth pass has the nearest top and the colour is drawn where it is (it writes no depth); opaque: one pass.
      material.depthFunc = translucent ? EqualDepth : LessDepth;
      material.depthWrite = !translucent;
      for (const part of parts) {
        part.depth.visible = translucent;
      }
      shown = next.visible;
      show();
    },
    // In the view from above (flat) only the tops are seen, and only they are drawn; seen from another way, all the faces are.
    prepareFrame(info: FrameInfo) {
      uniforms.uLight.value.set(...info.light);
      flat = info.flat;
      for (const part of parts) {
        drawRange(part.geometry);
      }
    },
    setClasses(next: ClassColouring | undefined) {
      if (next !== undefined && next.indices.length === total) {
        const same = next.indices === classes;
        classes = next.indices;
        const count = Math.min(next.colours.length, MAX_CLASSES);
        next.colours.slice(0, count).forEach((hex, k) => {
          const [r, g, b] = colourOf(hex);
          palette[k]?.set(r, g, b);
        });
        uniforms.uCount.value = count;
        if (same) {
          // The same classes of the blocks with other colours (another ramp): the attributes are what they were and only the palette changes.
          show();
          return;
        }
      } else {
        classes = undefined;
        uniforms.uCount.value = 0;
      }
      for (const part of parts) {
        classesOf(part);
      }
      show();
    },
    dispose() {
      group.clear();
      for (const part of parts) {
        part.geometry.dispose();
      }
      box.dispose();
      material.dispose();
      depthMaterial.dispose();
    },
  };
  layer.setLook(look);
  const more = addPart();
  return more ? { ...layer, step: addPart } : layer;
}
