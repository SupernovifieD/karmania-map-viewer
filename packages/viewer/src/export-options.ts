/**
 * What the export dialog asks and says (brief 10.5, steps 22.7 to 22.9), as plain functions: the options, the size of the picture they come to, what is wrong with them and the
 * words for it, the file name, and the caption under the preview. The dialog draws this and the viewer's `exportPng` is asked with it; nothing here reads the page.
 */
import {
  EXPORT_DPIS,
  MIN_EXPORT_SIDE,
  SIZE_PRESETS,
  maxSide,
  sizeInPixels,
  sizeProblems,
} from '@karmania/scene';
import type {
  ExportDpi,
  ExportWarning,
  GpuSizes,
  Size,
  SizePreset,
  SizeProblem,
} from '@karmania/scene';

/** The options the dialog holds. */
export interface ExportOptionsState {
  readonly preset: SizePreset;
  readonly dpi: ExportDpi;
  /** The size that was typed, for the preset `custom`, in pixels. */
  readonly custom: Size;
  /** Whether the legend is put to the right of the map. */
  readonly legend: boolean;
  /** The file name as typed, without ".png" (see `fileNameOf`). */
  readonly name: string;
}

/** The name of the file when a person has not given one (and what the field is reset to). */
export const DEFAULT_FILE_NAME = 'karmania-map';
/** The longest a file name is, without its ".png". */
export const MAX_FILE_NAME = 100;

/** The words of each size in the dialog's select, in the order of `SIZE_PRESETS`. */
export const SIZE_LABELS: Readonly<Record<SizePreset, string>> = {
  screen: 'Same as the map on screen',
  'a4-landscape': 'A4 landscape',
  'a4-portrait': 'A4 portrait',
  'a3-landscape': 'A3 landscape',
  'a3-portrait': 'A3 portrait',
  custom: 'Custom',
};

/** The words of each resolution in the dialog's select. */
export const DPI_LABELS: Readonly<Record<ExportDpi, string>> = {
  96: '96 dpi (screen)',
  150: '150 dpi',
  300: '300 dpi (print)',
};

export { EXPORT_DPIS, SIZE_PRESETS };

/** The options as the dialog starts: the map as it is on screen, at the screen's resolution, with the legend. `screen` is the map on screen in CSS pixels. */
export function defaultOptions(screen: Size): ExportOptionsState {
  return {
    preset: 'screen',
    dpi: 96,
    custom: { width: Math.round(screen.width), height: Math.round(screen.height) },
    legend: true,
    name: DEFAULT_FILE_NAME,
  };
}

/** The size of the picture the options come to, in pixels. */
export function pictureSize(state: ExportOptionsState, screen: Size): Size {
  return sizeInPixels(state.preset, state.dpi, screen, state.custom);
}

/** A number with thousands commas: `3,508`. */
export function withCommas(n: number): string {
  return n.toLocaleString('en-US');
}

/** The caption under the preview: `3,508 × 2,480 px · 300 dpi`. */
export function sizeCaption(size: Size, dpi: number): string {
  return `${withCommas(size.width)} × ${withCommas(size.height)} px · ${String(dpi)} dpi`;
}

/** What is wrong with the size of the picture, in the order width and then height: `[]` if nothing is. `gpu` is what the card allows, if it is known. */
export function problemsOf(size: Size, gpu: GpuSizes | undefined): readonly SizeProblem[] {
  return sizeProblems(
    size,
    gpu === undefined
      ? maxSide({ renderbuffer: 8192, texture: 8192, viewport: 8192 })
      : maxSide(gpu),
  );
}

/** A problem with a size in words that anyone can follow, with what to do. */
export function problemText(problem: SizeProblem): string {
  switch (problem.code) {
    case 'not_a_size':
      return 'The width and the height have to be whole numbers of pixels.';
    case 'too_small':
      return `The ${problem.side} has to be at least ${withCommas(problem.least)} pixels.`;
    case 'too_large':
      return `The ${problem.side} can be at most ${withCommas(problem.most)} pixels on this computer. Use a smaller size or a lower resolution.`;
  }
}

/** What the layout of the picture warns of, in words (see `exportLayout`). */
export function warningText(warning: ExportWarning): string {
  switch (warning) {
    case 'map_narrow':
      return 'The legend takes more than half of the width, so the map is narrow. A wider picture, or no legend, gives the map more room.';
    case 'no_room_for_map':
      return 'The legend leaves no room for the map. Make the picture wider, or leave the legend out.';
  }
}

/** Characters that no file name can have on some system (the separators of paths, the marks of drives and wildcards) and control characters. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * The name of the file for what was typed, without the ".png" (the dialog shows that after the field): the forbidden characters become hyphens (so `../../etc/passwd` is
 * `etc-passwd`), a ".png" the person typed is not doubled, spaces, dots and hyphens at the ends go, it is at most `MAX_FILE_NAME` characters, and nothing is `DEFAULT_FILE_NAME`.
 */
export function fileNameOf(typed: string): string {
  const cleaned = typed
    .replace(FORBIDDEN, '-')
    .replace(/(\.png)+\s*$/i, '')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, MAX_FILE_NAME)
    .replace(/[.\s-]+$/g, '');
  return cleaned === '' ? DEFAULT_FILE_NAME : cleaned;
}

/** The least a custom side is, for the field's hint. */
export { MIN_EXPORT_SIDE };
