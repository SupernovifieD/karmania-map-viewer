/**
 * Colours as the scene handles them: `#rrggbb` text, three numbers from 0 to 255 to work with, and the
 * contrast between two colours as the Web Content Accessibility Guidelines (WCAG 2.2, 1.4.11) measure it.
 * Plain arithmetic, deterministic, no DOM.
 */

/** Red, green and blue, each from 0 to 255; not necessarily whole numbers while a colour is being mixed. */
export type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;

/** `#rrggbb`, in either case, as numbers; `undefined` for anything else. */
export function parseHex(hex: string): Rgb | undefined {
  const found = HEX.exec(hex);
  if (found === null) {
    return undefined;
  }
  const [, red = '', green = '', blue = ''] = found;
  return [parseInt(red, 16), parseInt(green, 16), parseInt(blue, 16)];
}

/** `#rrggbb` in lower case; each number is rounded to a whole number and kept from 0 to 255. */
export function toHex(rgb: Rgb): string {
  const part = (value: number): string =>
    Math.min(255, Math.max(0, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`;
}

/** The colour `t` of the way from `from` (0) to `to` (1), each channel on its own, in the numbers as they are. */
export function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** How light a colour is to the eye, from 0 (black) to 1 (white), as WCAG defines it. */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/** The contrast between two colours, from 1 (the same) to 21 (black on white); 3 is what WCAG asks of a graphic. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}
