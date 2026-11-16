/**
 * Waiting for the font of the exported picture (step 22.3): Inter is fetched when it is first needed, and a canvas that draws or measures text before it has arrived uses
 * another font, silently, and the picture is wrong in a way that no test of the numbers shows. The export loads each weight at each size it uses, and then asks the browser
 * whether it has them; if it has not, the export stops and says so, and does not draw in another font.
 */
import { EXPORT_TYPE } from '@karmania/scene';
import { atScale } from './canvas-2d.js';

/** What the export needs of the page's fonts (a `document.fonts`). */
export interface FontSet {
  load(font: string, text?: string): Promise<unknown>;
  check(font: string, text?: string): boolean;
}

/** The font is not there, so the picture would be drawn in another one. */
export class ExportFontError extends Error {
  readonly font: string;

  constructor(font: string) {
    super(`The font of the picture did not load (${font}), so the picture would not be set in it.`);
    this.name = 'ExportFontError';
    this.font = font;
  }
}

/** A font as the canvas takes it: weight, size in pixels of the picture, and the family. */
export function fontOf(weight: number, size: number, scale: number): string {
  return `${String(weight)} ${String(atScale(scale)(size))}px ${EXPORT_TYPE.family}`;
}

/** The fonts the picture draws and measures with, at the scale of the picture: names, the names of groups, classes and the scale bar's label. */
export function exportFonts(scale: number): readonly string[] {
  return [
    fontOf(EXPORT_TYPE.regular, EXPORT_TYPE.name.size, scale),
    fontOf(EXPORT_TYPE.medium, EXPORT_TYPE.name.size, scale),
    fontOf(EXPORT_TYPE.regular, EXPORT_TYPE.class.size, scale),
    fontOf(EXPORT_TYPE.regular, EXPORT_TYPE.caption.size, scale),
  ];
}

/** The text the fonts are asked for: the digits, and the letters and marks of the legend, so that the parts of the file that cover them are fetched. */
const SAMPLE = '0123456789 –.,−ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz…';

/**
 * Loads the fonts of the picture at `scale` and checks that they are there. Rejects with `ExportFontError` for the first that is not: a font that failed to load, or that
 * the page does not have at all.
 */
export async function loadExportFonts(fonts: FontSet, scale: number): Promise<void> {
  const wanted = exportFonts(scale);
  await Promise.all(
    wanted.map(async (font) => {
      try {
        await fonts.load(font, SAMPLE);
      } catch {
        throw new ExportFontError(font);
      }
    }),
  );
  for (const font of wanted) {
    if (!fonts.check(font, SAMPLE)) {
      throw new ExportFontError(font);
    }
  }
}
