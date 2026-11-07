import type { RenderBuffers } from '@karmania/engine/display';
import { describe, expect, it } from 'vitest';
import { extentOf, extentOfInParts } from './extent.js';

const ORIGIN = [500_000, 4_000_000, 100] as const;

describe('extentOf', () => {
  it('is the least and the greatest of the positions, with the origin put back, for points', () => {
    const buffers: RenderBuffers = {
      kind: 'points',
      positions: Float32Array.of(1, 2, 3, -4, 8, 0, 10, -6, 5),
    };
    expect(extentOf(buffers, ORIGIN)).toEqual({
      min: [500_000 - 4, 4_000_000 - 6, 100],
      max: [500_010, 4_000_008, 105],
    });
  });

  it('reads the positions of lines, polygons, meshes and surfaces the same way', () => {
    const positions = Float32Array.of(0, 0, 0, 10, 20, 30);
    const empty = new Uint32Array(0);
    const all: RenderBuffers[] = [
      { kind: 'lines', positions, segments: empty, segmentLine: empty },
      {
        kind: 'polygons',
        positions,
        triangles: empty,
        trianglePolygon: empty,
        outline: empty,
        outlinePolygon: empty,
      },
      { kind: 'mesh', positions, triangles: empty },
      { kind: 'surface', positions, triangles: empty, triangleCell: empty },
    ];
    for (const buffers of all) {
      expect(extentOf(buffers, [0, 0, 0]), buffers.kind).toEqual({
        min: [0, 0, 0],
        max: [10, 20, 30],
      });
    }
  });

  it('leaves out a position that is not a number, and has no extent if none is', () => {
    const buffers: RenderBuffers = {
      kind: 'points',
      positions: Float32Array.of(NaN, 1, 1, 5, 6, 7, 2, Infinity, 3, 9, NaN, NaN),
    };
    expect(extentOf(buffers, [0, 0, 0])).toEqual({ min: [5, 6, 7], max: [5, 6, 7] });
    expect(
      extentOf({ kind: 'points', positions: Float32Array.of(NaN, NaN, NaN) }, [0, 0, 0]),
    ).toBeUndefined();
    expect(extentOf({ kind: 'points', positions: new Float32Array(0) }, [0, 0, 0])).toBeUndefined();
    // A position that is not whole (the buffer ends in the middle of one) is not one.
    expect(
      extentOf({ kind: 'points', positions: Float32Array.of(1, 2) }, [0, 0, 0]),
    ).toBeUndefined();
  });

  it('is the four corners of the image for a grid that is placed, and turns with it', () => {
    const grid = (rotation: number): RenderBuffers => ({
      kind: 'grid',
      size: [4, 2],
      tiles: [{ i0: 0, j0: 0, nx: 4, ny: 2 }],
      placement: { origin: [100, 200, 7], spacing: [10, 5], rotation },
    });
    expect(extentOf(grid(0), [1000, 2000, 0])).toEqual({
      min: [1100, 2200, 7],
      max: [1140, 2210, 7],
    });
    // A quarter turn anticlockwise about the corner: the image goes up (north) from it and to the left.
    const turned = extentOf(grid(90), [0, 0, 0]);
    expect(turned?.min[0]).toBeCloseTo(90, 4);
    expect(turned?.max[0]).toBeCloseTo(100, 4);
    expect(turned?.min[1]).toBeCloseTo(200, 4);
    expect(turned?.max[1]).toBeCloseTo(240, 4);
  });

  it('is the positions of a warped grid, without the corners that did not convert', () => {
    const buffers: RenderBuffers = {
      kind: 'grid',
      size: [2, 2],
      tiles: [{ i0: 0, j0: 0, nx: 2, ny: 2 }],
      warp: {
        positions: Float32Array.of(0, 0, 0, 10, 1, 0, NaN, NaN, NaN, 9, 12, 0),
        uvs: new Float32Array(8),
        triangles: new Uint32Array(0),
        tileTriangles: Uint32Array.of(0),
      },
    };
    expect(extentOf(buffers, [0, 0, 0])).toEqual({ min: [0, 0, 0], max: [10, 12, 0] });
  });

  it('is the centres of blocks and half a diagonal and half a height round them', () => {
    const buffers: RenderBuffers = {
      kind: 'blocks',
      centres: Float32Array.of(0, 0, 0, 20, 10, 6),
      spacing: [6, 8, 4],
      rotation: 30,
    };
    // Half the diagonal of 6 by 8 is 5.
    expect(extentOf(buffers, [100, 100, 0])).toEqual({ min: [95, 95, -2], max: [125, 115, 8] });
    expect(extentOf({ ...buffers, centres: new Float32Array(0) }, [0, 0, 0])).toBeUndefined();
  });

  it('keeps the precision of the origin: a position a metre from it is a metre from it at UTM coordinates', () => {
    const near = extentOf(
      { kind: 'points', positions: Float32Array.of(1, 1, 0) },
      [512_345.678, 4_012_345.5, 0],
    );
    expect(near?.min[0]).toBe(512_346.678);
    expect(near?.min[1]).toBe(4_012_346.5);
  });
});

describe('extentOfInParts', () => {
  /** Positions that are not simple: spread out, a few that are not numbers, and the extreme ones far into the array. */
  function many(count: number): Float32Array {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = ((i * 7919) % 2001) - 1000;
      positions[i * 3 + 1] = ((i * 104_729) % 4001) - 2000;
      positions[i * 3 + 2] = (i % 13) - 6;
    }
    positions[3 * (count - 2)] = NaN;
    positions[3 * (count - 3) + 1] = Infinity;
    // The least and the greatest of all are in the last slice.
    positions[3 * (count - 1)] = -5000;
    positions[3 * (count - 1) + 1] = 9000;
    positions[3 * (count - 1) + 2] = 77;
    return positions;
  }

  it('is the extent that `extentOf` gives, for every kind that has positions, whatever the size of the slices', async () => {
    const positions = many(1000);
    const empty = new Uint32Array(0);
    const all: RenderBuffers[] = [
      { kind: 'points', positions },
      { kind: 'lines', positions, segments: empty, segmentLine: empty },
      { kind: 'mesh', positions, triangles: empty },
      { kind: 'blocks', centres: positions, spacing: [6, 8, 4], rotation: 30 },
      {
        kind: 'grid',
        size: [2, 2],
        tiles: [{ i0: 0, j0: 0, nx: 2, ny: 2 }],
        warp: { positions, uvs: new Float32Array(8), triangles: empty, tileTriangles: empty },
      },
    ];
    for (const buffers of all) {
      for (const perTurn of [1, 7, 333, 1000, 5000]) {
        expect(
          await extentOfInParts(buffers, ORIGIN, () => Promise.resolve(), perTurn),
          `${buffers.kind} by ${String(perTurn)}`,
        ).toEqual(extentOf(buffers, ORIGIN));
      }
    }
  });

  it('gives the page a turn between the slices and not after the last, and none for buffers of one slice', async () => {
    let turns = 0;
    const turn = () => {
      turns += 1;
      return Promise.resolve();
    };
    await extentOfInParts({ kind: 'points', positions: many(1000) }, ORIGIN, turn, 300);
    // 1,000 positions by 300: four slices, three turns.
    expect(turns).toBe(3);
    turns = 0;
    await extentOfInParts({ kind: 'points', positions: many(1000) }, ORIGIN, turn, 1000);
    expect(turns).toBe(0);
    await extentOfInParts({ kind: 'points', positions: many(10) }, ORIGIN, turn);
    expect(turns).toBe(0);
  });

  it('has no extent for nothing, or for positions none of which is a number, and does not wait for a grid that is placed', async () => {
    const never = () => Promise.reject(new Error('no turn is wanted'));
    expect(
      await extentOfInParts({ kind: 'points', positions: new Float32Array(0) }, ORIGIN, never),
    ).toBeUndefined();
    expect(
      await extentOfInParts(
        { kind: 'points', positions: Float32Array.of(NaN, 1, 2) },
        ORIGIN,
        never,
        1,
      ),
    ).toBeUndefined();
    const placed: RenderBuffers = {
      kind: 'grid',
      size: [4, 2],
      tiles: [{ i0: 0, j0: 0, nx: 4, ny: 2 }],
      placement: { origin: [100, 200, 7], spacing: [10, 5], rotation: 0 },
    };
    expect(await extentOfInParts(placed, [1000, 2000, 0], never)).toEqual(
      extentOf(placed, [1000, 2000, 0]),
    );
  });
});
