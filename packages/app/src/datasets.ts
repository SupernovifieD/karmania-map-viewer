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
