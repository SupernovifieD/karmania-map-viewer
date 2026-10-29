import type { Summary } from '@karmania/engine';

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
