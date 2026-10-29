import type { CrsRef, CrsSource, DetectedCrs, Units } from '@karmania/engine';

/** How the coordinate system is to be chosen: the one that was found, a code, or a local grid. */
export type CrsMode = 'detected' | 'epsg' | 'local';

/** What a person has decided about the coordinate system. */
export interface CrsDraft {
  /** How it is chosen; `undefined` until a person has chosen, when nothing was found to start from. */
  readonly mode: CrsMode | undefined;
  /** The EPSG code, as typed. */
  readonly epsg: string;
  /** The units of a local grid. */
  readonly units: Units;
}

/** The draft for a file: the coordinate system that was found, if any, and metres for a local grid. */
export function crsDraftFor(detected: DetectedCrs | undefined): CrsDraft {
  return { mode: detected === undefined ? undefined : 'detected', epsg: '', units: 'm' };
}

/** The most digits an EPSG code has. */
const MAX_DIGITS = 6;

/** What an EPSG code typed is: a whole number from 1, of up to six digits; anything else is not one. */
export function parseEpsg(text: string): number | undefined {
  const trimmed = text.trim();
  if (!new RegExp(`^\\d{1,${String(MAX_DIGITS)}}$`).test(trimmed)) {
    return undefined;
  }
  const code = Number(trimmed);
  return code > 0 ? code : undefined;
}

/** What is wrong with a code that was typed, in words; `undefined` for none, or for nothing typed yet. */
export function epsgError(text: string): string | undefined {
  return text.trim() !== '' && parseEpsg(text) === undefined
    ? 'An EPSG code is a whole number, such as 32640.'
    : undefined;
}

/** The coordinate system the import is given: what a person chose, or `null` if nothing usable is. */
export function crsOf(draft: CrsDraft, detected: DetectedCrs | undefined): CrsRef | null {
  switch (draft.mode) {
    case 'detected':
      return detected?.crs ?? null;
    case 'epsg': {
      const code = parseEpsg(draft.epsg);
      return code === undefined ? null : { kind: 'epsg', code };
    }
    case 'local':
      return { kind: 'local', units: draft.units };
    case undefined:
      return null;
  }
}

/** Why a person cannot go on from the coordinate system step, in words, or `undefined` if they can. */
export function crsBlocker(draft: CrsDraft, detected: DetectedCrs | undefined): string | undefined {
  if (draft.mode === undefined) {
    return 'Choose a coordinate system: an EPSG code, or a local grid.';
  }
  if (draft.mode === 'epsg') {
    return parseEpsg(draft.epsg) === undefined
      ? 'Enter the EPSG code of the coordinate system.'
      : undefined;
  }
  if (draft.mode === 'detected' && detected === undefined) {
    return 'Choose a coordinate system: an EPSG code, or a local grid.';
  }
  return undefined;
}

/** What each unit is called. */
export const UNIT_NAMES: Readonly<Record<Units, string>> = {
  m: 'Metres',
  ft: 'Feet',
  us_ft: 'US survey feet',
};

/** A coordinate system in a few words: `EPSG 32640`, or `a local grid, in metres`. */
export function describeCrs(crs: CrsRef): string {
  return crs.kind === 'epsg'
    ? `EPSG ${String(crs.code)}`
    : `a local grid, in ${UNIT_NAMES[crs.units].toLowerCase()}`;
}

/** Where a coordinate system that was found came from, in words. `sidecar` is the name of the file beside the data, if there is one. */
export function describeSource(source: CrsSource, sidecar: string | undefined): string {
  switch (source) {
    case 'prj_file':
      return sidecar === undefined ? 'the .prj file beside the data' : `the .prj file ${sidecar}`;
    case 'geojson_crs_member':
      return "the file's own crs member";
    case 'geojson_default':
      return 'the GeoJSON default, which is assumed because the file names none';
  }
}

/** What the step says has been chosen: where it came from, or that nothing has been. */
export function summarizeCrs(
  draft: CrsDraft,
  detected: DetectedCrs | undefined,
  sidecar: string | undefined,
): string {
  const chosen = crsOf(draft, detected);
  if (chosen === null) {
    return 'No coordinate system is chosen yet.';
  }
  switch (draft.mode) {
    case 'detected':
      return detected === undefined
        ? ''
        : `${describeCrs(chosen)}, from ${describeSource(detected.source, sidecar)}.`;
    case 'epsg':
      return `${describeCrs(chosen)}, as you entered it.`;
    default:
      return `${describeCrs(chosen)}: the coordinates are not tied to a place on the Earth, only to each other.`;
  }
}
