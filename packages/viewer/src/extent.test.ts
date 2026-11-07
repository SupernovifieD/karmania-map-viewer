import type { RenderBuffers } from '@karmania/engine/display';
import { describe, expect, it } from 'vitest';
import { extentOf } from './extent.js';

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
