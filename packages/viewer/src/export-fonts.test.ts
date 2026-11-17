import { describe, expect, it } from 'vitest';
import { ExportFontError, exportFonts, fontOf, loadExportFonts } from './export-fonts.js';
import type { FontSet } from './export-fonts.js';

/** A set of fonts that says which it has been asked for, and which it has. */
function fontSet(has: (font: string) => boolean = () => true): FontSet & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    load(font) {
      asked.push(font);
      return Promise.resolve([]);
    },
    check: has,
  };
}

describe('fontOf', () => {
  it('is the weight, the size in pixels of the picture and the family, Inter first', () => {
    expect(fontOf(500, 14, 1)).toMatch(/^500 14px Inter,/);
    expect(fontOf(400, 13, 3.125)).toMatch(/^400 41px Inter,/);
  });
});

describe('exportFonts', () => {
  it('are the four the picture uses: names and group names at body size, classes at secondary size, the scale bar at caption size', () => {
    expect(exportFonts(1).map((font) => font.split(' ').slice(0, 2).join(' '))).toEqual([
      '400 14px',
      '500 14px',
      '400 13px',
      '400 12px',
    ]);
    expect(exportFonts(2).map((font) => font.split(' ').slice(0, 2).join(' '))).toEqual([
      '400 28px',
      '500 28px',
      '400 26px',
      '400 24px',
    ]);
  });
});

describe('loadExportFonts', () => {
  it('asks for every font at the scale of the picture, and is done when the page has them', async () => {
    const fonts = fontSet();
    await loadExportFonts(fonts, 3.125);
    expect(fonts.asked).toEqual([...exportFonts(3.125)]);
  });

  it('rejects, naming the font, when the page says it has not got one after loading: the picture is not drawn in another font', async () => {
    const fonts = fontSet((font) => !font.startsWith('500 '));
    const error = await loadExportFonts(fonts, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExportFontError);
    expect((error as ExportFontError).font).toMatch(/^500 14px Inter/);
  });

  it('rejects when a font cannot be loaded', async () => {
    const fonts: FontSet = {
      load: () => Promise.reject(new Error('network')),
      check: () => true,
    };
    await expect(loadExportFonts(fonts, 1)).rejects.toBeInstanceOf(ExportFontError);
  });
});
