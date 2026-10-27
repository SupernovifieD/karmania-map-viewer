/**
 * Builder functions: make a dataset for `engine.load` from data a page has in code.
 *
 * Coordinates and offsets become typed arrays, and each attribute column becomes a typed
 * column of the type its values call for, by the same rules a CSV import uses:
 *
 * - numbers are `int` when every one is a whole number that is safe to hold exactly, and
 *   `float` otherwise;
 * - true and false are `bool`;
 * - text is a `category` when it has at most 50 different values and each appears twice
 *   or more on average, and `text` otherwise;
 * - `null` is a missing value, whatever the type of the others. A column with nothing but
 *   `null` (or with no values at all) is `float`.
 *
 * A builder throws a `TypeError` for something it cannot put in a dataset at all: a column
 * of mixed kinds, a value that is none of the kinds above, or a position that is not a
 * whole number from 0 to 4,294,967,295. Anything the kernel can judge, such as lengths that
 * do not match, becomes a finding when the dataset is loaded.
 */
import type {
  AttributeColumn,
  Attributes,
  BlocksData,
  GridData,
  IndexList,
  LinesData,
  MeshData,
  NumberList,
  PointsData,
  PolygonsData,
} from './inputs.js';
import type {
  KernelBlocks,
  KernelColumn,
  KernelGrid,
  KernelLines,
  KernelMesh,
  KernelPoints,
  KernelPolygons,
} from './types.js';

/** A text column with no more than this many different values may be a category. */
const MAX_CATEGORIES = 50;

const MAX_INDEX = 0xffff_ffff;

/** The array itself if it already is one, otherwise a new one. Never a copy of a `Float64Array`. */
function float64(list: NumberList): Float64Array {
  return list instanceof Float64Array ? list : Float64Array.from(list);
}

function uint32(list: IndexList, what: string): Uint32Array {
  if (list instanceof Uint32Array) {
    return list;
  }
  const array = new Uint32Array(list.length);
  list.forEach((value, index) => {
    if (!Number.isInteger(value) || value < 0 || value > MAX_INDEX) {
      throw new TypeError(
        `${what} has ${String(value)} at position ${String(index + 1)}, which is not a whole number from 0 to ${String(MAX_INDEX)}.`,
      );
    }
    array[index] = value;
  });
  return array;
}

type ValueKind = 'number' | 'string' | 'boolean';

/** How a kind of value is named in a message, for one value and for several. */
const KIND_WORDS: Readonly<Record<ValueKind, { readonly one: string; readonly many: string }>> = {
  number: { one: 'a number', many: 'numbers' },
  string: { one: 'text', many: 'text' },
  boolean: { one: 'true or false', many: 'true or false' },
};

function kindOf(value: unknown): ValueKind | undefined {
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'string') {
    return 'string';
  }
  return typeof value === 'boolean' ? 'boolean' : undefined;
}

/** What a column of attribute values holds, found by looking at every value once. */
interface Survey {
  readonly kind: ValueKind | undefined;
  readonly nulls: Uint8Array;
  readonly nullCount: number;
  /** For numbers: every one is a whole number that a 64-bit integer holds exactly. */
  readonly allWhole: boolean;
}

function survey(name: string, values: AttributeColumn): Survey {
  const nulls = new Uint8Array(values.length);
  let nullCount = 0;
  let kind: ValueKind | undefined;
  let allWhole = true;
  for (let index = 0; index < values.length; index += 1) {
    const value: unknown = values[index];
    if (value === null) {
      nulls[index] = 1;
      nullCount += 1;
      continue;
    }
    const valueKind = kindOf(value);
    const position = String(index + 1);
    if (valueKind === undefined) {
      throw new TypeError(
        `The column "${name}" has a value at position ${position} that is not a number, text, true or false, or null.`,
      );
    }
    if (kind !== undefined && kind !== valueKind) {
      throw new TypeError(
        `The column "${name}" has ${KIND_WORDS[valueKind].one} at position ${position} but ${KIND_WORDS[kind].many} before it. A column holds one kind of value; use null for a missing one.`,
      );
    }
    kind = valueKind;
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      allWhole = false;
    }
  }
  return { kind, nulls, nullCount, allWhole };
}

/** Text as a category: the distinct values in order of first appearance, and a code for each. */
function categorise(strings: readonly string[], nulls: Uint8Array, nonNull: number) {
  const dictionary: string[] = [];
  const codes = new Uint32Array(strings.length);
  const known = new Map<string, number>();
  for (let index = 0; index < strings.length; index += 1) {
    if (nulls[index] === 1) {
      continue;
    }
    const text = strings[index] ?? '';
    let code = known.get(text);
    if (code === undefined) {
      if (dictionary.length === MAX_CATEGORIES || (dictionary.length + 1) * 2 > nonNull) {
        return undefined;
      }
      code = dictionary.length;
      known.set(text, code);
      dictionary.push(text);
    }
    codes[index] = code;
  }
  return { codes, dictionary };
}

/** Makes the column the kernel takes from the values of one attribute. */
export function kernelColumn(name: string, values: AttributeColumn): KernelColumn {
  if (values instanceof Float64Array) {
    return { name, type: 'float', values };
  }
  const { kind, nulls, nullCount, allWhole } = survey(name, values);
  const base = nullCount > 0 ? { name, nulls } : { name };
  const length = values.length;
  switch (kind) {
    case 'number': {
      const numbers = Float64Array.from({ length }, (_, i) => Number(values[i] ?? 0));
      return allWhole
        ? { ...base, type: 'int', values: BigInt64Array.from(numbers, (n) => BigInt(n)) }
        : { ...base, type: 'float', values: numbers };
    }
    case 'boolean':
      return {
        ...base,
        type: 'bool',
        values: Uint8Array.from({ length }, (_, i) => (values[i] === true ? 1 : 0)),
      };
    case 'string': {
      const strings = Array.from({ length }, (_, i) => {
        const value = values[i];
        return typeof value === 'string' ? value : '';
      });
      const category = categorise(strings, nulls, length - nullCount);
      return category === undefined
        ? { ...base, type: 'text', values: strings }
        : { ...base, type: 'category', codes: category.codes, dictionary: category.dictionary };
    }
    case undefined:
      return { ...base, type: 'float', values: new Float64Array(length) };
  }
}

/** The columns for a set of attributes. */
function columnsOf(attributes: Attributes): KernelColumn[] {
  return Object.entries(attributes).map(([name, values]) => kernelColumn(name, values));
}

/** `{ columns }` for the attributes if there are any, to spread into a dataset. */
function columns(
  attributes: Attributes | undefined,
): { readonly columns: KernelColumn[] } | object {
  return attributes === undefined ? {} : { columns: columnsOf(attributes) };
}

/** `{ vertexColumns }` for the attributes if there are any, to spread into a dataset. */
function vertexColumns(
  attributes: Attributes | undefined,
): { readonly vertexColumns: KernelColumn[] } | object {
  return attributes === undefined ? {} : { vertexColumns: columnsOf(attributes) };
}

/** Elevations for a dataset that may be two-dimensional. */
function optionalZ(z: NumberList | undefined): { readonly z: Float64Array } | object {
  return z === undefined ? {} : { z: float64(z) };
}

/** Points: one element for each. */
export function points(data: PointsData): KernelPoints {
  return {
    kind: 'points',
    name: data.name,
    crs: data.crs,
    x: float64(data.x),
    y: float64(data.y),
    ...optionalZ(data.z),
    ...columns(data.attributes),
  };
}

/** Lines: one element for each. */
export function lines(data: LinesData): KernelLines {
  return {
    kind: 'lines',
    name: data.name,
    crs: data.crs,
    x: float64(data.x),
    y: float64(data.y),
    ...optionalZ(data.z),
    offsets: uint32(data.offsets, 'The offsets'),
    ...columns(data.attributes),
    ...vertexColumns(data.vertexAttributes),
  };
}

/** Polygons with holes: one element for each polygon. */
export function polygons(data: PolygonsData): KernelPolygons {
  return {
    kind: 'polygons',
    name: data.name,
    crs: data.crs,
    x: float64(data.x),
    y: float64(data.y),
    ...optionalZ(data.z),
    ringOffsets: uint32(data.ringOffsets, 'The ring offsets'),
    polygonOffsets: uint32(data.polygonOffsets, 'The polygon offsets'),
    ...columns(data.attributes),
  };
}

/** A triangle mesh: one element for each triangle. */
export function mesh(data: MeshData): KernelMesh {
  return {
    kind: 'mesh',
    name: data.name,
    crs: data.crs,
    x: float64(data.x),
    y: float64(data.y),
    z: float64(data.z),
    indices: uint32(data.indices, 'The triangle indices'),
    ...columns(data.attributes),
    ...vertexColumns(data.vertexAttributes),
  };
}

/** A regular grid: one element for each cell. */
export function grid(data: GridData): KernelGrid {
  return {
    kind: 'grid',
    name: data.name,
    crs: data.crs,
    origin: data.origin,
    spacing: data.spacing,
    dims: data.dims,
    ...(data.rotation === undefined ? {} : { rotation: data.rotation }),
    ...(typeof data.z === 'number' ? { elevation: data.z } : {}),
    ...(typeof data.z === 'string' ? { elevationColumn: data.z } : {}),
    ...columns(data.values),
  };
}

/** A block model: one element for each block. */
export function blocks(data: BlocksData): KernelBlocks {
  return {
    kind: 'blocks',
    name: data.name,
    crs: data.crs,
    origin: data.origin,
    spacing: data.spacing,
    dims: data.dims,
    ...(data.rotation === undefined ? {} : { rotation: data.rotation }),
    ...(data.ijk === undefined ? {} : { ijk: uint32(data.ijk, 'The block positions') }),
    ...columns(data.values),
  };
}
