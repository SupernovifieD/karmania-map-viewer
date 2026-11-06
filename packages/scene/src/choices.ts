/**
 * The values a field of the document can be, where the engine has the type and the scene has to check the
 * value at run time. The lists are written here so that the scene loads no engine code; the compiler checks
 * that each is a list of members of the engine's type, and `choices.test.ts` that it is all of them.
 */
import type { ClassMethod, FrameSource } from '@karmania/engine/display';
import type { ColumnType, Kind, Units } from '@karmania/engine/types';

/** How the map's coordinate system was chosen. */
export const FRAME_SOURCES = ['auto', 'user'] as const satisfies readonly FrameSource[];

/** The unit of a local grid. */
export const LOCAL_UNITS = ['m', 'ft', 'us_ft'] as const satisfies readonly Units[];

/** The ways to divide a column into classes. */
export const CLASS_METHODS = [
  'equal',
  'quantile',
  'jenks',
  'categories',
] as const satisfies readonly ClassMethod[];

/** The two kinds of coordinate reference system a frame can have. */
export const CRS_KINDS = ['epsg', 'local'] as const;

/** The shapes a dataset can have. */
export const DATASET_KINDS = [
  'points',
  'lines',
  'polygons',
  'mesh',
  'grid',
  'blocks',
] as const satisfies readonly Kind[];

/** The types a column can have. */
export const COLUMN_TYPES = [
  'float',
  'int',
  'bool',
  'text',
  'category',
] as const satisfies readonly ColumnType[];
