/**
 * What the status chip says of the map's coordinate system (section 10.2 of the brief): a few words on its button (`EPSG:32640`, or
 * `Local grid, m`) and the whole of it in the tooltip, with the system's name when the definitions have been asked and have one.
 */
import type { CrsInfo } from '@karmania/engine';
import type { Frame } from '@karmania/engine/display';
import { describeNamed } from './import-crs.js';

/** The two texts of the button. */
export interface MapCrsText {
  /** On the button: `EPSG:32640`, `Local grid, m`. */
  readonly label: string;
  /** In the tooltip: `EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres)`, `A local grid, in metres`. */
  readonly title: string;
}

/** What a local grid's units are called on the button. */
const SHORT_UNITS = { m: 'm', ft: 'ft', us_ft: 'US ft' } as const;

/** The sentence with its first letter a capital. */
function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The texts for the map the frame is for. `info` is what the definitions say of the frame's EPSG code: the system, `null` if the code is
 * not in them, `undefined` while nobody has asked (the tooltip then has the code alone); a local grid has no use for it. With no frame
 * there is no system yet, and the button says so.
 */
export function mapCrsText(frame: Frame | null, info: CrsInfo | null | undefined): MapCrsText {
  if (frame === null) {
    return { label: 'No map CRS', title: 'The map has no coordinate system yet.' };
  }
  const { mapCrs } = frame;
  return {
    label:
      mapCrs.kind === 'epsg'
        ? `EPSG:${String(mapCrs.code)}`
        : `Local grid, ${SHORT_UNITS[mapCrs.units]}`,
    title: capital(describeNamed(mapCrs, info)),
  };
}
