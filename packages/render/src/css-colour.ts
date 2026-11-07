/**
 * Reads the colour that the browser says a CSS colour is: `getComputedStyle(...).backgroundColor` gives `rgb(...)` or
 * `rgba(...)` (with commas or with spaces and a slash), and `color(srgb ...)` for what was mixed in another way. Nothing
 * else needs to be read, since a computed value is always one of those, so anything else is not a colour.
 */

/** A colour in sRGB: `r`, `g` and `b` from 0 to 255 (a mixed colour is not always a whole number), `a` from 0 to 1. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const NUMBER = '(\\d*\\.?\\d+(?:e[+-]?\\d+)?)';
const RGB = new RegExp(
  `^rgba?\\(\\s*${NUMBER}\\s*[, ]\\s*${NUMBER}\\s*[, ]\\s*${NUMBER}\\s*(?:[,/]\\s*${NUMBER}(%?)\\s*)?\\)$`,
  'i',
);
const SRGB = new RegExp(
  `^color\\(\\s*srgb\\s+${NUMBER}\\s+${NUMBER}\\s+${NUMBER}\\s*(?:/\\s*${NUMBER}(%?)\\s*)?\\)$`,
  'i',
);

/** The colour that `text` says (a computed colour of CSS), or `undefined` if it is not one. */
export function parseCssColour(text: string): Rgba | undefined {
  const value = text.trim();
  const rgb = RGB.exec(value);
  if (rgb !== null) {
    return build(rgb, 1);
  }
  const srgb = SRGB.exec(value);
  return srgb === null ? undefined : build(srgb, 255);
}

/** `match` has the three channels (a unit of `scale` each: 1 for 0 to 255, 255 for 0 to 1) and then an alpha and its `%`. */
function build(match: RegExpExecArray, scale: number): Rgba | undefined {
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => Number(part) * scale);
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] === '%' ? 100 : 1);
  if (
    r === undefined ||
    g === undefined ||
    b === undefined ||
    ![r, g, b, alpha].every(Number.isFinite)
  ) {
    return undefined;
  }
  const clamp = (n: number, high: number): number => Math.min(high, Math.max(0, n));
  return { r: clamp(r, 255), g: clamp(g, 255), b: clamp(b, 255), a: clamp(alpha, 1) };
}
