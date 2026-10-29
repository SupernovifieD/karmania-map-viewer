import type { Delimiter, Format, Kind, Preview, PreviewGroup } from '@karmania/engine';

/**
 * The kinds of file the file picker offers first: the extensions the kernel reads (the `.prj` of a
 * data file goes with it), and `.txt`, which delimited text often has. The picker lets a person
 * choose any file all the same; what the kernel makes of it is for the wizard to say.
 */
export const IMPORT_FILE_ACCEPT = [
  '.csv',
  '.tsv',
  '.tab',
  '.txt',
  '.geojson',
  '.json',
  '.asc',
  '.obj',
  '.prj',
].join(',');

/** What the wizard knows about one file it was given: the files that go together, and what the kernel made of them. */
export interface FileEntry {
  /** The data file, and the sidecar files (a `.prj`) that describe it. */
  readonly group: PreviewGroup;
  readonly preview: Preview;
}

/**
 * Pairs the groups of files with their previews. The engine gives one preview for each group, in the
 * order of the groups, so the nth preview is the nth group's.
 */
export function entriesOf(
  groups: readonly PreviewGroup[],
  previews: readonly Preview[],
): readonly FileEntry[] {
  return groups.flatMap((group, index) => {
    const preview = previews[index];
    return preview === undefined ? [] : [{ group, preview }];
  });
}

/** Whether a file can be imported: it is a data file the kernel reads, and nothing about it stops that. */
export function isImportable(preview: Preview): boolean {
  return (
    preview.format !== undefined &&
    preview.format !== 'prj' &&
    !preview.findings.some((finding) => finding.severity === 'error')
  );
}

/** What each format is called in the wizard. */
const FORMAT_NAMES: Readonly<Record<Format, string>> = {
  csv: 'CSV',
  geojson: 'GeoJSON',
  ascii_grid: 'ESRI ASCII grid',
  obj: 'OBJ mesh',
  prj: 'Projection file',
};

/** What each delimiter is called in the wizard. */
const DELIMITER_NAMES: Readonly<Record<Delimiter, string>> = {
  comma: 'comma-separated',
  semicolon: 'semicolon-separated',
  tab: 'tab-separated',
  whitespace: 'space-separated',
};

/** What each kind is called in the wizard. */
export const KIND_NAMES: Readonly<Record<Kind, string>> = {
  points: 'Points',
  lines: 'Lines',
  polygons: 'Polygons',
  mesh: 'Mesh',
  grid: 'Grid',
  blocks: 'Block model',
};

/**
 * The kinds a format can be imported as. A CSV file can hold points, lines or a block model, and
 * which is for the person to say; the others are what they are (an ASCII grid is a grid, an OBJ file
 * a mesh), and GeoJSON has no choice to offer, since the shapes in it decide, and a file with
 * several kinds of shape gives a dataset for each.
 */
export const KINDS_BY_FORMAT: Readonly<Record<Format, readonly Kind[]>> = {
  csv: ['points', 'lines', 'blocks'],
  geojson: [],
  ascii_grid: ['grid'],
  obj: ['mesh'],
  prj: [],
};

/** How many, written for people: `1,203`, grouped by thousands with a comma. */
export function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

/**
 * What a file is, in a line: `CSV · UTF-8 · comma-separated · about 1,203 rows`. A file that cannot
 * be read has no such line.
 */
export function describeFile(preview: Preview): string | undefined {
  if (preview.format === undefined) {
    return undefined;
  }
  const parts: string[] = [FORMAT_NAMES[preview.format]];
  if (preview.encoding !== undefined) {
    parts.push(preview.encoding);
  }
  const table = preview.table;
  if (table !== undefined) {
    parts.push(DELIMITER_NAMES[table.delimiter]);
    parts.push(
      `about ${formatCount(table.estimatedRows)} ${table.estimatedRows === 1 ? 'row' : 'rows'}`,
    );
  }
  return parts.join(' · ');
}
