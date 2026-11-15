import type { CrsInfo, Engine, Summary } from '@karmania/engine';
import { describeInfo, describeUnits } from './import-crs.js';

/** Gets rows of a loaded dataset, as the engine's `rows` does. */
export type RowSource = Engine['rows'];

/** Says what an EPSG code means, as the engine's `crsInfo` does. */
export type CrsLookup = Engine['crsInfo'];

/** How many of a dataset's findings are warnings. (Errors would have stopped it loading; notes are not warned of.) */
export function warningCount(summary: Summary): number {
  return summary.findings.filter((finding) => finding.severity === 'warning').length;
}

/** `1 warning`, `3 warnings`. */
export function describeWarnings(count: number): string {
  return `${String(count)} ${count === 1 ? 'warning' : 'warnings'}`;
}

/**
 * The datasets in the order the Data tab lists them (brief 10.4): those that are not made from another, in the order they were loaded,
 * each followed directly by the datasets made from it (and from those), in the order they were loaded. A dataset whose source is not
 * in the list (it should not happen) is listed with the others, so that none is lost.
 */
export function listedDatasets(datasets: readonly Summary[]): readonly Summary[] {
  const loaded = new Set(datasets.map((dataset) => dataset.id));
  const made = (source: number): Summary[] =>
    datasets.flatMap((dataset) =>
      dataset.derivedFrom?.id === source ? [dataset, ...made(dataset.id)] : [],
    );
  return datasets
    .filter((dataset) => dataset.derivedFrom === undefined || !loaded.has(dataset.derivedFrom.id))
    .flatMap((dataset) => [dataset, ...made(dataset.id)]);
}

/** The datasets that removing `id` removes with it: those made from it, and from those, in the order they are listed. */
export function madeFrom(datasets: readonly Summary[], id: number): readonly Summary[] {
  const listed = listedDatasets(datasets);
  const at = listed.findIndex((dataset) => dataset.id === id);
  if (at < 0) {
    return [];
  }
  const gone = new Set([id]);
  const found: Summary[] = [];
  for (const dataset of listed.slice(at + 1)) {
    if (dataset.derivedFrom !== undefined && gone.has(dataset.derivedFrom.id)) {
      gone.add(dataset.id);
      found.push(dataset);
    }
  }
  return found;
}

/**
 * The dataset to select once `removed` is gone, and what was made from it: the one listed after them, or if they were last the one
 * listed before, or none when nothing is left. Only a selection that goes needs another.
 */
export function selectionAfterRemoving(
  datasets: readonly Summary[],
  removed: number,
  selected: number | undefined,
): number | undefined {
  const gone = new Set([removed, ...madeFrom(datasets, removed).map((dataset) => dataset.id)]);
  if (selected === undefined || !gone.has(selected)) {
    return selected;
  }
  const listed = listedDatasets(datasets);
  const first = listed.findIndex((dataset) => gone.has(dataset.id));
  const last = listed.reduce((at, dataset, i) => (gone.has(dataset.id) ? i : at), -1);
  const neighbour = listed[last + 1] ?? listed[first - 1];
  return neighbour?.id;
}

/**
 * The dataset to select once `removed` (and what was made from it) is gone from `before`, which left `after`, when `selected` is what is selected
 * now (the removal is waited for, and what is selected can change meanwhile: contour lines made again, or another dataset chosen): the selection
 * is left alone if it is still there, and if not it is as `selectionAfterRemoving` says, or the first dataset listed when that one is gone too.
 */
export function selectionAfterRemoved(
  before: readonly Summary[],
  after: readonly Summary[],
  removed: number,
  selected: number | undefined,
): number | undefined {
  if (selected === undefined || after.some((dataset) => dataset.id === selected)) {
    return selected;
  }
  const next = selectionAfterRemoving(before, removed, selected);
  return next !== undefined && after.some((dataset) => dataset.id === next)
    ? next
    : listedDatasets(after)[0]?.id;
}

/**
 * The dataset to select when the engine's datasets changed from `before` to `after` (contour lines were made again, or taken away): the one that was
 * selected if it is still there; otherwise, for lines that were replaced, the lines that replaced them (made from the same dataset), or the dataset they
 * were made from if the lines are gone; otherwise the first dataset listed, or none.
 */
export function selectionAfterChange(
  before: readonly Summary[],
  after: readonly Summary[],
  selected: number | undefined,
): number | undefined {
  if (selected === undefined || after.some((dataset) => dataset.id === selected)) {
    return selected;
  }
  const source = before.find((dataset) => dataset.id === selected)?.derivedFrom?.id;
  if (source !== undefined) {
    const lines = after.find((dataset) => dataset.derivedFrom?.id === source);
    if (lines !== undefined) {
      return lines.id;
    }
    if (after.some((dataset) => dataset.id === source)) {
      return source;
    }
  }
  return listedDatasets(after)[0]?.id;
}

/** The coordinate system of a dataset in a few words: `EPSG 32640`, or `Local grid, metres`. */
export function crsLabel(crs: Summary['crs']): string {
  if (crs === undefined) {
    return 'Not set';
  }
  if (crs.kind === 'epsg') {
    return `EPSG ${String(crs.code)}`;
  }
  const units = { m: 'metres', ft: 'feet', us_ft: 'US survey feet' }[crs.units];
  return `Local grid, ${units}`;
}

/**
 * The coordinate system of a dataset with its name and unit, for the summary: `EPSG 32640, WGS 84 / UTM zone
 * 40N, metres`. `info` is what the definitions say of the code: the system, `null` if the code is not in
 * them, `undefined` if nobody has asked, or if the system is a local grid, which they know nothing of; then
 * it is `crsLabel`.
 */
export function crsLabelNamed(crs: Summary['crs'], info: CrsInfo | null | undefined): string {
  if (crs?.kind !== 'epsg' || info === undefined) {
    return crsLabel(crs);
  }
  return info === null
    ? `EPSG ${String(crs.code)}, not one Karmania knows`
    : `EPSG ${String(crs.code)}, ${info.name}, ${describeUnits(info.units)}`;
}

/** What the tooltip of that label says: the same, with what kind of system it is. */
export function crsTitleNamed(crs: Summary['crs'], info: CrsInfo | null | undefined): string {
  if (crs?.kind !== 'epsg' || info === undefined) {
    return crsLabel(crs);
  }
  return info === null
    ? `EPSG ${String(crs.code)} is not one of the coordinate systems Karmania knows`
    : `EPSG ${String(crs.code)}, ${describeInfo(info)}`;
}

/** The most decimals a coordinate is shown with; the whole of it is in the title. */
const DECIMALS = 6;

/** A coordinate as shown: up to six decimals, with no zeros at the end and no `-0`. */
export function formatCoordinate(value: number): string {
  const rounded = Number(value.toFixed(DECIMALS));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** One side of a dataset's box, for a line of the summary. */
export interface ExtentRow {
  readonly axis: 'X' | 'Y' | 'Z';
  /** `500010.5 to 500185.5`. */
  readonly text: string;
  /** The same with every digit, for a tooltip. */
  readonly full: string;
}

/** The box round a dataset, a row for each axis it has: X and Y, and Z if it has heights. */
export function extentRows(summary: Summary): readonly ExtentRow[] {
  const { bbox } = summary;
  if (bbox === undefined) {
    return [];
  }
  const axes = ['X', 'Y', 'Z'] as const;
  return axes.slice(0, summary.hasZ ? 3 : 2).map((axis, index) => {
    const [low, high] = [bbox.min[index] ?? 0, bbox.max[index] ?? 0];
    return {
      axis,
      text: `${formatCoordinate(low)} to ${formatCoordinate(high)}`,
      full: `${String(low)} to ${String(high)}`,
    };
  });
}

/** One line of what a derived dataset says of how it was made: a label and a text. */
export interface DerivedRow {
  readonly label: string;
  readonly text: string;
}

/**
 * What the summary of a derived dataset says of how it was made (brief 10.4: "the summary shows the parameters"): which dataset it came
 * from, the interval and the base of the lines, how often there is an index line, and the column of a grid. Nothing for a dataset that is
 * not derived. `sourceName` is the name of the dataset it was made from, if that is loaded.
 */
export function derivedRows(
  summary: Summary,
  sourceName: string | undefined,
): readonly DerivedRow[] {
  const from = summary.derivedFrom;
  if (from === undefined) {
    return [];
  }
  const { params } = from;
  return [
    { label: 'Made from', text: sourceName ?? `dataset ${String(from.id)}` },
    {
      label: 'Contours',
      text: `every ${contoursNumber(params.interval)}, counted from ${contoursNumber(params.base)}`,
    },
    {
      label: 'Index lines',
      text: params.indexEvery === 1 ? 'every line' : `every ${ordinal(params.indexEvery)} line`,
    },
    ...(params.column === undefined ? [] : [{ label: 'Column', text: params.column }]),
  ];
}

/**
 * A number of the settings of contours as it is said: the digits that mean something (the interval of 0.0000001 is that, and not 0, as
 * `formatCoordinate` would say), without the noise of a sum of floats (0.30000000000000004 is 0.3).
 */
function contoursNumber(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/** `2nd`, `5th`, `11th`, `21st`: the number as a person says it of lines. */
function ordinal(n: number): string {
  const tail = n % 100;
  const suffix =
    tail >= 11 && tail <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${String(n)}${suffix}`;
}
