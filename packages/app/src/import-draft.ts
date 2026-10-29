import type { Kind } from '@karmania/engine';
import { KINDS_BY_FORMAT } from './import-files.js';
import type { FileEntry } from './import-files.js';
import { columnsFromPreview, EMPTY_BLOCK_SIZE, withKind } from './import-mapping.js';
import type { BlockSizeDraft, ColumnDraft } from './import-mapping.js';

/**
 * What a person has decided about the file being imported, step by step. It starts as what the kernel
 * suggested, and each step of the wizard edits its own part.
 */
export interface ImportDraft {
  /** The name of the dataset: the file's name without its extension, to begin with. */
  readonly datasetName: string;
  /** What to import the file as; `undefined` for a format with no choice (GeoJSON). */
  readonly kind: Kind | undefined;
  /** What each column of the file is for, in the file's order; none for a file without columns. */
  readonly columns: readonly ColumnDraft[];
  /** The size of a block, for a block model; as typed. */
  readonly blockSize: BlockSizeDraft;
}

/** A file's name without its extension: `collars.csv` is `collars`, `a.b.csv` is `a.b`. */
export function fileStem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The draft for a file, from what the kernel found in it. */
export function draftFor(entry: FileEntry): ImportDraft {
  const { format, suggestedKind } = entry.preview;
  const offered = format === undefined ? [] : KINDS_BY_FORMAT[format];
  const kind =
    suggestedKind !== undefined && offered.includes(suggestedKind) ? suggestedKind : offered[0];
  const table = entry.preview.table;
  return {
    datasetName: fileStem(entry.preview.fileName),
    kind,
    columns: table === undefined ? [] : columnsFromPreview(table, kind),
    blockSize: EMPTY_BLOCK_SIZE,
  };
}

/**
 * The draft after a person changed some of it. What is changed along with it is kept in step: when
 * the kind changes, a column whose role the new kind has not becomes an attribute.
 */
export function applyDraftChange(draft: ImportDraft, change: Partial<ImportDraft>): ImportDraft {
  const changed = { ...draft, ...change };
  return change.kind !== undefined && change.kind !== draft.kind && change.columns === undefined
    ? { ...changed, columns: withKind(changed.columns, change.kind) }
    : changed;
}
