import type {
  ColumnMapping,
  Finding,
  ImportMapping,
  ImportPhase,
  Kind,
  Summary,
} from '@karmania/engine';
import { crsOf } from './import-crs.js';
import type { ImportDraft } from './import-draft.js';
import type { FileEntry } from './import-files.js';
import { blockSizeOf, effectiveName } from './import-mapping.js';
import { nodataOf } from './import-nodata.js';

/**
 * The mapping the kernel is given, from what a person decided. A file with no choice of kind
 * (GeoJSON) has none in the draft, and the kernel ignores the kind of such a file, so `points`
 * stands in. A name is only given to an attribute, and only when one was typed.
 */
export function buildMapping(draft: ImportDraft, entry: FileEntry): ImportMapping {
  const kind: Kind = draft.kind ?? 'points';
  const columns: ColumnMapping[] = draft.columns.map((column) => ({
    source: column.source,
    role: column.role,
    ...(column.type === undefined ? {} : { type: column.type }),
    ...(column.role === 'attribute' && column.rename.trim() !== ''
      ? { rename: effectiveName(column) }
      : {}),
  }));
  const blockSize = kind === 'blocks' ? blockSizeOf(draft.blockSize) : undefined;
  return {
    datasetName: draft.datasetName.trim(),
    kind,
    columns,
    nodata: nodataOf(draft.nodata),
    emptyCoordinates: draft.emptyCoordinates,
    ...(blockSize === undefined ? {} : { blockSize }),
    decimalSeparator: draft.decimalSeparator,
    crs: crsOf(draft.crs, entry.preview.crs),
  };
}

/** What the import has come to. */
export type RunState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'running';
      readonly phase: ImportPhase | undefined;
      readonly fraction: number | undefined;
    }
  | {
      readonly status: 'loaded';
      readonly summaries: readonly Summary[];
      readonly findings: readonly Finding[];
    }
  | { readonly status: 'blocked'; readonly findings: readonly Finding[] }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string };

/** The state before anything has been run. */
export const IDLE: RunState = { status: 'idle' };

/** What each stage of an import is called while it goes on. */
export const PHASE_LABELS: Readonly<Record<ImportPhase, string>> = {
  reading: 'Reading the file',
  parsing: 'Reading the values',
  validating: 'Checking the data',
};

/** Findings by how serious they are, each finding once. */
export interface FindingGroups {
  readonly errors: readonly Finding[];
  readonly warnings: readonly Finding[];
  readonly notes: readonly Finding[];
}

/**
 * Sorts findings into errors, warnings and notes, in the order they came, and drops one that is the
 * same as one before it (a file that gives several datasets gives each the findings about the file).
 */
export function groupFindings(findings: readonly Finding[]): FindingGroups {
  const seen = new Set<string>();
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const notes: Finding[] = [];
  for (const finding of findings) {
    const key = `${finding.code}\n${finding.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    (finding.severity === 'error'
      ? errors
      : finding.severity === 'warning'
        ? warnings
        : notes
    ).push(finding);
  }
  return { errors, warnings, notes };
}

/** What `Load` says: plain, or with how many warnings there are, if there are any. */
export function loadLabel(warnings: number): string {
  return warnings === 0
    ? 'Load'
    : `Load with ${String(warnings)} ${warnings === 1 ? 'warning' : 'warnings'}`;
}

/** Why a person cannot load, in words, or `undefined` if they can. */
export function loadBlocker(run: RunState): string | undefined {
  switch (run.status) {
    case 'idle':
    case 'running':
      return 'Importing…';
    case 'blocked': {
      const errors = groupFindings(run.findings).errors.length;
      return `${String(errors)} ${errors === 1 ? 'error' : 'errors'} to fix before anything can be loaded.`;
    }
    case 'cancelled':
      return 'The import was cancelled, so nothing is loaded.';
    case 'failed':
      return 'The import could not be done, so nothing is loaded.';
    case 'loaded':
      return undefined;
  }
}
