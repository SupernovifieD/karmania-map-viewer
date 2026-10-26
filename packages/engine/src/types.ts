/**
 * Types for the data the kernel sends to JavaScript.
 *
 * They mirror the Rust types in `karmania-core` exactly: a field is optional here
 * when Rust leaves it out of the JSON, never when it is `undefined`. The test in
 * `contract.test.ts` checks real Rust output against them.
 */

/** Every severity, most serious first. */
export const SEVERITIES = ['error', 'warning', 'info'] as const;

/** How serious a finding is. Errors block loading; warnings and info do not. */
export type Severity = (typeof SEVERITIES)[number];

/** Every wizard step, in the order the user sees them. */
export const WIZARD_STEPS = ['file', 'mapping', 'nodata', 'crs'] as const;

/** The import wizard step where the user can fix a finding. */
export type WizardStep = (typeof WIZARD_STEPS)[number];

/**
 * Where something was found. Every number is 0-based except `line`, which is the
 * 1-based line in the source file (the header is line 1), as a text editor shows it.
 */
export interface Location {
  readonly line?: number;
  readonly row?: number;
  readonly element?: number;
  readonly vertex?: number;
  readonly column?: string;
  /** The `[i, j, k]` of a grid or block-model cell. */
  readonly cell?: readonly [number, number, number];
}

/** One kind of problem, with how often it happened and where. */
export interface Finding {
  /** A stable, dotted, lowercase code such as `crs.missing`. */
  readonly code: string;
  readonly severity: Severity;
  /** Plain language: what is wrong and where. */
  readonly message: string;
  /** What the user can do about it. */
  readonly hint?: string;
  /** How many times it happened (at least 1); repeats are counted, not repeated. */
  readonly count: number;
  /** At most 20 places, in order of occurrence. */
  readonly examples: readonly Location[];
  readonly step?: WizardStep;
}

/** The groups of checks, in the order they run. */
export const CHECK_GROUPS = ['structure', 'values', 'crs'] as const;

/** The findings of one group of related checks. */
export interface CheckGroup {
  readonly name: (typeof CHECK_GROUPS)[number];
  readonly findings: readonly Finding[];
}

/** What validating a dataset found: always the three groups, in this order. */
export interface ValidationReport {
  readonly groups: readonly CheckGroup[];
}

/** Every shape of dataset. */
export const KINDS = ['points', 'lines', 'polygons', 'mesh', 'grid', 'blocks'] as const;

/** The shape of a dataset. */
export type Kind = (typeof KINDS)[number];

/** Every file format the kernel can read. */
export const FORMATS = ['csv', 'geojson', 'ascii_grid', 'obj', 'prj'] as const;

/** A file format the kernel can read. */
export type Format = (typeof FORMATS)[number];

/** Every delimiter a text file can be split by. */
export const DELIMITERS = ['comma', 'semicolon', 'tab', 'whitespace'] as const;

/** What separates the fields of a row in a delimited text file. */
export type Delimiter = (typeof DELIMITERS)[number];

/** How decimal numbers are written. */
export type DecimalSeparator = '.' | ',';

/** Every column type. */
export const COLUMN_TYPES = ['float', 'int', 'bool', 'text', 'category'] as const;

/** The type of the values in a column. */
export type ColumnType = (typeof COLUMN_TYPES)[number];

/** Every role a column can have in an import. */
export const ROLES = ['x', 'y', 'z', 'line_id', 'attribute', 'ignore'] as const;

/** What a column is used for in an import. */
export type Role = (typeof ROLES)[number];

/** The unit of a local grid: metres, international feet or US survey feet. */
export type Units = 'm' | 'ft' | 'us_ft';

/** A coordinate reference system: an EPSG code, or a local grid with its unit. */
export type CrsRef =
  | { readonly kind: 'epsg'; readonly code: number }
  | { readonly kind: 'local'; readonly units: Units };

/** Every place a detected coordinate system can come from. */
export const CRS_SOURCES = ['prj_file', 'geojson_default', 'geojson_crs_member'] as const;

/** Where a detected coordinate system came from. */
export type CrsSource = (typeof CRS_SOURCES)[number];

/** A coordinate system found in or beside a file, and where it came from. */
export interface DetectedCrs {
  readonly crs: CrsRef;
  readonly source: CrsSource;
}

/** A suggested role for a column, and how sure the guess is, from 0 to 1. */
export interface RoleSuggestion {
  readonly role: Role;
  readonly confidence: number;
}

/** Values that look like "no data" and how often each appears in the sample. */
export interface NodataSuggestions {
  readonly tokens: readonly { readonly token: string; readonly count: number }[];
  readonly numbers: readonly { readonly value: number; readonly count: number }[];
}

/** What a delimited text file looks like. */
export interface TablePreview {
  readonly delimiter: Delimiter;
  readonly hasHeader: boolean;
  /** Column names; `Column 1`, `Column 2`, ... when the file has no header row. */
  readonly header: readonly string[];
  /** The first 200 data rows, as written in the file. */
  readonly rows: readonly (readonly string[])[];
  /** About how many data rows there are, counted by lines. */
  readonly estimatedRows: number;
  readonly decimalSeparator: DecimalSeparator;
  /** One suggested type per column. */
  readonly columnTypes: readonly ColumnType[];
  /** One suggested role per column. */
  readonly roles: readonly RoleSuggestion[];
  readonly nodata: NodataSuggestions;
}

/** What a file is and how to import it, found without importing it. */
export interface Preview {
  readonly fileName: string;
  /** Absent if the file cannot be read; a finding says why. */
  readonly format?: Format;
  /** The kind of dataset the file probably holds, where that can be told. */
  readonly suggestedKind?: Kind;
  /** `UTF-8`, `UTF-16 LE`, `UTF-16 BE` or `Windows-1252`. */
  readonly encoding?: string;
  /** Present for delimited text only. */
  readonly table?: TablePreview;
  readonly crs?: DetectedCrs;
  readonly findings: readonly Finding[];
}

/** A box around a dataset, in its coordinate system's units, Z up. */
export interface BBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** An attribute column, described without its values. */
export interface ColumnSummary {
  readonly name: string;
  readonly type: ColumnType;
  readonly nullCount: number;
}

/** What a loaded dataset is, without its data. */
export interface Summary {
  readonly id: number;
  readonly name: string;
  readonly kind: Kind;
  /** Points, lines, polygons, triangles, cells or blocks: one attribute row each. */
  readonly elementCount: number;
  /** For lines, polygons and meshes. */
  readonly vertexCount?: number;
  readonly crs?: CrsRef;
  readonly hasZ: boolean;
  readonly bbox?: BBox;
  readonly columns: readonly ColumnSummary[];
  /** Warnings and info about the dataset; errors would have stopped it loading. */
  readonly findings: readonly Finding[];
}

/** What loading datasets came to: they are all loaded, or none is. */
export type LoadResult =
  | { readonly status: 'loaded'; readonly summaries: readonly Summary[] }
  | { readonly status: 'blocked'; readonly findings: readonly Finding[] };

/** The stages of an import the kernel works through. */
export const PHASES = ['parsing', 'validating'] as const;

/** A stage of an import. Reading the file from disk comes before these and is the caller's. */
export type Phase = (typeof PHASES)[number];

/** What one step of an import did. */
export type ImportStatus =
  | { readonly status: 'progress'; readonly phase: Phase; readonly fraction: number }
  | { readonly status: 'done'; readonly result: LoadResult };

/** How one column of a file is imported. */
export interface ColumnMapping {
  /** The column's name in the file. */
  readonly source: string;
  readonly role: Role;
  /** Overrides the guessed type. */
  readonly type?: ColumnType;
  /** The name the column gets in the dataset. */
  readonly rename?: string;
}

/** Everything the kernel needs to know about how to import a file. */
export interface ImportMapping {
  readonly datasetName: string;
  readonly kind: Kind;
  readonly columns: readonly ColumnMapping[];
  /** Which values mean "no data". */
  readonly nodata: {
    readonly tokens: readonly string[];
    readonly numbers: readonly number[];
  };
  /** What to do with rows that have an empty coordinate. */
  readonly emptyCoordinates: 'error' | 'skip';
  /** The size of a block along X, Y and Z, for block models. */
  readonly blockSize?: readonly [number, number, number];
  readonly decimalSeparator: DecimalSeparator;
  /** The coordinate system, or `null` if none has been chosen. */
  readonly crs: CrsRef | null;
}
