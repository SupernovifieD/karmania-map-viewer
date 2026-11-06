/**
 * Numbers as the legend writes them (section 11.7 of the brief): thousands separated by commas, a bound as it is and
 * not rounded (`formatBounds` says why that departs from the brief), and a true minus sign. The bounds are finite, as
 * the engine's own checks make them. Plain arithmetic on text: the same text on every machine, in every locale
 * (nothing here asks the platform how to write a number).
 */

/** The sign of a negative number, `−` (U+2212), which is not the hyphen and not the dash between two bounds. */
export const MINUS = '−';

/** The dash between the two bounds of a class, `–` (U+2013), with a space on each side. */
export const BOUND_DASH = ' – ';

/** The most decimals a label has. */
const MOST_DECIMALS = 20;

/** The most significant digits a label has. */
const SIGNIFICANT_DIGITS = 6;

function grouped(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * `value` with exactly `decimals` decimals and commas between the thousands. A number that rounds to nothing is
 * written without a sign (`0.0`, never `-0.0`). A number of 1e21 or more, which the platform writes with an
 * exponent, is written with 6 significant digits and an exponent; a number that is not finite is written as it is.
 */
export function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (Math.abs(value) >= 1e21) {
    return value.toPrecision(SIGNIFICANT_DIGITS).replace('-', MINUS);
  }
  const fixed = Math.abs(value).toFixed(Math.min(Math.max(Math.trunc(decimals), 0), MOST_DECIMALS));
  const [whole = '0', fraction] = fixed.split('.');
  const text = grouped(whole) + (fraction === undefined ? '' : `.${fraction}`);
  return value < 0 && /[1-9]/.test(fixed) ? `${MINUS}${text}` : text;
}

/** A whole number with commas: a count of elements. */
export function formatCount(count: number): string {
  return formatNumber(count, 0);
}

/** How many significant digits a bound keeps when it is written as it is: all that a double has, less the one or two of its noise. */
const AS_IS_DIGITS = 15;

/**
 * A bound written as it is, and not rounded: its own digits, thousands separated by commas, a true minus sign. The
 * digits are those of the shortest text that gives the number back, **trimmed at 15 significant digits**, which
 * keeps every number that a file can write and takes off only the noise of arithmetic (the bounds of equal classes
 * are sums and products, and `0.1 + 0.2` would otherwise read `0.30000000000000004`), as the table of the Data tab
 * does. A number that the platform writes with an exponent (below 1e-6, from 1e21) keeps it. One that is not finite is written as it is.
 */
function formatAsIs(bound: number): string {
  if (!Number.isFinite(bound)) {
    return String(bound);
  }
  const text = String(Number(Math.abs(bound).toPrecision(AS_IS_DIGITS)));
  const [whole = '0', fraction] = text.split('.');
  const body = grouped(whole) + (fraction === undefined ? '' : `.${fraction}`);
  return bound < 0 ? `${MINUS}${body}` : body;
}

/**
 * The labels of a list of bounds: **each bound as it is, whatever the others are** (the owner's choice, step 14.10a
 * after the milestone: the brief's "the fewest decimals that keep neighbouring bounds distinct" rounds a bound, and
 * a rounded or a plain reading is to be a choice of the person later; the rounding rule, with its tenth of the
 * narrowest class, is in the history of this file, in the commit `5676067`). So the bounds 0, 2.5 and 5 read `0`,
 * `2.5` and `5`, and two bounds that differ read differently.
 */
export function formatBounds(bounds: readonly number[]): string[] {
  return bounds.map(formatAsIs);
}
