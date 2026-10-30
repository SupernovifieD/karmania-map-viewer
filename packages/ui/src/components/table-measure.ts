import { textWidth } from './table-columns.js';

/** Measures text as the table sets it. */
export interface Measurer {
  /** How wide `text` is in a cell, or in a header, which is in a heavier weight. */
  readonly width: (text: string, header: boolean) => number;
  /**
   * How wide the widest of `texts` is, drawn as they are in the page and not worked out: exact, and
   * slower, so it is for the few words that decide how wide a column is.
   */
  readonly widest: (texts: readonly string[], header: boolean) => number;
  /** How wide a digit is, in a cell. */
  readonly digitWidth: number;
}

/** How many digits are set side by side to find out how wide one is. */
const PROBE_DIGITS = 20;

/** How many words are remembered, for each weight, before they are forgotten and learnt again. */
const MEMORY = 20_000;

/** The fonts the table's words are in, as `font` in CSS has them: regular and a heavier weight. */
function fontsOf(parent: HTMLElement, heavy: number): { regular: string; heavy: string } {
  const style = getComputedStyle(parent);
  return {
    regular: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    heavy: `${String(heavy)} ${style.fontSize} ${style.fontFamily}`,
  };
}

/**
 * Waits until the fonts that the words in `sample` are set in have arrived. A font that is fetched
 * when it is first needed has not come when the first words are drawn, and measuring before it
 * has would measure another font.
 */
export async function loadFonts(parent: HTMLElement, heavy: number, sample: string): Promise<void> {
  const fonts = fontsOf(parent, heavy);
  await Promise.all([
    document.fonts.load(fonts.regular, sample),
    document.fonts.load(fonts.heavy, sample),
  ]);
}

/** How wide a digit is in `weight`, which the page draws as wide as every other digit. */
function digitWidthOf(parent: HTMLElement, weight: string): number {
  const probe = document.createElement('span');
  probe.style.cssText = `position: absolute; visibility: hidden; white-space: nowrap; font-weight: ${weight}`;
  probe.textContent = '0'.repeat(PROBE_DIGITS);
  parent.append(probe);
  const width = probe.getBoundingClientRect().width / PROBE_DIGITS;
  probe.remove();
  return width;
}

/**
 * A measurer for the words in `parent`, in the font they are drawn in. Digits are measured by
 * drawing some, since the page sets them all one width and a canvas does not know that; the rest of
 * a word is measured with a canvas. Nothing is returned if the browser has no canvas.
 */
export function createMeasurer(parent: HTMLElement, heavy: number): Measurer | undefined {
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) {
    return undefined;
  }
  const fonts = fontsOf(parent, heavy);
  const digits = {
    regular: digitWidthOf(parent, getComputedStyle(parent).fontWeight),
    heavy: digitWidthOf(parent, String(heavy)),
  };
  const remembered = { regular: new Map<string, number>(), heavy: new Map<string, number>() };
  const measure = (text: string, header: boolean): number => {
    context.font = header ? fonts.heavy : fonts.regular;
    return context.measureText(text).width;
  };
  return {
    digitWidth: digits.regular,
    widest: (texts, header) => {
      const probe = document.createElement('span');
      probe.style.cssText = `position: absolute; visibility: hidden; white-space: pre; font-weight: ${header ? String(heavy) : getComputedStyle(parent).fontWeight}`;
      parent.append(probe);
      let widest = 0;
      for (const text of texts) {
        probe.textContent = text;
        widest = Math.max(widest, probe.getBoundingClientRect().width);
      }
      probe.remove();
      return widest;
    },
    width: (text, header) => {
      const memory = header ? remembered.heavy : remembered.regular;
      const known = memory.get(text);
      if (known !== undefined) {
        return known;
      }
      const width = textWidth(text, header ? digits.heavy : digits.regular, (rest) =>
        measure(rest, header),
      );
      if (memory.size >= MEMORY) {
        memory.clear();
      }
      memory.set(text, width);
      return width;
    },
  };
}
