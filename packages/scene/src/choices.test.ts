import type { ClassMethod, FrameSource } from '@karmania/engine/display';
import type { ColumnType, CrsRef, Kind, Units } from '@karmania/engine/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CLASS_METHODS,
  COLUMN_TYPES,
  CRS_KINDS,
  DATASET_KINDS,
  FRAME_SOURCES,
  LOCAL_UNITS,
} from './choices.js';

describe('the choices the scene checks at run time', () => {
  it('are every member of the engine`s types, no more and no fewer', () => {
    expectTypeOf<(typeof FRAME_SOURCES)[number]>().toEqualTypeOf<FrameSource>();
    expectTypeOf<(typeof LOCAL_UNITS)[number]>().toEqualTypeOf<Units>();
    expectTypeOf<(typeof CLASS_METHODS)[number]>().toEqualTypeOf<ClassMethod>();
    expectTypeOf<(typeof CRS_KINDS)[number]>().toEqualTypeOf<CrsRef['kind']>();
    expectTypeOf<(typeof DATASET_KINDS)[number]>().toEqualTypeOf<Kind>();
    expectTypeOf<(typeof COLUMN_TYPES)[number]>().toEqualTypeOf<ColumnType>();
    expect([
      FRAME_SOURCES.length,
      LOCAL_UNITS.length,
      CLASS_METHODS.length,
      CRS_KINDS.length,
      DATASET_KINDS.length,
      COLUMN_TYPES.length,
    ]).toEqual([2, 3, 4, 2, 6, 5]);
  });
});
