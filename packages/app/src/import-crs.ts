import type {
  CrsInfo,
  CrsKind,
  CrsRef,
  CrsSource,
  CrsUnits,
  DetectedCrs,
  Units,
} from '@karmania/engine';

/** How the coordinate system is to be chosen: the one that was found, a code, or a local grid. */
export type CrsMode = 'detected' | 'epsg' | 'local';

/** What a person has decided about the coordinate system. */
export interface CrsDraft {
  /** How it is chosen; `undefined` until a person has chosen, when nothing was found to start from. */
  readonly mode: CrsMode | undefined;
  /** The EPSG code, as typed or chosen from the matches. */
  readonly epsg: string;
  /** What is in the search box: a code, or part of a name. It is not the code: a name has none. */
  readonly query: string;
  /** The units of a local grid. */
  readonly units: Units;
}

/** The draft for a file: the coordinate system that was found, if any, and metres for a local grid. */
export function crsDraftFor(detected: DetectedCrs | undefined): CrsDraft {
  return { mode: detected === undefined ? undefined : 'detected', epsg: '', query: '', units: 'm' };
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

/**
 * What is wrong with what was typed in the search box, in words; `undefined` for nothing wrong, or for
 * nothing typed yet. Only a number can be wrong: digits that are not a code (0, or more than six).
 * Anything else is a name to search for, which is not an error.
 */
export function epsgError(text: string): string | undefined {
  return /^\d+$/.test(text.trim()) && parseEpsg(text) === undefined
    ? 'An EPSG code is 1 to 999999, such as 32640.'
    : undefined;
}

/**
 * The code, as the draft keeps it, once the search box holds `text`. Digits typed are a code typed, which
 * is chosen as it is typed; a name is not a code, so it leaves the code as it was (a code that was chosen
 * stays chosen while a person looks for another); and an empty box has no code.
 */
export function epsgAfterTyping(text: string, previous: string): string {
  const trimmed = text.trim();
  if (trimmed === '') {
    return '';
  }
  return /^\d+$/.test(trimmed) ? trimmed : previous;
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

/** What each unit is called in the middle of a sentence. */
const UNIT_WORDS: Readonly<Record<Units, string>> = {
  m: 'metres',
  ft: 'feet',
  us_ft: 'US survey feet',
};

/** A coordinate system in a few words: `EPSG 32640`, or `a local grid, in metres`. */
export function describeCrs(crs: CrsRef): string {
  return crs.kind === 'epsg'
    ? `EPSG ${String(crs.code)}`
    : `a local grid, in ${UNIT_WORDS[crs.units]}`;
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

/** What each kind of system is, in the middle of a sentence. */
const KIND_WORDS: Readonly<Record<CrsKind, string>> = {
  geographic: 'longitude and latitude',
  projected: 'projected',
  other: 'another kind',
};

/** What each unit of the axes of a system is called, in the middle of a sentence. */
const AXIS_UNIT_WORDS: Readonly<Record<CrsUnits, string>> = {
  m: 'metres',
  ft: 'feet',
  us_ft: 'US survey feet',
  degree: 'degrees',
  other: 'other units',
};

/** What a system is, in a few words: `projected, in metres`. */
export function describeKind(info: CrsInfo): string {
  return `${KIND_WORDS[info.kind]}, in ${AXIS_UNIT_WORDS[info.units]}`;
}

/** A system by name, and what it is: `WGS 84 / UTM zone 40N (projected, in metres)`. */
export function describeInfo(info: CrsInfo): string {
  return `${info.name} (${describeKind(info)})`;
}

/**
 * A coordinate system in words, with its name when the definitions have one. `info` is what the
 * definitions say of an EPSG code: the system, `null` if the code is not in them, `undefined` if they
 * have not been asked (or the system is a local grid, which they know nothing of).
 */
export function describeNamed(crs: CrsRef, info: CrsInfo | null | undefined): string {
  if (crs.kind === 'local' || info === undefined) {
    return describeCrs(crs);
  }
  return info === null
    ? `${describeCrs(crs)}, which is not one of the coordinate systems Karmania knows`
    : `${describeCrs(crs)}, ${describeInfo(info)}`;
}

/**
 * What the step says has been chosen: where it came from, or that nothing has been. `info` is what the
 * definitions say of the code, as for `describeNamed`.
 */
export function summarizeCrs(
  draft: CrsDraft,
  detected: DetectedCrs | undefined,
  sidecar: string | undefined,
  info?: CrsInfo | null,
): string {
  const chosen = crsOf(draft, detected);
  if (chosen === null) {
    return 'No coordinate system is chosen yet.';
  }
  switch (draft.mode) {
    case 'detected':
      return detected === undefined
        ? ''
        : `${describeNamed(chosen, info)}, from ${describeSource(detected.source, sidecar)}.`;
    case 'epsg':
      return `${describeNamed(chosen, info)}, as you entered it.`;
    default:
      return `${describeCrs(chosen)}: the coordinates are not tied to a place on the Earth, only to each other.`;
  }
}
