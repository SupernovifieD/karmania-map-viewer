/**
 * The layer of a grid (section 9.3 of the brief): an image of its cells, each cell the colour of its class, sampled NEAREST and never
 * linearly, so that every cell shows its own class and nothing between cells. A cell with no value is not drawn (the map shows through
 * it). The image goes where the engine's placement says, rotated as it says, in one texture for each of its tiles (the engine cuts the
 * grid so that no tile is larger than the card's largest texture).
 *
 * The buffers do not have the cells' values: they come as the classes of the cells (`setClasses`), one byte for each cell in lattice
 * order, `i` fastest, which are cut up by the tiles here. Until a grid has them, or if what it is given is not one byte for each cell, it
 * draws nothing.
 */
import type { RenderBuffers } from '@karmania/engine/display';
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  Group,
  LessDepth,
  Mesh,
  NearestFilter,
  NormalBlending,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
} from 'three';
import type { LayerObject } from './layer-set.js';
import { MAX_CLASSES, colourOf } from './look.js';
import type { ClassColouring, LayerLook } from './look.js';
import { sinCos } from './rotation.js';

const VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * The class of a cell is a byte in a texture that is read at the middle of its cell. A class that the layer has no colour for (and
 * 255, which is no value) is not drawn.
 */
const FRAGMENT = /* glsl */ `
uniform sampler2D uCells;
uniform vec3 uPalette[${String(MAX_CLASSES)}];
uniform float uCount;
uniform float uOpacity;
varying vec2 vUv;

void main() {
  float cell = floor(texture2D(uCells, vUv).r * 255.0 + 0.5);
  if (cell >= uCount) {
    discard;
  }
  gl_FragColor = vec4(uPalette[int(cell)], uOpacity);
}
`;

type GridBuffers = Extract<RenderBuffers, { kind: 'grid' }>;
type Tile = GridBuffers['tiles'][number];

/**
 * The four corners of a tile (from the first cell's lower corner, anticlockwise), `x y z` each: the cells' own axes from the origin,
 * turned about it. Two tiles that meet have the same corner worked out from the same two numbers, so they are the same bits, and there is
 * no gap or double covering between them.
 */
function corners(buffers: Extract<GridBuffers, { placement: object }>, tile: Tile): Float32Array {
  const { origin, spacing, rotation } = buffers.placement;
  const [sin, cos] = sinCos(rotation);
  const out = new Float32Array(12);
  [
    [tile.i0, tile.j0],
    [tile.i0 + tile.nx, tile.j0],
    [tile.i0 + tile.nx, tile.j0 + tile.ny],
    [tile.i0, tile.j0 + tile.ny],
  ].forEach(([i = 0, j = 0], corner) => {
    const along = i * spacing[0];
    const up = j * spacing[1];
    out[corner * 3] = origin[0] + cos * along - sin * up;
    out[corner * 3 + 1] = origin[1] + sin * along + cos * up;
    out[corner * 3 + 2] = origin[2];
  });
  return out;
}

/** The classes of the cells of `tile`, cut out of the classes of all of them (`columns` cells to a row, `i` fastest). */
function cut(indices: Uint8Array, columns: number, tile: Tile): Uint8Array {
  if (tile.nx === columns) {
    // A tile as wide as the grid (it starts at its first column) is whole rows one after another: a view, not a copy.
    return indices.subarray(tile.j0 * columns, (tile.j0 + tile.ny) * columns);
  }
  const out = new Uint8Array(tile.nx * tile.ny);
  for (let row = 0; row < tile.ny; row += 1) {
    const from = (tile.j0 + row) * columns + tile.i0;
    out.set(indices.subarray(from, from + tile.nx), row * tile.nx);
  }
  return out;
}

/** A quad for each tile, placed where the placement says, with the texture of the tile across it. */
function placedGeometries(
  buffers: Extract<GridBuffers, { placement: object }>,
): { tile: Tile; geometry: BufferGeometry }[] {
  return buffers.tiles.map((tile) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(corners(buffers, tile), 3));
    geometry.setAttribute('uv', new BufferAttribute(Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1), 2));
    geometry.setIndex(new BufferAttribute(Uint32Array.of(0, 1, 2, 0, 2, 3), 1));
    return { tile, geometry };
  });
}

/**
 * The mesh of each tile of a grid in another coordinate system: the positions and the `uv`s are one attribute each that every tile uses (the
 * vertex numbers run on from tile to tile), and the triangles of a tile are the next `tileTriangles[t]` of the list, a view of it. The
 * triangles that would have used a vertex that could not be placed are not in it, so no position that is NaN is ever drawn.
 */
function warpedGeometries(
  buffers: Extract<GridBuffers, { warp: object }>,
): { tile: Tile; geometry: BufferGeometry }[] {
  const { warp } = buffers;
  const positions = new BufferAttribute(warp.positions, 3);
  const uvs = new BufferAttribute(warp.uvs, 2);
  let first = 0;
  return buffers.tiles.map((tile, t) => {
    const end = first + (warp.tileTriangles[t] ?? 0) * 3;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', positions);
    geometry.setAttribute('uv', uvs);
    geometry.setIndex(new BufferAttribute(warp.triangles.subarray(first, end), 1));
    first = end;
    return { tile, geometry };
  });
}

/** The layer of the grid of `buffers`, looking as `look` says. */
export function createGridLayer(buffers: GridBuffers, look: LayerLook): LayerObject {
  const group = new Group();
  const palette = Array.from({ length: MAX_CLASSES }, () => new Vector3());
  const laidOut =
    buffers.placement === undefined ? warpedGeometries(buffers) : placedGeometries(buffers);
  const tiles = laidOut.map(({ tile, geometry }) => {
    const uniforms = {
      uCells: { value: null as DataTexture | null },
      uPalette: { value: palette },
      uCount: { value: 0 },
      uOpacity: { value: 1 },
    };
    const material = new ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      blending: NormalBlending,
      depthTest: true,
      depthFunc: LessDepth,
      depthWrite: true,
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    return {
      tile,
      uniforms,
      geometry,
      material,
      mesh,
      texture: undefined as DataTexture | undefined,
    };
  });
  const [columns, rows] = buffers.size;
  let shown = look.visible;
  let coloured = false;

  function show(): void {
    group.visible = shown;
    for (const entry of tiles) {
      entry.mesh.visible = coloured;
    }
  }

  function forgetTextures(): void {
    for (const entry of tiles) {
      entry.texture?.dispose();
      entry.texture = undefined;
      entry.uniforms.uCells.value = null;
    }
  }

  const layer: LayerObject = {
    object: group,
    setLook(next) {
      shown = next.visible;
      for (const entry of tiles) {
        entry.uniforms.uOpacity.value = next.opacity;
      }
      show();
    },
    // A grid has no size in pixels and no outline: it is the same at every pixel ratio and on every theme.
    prepareFrame() {
      // (nothing)
    },
    setClasses(classes: ClassColouring | undefined) {
      forgetTextures();
      coloured = false;
      if (classes !== undefined && classes.indices.length === columns * rows) {
        const count = Math.min(classes.colours.length, MAX_CLASSES);
        classes.colours.slice(0, count).forEach((hex, k) => {
          const [r, g, b] = colourOf(hex);
          palette[k]?.set(r, g, b);
        });
        for (const entry of tiles) {
          const texture = new DataTexture(
            cut(classes.indices, columns, entry.tile),
            entry.tile.nx,
            entry.tile.ny,
            RedFormat,
            UnsignedByteType,
          );
          // The class of a cell and nothing between cells; rows of any width are tight in the array.
          texture.magFilter = NearestFilter;
          texture.minFilter = NearestFilter;
          texture.wrapS = ClampToEdgeWrapping;
          texture.wrapT = ClampToEdgeWrapping;
          texture.generateMipmaps = false;
          texture.unpackAlignment = 1;
          texture.needsUpdate = true;
          entry.texture = texture;
          entry.uniforms.uCells.value = texture;
          entry.uniforms.uCount.value = count;
        }
        coloured = true;
      }
      show();
    },
    dispose() {
      group.clear();
      forgetTextures();
      for (const entry of tiles) {
        entry.geometry.dispose();
        entry.material.dispose();
      }
    },
  };
  layer.setLook(look);
  return layer;
}
