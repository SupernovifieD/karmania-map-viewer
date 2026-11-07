import type { RenderBuffers } from '@karmania/engine/display';
import {
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  LessDepth,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
} from 'three';
import type { Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createGridLayer } from './grid-layer.js';
import type { ClassColouring, LayerLook } from './look.js';
import { MAX_CLASSES, NO_VALUE } from './look.js';

const LOOK: LayerLook = {
  visible: true,
  opacity: 1,
  colour: '#56b4e9',
  pointSize: 6,
  lineWidth: 2,
};

type Placed = Extract<RenderBuffers, { kind: 'grid'; placement: object }>;

/** A grid of 4 by 3 cells of 2 by 3 units whose first cell has its lower corner at (10, 20, 5), in one tile unless told otherwise. */
const grid = (over: Partial<Placed> = {}): Placed => ({
  kind: 'grid',
  size: [4, 3],
  tiles: [{ i0: 0, j0: 0, nx: 4, ny: 3 }],
  placement: { origin: [10, 20, 5], spacing: [2, 3], rotation: 0 },
  ...over,
});

type WarpOf = NonNullable<Extract<RenderBuffers, { kind: 'grid'; warp: object }>['warp']>;

/**
 * A grid of 4 by 3 in two tiles (3 columns by 2 rows, and 1 column by 3 rows), warped: a mesh of 4 vertices and 2 triangles for the first
 * and of 5 vertices and 3 triangles for the second, whose vertex numbers run on from the first's.
 */
const warped = (): Extract<RenderBuffers, { kind: 'grid' }> & { warp?: WarpOf } => ({
  kind: 'grid',
  size: [4, 3],
  tiles: [
    { i0: 0, j0: 0, nx: 3, ny: 2 },
    { i0: 3, j0: 0, nx: 1, ny: 3 },
  ],
  warp: {
    positions: Float32Array.from({ length: 9 * 3 }, (_, i) => i),
    uvs: Float32Array.from({ length: 9 * 2 }, (_, i) => i / 20),
    triangles: Uint32Array.of(0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 5, 8, 6),
    tileTriangles: Uint32Array.of(2, 3),
  },
});

/** A class for each cell of a grid of 4 by 3, which is its own number (so that a cell is told from another). */
const numbered = (count = 12): ClassColouring => ({
  indices: Uint8Array.from({ length: count }, (_, i) => i),
  colours: Array.from({ length: 12 }, (_, i) => `#${(i * 16).toString(16).padStart(2, '0')}0000`),
});

const meshes = (layer: ReturnType<typeof createGridLayer>): Mesh[] =>
  layer.object.children as Mesh[];
const positions = (mesh: Mesh | undefined): number[] => [
  ...((mesh?.geometry.getAttribute('position').array as Float32Array | undefined) ?? []),
];
const uniforms = (mesh: Mesh | undefined) => (mesh?.material as ShaderMaterial).uniforms;
const textureOf = (mesh: Mesh | undefined) => uniforms(mesh)['uCells']?.value as DataTexture | null;

describe('createGridLayer', () => {
  it('is a mesh for each tile when the grid is warped, with the positions and the uvs once for all of them', () => {
    const layer = createGridLayer(warped(), LOOK);
    expect(meshes(layer)).toHaveLength(2);
    const [first, second] = meshes(layer).map((mesh) => mesh.geometry);
    expect(first?.getAttribute('position')).toBe(second?.getAttribute('position'));
    expect(first?.getAttribute('uv')).toBe(second?.getAttribute('uv'));
    expect(first?.getAttribute('position').count).toBe(9);
    expect(first?.getAttribute('uv').count).toBe(9);
  });

  it('takes the triangles of each tile from the list in turn, as a view of it and not a copy', () => {
    const buffers = warped();
    const layer = createGridLayer(buffers, LOOK);
    const [first, second] = meshes(layer).map((mesh) => mesh.geometry.index?.array);
    expect([...(first ?? [])]).toEqual([0, 1, 2, 0, 2, 3]);
    expect([...(second ?? [])]).toEqual([4, 5, 6, 4, 6, 7, 5, 8, 6]);
    expect(first?.buffer).toBe(buffers.warp?.triangles.buffer);
    expect(second?.buffer).toBe(buffers.warp?.triangles.buffer);
    expect(second?.byteOffset).toBe(6 * 4);
  });

  it('gives the card the positions and uvs that the engine sent, not a copy', () => {
    const buffers = warped();
    const layer = createGridLayer(buffers, LOOK);
    const geometry = meshes(layer)[0]?.geometry;
    expect(geometry?.getAttribute('position').array).toBe(buffers.warp?.positions);
    expect(geometry?.getAttribute('uv').array).toBe(buffers.warp?.uvs);
  });

  it('has a tile with no triangles (every vertex of it could not be placed) draw nothing, and the others as they are', () => {
    const buffers = warped();
    const layer = createGridLayer(
      {
        ...buffers,
        warp: { ...(buffers.warp as WarpOf), tileTriangles: Uint32Array.of(0, 3) },
      } as Extract<RenderBuffers, { kind: 'grid' }>,
      LOOK,
    );
    const [first, second] = meshes(layer).map((mesh) => [...(mesh.geometry.index?.array ?? [])]);
    expect(first).toEqual([]);
    // The next tile's triangles start where the list is, since the first took none of it.
    expect(second).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6]);
  });

  it('gives a tile that the list of counts does not reach no triangles, and does not draw what it was not told of', () => {
    const buffers = warped();
    const layer = createGridLayer(
      {
        ...buffers,
        warp: { ...(buffers.warp as WarpOf), tileTriangles: Uint32Array.of(2) },
      } as Extract<RenderBuffers, { kind: 'grid' }>,
      LOOK,
    );
    const [first, second] = meshes(layer).map((mesh) => [...(mesh.geometry.index?.array ?? [])]);
    expect(first).toEqual([0, 1, 2, 0, 2, 3]);
    expect(second).toEqual([]);
  });

  it('has the classes cut into the tiles of a warped grid, and the textures freed with it, as for a placed one', () => {
    const layer = createGridLayer(warped(), LOOK);
    layer.setClasses?.(numbered());
    const data = meshes(layer).map((mesh) => [
      ...((textureOf(mesh)?.image.data as Uint8Array | undefined) ?? []),
    ]);
    // The first tile is 3 columns of 2 rows, the second is the last column of all 3 rows.
    expect(data).toEqual([
      [0, 1, 2, 4, 5, 6],
      [3, 7, 11],
    ]);
    const freed: string[] = [];
    for (const [i, mesh] of meshes(layer).entries()) {
      textureOf(mesh)?.addEventListener('dispose', () => freed.push(`texture ${String(i)}`));
      mesh.geometry.addEventListener('dispose', () => freed.push(`geometry ${String(i)}`));
    }
    layer.dispose();
    expect(freed.sort()).toEqual(['geometry 0', 'geometry 1', 'texture 0', 'texture 1']);
  });

  it('puts the image where the placement says: a quad for a tile, from the lower corner of the first cell, the height of its plane', () => {
    const layer = createGridLayer(grid(), LOOK);
    expect(meshes(layer)).toHaveLength(1);
    // 4 cells of 2 along and 3 cells of 3 up, from (10, 20) at height 5.
    expect(positions(meshes(layer)[0])).toEqual([10, 20, 5, 18, 20, 5, 18, 29, 5, 10, 29, 5]);
    expect([...(meshes(layer)[0]?.geometry.index?.array ?? [])]).toEqual([0, 1, 2, 0, 2, 3]);
    expect([...(meshes(layer)[0]?.geometry.getAttribute('uv').array ?? [])]).toEqual([
      0, 0, 1, 0, 1, 1, 0, 1,
    ]);
  });

  it('turns the image about the origin by the rotation, anticlockwise, exactly for a quarter turn', () => {
    const quarter = createGridLayer(
      grid({ placement: { origin: [10, 20, 5], spacing: [2, 3], rotation: 90 } }),
      LOOK,
    );
    // The first axis (along `i`) points north now and the second (along `j`) west.
    expect(positions(meshes(quarter)[0])).toEqual([10, 20, 5, 10, 28, 5, 1, 28, 5, 1, 20, 5]);
    const half = createGridLayer(
      grid({ placement: { origin: [0, 0, 0], spacing: [1, 1], rotation: 180 } }),
      LOOK,
    );
    // (`+ 0` makes a negative zero a zero: the sign of a zero is not what is asked.)
    expect(positions(meshes(half)[0]).map((value) => value + 0)).toEqual([
      0, 0, 0, -4, 0, 0, -4, -3, 0, 0, -3, 0,
    ]);
    const slant = createGridLayer(
      grid({ placement: { origin: [0, 0, 0], spacing: [1, 1], rotation: 30 } }),
      LOOK,
    );
    const [, , , x1, y1] = positions(meshes(slant)[0]);
    expect(x1).toBeCloseTo(4 * Math.cos(Math.PI / 6), 5);
    expect(y1).toBeCloseTo(4 * Math.sin(Math.PI / 6), 5);
  });

  it('turns by what the angle is the same as: -90 is 270, 450 is 90', () => {
    const corner = (rotation: number) =>
      positions(
        meshes(
          createGridLayer(
            grid({ placement: { origin: [0, 0, 0], spacing: [1, 1], rotation } }),
            LOOK,
          ),
        )[0],
      )
        .slice(3, 5)
        .map((value) => value + 0);
    expect(corner(-90)).toEqual(corner(270));
    expect(corner(450)).toEqual(corner(90));
    expect(corner(90)).toEqual([0, 4]);
    expect(corner(270)).toEqual([0, -4]);
  });

  it('has the tiles meet exactly: the same corner of two tiles is the same bits, even when turned', () => {
    const layer = createGridLayer(
      grid({
        size: [5, 2],
        tiles: [
          { i0: 0, j0: 0, nx: 3, ny: 2 },
          { i0: 3, j0: 0, nx: 2, ny: 2 },
        ],
        placement: { origin: [500_000.25, 2_765_000.5, 0], spacing: [10.1, 9.9], rotation: 33 },
      }),
      LOOK,
    );
    const [first, second] = meshes(layer).map((mesh) => positions(mesh));
    // The right side of the first (its corners 1 and 2) is the left side of the second (its corners 0 and 3).
    expect(first?.slice(3, 6)).toEqual(second?.slice(0, 3));
    expect(first?.slice(6, 9)).toEqual(second?.slice(9, 12));
  });

  it('draws nothing until it has classes, and a texture of each tile and nothing else when it has them', () => {
    const layer = createGridLayer(grid(), LOOK);
    expect(meshes(layer).map((mesh) => mesh.visible)).toEqual([false]);
    expect(textureOf(meshes(layer)[0])).toBeNull();
    layer.setClasses?.(numbered());
    expect(meshes(layer).map((mesh) => mesh.visible)).toEqual([true]);
    const texture = textureOf(meshes(layer)[0]);
    expect(texture).toBeInstanceOf(DataTexture);
    expect([texture?.image.width, texture?.image.height]).toEqual([4, 3]);
  });

  it('samples the cells nearest, never between, one byte for a cell, with no mipmaps and no wrapping', () => {
    const layer = createGridLayer(grid(), LOOK);
    layer.setClasses?.(numbered());
    const texture = textureOf(meshes(layer)[0]);
    expect(texture?.magFilter).toBe(NearestFilter);
    expect(texture?.minFilter).toBe(NearestFilter);
    expect(texture?.generateMipmaps).toBe(false);
    expect(texture?.format).toBe(RedFormat);
    expect(texture?.type).toBe(UnsignedByteType);
    expect(texture?.unpackAlignment).toBe(1);
    expect([texture?.wrapS, texture?.wrapT]).toEqual([ClampToEdgeWrapping, ClampToEdgeWrapping]);
    // It is to be sent to the card (setting `needsUpdate` raises the version, and that is all that can be read of it).
    expect(texture?.version).toBeGreaterThan(0);
  });

  it('cuts the classes into the tiles: each texture has the rows and columns of its tile, in lattice order', () => {
    const layer = createGridLayer(
      grid({
        tiles: [
          { i0: 0, j0: 0, nx: 3, ny: 2 },
          { i0: 3, j0: 0, nx: 1, ny: 2 },
          { i0: 0, j0: 2, nx: 3, ny: 1 },
          { i0: 3, j0: 2, nx: 1, ny: 1 },
        ],
      }),
      LOOK,
    );
    layer.setClasses?.(numbered());
    const data = meshes(layer).map((mesh) => [
      ...((textureOf(mesh)?.image.data as Uint8Array | undefined) ?? []),
    ]);
    expect(data).toEqual([[0, 1, 2, 4, 5, 6], [3, 7], [8, 9, 10], [11]]);
  });

  it('gives a tile as wide as the grid a view of the classes, not a copy', () => {
    const classes = numbered();
    const layer = createGridLayer(
      grid({
        tiles: [
          { i0: 0, j0: 0, nx: 4, ny: 2 },
          { i0: 0, j0: 2, nx: 4, ny: 1 },
        ],
      }),
      LOOK,
    );
    layer.setClasses?.(classes);
    const [first, second] = meshes(layer).map((mesh) => textureOf(mesh)?.image.data as Uint8Array);
    expect(first?.buffer).toBe(classes.indices.buffer);
    expect([first?.byteOffset, first?.length]).toEqual([0, 8]);
    expect([second?.byteOffset, second?.length]).toEqual([8, 4]);
  });

  it('has the colours of the classes in the palette, as many as there are, and no more than it can hold', () => {
    const layer = createGridLayer(grid(), LOOK);
    layer.setClasses?.({ indices: new Uint8Array(12), colours: ['#ff0000', '#00ff00'] });
    expect(uniforms(meshes(layer)[0])['uCount']?.value).toBe(2);
    const palette = uniforms(meshes(layer)[0])['uPalette']?.value as {
      x: number;
      y: number;
      z: number;
    }[];
    expect(palette).toHaveLength(MAX_CLASSES);
    expect(palette[0]).toMatchObject({ x: 1, y: 0, z: 0 });
    expect(palette[1]).toMatchObject({ x: 0, y: 1, z: 0 });
    layer.setClasses?.({
      indices: new Uint8Array(12),
      colours: Array.from({ length: MAX_CLASSES + 5 }, () => '#0000ff'),
    });
    expect(uniforms(meshes(layer)[0])['uCount']?.value).toBe(MAX_CLASSES);
  });

  it('does not draw a class of no value or one without a colour: the cells are not coloured in the shader, whatever their byte', () => {
    expect(NO_VALUE).toBeGreaterThanOrEqual(MAX_CLASSES);
    const layer = createGridLayer(grid(), LOOK);
    layer.setClasses?.({
      indices: new Uint8Array(12),
      colours: ['#ff0000', '#00ff00', '#0000ff'],
    });
    // A cell is drawn when its class is below the count, which is 3 here, and 255 is never below it.
    expect(uniforms(meshes(layer)[0])['uCount']?.value).toBe(3);
    expect(NO_VALUE).toBeGreaterThan(uniforms(meshes(layer)[0])['uCount']?.value as number);
  });

  it('draws nothing for classes that are not one byte for each cell', () => {
    const layer = createGridLayer(grid(), LOOK);
    layer.setClasses?.(numbered());
    expect(meshes(layer).map((mesh) => mesh.visible)).toEqual([true]);
    layer.setClasses?.(numbered(11));
    expect(meshes(layer).map((mesh) => mesh.visible)).toEqual([false]);
    expect(textureOf(meshes(layer)[0])).toBeNull();
    layer.setClasses?.(numbered(13));
    expect(meshes(layer).map((mesh) => mesh.visible)).toEqual([false]);
  });

  it('keeps its textures when it is given the same classes of the cells with other colours: only the palette changes', () => {
    const layer = createGridLayer(grid(), LOOK);
    const classes = numbered();
    layer.setClasses?.(classes);
    const texture = textureOf(meshes(layer)[0]);
    const freed: string[] = [];
    texture?.addEventListener('dispose', () => freed.push('texture'));
    const version = texture?.version;
    layer.setClasses?.({ indices: classes.indices, colours: ['#ff0000', '#00ff00'] });
    expect(textureOf(meshes(layer)[0])).toBe(texture);
    expect(texture?.version).toBe(version);
    expect(freed).toEqual([]);
    expect(uniforms(meshes(layer)[0])['uCount']?.value).toBe(2);
    const palette = uniforms(meshes(layer)[0])['uPalette']?.value as { x: number }[];
    expect(palette[0]?.x).toBe(1);
    expect(meshes(layer)[0]?.visible).toBe(true);
    // Other classes of the cells, though the same length, are new textures.
    layer.setClasses?.({ indices: Uint8Array.from(classes.indices), colours: classes.colours });
    expect(textureOf(meshes(layer)[0])).not.toBe(texture);
    expect(freed).toEqual(['texture']);
  });

  it('does not keep what it was given as the same classes once they were taken away', () => {
    const layer = createGridLayer(grid(), LOOK);
    const classes = numbered();
    layer.setClasses?.(classes);
    layer.setClasses?.(undefined);
    layer.setClasses?.(classes);
    expect(textureOf(meshes(layer)[0])).toBeInstanceOf(DataTexture);
    expect(meshes(layer)[0]?.visible).toBe(true);
  });

  it('frees the textures of the old classes when it is given new ones, and when they are taken away', () => {
    const layer = createGridLayer(grid(), LOOK);
    layer.setClasses?.(numbered());
    const freed: string[] = [];
    const first = textureOf(meshes(layer)[0]);
    first?.addEventListener('dispose', () => freed.push('first'));
    layer.setClasses?.(numbered());
    const second = textureOf(meshes(layer)[0]);
    expect(second).not.toBe(first);
    second?.addEventListener('dispose', () => freed.push('second'));
    layer.setClasses?.(undefined);
    expect(freed).toEqual(['first', 'second']);
    expect(meshes(layer).map((mesh) => mesh.visible)).toEqual([false]);
    expect(textureOf(meshes(layer)[0])).toBeNull();
  });

  it('takes the opacity of its look, shows or hides, and does not show what has no classes when shown', () => {
    const layer = createGridLayer(grid(), { ...LOOK, opacity: 0.4 });
    expect(uniforms(meshes(layer)[0])['uOpacity']?.value).toBe(0.4);
    layer.setClasses?.(numbered());
    layer.setLook({ ...LOOK, opacity: 0.7, visible: false });
    expect(uniforms(meshes(layer)[0])['uOpacity']?.value).toBe(0.7);
    expect(layer.object.visible).toBe(false);
    layer.setLook({ ...LOOK, visible: true });
    expect(layer.object.visible).toBe(true);
    expect(meshes(layer)[0]?.visible).toBe(true);
    // Hidden before it has classes, and shown after: shown means that its classes show.
    const bare = createGridLayer(grid(), { ...LOOK, visible: false });
    expect(bare.object.visible).toBe(false);
    bare.setClasses?.(numbered());
    expect(bare.object.visible).toBe(false);
  });

  it('is drawn with depth, strictly nearer, from either side, and with blending for its opacity', () => {
    const material = meshes(createGridLayer(grid(), LOOK))[0]?.material as ShaderMaterial;
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.transparent).toBe(true);
    expect(material.depthFunc).toBe(LessDepth);
    expect(material.side).toBe(DoubleSide);
  });

  it('frees every geometry, material and texture when it is disposed', () => {
    const layer = createGridLayer(
      grid({
        tiles: [
          { i0: 0, j0: 0, nx: 2, ny: 3 },
          { i0: 2, j0: 0, nx: 2, ny: 3 },
        ],
      }),
      LOOK,
    );
    layer.setClasses?.(numbered());
    const freed: string[] = [];
    for (const [i, mesh] of meshes(layer).entries()) {
      mesh.geometry.addEventListener('dispose', () => freed.push(`geometry ${String(i)}`));
      (mesh.material as ShaderMaterial).addEventListener('dispose', () =>
        freed.push(`material ${String(i)}`),
      );
      textureOf(mesh)?.addEventListener('dispose', () => freed.push(`texture ${String(i)}`));
    }
    layer.dispose();
    expect(freed.sort()).toEqual([
      'geometry 0',
      'geometry 1',
      'material 0',
      'material 1',
      'texture 0',
      'texture 1',
    ]);
    expect(meshes(layer)).toHaveLength(0);
  });

  it('has no tile to draw for a grid that has none', () => {
    const layer = createGridLayer(grid({ tiles: [] }), LOOK);
    expect(meshes(layer)).toHaveLength(0);
    layer.setClasses?.(numbered());
    expect(meshes(layer)).toHaveLength(0);
  });
});
