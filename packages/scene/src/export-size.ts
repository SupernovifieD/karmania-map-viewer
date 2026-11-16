/**
 * The size of the exported picture (section 10.5 of the brief): the presets of the dialog, the dpi it offers, and the largest side a picture can have.
 * Pixels are whole numbers; paper is measured in millimetres and turned into pixels at the dpi, rounded, so A4 at 300 dpi is 3,508 by 2,480 pixels.
 * Plain arithmetic, with no DOM; what the graphics card allows is given by the caller.
 */
import type { Size } from './export-layout.js';

/** The dpi the dialog offers: 96 is the size of the screen. */
export const EXPORT_DPIS = [96, 150, 300] as const;
export type ExportDpi = (typeof EXPORT_DPIS)[number];

/** The sizes the dialog offers. */
export const SIZE_PRESETS = [
  'screen',
  'a4-landscape',
  'a4-portrait',
  'a3-landscape',
  'a3-portrait',
  'custom',
] as const;
export type SizePreset = (typeof SIZE_PRESETS)[number];

/** The most a side of a picture is, whatever the card allows (section 10.6 of the brief). */
export const MAX_EXPORT_SIDE = 8192;
/** The least a side of a picture is: a picture smaller than the map's furniture is nothing. */
export const MIN_EXPORT_SIDE = 64;

/** Paper, in millimetres: the long side and the short side. */
const PAPER = { a4: [297, 210], a3: [420, 297] } as const;
const MM_PER_INCH = 25.4;

const pixels = (mm: number, dpi: number): number => Math.round((mm / MM_PER_INCH) * dpi);

/**
 * The size of a picture in pixels. `screen` is the map on screen in CSS pixels (for the preset "same as the map on screen", which is that at `dpi / 96`),
 * and `custom` the size that was typed (for `custom`, which is returned as it is).
 */
export function sizeInPixels(
  preset: SizePreset,
  dpi: number,
  screen: Size,
  custom: Size = screen,
): Size {
  switch (preset) {
    case 'screen':
      return {
        width: Math.round((screen.width * dpi) / 96),
        height: Math.round((screen.height * dpi) / 96),
      };
    case 'custom':
      return custom;
    default: {
      const [paper, orientation] = preset.split('-') as ['a4' | 'a3', 'landscape' | 'portrait'];
      const [long, short] = PAPER[paper];
      const [width, height] = orientation === 'landscape' ? [long, short] : [short, long];
      return { width: pixels(width, dpi), height: pixels(height, dpi) };
    }
  }
}

/** What the graphics card allows, as it says: the biggest renderbuffer, texture and viewport, in pixels on a side. */
export interface GpuSizes {
  readonly renderbuffer: number;
  readonly texture: number;
  readonly viewport: number;
}

/** The most a side of a picture can be on this card: `MAX_EXPORT_SIDE`, or less where the card allows less. */
export function maxSide(gpu: GpuSizes): number {
  return Math.min(MAX_EXPORT_SIDE, gpu.renderbuffer, gpu.texture, gpu.viewport);
}

/** Why a size cannot be exported. */
export type SizeProblem =
  | { readonly code: 'not_a_size' }
  | { readonly code: 'too_small'; readonly side: 'width' | 'height'; readonly least: number }
  | { readonly code: 'too_large'; readonly side: 'width' | 'height'; readonly most: number };

/** What is wrong with a size, in the order width and then height; none if it can be exported. `most` is from `maxSide`. */
export function sizeProblems(size: Size, most: number): readonly SizeProblem[] {
  const whole = (n: number): boolean => Number.isInteger(n);
  if (!whole(size.width) || !whole(size.height)) {
    return [{ code: 'not_a_size' }];
  }
  const problems: SizeProblem[] = [];
  for (const side of ['width', 'height'] as const) {
    if (size[side] < MIN_EXPORT_SIDE) {
      problems.push({ code: 'too_small', side, least: MIN_EXPORT_SIDE });
    } else if (size[side] > most) {
      problems.push({ code: 'too_large', side, most });
    }
  }
  return problems;
}
