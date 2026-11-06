/**
 * What the colours of the map have to be seen against: the two backgrounds of the map, and how much a colour
 * stands out from each. The brief asks for 3 to 1 for a graphic (WCAG 2.2, 1.4.11), and a colour that has less on a
 * background is made readable by the 1 px outline that points and polygons are drawn with (section 9.3 of the brief).
 */
import { contrastRatio, parseHex } from './colour.js';

/**
 * The background of the map in each theme: `--k-surface-map` of `packages/ui/src/tokens.css` (a test reads the
 * stylesheet, so that this cannot drift from it). The exported picture is always the light one.
 */
export const MAP_BACKGROUNDS = { light: '#e9ecf0', dark: '#0e1013' } as const;

/** The lowest contrast that a graphic is asked to have against what is next to it. */
export const MIN_GRAPHIC_CONTRAST = 3;

/** The contrast of a `#rrggbb` colour with the light map and with the dark map; a mistake to give anything else. */
export function contrastOnMaps(colour: string): { readonly light: number; readonly dark: number } {
  const rgb = parseHex(colour);
  const light = parseHex(MAP_BACKGROUNDS.light);
  const dark = parseHex(MAP_BACKGROUNDS.dark);
  if (rgb === undefined || light === undefined || dark === undefined) {
    throw new TypeError(`"${colour}" is not #rrggbb.`);
  }
  return { light: contrastRatio(rgb, light), dark: contrastRatio(rgb, dark) };
}
