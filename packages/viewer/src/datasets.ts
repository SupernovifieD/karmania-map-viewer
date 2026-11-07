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
 * The dataset to select once `removed` is gone: the one after it, or if it was the last the one
 * before it, or none when it was the only one. Only the one that was selected needs another.
 */
export function selectionAfterRemoving(
  datasets: readonly Summary[],
  removed: number,
  selected: number | undefined,
): number | undefined {
  if (selected !== removed) {
    return selected;
  }
  const at = datasets.findIndex((dataset) => dataset.id === removed);
  const neighbour = datasets[at + 1] ?? datasets[at - 1];
  return neighbour?.id;
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
