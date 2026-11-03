/**
 * Strict checks that what the kernel gives for display preparation has the shape of its public type:
 * the frame, the buffers and the classes. As the other checks of the engine, they reject keys that are
 * not in the type, so that a field added on the Rust side without a type fails a test and not a person.
 * Each returns the value with its type, or throws a `ContractError` that says where it is wrong.
 */
import {
  ContractError,
  checkedArray,
  checkedCount,
  checkedCrs,
  checkedFinding,
  checkedNumber,
  checkedObject,
  checkedOneOf,
  checkedString,
} from './contract-check.js';
import type { Finding } from './types.js';
import {
  CLASS_METHODS,
  DRAW_STATUSES,
  FRAME_SOURCES,
  type ClassBreaks,
  type ClassMethod,
  type ClassifyResult,
  type Frame,
  type FrameChoice,
  type GridTile,
  type PrepareResult,
  type RenderBuffers,
} from './display.js';

type TypedArrayConstructor<T> = new (...args: never[]) => T;

/** A typed array of the given kind (made in this realm, as the kernel's are). */
function checkedTyped<T>(value: unknown, kind: TypedArrayConstructor<T>, path: string): T {
  if (!(value instanceof kind)) {
    throw new ContractError(
      path,
      `expected a ${(kind as { name?: string }).name ?? 'typed array'}`,
    );
  }
  return value;
}

function checkedBool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ContractError(path, 'expected true or false');
  return value;
}

/** A list of exactly `n` finite numbers. */
function checkedNumbers(value: unknown, path: string, n: number): readonly number[] {
  const list = checkedArray(value, path);
  if (list.length !== n) throw new ContractError(path, `expected ${String(n)} numbers`);
  list.forEach((v, i) => checkedNumber(v, `${path}[${String(i)}]`));
  return list as readonly number[];
}

function checkedFindings(value: unknown, path: string): readonly Finding[] {
  return checkedArray(value, path).map((f, i) => checkedFinding(f, `${path}[${String(i)}]`));
}

export function checkedFrame(value: unknown, path = 'frame'): Frame {
  const o = checkedObject(value, path, ['mapCrs', 'origin', 'source']);
  checkedCrs(o['mapCrs'], `${path}.mapCrs`);
  checkedNumbers(o['origin'], `${path}.origin`, 3);
  checkedOneOf(o['source'], `${path}.source`, FRAME_SOURCES);
  return o as unknown as Frame;
}

export function checkedFrameChoice(value: unknown, path = 'frameChoice'): FrameChoice {
  const o = checkedObject(value, path, ['frame', 'drawable', 'findings']);
  if (o['frame'] !== null) checkedFrame(o['frame'], `${path}.frame`);
  checkedArray(o['drawable'], `${path}.drawable`).forEach((entry, i) => {
    const p = `${path}.drawable[${String(i)}]`;
    const e = checkedObject(entry, p, ['id', 'status', 'reprojected', 'findings']);
    checkedCount(e['id'], `${p}.id`);
    checkedOneOf(e['status'], `${p}.status`, DRAW_STATUSES);
    checkedBool(e['reprojected'], `${p}.reprojected`);
    checkedFindings(e['findings'], `${p}.findings`);
  });
  checkedFindings(o['findings'], `${path}.findings`);
  return o as unknown as FrameChoice;
}

function checkedTile(value: unknown, path: string): GridTile {
  const o = checkedObject(value, path, ['i0', 'j0', 'nx', 'ny']);
  for (const key of ['i0', 'j0', 'nx', 'ny']) checkedCount(o[key], `${path}.${key}`);
  return o as unknown as GridTile;
}

/** The buffers of a dataset: the keys of each kind, and the type of each array. */
export function checkedRenderBuffers(value: unknown, path = 'buffers'): RenderBuffers {
  const kind = checkedObject(
    value,
    path,
    ['kind'],
    [
      'positions',
      'segments',
      'segmentLine',
      'triangles',
      'trianglePolygon',
      'outline',
      'outlinePolygon',
      'size',
      'tiles',
      'placement',
      'warp',
      'triangleCell',
      'centres',
      'spacing',
      'rotation',
    ],
  )['kind'];
  const floats = (o: Record<string, unknown>, key: string) =>
    checkedTyped(o[key], Float32Array, `${path}.${key}`);
  const indices = (o: Record<string, unknown>, key: string) =>
    checkedTyped(o[key], Uint32Array, `${path}.${key}`);
  switch (kind) {
    case 'points': {
      const o = checkedObject(value, path, ['kind', 'positions']);
      floats(o, 'positions');
      return o as unknown as RenderBuffers;
    }
    case 'lines': {
      const o = checkedObject(value, path, ['kind', 'positions', 'segments', 'segmentLine']);
      floats(o, 'positions');
      const segments = indices(o, 'segments');
      if (segments.length !== indices(o, 'segmentLine').length * 2) {
        throw new ContractError(path, 'a line number for each segment');
      }
      return o as unknown as RenderBuffers;
    }
    case 'polygons': {
      const keys = [
        'kind',
        'positions',
        'triangles',
        'trianglePolygon',
        'outline',
        'outlinePolygon',
      ];
      const o = checkedObject(value, path, keys);
      floats(o, 'positions');
      if (indices(o, 'triangles').length !== indices(o, 'trianglePolygon').length * 3) {
        throw new ContractError(path, 'a polygon number for each triangle');
      }
      if (indices(o, 'outline').length !== indices(o, 'outlinePolygon').length * 2) {
        throw new ContractError(path, 'a polygon number for each outline segment');
      }
      return o as unknown as RenderBuffers;
    }
    case 'mesh': {
      const o = checkedObject(value, path, ['kind', 'positions', 'triangles']);
      floats(o, 'positions');
      indices(o, 'triangles');
      return o as unknown as RenderBuffers;
    }
    case 'grid': {
      const o = checkedObject(value, path, ['kind', 'size', 'tiles'], ['placement', 'warp']);
      checkedNumbers(o['size'], `${path}.size`, 2);
      checkedArray(o['tiles'], `${path}.tiles`).forEach((t, i) =>
        checkedTile(t, `${path}.tiles[${String(i)}]`),
      );
      if ('placement' in o === 'warp' in o) {
        throw new ContractError(path, 'a grid has a placement or a warp, not both and not neither');
      }
      if ('placement' in o) {
        const p = checkedObject(o['placement'], `${path}.placement`, [
          'origin',
          'spacing',
          'rotation',
        ]);
        checkedNumbers(p['origin'], `${path}.placement.origin`, 3);
        checkedNumbers(p['spacing'], `${path}.placement.spacing`, 2);
        checkedNumber(p['rotation'], `${path}.placement.rotation`);
      } else {
        const w = checkedObject(o['warp'], `${path}.warp`, [
          'positions',
          'uvs',
          'triangles',
          'tileTriangles',
        ]);
        const positions = checkedTyped(w['positions'], Float32Array, `${path}.warp.positions`);
        const uvs = checkedTyped(w['uvs'], Float32Array, `${path}.warp.uvs`);
        if (positions.length / 3 !== uvs.length / 2) {
          throw new ContractError(`${path}.warp`, 'a u and v for each vertex');
        }
        const triangles = checkedTyped(w['triangles'], Uint32Array, `${path}.warp.triangles`);
        const perTile = checkedTyped(w['tileTriangles'], Uint32Array, `${path}.warp.tileTriangles`);
        if (perTile.length !== (o['tiles'] as readonly unknown[]).length) {
          throw new ContractError(`${path}.warp`, 'a triangle count for each tile');
        }
        if (perTile.reduce((a, b) => a + b, 0) * 3 !== triangles.length) {
          throw new ContractError(`${path}.warp`, 'the tiles’ triangles add up to the triangles');
        }
      }
      return o as unknown as RenderBuffers;
    }
    case 'surface': {
      const o = checkedObject(value, path, ['kind', 'positions', 'triangles', 'triangleCell']);
      floats(o, 'positions');
      if (indices(o, 'triangles').length !== indices(o, 'triangleCell').length * 3) {
        throw new ContractError(path, 'a cell for each triangle');
      }
      return o as unknown as RenderBuffers;
    }
    case 'blocks': {
      const o = checkedObject(value, path, ['kind', 'centres', 'spacing', 'rotation']);
      if (floats(o, 'centres').length % 3 !== 0)
        throw new ContractError(path, 'x, y and z for each centre');
      checkedNumbers(o['spacing'], `${path}.spacing`, 3);
      checkedNumber(o['rotation'], `${path}.rotation`);
      return o as unknown as RenderBuffers;
    }
    default:
      throw new ContractError(
        `${path}.kind`,
        'expected points, lines, polygons, mesh, grid, surface or blocks',
      );
  }
}

export function checkedPrepareResult(value: unknown, path = 'prepareResult'): PrepareResult {
  const status = checkedObject(value, path, ['status'], ['buffers', 'findings'])['status'];
  if (status === 'drawn') {
    const o = checkedObject(value, path, ['status', 'buffers', 'findings']);
    checkedRenderBuffers(o['buffers'], `${path}.buffers`);
    checkedFindings(o['findings'], `${path}.findings`);
    return o as unknown as PrepareResult;
  }
  if (status === 'not_drawn') {
    const o = checkedObject(value, path, ['status', 'findings']);
    if (checkedFindings(o['findings'], `${path}.findings`).length === 0) {
      throw new ContractError(`${path}.findings`, 'a dataset that is not drawn has a reason');
    }
    return o as unknown as PrepareResult;
  }
  throw new ContractError(`${path}.status`, 'expected drawn or not_drawn');
}

/** The classes of a column: bounds that ascend, counts for each class, and the rows with no value. */
export function checkedClassBreaks(value: unknown, path = 'breaks'): ClassBreaks {
  const kind = checkedObject(
    value,
    path,
    ['kind'],
    ['column', 'bounds', 'values', 'counts', 'other', 'nulls', 'sampled'],
  )['kind'];
  if (kind === 'ranges') {
    const o = checkedObject(
      value,
      path,
      ['kind', 'column', 'bounds', 'counts', 'nulls'],
      ['sampled'],
    );
    checkedString(o['column'], `${path}.column`);
    const bounds = checkedArray(o['bounds'], `${path}.bounds`).map((b, i) =>
      checkedNumber(b, `${path}.bounds[${String(i)}]`),
    );
    if (bounds.length < 2)
      throw new ContractError(`${path}.bounds`, 'at least one class: two bounds');
    if (bounds.some((b, i) => i > 0 && b < (bounds[i - 1] ?? b))) {
      throw new ContractError(`${path}.bounds`, 'must not go down');
    }
    const counts = checkedArray(o['counts'], `${path}.counts`).map((c, i) =>
      checkedCount(c, `${path}.counts[${String(i)}]`),
    );
    if (counts.length !== bounds.length - 1)
      throw new ContractError(`${path}.counts`, 'one count for each class');
    checkedCount(o['nulls'], `${path}.nulls`);
    if ('sampled' in o) checkedCount(o['sampled'], `${path}.sampled`);
    return o as unknown as ClassBreaks;
  }
  if (kind === 'categories') {
    const o = checkedObject(
      value,
      path,
      ['kind', 'column', 'values', 'counts', 'nulls'],
      ['other'],
    );
    checkedString(o['column'], `${path}.column`);
    const values = checkedArray(o['values'], `${path}.values`);
    values.forEach((v, i) => {
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        throw new ContractError(
          `${path}.values[${String(i)}]`,
          'expected a string, a number or a boolean',
        );
      }
    });
    const counts = checkedArray(o['counts'], `${path}.counts`);
    if (counts.length !== values.length)
      throw new ContractError(`${path}.counts`, 'one count for each value');
    counts.forEach((c, i) => checkedCount(c, `${path}.counts[${String(i)}]`));
    if ('other' in o && checkedCount(o['other'], `${path}.other`) < 1) {
      throw new ContractError(`${path}.other`, 'is absent when there is none');
    }
    checkedCount(o['nulls'], `${path}.nulls`);
    return o as unknown as ClassBreaks;
  }
  throw new ContractError(`${path}.kind`, 'expected ranges or categories');
}

export function checkedClassifyResult(value: unknown, path = 'classifyResult'): ClassifyResult {
  const status = checkedObject(value, path, ['status'], ['breaks', 'findings'])['status'];
  if (status === 'classified') {
    const o = checkedObject(value, path, ['status', 'breaks']);
    checkedClassBreaks(o['breaks'], `${path}.breaks`);
    return o as unknown as ClassifyResult;
  }
  if (status === 'not_classified') {
    const o = checkedObject(value, path, ['status', 'findings']);
    if (checkedFindings(o['findings'], `${path}.findings`).length === 0) {
      throw new ContractError(`${path}.findings`, 'a column that is not classified has a reason');
    }
    return o as unknown as ClassifyResult;
  }
  throw new ContractError(`${path}.status`, 'expected classified or not_classified');
}

/** A method of dividing a column that is one of the four. */
export function checkedClassMethod(value: unknown, path = 'method'): ClassMethod {
  return checkedOneOf(value, path, CLASS_METHODS) as ClassMethod;
}

/** What a step of a prepare answered: progress, a result, or that the job is gone. */
export type CheckedPrepareStep =
  | { readonly status: 'progress'; readonly fraction: number }
  | { readonly status: 'done'; readonly result: PrepareResult }
  | { readonly status: 'cancelled' };

export function checkedPrepareStep(value: unknown, path = 'prepareStep'): CheckedPrepareStep {
  const status = checkedObject(value, path, ['status'], ['fraction', 'result'])['status'];
  if (status === 'progress') {
    const o = checkedObject(value, path, ['status', 'fraction']);
    const fraction = checkedNumber(o['fraction'], `${path}.fraction`);
    if (fraction < 0 || fraction > 1)
      throw new ContractError(`${path}.fraction`, 'expected 0 to 1');
    return { status: 'progress', fraction };
  }
  if (status === 'done') {
    const o = checkedObject(value, path, ['status', 'result']);
    return { status: 'done', result: checkedPrepareResult(o['result'], `${path}.result`) };
  }
  if (status === 'cancelled') {
    checkedObject(value, path, ['status']);
    return { status: 'cancelled' };
  }
  throw new ContractError(`${path}.status`, 'expected progress, done or cancelled');
}
