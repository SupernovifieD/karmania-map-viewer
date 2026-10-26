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
