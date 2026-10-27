/**
 * The arguments of the builder functions, and what they make.
 *
 * A builder takes data the way a page has it (plain arrays, one array per column,
 * attribute columns by name) and makes the dataset the kernel takes. Every shape has
 * one `...Data` type here; `DatasetInput` is what they all make.
 */
import type { CrsRef, KernelDataset, Triple } from './types.js';

/** A list of numbers: a plain array or a `Float64Array`. */
export type NumberList = readonly number[] | Float64Array;

/** A list of whole numbers (positions in another list): a plain array or a `Uint32Array`. */
export type IndexList = readonly number[] | Uint32Array;

/** One value of an attribute column. `null` is a missing value. */
export type AttributeValue = number | string | boolean | null;

/**
 * The values of one attribute column, one for each element of the dataset. All the
 * values that are not `null` must be of one type: numbers, text or booleans.
 */
export type AttributeColumn = ArrayLike<AttributeValue>;

/** Attribute columns by name, in the order they are listed. */
export type Attributes = Readonly<Record<string, AttributeColumn>>;

/** Points: one element for each. */
export interface PointsData {
  /** Blank means `points`. */
  readonly name: string;
  readonly x: NumberList;
  readonly y: NumberList;
  /** Elevations. Without them the points are two-dimensional. */
  readonly z?: NumberList;
  /** One value per point. */
  readonly attributes?: Attributes;
  /** `null` is reported when the dataset is loaded, and stops it loading. */
  readonly crs: CrsRef | null;
}

/** Lines: one element for each. */
export interface LinesData {
  /** Blank means `lines`. */
  readonly name: string;
  /** Every vertex of every line, in line order. */
  readonly x: NumberList;
  readonly y: NumberList;
  readonly z?: NumberList;
  /** Where each line starts in the vertex list, plus the end: one more than there are lines. */
  readonly offsets: IndexList;
  /** One value per line. */
  readonly attributes?: Attributes;
  /** One value per vertex. */
  readonly vertexAttributes?: Attributes;
  readonly crs: CrsRef | null;
}

/** Polygons with holes: one element for each polygon. */
export interface PolygonsData {
  /** Blank means `polygons`. */
  readonly name: string;
  /** Every vertex of every ring. Rings are open: the closing vertex is not repeated. */
  readonly x: NumberList;
  readonly y: NumberList;
  readonly z?: NumberList;
  /** Where each ring starts in the vertex list, plus the end. */
  readonly ringOffsets: IndexList;
  /**
   * Where each polygon's rings start in the ring list, plus the end. The first ring of
   * a polygon is its exterior and the rest are holes.
   */
  readonly polygonOffsets: IndexList;
  /** One value per polygon. */
  readonly attributes?: Attributes;
  readonly crs: CrsRef | null;
}

/** A triangle mesh: one element for each triangle. */
export interface MeshData {
  /** Blank means `mesh`. */
  readonly name: string;
  readonly x: NumberList;
  readonly y: NumberList;
  /** A mesh is always three-dimensional. */
  readonly z: NumberList;
  /** Three vertex numbers per triangle, counting from 0. */
  readonly indices: IndexList;
  /** One value per triangle. */
  readonly attributes?: Attributes;
  /** One value per vertex. */
  readonly vertexAttributes?: Attributes;
  readonly crs: CrsRef | null;
}

/** The cells of a regular grid or block model. */
interface LatticeData {
  /** Blank means the kind's name. */
  readonly name: string;
  /** The lowest corner of cell (0, 0, 0), before rotation. */
  readonly origin: Triple;
  /** The size of a cell along each axis; each above 0. */
  readonly spacing: Triple;
  /** How many cells there are along each axis, at least 1; 1 along Z for a 2D grid. */
  readonly dims: readonly [number, number, number] | Uint32Array;
  /** Degrees counter-clockwise about +Z, pivoting at the origin. Defaults to 0. */
  readonly rotation?: number;
  readonly crs: CrsRef | null;
}

/** A regular grid: one element for each cell. */
export interface GridData extends LatticeData {
  /**
   * The elevation of the grid: a number for a flat grid, or the name of a column of
   * `values` that holds the elevation of each cell. Defaults to 0.
   */
  readonly z?: number | string;
  /** One value per cell, with X fastest, then Y, then Z. */
  readonly values: Attributes;
}

/**
 * A block model: one element for each block. Without `ijk` it is dense, with a block
 * in every cell and the values in lattice order (X fastest, then Y, then Z).
 */
export interface BlocksData extends LatticeData {
  /** For a sparse model: `i, j, k` for each block, in the order of the values. */
  readonly ijk?: IndexList;
  /** One value per block. */
  readonly values: Attributes;
}

/**
 * A dataset made with one of the builder functions, ready for `engine.load`. Its
 * `kind` says which shape it is.
 *
 * Loading *consumes* it: the typed arrays inside are handed to the worker, not copied,
 * so a dataset input can be loaded once, and arrays you passed to a builder are empty
 * afterwards. Pass a copy (`array.slice()`) to keep yours.
 */
export type DatasetInput = KernelDataset;
