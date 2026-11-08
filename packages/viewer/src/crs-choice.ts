/**
 * What the map coordinate system dialog needs to know of the systems it is choosing among: whether two are the same one, and which local
 * grids are loaded (so which units it offers). Plain functions, with no page in them.
 */
import type { Summary } from '@karmania/engine';
import type { CrsRef, Units } from '@karmania/engine/types';

/** Whether two systems are the same one. */
export function sameCrs(a: CrsRef | undefined, b: CrsRef | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.kind === 'epsg'
    ? b.kind === 'epsg' && a.code === b.code
    : b.kind === 'local' && a.units === b.units;
}

/** The units of the local grids that are loaded, each once, in the order they are first met. */
export function localUnitsOf(datasets: readonly Summary[]): readonly Units[] {
  const units: Units[] = [];
  for (const dataset of datasets) {
    if (dataset.crs?.kind === 'local' && !units.includes(dataset.crs.units)) {
      units.push(dataset.crs.units);
    }
  }
  return units;
}
