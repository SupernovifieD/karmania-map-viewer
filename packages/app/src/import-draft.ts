import type { Kind } from '@karmania/engine';
import { KINDS_BY_FORMAT } from './import-files.js';
import type { FileEntry } from './import-files.js';

/**
 * What a person has decided about the file being imported, step by step. It starts as what the kernel
 * suggested, and each step of the wizard edits its own part.
 */
export interface ImportDraft {
  /** The name of the dataset: the file's name without its extension, to begin with. */
  readonly datasetName: string;
  /** What to import the file as; `undefined` for a format with no choice (GeoJSON). */
  readonly kind: Kind | undefined;
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
  return { datasetName: fileStem(entry.preview.fileName), kind };
}
