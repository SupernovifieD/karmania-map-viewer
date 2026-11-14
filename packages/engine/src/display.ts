/**
 * The public types of display preparation: the frame the map is drawn in, the buffers a renderer
 * uploads, and the classes a column is shown in. What they mean is in the kernel (`karmania-prep`); the
 * checks that a value from the kernel has these shapes are in `display-check.ts`.
 */
import type { CrsRef, Finding } from './types.js';

/** How the map's coordinate system was chosen. */
export const FRAME_SOURCES = ['auto', 'user'] as const;

/** `auto` from the first dataset that can be drawn, `user` in the map CRS dialog. */
export type FrameSource = (typeof FRAME_SOURCES)[number];

/**
 * The coordinate system the map is drawn in, and the origin every position sent to the graphics card is
 * relative to (so that a 32-bit float keeps the centimetres). `origin` is in map units.
 */
export interface Frame {
  readonly mapCrs: CrsRef;
  readonly origin: readonly [number, number, number];
  readonly source: FrameSource;
}

/** Whether a dataset is drawn in the map's coordinate system. */
export const DRAW_STATUSES = ['drawn', 'not_drawn'] as const;

/** `drawn`, or `not_drawn` with the reason in its findings. A dataset that is not drawn stays loaded. */
export type DrawStatus = (typeof DRAW_STATUSES)[number];

/** What is said of one dataset in a frame. */
export interface DrawableEntry {
  readonly id: number;
  readonly status: DrawStatus;
  /** Whether its positions are converted: reprojected, or scaled from other units. */
  readonly reprojected: boolean;
  /** Why it is not drawn, or what was assumed to draw it. */
  readonly findings: readonly Finding[];
}

/** The frame, and which datasets are drawn in it. */
export interface FrameChoice {
  /** `null` when nothing is loaded, or nothing has a coordinate system and a position. */
  readonly frame: Frame | null;
  /** One entry for each dataset, in the order they were loaded. */
  readonly drawable: readonly DrawableEntry[];
  /** About the choice of the map's coordinate system (the UTM zone), said once, when it is chosen. */
  readonly findings: readonly Finding[];
}

/** Where an image of grid cells goes, in the frame (map units, relative to the origin). */
export interface GridPlacement {
  /** The outer corner of cell (0, 0); z is the elevation of the grid's plane. */
  readonly origin: readonly [number, number, number];
  /** The size of a cell along `i` and `j`. */
  readonly spacing: readonly [number, number];
  /** Degrees counter-clockwise about +Z, pivoting at the origin. */
  readonly rotation: number;
}

/** One texture of a grid: `nx` by `ny` cells from cell (`i0`, `j0`). */
export interface GridTile {
  readonly i0: number;
  readonly j0: number;
  readonly nx: number;
  readonly ny: number;
}

/** The meshes of a grid in another coordinate system, one for each tile, one after another. */
export interface GridWarp {
  /** `x y z` of each vertex, relative to the origin; NaN where the conversion cannot place it. */
  readonly positions: Float32Array;
  /** `u v` of each vertex, from 0 to 1 across the texture of its tile. */
  readonly uvs: Float32Array;
  /** Three vertex numbers for each triangle, for all the tiles. */
  readonly triangles: Uint32Array;
  /** How many triangles each tile has, in the order of `tiles`. */
  readonly tileTriangles: Uint32Array;
}

/**
 * What a renderer uploads for a dataset, by kind. Positions are `f32`, `x y z` interleaved, relative to
 * the frame's origin, in map units; the numbers of elements, vertices and cells count from 0. Every typed
 * array is the receiver's to keep: it came by transfer, not by copy.
 */
export type RenderBuffers =
  | { readonly kind: 'points'; readonly positions: Float32Array }
  | {
      readonly kind: 'lines';
      readonly positions: Float32Array;
      /** Pairs of vertex numbers. */
      readonly segments: Uint32Array;
      /** The line of each segment. */
      readonly segmentLine: Uint32Array;
    }
  | {
      readonly kind: 'polygons';
      readonly positions: Float32Array;
      readonly triangles: Uint32Array;
      /** The polygon of each triangle. */
      readonly trianglePolygon: Uint32Array;
      /** Pairs of vertex numbers. */
      readonly outline: Uint32Array;
      /** The polygon of each outline segment. */
      readonly outlinePolygon: Uint32Array;
    }
  | {
      readonly kind: 'mesh';
      readonly positions: Float32Array;
      readonly triangles: Uint32Array;
    }
  | {
      readonly kind: 'grid';
      /** The cells along `i` and along `j`. */
      readonly size: readonly [number, number];
      readonly tiles: readonly GridTile[];
      readonly placement: GridPlacement;
      readonly warp?: undefined;
    }
  | {
      readonly kind: 'grid';
      readonly size: readonly [number, number];
      readonly tiles: readonly GridTile[];
      readonly warp: GridWarp;
      readonly placement?: undefined;
    }
  | {
      readonly kind: 'surface';
      /** The centre of every cell of the first layer, in cell order. */
      readonly positions: Float32Array;
      readonly triangles: Uint32Array;
      /** The cell each triangle takes its colour from. */
      readonly triangleCell: Uint32Array;
    }
  | {
      readonly kind: 'blocks';
      /** The centre of every block, in block order. */
      readonly centres: Float32Array;
      /** The size of a block along its own axes. */
      readonly spacing: readonly [number, number, number];
      /** Degrees counter-clockwise about +Z that each box is turned by. */
      readonly rotation: number;
      /**
       * How many blocks there are along `i`, `j` and `k`, for a dense model only: one block for each cell of the lattice, in lattice order (`i`
       * fastest, then `j`, then `k`), so that block `n` has the blocks `n ± 1`, `n ± dims[0]` and `n ± dims[0] * dims[1]` next to it. Absent for a
       * sparse model.
       */
      readonly dims?: readonly [number, number, number];
    };

/** What preparing a dataset came to. */
export type PrepareResult =
  | {
      readonly status: 'drawn';
      readonly buffers: RenderBuffers;
      /** What was found on the way: positions that could not be converted, polygons only outlined. */
      readonly findings: readonly Finding[];
    }
  | { readonly status: 'not_drawn'; readonly findings: readonly Finding[] };

/** How far a prepare has got, for a progress bar: from 0 to 1, never going down. */
export interface PrepareProgress {
  readonly fraction: number;
}

/** How a column is divided into classes. */
export const CLASS_METHODS = ['equal', 'quantile', 'jenks', 'categories'] as const;

/**
 * `equal` intervals, exact `quantile`s, natural breaks (`jenks`, found from an evenly strided sample of
 * at most 10,000 values), or `categories`.
 */
export type ClassMethod = (typeof CLASS_METHODS)[number];

/** A value shown as a category: the number, the text or the truth value itself. */
export type CategoryValue = string | number | boolean;

/** The classes of a column, and how many rows are in each. */
export type ClassBreaks =
  | {
      readonly kind: 'ranges';
      /** The column the classes are of. */
      readonly column: string;
      /**
       * `classes + 1` numbers, ascending: class `c` runs from `bounds[c]` up to, but not including,
       * `bounds[c + 1]`, and the last includes its upper bound. There can be fewer classes than were
       * asked for. The last two bounds are equal when the largest value is a class of its own.
       */
      readonly bounds: readonly number[];
      readonly counts: readonly number[];
      /** The rows with no value to put in a class: null, or not a finite number. */
      readonly nulls: number;
      /** For natural breaks: how many values they were found from, when that was not every value. */
      readonly sampled?: number;
    }
  | {
      readonly kind: 'categories';
      readonly column: string;
      /** The most common first; rows with the same count are in ascending order of value. */
      readonly values: readonly CategoryValue[];
      readonly counts: readonly number[];
      /** The rows with any other value: the class "Other", after `values`. Absent when there are none. */
      readonly other?: number;
      readonly nulls: number;
    };

/** What dividing a column into classes came to. */
export type ClassifyResult =
  | { readonly status: 'classified'; readonly breaks: ClassBreaks }
  | { readonly status: 'not_classified'; readonly findings: readonly Finding[] };

/** The class index of an element that has no value to put in a class. */
export const NO_CLASS = 255;
