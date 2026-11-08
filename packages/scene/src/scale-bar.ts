/**
 * The scale bar as data, for the screen (step 17.2) and the export (step 22.2) to draw the same bar: a nice length
 * (1, 2 or 5 times a power of ten) in metres or kilometres, feet or miles, as wide in pixels as the map says that
 * length is, and no wider than the room there is; or nothing, with the reason.
 */
import type { CrsUnits } from '@karmania/engine/types';
import { formatNumber } from './numbers.js';
import type { ViewMode } from './types.js';

/** The widest a bar is, in pixels (section 10.2 of the brief). */
export const SCALE_BAR_MAX_PIXELS = 160;

/** The unit a bar is written in. */
export type ScaleBarUnit = 'm' | 'km' | 'ft' | 'mi';

/** A scale bar. */
export interface ScaleBar {
  readonly kind: 'bar';
  /** The length in `unit`: 1, 2 or 5 times a power of ten. */
  readonly value: number;
  readonly unit: ScaleBarUnit;
  /** What the bar says: `200 m`, `1 km`, `0.5 m`, `2,000 ft`, `1 mi`. */
  readonly label: string;
  /** How wide to draw it, in pixels: never more than the room. */
  readonly widthPx: number;
  /** The length in map units, which is metres, feet or US survey feet as the map is. */
  readonly mapUnits: number;
}

/** Why there is no scale bar. */
export type ScaleBarReason =
  'three_d' | 'geographic' | 'unknown_units' | 'units_pending' | 'no_map' | 'no_scale';

/** No scale bar, and why, in a sentence for a tooltip or a screen reader. */
export interface NoScaleBar {
  readonly kind: 'none';
  readonly reason: ScaleBarReason;
  readonly message: string;
}

/** What the scale bar is for a map. */
export type ScaleBarModel = ScaleBar | NoScaleBar;

/** What a scale bar is made from. */
export interface ScaleBarInput {
  /** There is a scale bar in 2D only. */
  readonly viewMode: ViewMode;
  /**
   * The units of the map's coordinate system (`CrsInfo.units`; for a local grid its unit); `'pending'` while they are being looked up (an
   * EPSG code's are in the definitions, which have to be asked); or `undefined` if there is no map.
   */
  readonly units: CrsUnits | 'pending' | undefined;
  /** Map units to a pixel on the screen (`camera2d.unitsPerPixel`). */
  readonly unitsPerPixel: number;
  /** The most the bar can be wide, in pixels; 160 by default. */
  readonly maxPixels?: number;
}

const MESSAGES: Record<ScaleBarReason, string> = {
  three_d: 'The scale bar is only shown in the 2D view.',
  geographic: 'A map in degrees has no scale bar.',
  unknown_units: 'The units of this coordinate system are not known, so there is no scale bar.',
  units_pending: 'The units of this coordinate system are being looked up.',
  no_map: 'There is no map to measure yet.',
  no_scale: 'The map has no scale yet.',
};

function none(reason: ScaleBarReason): NoScaleBar {
  return { kind: 'none', reason, message: MESSAGES[reason] };
}

/** The least a length can be and be written: a millionth of a unit. */
const LEAST = 1e-6;

/**
 * The largest of 1, 2 and 5 times a power of ten that is at most `x` (greater than 0), and the decimals it needs.
 * The power and the leading digits are read from the number's own decimal form (`toExponential`), which is exact
 * on every engine, and not worked out with logarithms, which are not: `Math.log10(1000)` is not always 3.
 */
function niceAtMost(x: number): { value: number; decimals: number } {
  const [digits = '1', exponent = '0'] = x.toExponential().split('e');
  const mantissa = Number(digits);
  const power = Number(exponent);
  const lead = mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1;
  return { value: Number(`${String(lead)}e${String(power)}`), decimals: Math.max(0, -power) };
}

/**
 * The scale bar for a map. Metres become kilometres from 1,000, and feet (international or US survey) become
 * miles from 5,280, so that a bar never reads `1,000 m` or `5,280 ft`; a mile of survey feet is 5,280 of them, as
 * a mile of feet is, so the sum is the same. Nothing is given for the 3D view, for a map in degrees, for units that
 * are not known, for units that are still being looked up, when there is no map, and when the map has no scale (a
 * scale that is not above 0 or not a number, or one so small that a bar is under a millionth of a unit).
 *
 * @throws RangeError if `maxPixels` is given and is not above 0, which is a mistake of the caller.
 */
export function scaleBar(input: ScaleBarInput): ScaleBarModel {
  const maxPixels = input.maxPixels ?? SCALE_BAR_MAX_PIXELS;
  if (!Number.isFinite(maxPixels) || maxPixels <= 0) {
    throw new RangeError(
      `The widest a scale bar can be is a number of pixels above 0, and not ${String(maxPixels)}.`,
    );
  }
  if (input.viewMode === '3d') {
    return none('three_d');
  }
  const { units } = input;
  if (units === undefined) {
    return none('no_map');
  }
  if (units === 'pending') {
    return none('units_pending');
  }
  if (units === 'degree') {
    return none('geographic');
  }
  if (units === 'other') {
    return none('unknown_units');
  }
  const room = maxPixels * input.unitsPerPixel;
  if (!Number.isFinite(room) || room < LEAST) {
    return none('no_scale');
  }
  const metric = units === 'm';
  const big = metric ? 1000 : 5280;
  const useBig = room >= big;
  const size = useBig ? big : 1;
  const unit: ScaleBarUnit = metric ? (useBig ? 'km' : 'm') : useBig ? 'mi' : 'ft';
  const { value, decimals } = niceAtMost(room / size);
  const mapUnits = value * size;
  return {
    kind: 'bar',
    value,
    unit,
    label: `${formatNumber(value, decimals)} ${unit}`,
    widthPx: Math.min(maxPixels, mapUnits / input.unitsPerPixel),
    mapUnits,
  };
}
