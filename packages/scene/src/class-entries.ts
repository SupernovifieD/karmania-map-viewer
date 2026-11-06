/**
 * The classes of a layer as the legend lists them: a colour, a label and a count each. The colours are chosen here
 * and nowhere else, so that the legend and the picture (step 16.13, and the exported picture) cannot disagree, and the
 * counts are the engine's own (`ClassBreaks`), the ones the class index is made from.
 */
import type { ClassBreaks } from '@karmania/engine/display';
import { BOUND_DASH, formatBounds, formatCount } from './numbers.js';
import { rampById, sampleRamp } from './ramps.js';
import type { ClassColour } from './types.js';

/** The colour of the class "Other" of a column of categories: a grey that is neither one of the palette's colours nor a ramp's. */
export const OTHER_COLOUR = '#8c8c8c';

/** The label of what has no value to put in a class. */
export const NO_VALUE_LABEL = 'No value';

/** The label of the categories that are not among those that are listed. */
export const OTHER_LABEL = 'Other';

/** One line of the legend under a layer. */
export interface ClassEntry {
  /** `10 – 20` for a range, the value for a category, `Other`, or `No value`. */
  readonly label: string;
  /** How many elements are in it. */
  readonly count: number;
  /** The count as written, with commas, so that the screen and the export write the same. */
  readonly countLabel: string;
  /** `#rrggbb`, or `null` for what has no value: it has no colour, and is drawn as an empty swatch. */
  readonly colour: string | null;
}

/** How many classes the breaks have: the ranges, or the categories that are listed (not "Other"). */
export function classCount(breaks: ClassBreaks): number {
  return breaks.kind === 'ranges' ? breaks.counts.length : breaks.values.length;
}

/**
 * The colour of each class, in the order of the classes: the ramp sampled to as many colours as the breaks have
 * classes (which can be fewer than were asked for), from its last colour if it is reversed.
 *
 * @throws RangeError if the ramp is not one of the ramps: a document that `validateScene` accepts has none such.
 */
export function classColours(colour: ClassColour, breaks: ClassBreaks): readonly string[] {
  const ramp = rampById(colour.ramp);
  if (ramp === undefined) {
    throw new RangeError(`There is no ramp "${colour.ramp}".`);
  }
  const count = classCount(breaks);
  return count === 0 ? [] : sampleRamp(ramp, count, colour.reverse);
}

function entry(label: string, count: number, colour: string | null): ClassEntry {
  return { label, count, countLabel: formatCount(count), colour };
}

/**
 * The lines under a layer: each class with its label and count, then "Other" if there are categories that are not
 * listed, then "No value" if any element has none. A range reads `lower – upper` (the last one that is a class of a
 * single value, the largest, reads that value alone); a category reads as its value is, not as a number with commas.
 */
export function classEntries(colour: ClassColour, breaks: ClassBreaks): readonly ClassEntry[] {
  const colours = classColours(colour, breaks);
  const entries: ClassEntry[] = [];
  if (breaks.kind === 'ranges') {
    const labels = formatBounds(breaks.bounds);
    breaks.counts.forEach((count, k) => {
      const [lower, upper] = [breaks.bounds[k], breaks.bounds[k + 1]];
      const text = labels[k] ?? '';
      const label = lower === upper ? text : `${text}${BOUND_DASH}${labels[k + 1] ?? ''}`;
      entries.push(entry(label, count, colours[k] ?? null));
    });
  } else {
    breaks.values.forEach((value, k) => {
      entries.push(entry(String(value), breaks.counts[k] ?? 0, colours[k] ?? null));
    });
    if (breaks.other !== undefined) {
      entries.push(entry(OTHER_LABEL, breaks.other, OTHER_COLOUR));
    }
  }
  if (breaks.nulls > 0) {
    entries.push(entry(NO_VALUE_LABEL, breaks.nulls, null));
  }
  return entries;
}
