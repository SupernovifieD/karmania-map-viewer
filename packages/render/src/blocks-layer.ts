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
 *
 * **A dense model** (one block for each cell of the lattice, which the buffers say by `dims`) is drawn by its exposed faces only: a face between two
 * blocks that are drawn is inside the model and shows from no side, and a model of a million blocks has a hundred times more of them than it has on its
 * outside. When the classes are given, the blocks that are drawn and have a neighbour in each direction that is drawn too are left out of the
 * instances, and the others have a mask of the faces that show (a face is not drawn if the block beside it in that direction is drawn). That is
 * worked out a part at a time between frames, as the parts are built, so that no task holds the page. A sparse model, whose blocks are in any order,
 * is drawn with all its faces, as before.
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
import { MAX_CLASSES, NO_VALUE, colourOf } from './look.js';
import type { ClassColouring, FrameInfo, LayerLook } from './look.js';
import { sinCos } from './rotation.js';

/** The blocks are put on the card this many at a time (1.2 MB of centres, 100 KB of classes), the first part at once (the size of a part of points, for the same reason). */
export const BLOCKS_PER_PART = 100_000;

/** A dense model has the instances of its parts made this many blocks at a time, one piece in each frame (2 to 6 ms of work, cold or warm). */
export const BLOCKS_PER_STEP = 25_000;

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
// Of a dense model: the faces of the block that show, one bit each in the order of the box's faces (+x, -x, +y, -y, +z, -z).
attribute float aExposed;
uniform vec3 uSize;
uniform vec2 uTurn;
uniform float uMasked;
varying float vClass;
varying vec3 vNormal;

void main() {
  if (uMasked > 0.5) {
    // The face this corner is of, from its normal (the box's normals are along its axes), and whether its bit is set; a face that is not
    // shown is put outside the clip volume, all three corners of each of its triangles together, so the card does not draw it.
    float face = normal.x > 0.5 ? 0.0 : normal.x < -0.5 ? 1.0 : normal.y > 0.5 ? 2.0 : normal.y < -0.5 ? 3.0 : normal.z > 0.5 ? 4.0 : 5.0;
    if (mod(floor(aExposed / exp2(face)), 2.0) < 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
  }
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
  'centres' | 'spacing' | 'rotation' | 'dims'
>;

/**
 * A part of the blocks on the card. `ready` is whether its instances are of the classes that the layer has now (always, for a sparse model). The
 * geometry of a part of a dense model is made again when its instances are (their number changes with the classes), and the old one is freed.
 */
interface Part {
  geometry: InstancedBufferGeometry;
  readonly first: number;
  readonly count: number;
  readonly depth: Mesh;
  readonly mesh: Mesh;
  ready: boolean;
}

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
    uMasked: { value: buffers.dims === undefined ? 0 : 1 },
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
  const parts: Part[] = [];
  /** The blocks along each axis of a dense model, whose instances are made from the classes; `undefined` for a sparse one. */
  const dims = buffers.dims;
  /** The parts whose instances are to be made again for the classes that the layer has now (a dense model). */
  const waiting: Part[] = [];
  let built = 0;
  let shown = look.visible;
  let classes: Uint8Array | undefined;
  let flat = true;
  let translucent = false;

  function drawRange(geometry: InstancedBufferGeometry): void {
    geometry.setDrawRange(flat ? top.start : 0, flat ? top.count : Infinity);
  }

  /** What each pass of a part draws: the colour once its instances are ready, and the depth too when the layer is less than opaque. */
  function visibility(part: Part): void {
    part.mesh.visible = part.ready;
    part.depth.visible = part.ready && translucent;
  }

  function classesOf(part: Part): void {
    if (dims !== undefined) {
      // Its instances are made again for the classes, between frames (`step`); what was being made for other classes is let go.
      part.ready = false;
      visibility(part);
      if (working?.part === part) {
        working = undefined;
      }
      if (!waiting.includes(part)) {
        waiting.push(part);
      }
      return;
    }
    if (classes === undefined) {
      // The attribute is left where it is (the shader reads it only for a colour that a class has, and `show` draws nothing without classes).
      return;
    }
    // Made once, with an array of its own (it is written to, and the classes are the caller's); the next classes are put into it and sent to the card
    // again, so that no buffer of the card is left behind by an attribute that was replaced (three frees a buffer only when the geometry that
    // holds its attribute is disposed).
    const view = classes.subarray(part.first, part.first + part.count);
    const held = part.geometry.getAttribute('aClass') as InstancedBufferAttribute | undefined;
    if (held !== undefined) {
      (held.array as Uint8Array).set(view);
      held.needsUpdate = true;
      return;
    }
    part.geometry.setAttribute('aClass', new InstancedBufferAttribute(view.slice(), 1));
  }

  /** The instances of a part that are being made, a few blocks of it at a time (`BLOCKS_PER_STEP`): the part, where it has got to, and what it has made. */
  interface Work {
    readonly part: Part;
    n: number;
    i: number;
    j: number;
    k: number;
    at: number;
    readonly centres: Float32Array;
    readonly kinds: Uint8Array;
    readonly masks: Uint8Array;
  }
  let working: Work | undefined;

  function begin(part: Part, shape: readonly [number, number, number]): Work {
    const [nx, ny] = shape;
    return {
      part,
      n: part.first,
      i: nx > 0 ? part.first % nx : 0,
      j: nx > 0 && ny > 0 ? Math.floor(part.first / nx) % ny : 0,
      k: nx > 0 && ny > 0 ? Math.floor(part.first / (nx * ny)) : 0,
      at: 0,
      centres: new Float32Array(part.count * 3),
      kinds: new Uint8Array(part.count),
      masks: new Uint8Array(part.count),
    };
  }

  /**
   * Looks at the next `budget` blocks of a part of a dense model: the blocks that are drawn (their class has a colour) and have a face that shows are
   * made instances, with their centres, classes and the mask of the faces that show. Block `n` is the cell `(n % nx, (n / nx) % ny, n / (nx * ny))`,
   * and its neighbours are the blocks `n ± 1`, `n ± nx` and `n ± nx * ny`, where the cell is in the lattice. `true` when the part is done.
   */
  function advance(work: Work, shape: readonly [number, number, number], budget: number): boolean {
    const [nx, ny, nz] = shape;
    const layer = nx * ny;
    const colours = uniforms.uCount.value;
    const held = classes;
    const end = Math.min(work.part.first + work.part.count, work.n + budget);
    if (held !== undefined && layer > 0) {
      let { i, j, k, at } = work;
      for (let n = work.n; n < end; n += 1) {
        const own = held[n] ?? NO_VALUE;
        if (own < colours) {
          // A face shows if there is no block beside it, or the block that is there is not drawn (no value, or a class with no colour).
          let mask = 0;
          if (i + 1 >= nx || (held[n + 1] ?? NO_VALUE) >= colours) mask |= 1;
          if (i === 0 || (held[n - 1] ?? NO_VALUE) >= colours) mask |= 2;
          if (j + 1 >= ny || (held[n + nx] ?? NO_VALUE) >= colours) mask |= 4;
          if (j === 0 || (held[n - nx] ?? NO_VALUE) >= colours) mask |= 8;
          if (k + 1 >= nz || (held[n + layer] ?? NO_VALUE) >= colours) mask |= 16;
          if (k === 0 || (held[n - layer] ?? NO_VALUE) >= colours) mask |= 32;
          if (mask !== 0) {
            const from = n * 3;
            work.centres[at * 3] = buffers.centres[from] ?? NaN;
            work.centres[at * 3 + 1] = buffers.centres[from + 1] ?? NaN;
            work.centres[at * 3 + 2] = buffers.centres[from + 2] ?? NaN;
            work.kinds[at] = own;
            work.masks[at] = mask;
            at += 1;
          }
        }
        i += 1;
        if (i === nx) {
          i = 0;
          j += 1;
          if (j === ny) {
            j = 0;
            k += 1;
          }
        }
      }
      Object.assign(work, { i, j, k, at });
    }
    work.n = end;
    if (work.n < work.part.first + work.part.count) {
      return false;
    }
    const { part, at } = work;
    // The instances are a different number each time, so they are put in a geometry of their own, which takes the place of the part's, and the old one is
    // freed (with its instance buffers: the box's attributes, which every part uses, are taken out of it first, and stay).
    const next = new InstancedBufferGeometry();
    next.setIndex(box.getIndex());
    next.setAttribute('position', box.getAttribute('position'));
    next.setAttribute('normal', box.getAttribute('normal'));
    next.setAttribute('aCentre', new InstancedBufferAttribute(work.centres.subarray(0, at * 3), 3));
    next.setAttribute('aClass', new InstancedBufferAttribute(work.kinds.subarray(0, at), 1));
    next.setAttribute('aExposed', new InstancedBufferAttribute(work.masks.subarray(0, at), 1));
    next.instanceCount = at;
    drawRange(next);
    const old = part.geometry;
    part.geometry = next;
    part.mesh.geometry = next;
    part.depth.geometry = next;
    old.deleteAttribute('position');
    old.deleteAttribute('normal');
    old.setIndex(null);
    old.dispose();
    part.ready = true;
    visibility(part);
    return true;
  }

  /**
   * Puts the next part of the blocks on the card. `true` if there are more to come. For a dense model a part has no instances until its classes
   * come: `instancesOf` makes them, one part each time `step` is called.
   */
  function addPart(): boolean {
    if (built >= total) {
      return false;
    }
    const count = Math.min(BLOCKS_PER_PART, total - built);
    const geometry = new InstancedBufferGeometry();
    geometry.setIndex(box.getIndex());
    geometry.setAttribute('position', box.getAttribute('position'));
    geometry.setAttribute('normal', box.getAttribute('normal'));
    if (dims === undefined) {
      geometry.setAttribute(
        'aCentre',
        new InstancedBufferAttribute(buffers.centres.subarray(built * 3, (built + count) * 3), 3),
      );
      geometry.instanceCount = count;
    } else {
      geometry.instanceCount = 0;
    }
    const depth = new Mesh(geometry, depthMaterial);
    depth.frustumCulled = false;
    depth.visible = translucent && dims === undefined;
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = dims === undefined;
    const part: Part = { geometry, first: built, count, depth, mesh, ready: dims === undefined };
    parts.push(part);
    drawRange(geometry);
    classesOf(part);
    group.add(depth, mesh);
    built += count;
    return built < total;
  }

  /**
   * The next piece of work between two frames: the next part to put on the card, and the next few blocks of the part that is having its instances
   * made (`BLOCKS_PER_STEP` of them, so that the work of a frame is the same however big the model is, and the first of it, which runs cold, is
   * not a task that holds the page).
   */
  function step(): boolean {
    const more = addPart();
    if (working === undefined && dims !== undefined) {
      const next = waiting.shift();
      if (next !== undefined) {
        working = begin(next, dims);
      }
    }
    if (working !== undefined && dims !== undefined && advance(working, dims, BLOCKS_PER_STEP)) {
      working = undefined;
    }
    return more || working !== undefined || waiting.length > 0;
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
        visibility(part);
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
        const colours = uniforms.uCount.value;
        uniforms.uCount.value = count;
        // (A dense model's instances depend on which classes have a colour, so for it another number of colours is not only another palette.)
        if (same && (dims === undefined || count === colours)) {
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
  // A dense model always has work to come: its instances are made when its classes are given.
  return more || dims !== undefined ? { ...layer, step } : layer;
}
