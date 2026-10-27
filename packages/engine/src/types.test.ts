/**
 * Tests of the types themselves. `expectTypeOf` and `@ts-expect-error` are checked by
 * `tsc` (the `typecheck` script), not at run time; the `switch` functions are
 * exhaustive for the compiler and are run over every member of the matching constant
 * list, so a member missing from either one fails.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { assertNever } from './exhaustive.js';
import type {
  AttributeColumn,
  BlocksData,
  DatasetInput,
  GridData,
  LinesData,
  MeshData,
  NumberList,
  PointsData,
  PolygonsData,
} from './inputs.js';
import {
  COLUMN_TYPES,
  CRS_SOURCES,
  DELIMITERS,
  FORMATS,
  KINDS,
  PHASES,
  ROLES,
  SEVERITIES,
  WIZARD_STEPS,
} from './types.js';
import type {
  ColumnMapping,
  ColumnSummary,
  ColumnType,
  CrsRef,
  CrsSource,
  Delimiter,
  Finding,
  Format,
  ImportMapping,
  ImportStatus,
  Kind,
  KernelColumn,
  LoadResult,
  Phase,
  Preview,
  Role,
  Severity,
  Units,
  WizardStep,
} from './types.js';

/** Each function handles every member of its union, or it does not compile. */
const handled = {
  severity: (v: Severity): string => {
    switch (v) {
      case 'error':
      case 'warning':
      case 'info':
        return v;
      default:
        return assertNever(v);
    }
  },
  step: (v: WizardStep): string => {
    switch (v) {
      case 'file':
      case 'mapping':
      case 'nodata':
      case 'crs':
        return v;
      default:
        return assertNever(v);
    }
  },
  kind: (v: Kind): string => {
    switch (v) {
      case 'points':
      case 'lines':
      case 'polygons':
      case 'mesh':
      case 'grid':
      case 'blocks':
        return v;
      default:
        return assertNever(v);
    }
  },
  format: (v: Format): string => {
    switch (v) {
      case 'csv':
      case 'geojson':
      case 'ascii_grid':
      case 'obj':
      case 'prj':
        return v;
      default:
        return assertNever(v);
    }
  },
  delimiter: (v: Delimiter): string => {
    switch (v) {
      case 'comma':
      case 'semicolon':
      case 'tab':
      case 'whitespace':
        return v;
      default:
        return assertNever(v);
    }
  },
  columnType: (v: ColumnType): string => {
    switch (v) {
      case 'float':
      case 'int':
      case 'bool':
      case 'text':
      case 'category':
        return v;
      default:
        return assertNever(v);
    }
  },
  role: (v: Role): string => {
    switch (v) {
      case 'x':
      case 'y':
      case 'z':
      case 'line_id':
      case 'attribute':
      case 'ignore':
        return v;
      default:
        return assertNever(v);
    }
  },
  crsSource: (v: CrsSource): string => {
    switch (v) {
      case 'prj_file':
      case 'geojson_default':
      case 'geojson_crs_member':
        return v;
      default:
        return assertNever(v);
    }
  },
  phase: (v: Phase): string => {
    switch (v) {
      case 'parsing':
      case 'validating':
        return v;
      default:
        return assertNever(v);
    }
  },
};

describe('the unions are exhaustive', () => {
  it('handles every member of every list of constants, and no others', () => {
    const lists: [readonly string[], (v: never) => string][] = [
      [SEVERITIES, handled.severity],
      [WIZARD_STEPS, handled.step],
      [KINDS, handled.kind],
      [FORMATS, handled.format],
      [DELIMITERS, handled.delimiter],
      [COLUMN_TYPES, handled.columnType],
      [ROLES, handled.role],
      [CRS_SOURCES, handled.crsSource],
      [PHASES, handled.phase],
    ];
    for (const [list, handle] of lists) {
      expect(list.map((member) => handle(member as never))).toEqual(list);
    }
  });

  it('discriminates the unions that carry data', () => {
    const crs = (v: CrsRef): string => {
      switch (v.kind) {
        case 'epsg':
          return `EPSG:${String(v.code)}`;
        case 'local':
          return v.units;
        default:
          return assertNever(v);
      }
    };
    const loaded = (v: LoadResult): number => {
      switch (v.status) {
        case 'loaded':
          return v.summaries.length;
        case 'blocked':
          return v.findings.length;
        default:
          return assertNever(v);
      }
    };
    const step = (v: ImportStatus): string => {
      switch (v.status) {
        case 'progress':
          return v.phase;
        case 'done':
          return v.result.status;
        default:
          return assertNever(v);
      }
    };
    const input = (v: DatasetInput): Kind => {
      switch (v.kind) {
        case 'points':
        case 'lines':
        case 'polygons':
        case 'mesh':
        case 'grid':
        case 'blocks':
          return v.kind;
        default:
          return assertNever(v);
      }
    };
    expect(crs({ kind: 'epsg', code: 32640 })).toBe('EPSG:32640');
    expect(crs({ kind: 'local', units: 'ft' })).toBe('ft');
    expect(loaded({ status: 'blocked', findings: [] })).toBe(0);
    expect(step({ status: 'progress', phase: 'parsing', fraction: 0.5 })).toBe('parsing');
    expect(input({ kind: 'mesh' } as DatasetInput)).toBe('mesh');
  });
});

describe('related unions agree with each other', () => {
  it('uses the same lists wherever a list is repeated', () => {
    expectTypeOf<DatasetInput['kind']>().toEqualTypeOf<Kind>();
    expectTypeOf<ImportMapping['kind']>().toEqualTypeOf<Kind>();
    expectTypeOf<NonNullable<Preview['suggestedKind']>>().toEqualTypeOf<Kind>();
    expectTypeOf<ColumnMapping['role']>().toEqualTypeOf<Role>();
    expectTypeOf<ColumnMapping['type']>().toEqualTypeOf<ColumnType | undefined>();
    expectTypeOf<ColumnSummary['type']>().toEqualTypeOf<ColumnType>();
    expectTypeOf<KernelColumn['type']>().toEqualTypeOf<ColumnType>();
    expectTypeOf<Finding['severity']>().toEqualTypeOf<Severity>();
    expectTypeOf<NonNullable<Finding['step']>>().toEqualTypeOf<WizardStep>();
    expectTypeOf<Extract<CrsRef, { kind: 'local' }>['units']>().toEqualTypeOf<Units>();
    // A kernel result is the status or the findings, never both.
    expectTypeOf<Extract<LoadResult, { status: 'blocked' }>>().not.toHaveProperty('summaries');
  });
});

describe('the builder arguments', () => {
  it('take plain arrays or typed arrays, and attribute columns by name', () => {
    const plain: PointsData = { name: 'p', x: [1, 2], y: [3, 4], crs: null };
    const typed: PointsData = {
      name: 'p',
      x: new Float64Array(2),
      y: new Float64Array(2),
      z: [5, 6],
      attributes: {
        grade: [1.5, null],
        rock: ['a', 'b'],
        ok: [true, false],
        raw: new Uint8Array(2),
      },
      crs: { kind: 'epsg', code: 32640 },
    };
    expect([plain.x.length, typed.x.length]).toEqual([2, 2]);
    expectTypeOf<NumberList>().toEqualTypeOf<readonly number[] | Float64Array>();
    expectTypeOf<Uint8Array>().toExtend<AttributeColumn>();
  });

  it('are strict about what they accept', () => {
    const wrongArray: PointsData = {
      name: 'p',
      // @ts-expect-error an Int32Array is not a list of coordinates
      x: new Int32Array(1),
      y: [1],
      crs: null,
    };
    const wrongValue: PointsData = {
      name: 'p',
      x: [1],
      y: [1],
      // @ts-expect-error an attribute value is a number, text, a boolean or null
      attributes: { a: [{}] },
      crs: null,
    };
    // @ts-expect-error a mesh is three-dimensional
    const flatMesh: MeshData = { name: 'm', x: [], y: [], indices: [], crs: null };
    // @ts-expect-error the coordinate system is required, even if it is null
    const noCrs: LinesData = { name: 'l', x: [], y: [], offsets: [0] };
    expect([wrongArray, wrongValue, flatMesh, noCrs]).toHaveLength(4);
  });

  it('describe each shape', () => {
    expectTypeOf<PolygonsData>().toHaveProperty('ringOffsets');
    expectTypeOf<PolygonsData>().toHaveProperty('polygonOffsets');
    expectTypeOf<GridData['z']>().toEqualTypeOf<number | string | undefined>();
    expectTypeOf<BlocksData['ijk']>().toEqualTypeOf<readonly number[] | Uint32Array | undefined>();
    expectTypeOf<GridData>().toHaveProperty('values');
  });
});
