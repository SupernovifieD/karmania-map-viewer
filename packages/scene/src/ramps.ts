/**
 * The colour ramps a layer can be coloured by, and sampling a ramp to a number of classes. Every ramp says where
 * its colours come from and under what licence (the data is in `ramp-data.ts`, with the sources written out).
 */
import { mix, parseHex, toHex, type Rgb } from './colour.js';
import { BREWER_DIVERGING, BREWER_PAIRED, BREWER_SEQUENTIAL, MAGMA, VIRIDIS } from './ramp-data.js';
import type { RampId } from './types.js';

/**
 * `sequential` runs from low to high, `diverging` from one end through a light middle to the other, and
 * `categorical` has colours that are all different and have no order.
 */
export const RAMP_KINDS = ['sequential', 'diverging', 'categorical'] as const;

/** See {@link RAMP_KINDS}. */
export type RampKind = (typeof RAMP_KINDS)[number];

/** A ramp: its colours, as `#rrggbb` in lower case, and where they come from. */
export interface Ramp {
  readonly id: RampId;
  /** For a person to read, in a list of ramps. */
  readonly name: string;
  readonly kind: RampKind;
  /** For `sequential` and `diverging` the stops that colours are mixed between; for `categorical` the colours themselves. */
  readonly colours: readonly string[];
  /** Who made it and where it was taken from. */
  readonly source: string;
  /** The SPDX identifier of the licence it is under. */
  readonly licence: string;
}

/**
 * The Okabe-Ito palette: eight colours that people with the common kinds of colour blindness can tell apart,
 * published by Masataka Okabe and Kei Ito (Color Universal Design, 2002; jfly.uni-koeln.de/color) and by Bang Wong
 * (Nature Methods 8, 441, 2011). It is a published list of colour values, with no licence stated. Orange, sky blue,
 * bluish green, vermillion, blue, reddish purple, yellow and black: the order of the colours of a new layer, with
 * black last because it cannot be seen on the dark map (and yellow because it cannot be seen on the light one).
 */
const OKABE_ITO = '#e69f00#56b4e9#009e73#d55e00#0072b2#cc79a7#f0e442#000000';

const MATPLOTLIB = 'matplotlib 3.10.0 (original: github.com/BIDS/colormap)';
const COLORBREWER = 'ColorBrewer, Cynthia Brewer (colorbrewer.org)';

/** The colours that a string of `#rrggbb` written one after the other is made of. */
export function colourList(data: string): readonly string[] {
  const colours: string[] = [];
  for (let at = 0; at < data.length; at += 7) {
    const colour = data.slice(at, at + 7);
    if (parseHex(colour) === undefined || colour !== colour.toLowerCase()) {
      throw new Error(
        `The colour data has "${colour}" at ${String(at)}, which is not #rrggbb in lower case.`,
      );
    }
    colours.push(colour);
  }
  return colours;
}

function defineRamp(
  id: RampId,
  name: string,
  kind: RampKind,
  data: string,
  source: string,
  licence: string,
): Ramp {
  return { id, name, kind, colours: colourList(data), source, licence };
}

const brewer = (id: RampId, name: string, kind: RampKind, data: string): Ramp =>
  defineRamp(id, name, kind, data, COLORBREWER, 'Apache-2.0');

/** Every ramp, in the order a list of them shows. */
export const RAMPS: readonly Ramp[] = [
  defineRamp('viridis', 'Viridis', 'sequential', VIRIDIS, MATPLOTLIB, 'CC0-1.0'),
  defineRamp('magma', 'Magma', 'sequential', MAGMA, MATPLOTLIB, 'CC0-1.0'),
  brewer('blues', 'Blues', 'sequential', BREWER_SEQUENTIAL.blues),
  brewer('greens', 'Greens', 'sequential', BREWER_SEQUENTIAL.greens),
  brewer('oranges', 'Oranges', 'sequential', BREWER_SEQUENTIAL.oranges),
  brewer('reds', 'Reds', 'sequential', BREWER_SEQUENTIAL.reds),
  brewer('purples', 'Purples', 'sequential', BREWER_SEQUENTIAL.purples),
  brewer('ylgnbu', 'Yellow-green-blue', 'sequential', BREWER_SEQUENTIAL.ylgnbu),
  brewer('ylorrd', 'Yellow-orange-red', 'sequential', BREWER_SEQUENTIAL.ylorrd),
  brewer('rdbu', 'Red-blue', 'diverging', BREWER_DIVERGING.rdbu),
  brewer('puor', 'Purple-orange', 'diverging', BREWER_DIVERGING.puor),
  brewer('brbg', 'Brown-blue-green', 'diverging', BREWER_DIVERGING.brbg),
  defineRamp(
    'okabe-ito',
    'Okabe-Ito',
    'categorical',
    OKABE_ITO,
    'Masataka Okabe and Kei Ito, Color Universal Design (jfly.uni-koeln.de/color)',
    'none stated (a published list of eight colours)',
  ),
  brewer('paired', 'Paired', 'categorical', BREWER_PAIRED),
];

/** The id of every ramp, in the same order. */
export const RAMP_IDS: readonly RampId[] = RAMPS.map((entry) => entry.id);

/** The ramp with this id, or `undefined`. */
export function rampById(id: string): Ramp | undefined {
  return RAMPS.find((entry) => entry.id === id);
}

function rgbOf(hex: string): Rgb {
  const rgb = parseHex(hex);
  if (rgb === undefined) {
    throw new Error(`"${hex}" is not #rrggbb.`);
  }
  return rgb;
}

/** `n` colours spread evenly along the stops, the first and the last stop at the ends (the middle of them for one). */
function along(stops: readonly string[], n: number): string[] {
  const rgb = stops.map(rgbOf);
  const last = rgb.length - 1;
  return Array.from({ length: n }, (_, k) => {
    const position = (n === 1 ? 0.5 : k / (n - 1)) * last;
    const lower = Math.min(Math.floor(position), last - 1);
    const from = rgb[lower];
    const to = rgb[lower + 1];
    if (from === undefined || to === undefined) {
      throw new Error('A ramp needs at least two colours to be sampled along.');
    }
    return toHex(mix(from, to, position - lower));
  });
}

/**
 * `n` colours of `ramp`, for the `n` classes of a column, from the first class to the last; with `reverse` from the
 * last colour of the ramp to the first. A sequential or diverging ramp is sampled evenly along its stops (the
 * stops themselves when `n` is their number), a categorical one gives its colours in order and starts again
 * after the last. Always the same colours for the same arguments.
 *
 * @throws RangeError if `n` is not a whole number from 1: the classes of a column are, so it is a mistake.
 */
export function sampleRamp(ramp: Ramp, n: number, reverse = false): readonly string[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(
      `A ramp is sampled to a whole number of colours from 1, and not to ${String(n)}.`,
    );
  }
  const colours =
    ramp.kind === 'categorical'
      ? Array.from({ length: n }, (_, k) => ramp.colours[k % ramp.colours.length] ?? '#000000')
      : along(ramp.colours, n);
  return reverse ? colours.reverse() : colours;
}
