/**
 * The exported picture (step 22.4), put together from the pieces: the map drawn by the renderer into the rectangle the layout gives it, a line round it, the north arrow
 * and the scale bar inside it, and the legend to the right of it, all on a canvas of the picture's size, in the light theme (brief 10.6). The layout is the scene's
 * (`exportLayout`); the drawing is `export-furniture.ts` and `export-legend.ts`; the map is asked of whatever `renderMap` is (the renderer's `renderExport`), in bands that
 * are put on the canvas as they come, so no array of the whole picture is held. The canvas and the images are given by an environment, so that this is tested without a browser.
 */
import {
  EXPORT_COLOURS,
  exportCamera2d,
  exportCamera3d,
  exportLayout,
  exportLegendLines,
  northArrow,
  scaleBar,
} from '@karmania/scene';
import type {
  Camera2d,
  Camera3d,
  ExportLayout,
  ExportLine,
  LegendModel,
  ScaleBarModel,
  Size,
  ViewMode,
} from '@karmania/scene';
import { atScale } from './canvas-2d.js';
import type { Canvas2d } from './canvas-2d.js';
import { drawNorthArrow, drawScaleBar, measureScaleBar } from './export-furniture.js';
import { loadExportFonts } from './export-fonts.js';
import type { FontSet } from './export-fonts.js';
import { drawLegend, measureLegendLine } from './export-legend.js';

/** Why a picture could not be put together. */
export type ComposeErrorCode =
  /** The legend takes all the width, so there is no room for the map. */
  'no_room_for_map';

/** What goes wrong with putting a picture together that is not a mistake of the caller. */
export class ComposeError extends Error {
  readonly code: ComposeErrorCode;

  constructor(code: ComposeErrorCode, message: string) {
    super(message);
    this.name = 'ComposeError';
    this.code = code;
  }
}

/** A canvas of a size, and its context. `C` is the canvas, which is what comes back: a page's `HTMLCanvasElement`. */
export interface ComposeEnv<C> {
  createCanvas(width: number, height: number): { readonly canvas: C; readonly ctx: Canvas2d };
  /** An image of `width` by `height` pixels from rows of four bytes a pixel, which is not kept (it is put on the canvas and let go). */
  image(rows: Uint8Array, width: number, height: number): ImageData;
}

/** What the map's rectangle is asked of the renderer as. */
export interface MapRequest {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly viewMode: ViewMode;
  readonly camera2d: Camera2d;
  readonly camera3d: Camera3d;
  /** The rows of the picture come to this from the top, a band at a time. */
  readonly onBand: (rows: Uint8Array, first: number, count: number) => void;
  readonly signal?: AbortSignal;
  /** The part of the map done, from 0 to 1. */
  readonly onProgress?: (done: number) => void;
}

/** What a picture is put together from. */
export interface ComposeInput {
  /** The size of the picture, in pixels. */
  readonly size: Size;
  readonly dpi: number;
  /** The legend model, or `null` for a picture with no legend (the map takes all the width). */
  readonly legend: LegendModel | null;
  /** The view and the two cameras of the scene, and the heading of the view that is shown (what the north arrow turns by). */
  readonly viewMode: ViewMode;
  readonly camera2d: Camera2d;
  readonly camera3d: Camera3d;
  readonly heading: number;
  /** The units of the map's coordinate system, for the scale bar (see `scaleBar`). */
  readonly units: Parameters<typeof scaleBar>[0]['units'];
  /** The size of the map on screen, in CSS pixels: the picture shows at least what is visible there. */
  readonly screen: Size;
  readonly fonts: FontSet;
  /** Draws the map for a picture: the renderer's `renderExport`, with the colours of the light theme. */
  readonly renderMap: (request: MapRequest) => Promise<void>;
  readonly signal?: AbortSignal;
  /** How far the whole picture is, from 0 to 1 (counted in steps, never in time). */
  readonly onProgress?: (done: number) => void;
}

/** What a person (or the dialog) asks of a picture: its size and dpi, whether it has a legend, and the way to stop it and to hear how far it is. */
export interface PictureOptions {
  /** The size of the picture, in pixels. */
  readonly size: Size;
  readonly dpi: number;
  /** Whether the legend is put to the right of the map. */
  readonly legend: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number) => void;
}

/** What `exportPng` is asked for (brief 11.8): the size of the picture in pixels, its dpi, and whether the legend is put to the right of the map. */
export interface ExportPngOptions {
  readonly widthPx: number;
  readonly heightPx: number;
  /** Dots to the inch, above 0: written in the file, and the scale that the sizes of the screen are drawn at (`dpi / 96`). The dialog offers 96, 150 and 300. */
  readonly dpi: number;
  readonly legend: boolean;
}

/** How an export is stopped and watched. */
export interface ExportPngRun {
  /** Stops it; `exportPng` then rejects with the signal's reason. */
  readonly signal?: AbortSignal;
  /** Called with how far it is, from 0 to 1, in steps and never in time. */
  readonly onProgress?: (done: number) => void;
}

/** What is made. */
export interface Composed<C> {
  readonly canvas: C;
  readonly layout: ExportLayout;
  /** The scale bar that was drawn, or why there was none. */
  readonly scaleBar: ScaleBarModel;
  /** The map's own rectangle, inside its line, in pixels of the picture. */
  readonly map: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** How much of the whole is done when the fonts are, and when the map is: the furniture and the legend are the rest. */
const DONE_FONTS = 0.02;
const DONE_MAP = 0.95;

/** What is worked out before anything is drawn: where everything goes, and what the map is asked for. */
export interface ExportPlan {
  /** `dpi / 96`. */
  readonly scale: number;
  readonly layout: ExportLayout;
  /** The map's own rectangle, inside its line, in pixels of the picture. */
  readonly inner: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** The cameras of the picture for the map's rectangle. */
  readonly camera2d: Camera2d;
  readonly camera3d: Camera3d;
  /** The scale bar, or why there is none. */
  readonly bar: ScaleBarModel;
  readonly lines: readonly ExportLine[];
  /** The line round the map, in pixels. */
  readonly border: number;
}

/**
 * Works out the picture: its layout, the map's rectangle and cameras, and the scale bar. `ctx` is only used to measure text, in the fonts of the picture, which are to be loaded
 * already. The layout is made twice: the map's rectangle does not depend on the scale bar, but the scale bar depends on the map (the units to a pixel are those of the camera
 * that shows it, which are worked out for the map's rectangle), so the first layout gives the map and the second gives the bar its place.
 *
 * @throws ComposeError `no_room_for_map` if the legend leaves no room for the map; RangeError for a size or dpi that is not a number above 0 (`exportLayout`).
 */
export function planExport(ctx: Canvas2d, input: ComposeInput): ExportPlan {
  const { size, dpi } = input;
  const scale = dpi / 96;
  const lines = input.legend === null ? [] : exportLegendLines(input.legend);
  const measure = (line: ExportLine): Size => measureLegendLine(ctx, line, scale);
  const first = exportLayout({ size, dpi, lines, measure, scaleBar: null });
  const border = Math.max(1, atScale(scale)(1));
  const inner = {
    x: first.map.x + border,
    y: first.map.y + border,
    width: first.map.width - 2 * border,
    height: first.map.height - 2 * border,
  };
  if (inner.width < 1 || inner.height < 1) {
    throw new ComposeError('no_room_for_map', 'The legend leaves no room for the map.');
  }
  // The cameras of the picture, for the map's rectangle, and so the units to a pixel that the scale bar is measured in (a pixel of the screen).
  const camera2d = exportCamera2d(input.camera2d, input.screen, inner, scale);
  const camera3d = exportCamera3d(input.camera3d, input.screen, inner);
  const bar = scaleBar({
    viewMode: input.viewMode,
    units: input.units,
    unitsPerPixel: camera2d.unitsPerPixel,
  });
  const layout = exportLayout({
    size,
    dpi,
    lines,
    measure,
    scaleBar: bar.kind === 'bar' ? measureScaleBar(ctx, bar, scale) : null,
  });
  return { scale, layout, inner, camera2d, camera3d, bar, lines, border };
}

/**
 * The plan of a picture for a page that has not made it yet (the export dialog, which warns before it exports): the fonts are loaded, and then `planExport` is made on a context
 * that is only measured with. Rejects as `composeExport` does for the fonts and for no room for the map.
 */
export async function planOnly(measure: Canvas2d, input: ComposeInput): Promise<ExportPlan> {
  input.signal?.throwIfAborted();
  await loadExportFonts(input.fonts, input.dpi / 96);
  input.signal?.throwIfAborted();
  return planExport(measure, input);
}

/**
 * Puts the picture together (see `planExport` for how it is laid out). The scale is `dpi / 96`.
 *
 * @throws ComposeError `no_room_for_map` if the legend leaves no room for the map; `ExportFontError` if the font is not there; whatever `renderMap` rejects with
 * (an `ExportError`, an abort); the signal's reason if it is aborted. A size or dpi that is not a number above 0 is a RangeError (`exportLayout`).
 */
export async function composeExport<C>(
  env: ComposeEnv<C>,
  input: ComposeInput,
): Promise<Composed<C>> {
  const { size, signal, onProgress } = input;
  signal?.throwIfAborted();
  await loadExportFonts(input.fonts, input.dpi / 96);
  signal?.throwIfAborted();
  onProgress?.(DONE_FONTS);

  const { canvas, ctx } = env.createCanvas(size.width, size.height);
  const { scale, layout, inner, camera2d, camera3d, bar, border } = planExport(ctx, input);

  // The page, the line round the map, and the map as its bands come.
  ctx.fillStyle = EXPORT_COLOURS.surface;
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.save();
  ctx.strokeStyle = EXPORT_COLOURS.border;
  ctx.lineWidth = border;
  ctx.strokeRect(
    layout.map.x + border / 2,
    layout.map.y + border / 2,
    layout.map.width - border,
    layout.map.height - border,
  );
  ctx.restore();
  await input.renderMap({
    width: inner.width,
    height: inner.height,
    scale,
    viewMode: input.viewMode,
    camera2d,
    camera3d,
    onBand: (rows, firstRow, count) => {
      ctx.putImageData(env.image(rows, inner.width, count), inner.x, inner.y + firstRow);
    },
    ...(signal === undefined ? {} : { signal }),
    onProgress: (done) => onProgress?.(DONE_FONTS + (DONE_MAP - DONE_FONTS) * done),
  });
  signal?.throwIfAborted();

  // The furniture is over the map, and the legend beside it.
  drawNorthArrow(ctx, layout.northArrow, northArrow(input.heading).angle, scale);
  if (layout.scaleBar !== null && bar.kind === 'bar') {
    drawScaleBar(ctx, layout.scaleBar, bar, scale);
  }
  drawLegend(ctx, layout, scale);
  onProgress?.(1);
  return { canvas, layout, scaleBar: bar, map: inner };
}

/** The environment of a page: a canvas of the document, and images made from the bytes of a band without copying them. */
export function browserEnv(doc: Document): ComposeEnv<HTMLCanvasElement> {
  return {
    createCanvas(width, height) {
      const canvas = doc.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      // sRGB and opaque-looking: a canvas whose alpha is not asked for would be given LCD text, whose coloured fringes would be in the picture; this one has alpha, and is filled white first.
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
      if (ctx === null) {
        throw new Error('The browser gave no canvas to draw the picture on.');
      }
      return { canvas, ctx };
    },
    image(rows, width, height) {
      // (The bands are made here from plain buffers; an image cannot be made of a shared one.)
      if (!(rows.buffer instanceof ArrayBuffer)) {
        throw new TypeError(
          'The rows of the picture are in a shared buffer, which an image cannot be made of.',
        );
      }
      const view = new Uint8ClampedArray(rows.buffer, rows.byteOffset, width * height * 4);
      return new ImageData(view, width, height, { colorSpace: 'srgb' });
    },
  };
}
