/**
 * Numbers as the legend writes them (section 11.7 of the brief): thousands separated by commas, the fewest decimals
 * that keep neighbouring bounds apart, never more than 6 significant digits, and a true minus sign. Plain arithmetic
 * on text: the same text on every machine, in every locale (nothing here asks the platform how to write a number).
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

/** How many decimals a number can have before it has more than 6 significant digits (none for 100,000 or more). */
function decimalsFor(value: number): number {
  if (value === 0 || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, SIGNIFICANT_DIGITS - 1 - Math.floor(Math.log10(Math.abs(value))));
}

/** How far `bound` is from what it reads as with `decimals` decimals. */
function roundingError(bound: number, decimals: number): number {
  return Number.isFinite(bound) && Math.abs(bound) < 1e21
    ? Math.abs(Number(bound.toFixed(decimals)) - bound)
    : 0;
}

/**
 * The labels of a list of bounds (ascending), all with the same number of decimals. **The fewest decimals** that
 * **leave each bound reading as itself, to less than a tenth of the narrowest class** (which also keeps each bound
 * apart from the next that is different, as the brief asks, and leaves equal neighbours with the same label): without that,
 * the bounds 0, 2.5 and 5 would read 0, 3 and 5, which are apart but are not the bounds, and a value of 2.7 would be
 * in a class that reads "3 – 5". Never more than the 6 significant digits of the bound that can have most; if two
 * bounds that differ are closer than that, they have the same label. With no class to measure by (one bound, or all
 * equal) a bound reads as itself to a millionth of the largest.
 */
export function formatBounds(bounds: readonly number[]): string[] {
  const most = Math.min(MOST_DECIMALS, Math.max(0, ...bounds.map(decimalsFor)));
  const widths = bounds.flatMap((bound, i) => {
    const next = bounds[i + 1];
    return next !== undefined && next > bound ? [next - bound] : [];
  });
  const tolerance =
    widths.length > 0 ? Math.min(...widths) / 10 : Math.max(0, ...bounds.map(Math.abs)) * 1e-6;
  let decimals = 0;
  while (decimals < most && !bounds.every((bound) => roundingError(bound, decimals) < tolerance)) {
    decimals += 1;
  }
  return bounds.map((bound) => formatNumber(bound, decimals));
}
