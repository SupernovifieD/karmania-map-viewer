/**
 * The legend of the exported picture, drawn on a canvas from the lines of the scene (`exportLegendLines`, set in columns by `exportLayout`) in the light theme and the
 * type scale of the page (step 22.3). A row is as the Legend tab's: a layer has a swatch of 16 (or its ramp, 24 by 12) in a room of 24 so that the names of all the layers
 * of a level start at one place, then its name; a group is its name alone; a class is a swatch of 12 under the name of its layer, its label and, at the right edge of the column,
 * its count (muted: canvas has no tabular numerals, so numbers are right-aligned and line up, which is recorded). A name that is longer than its room is cut with an
 * ellipsis. Lengths are of a screen of 96 to the inch times `scale`, in whole pixels.
 */
import { EXPORT_COLOURS, EXPORT_TYPE, LEGEND_ROW } from '@karmania/scene';
import type { ExportLayout, ExportLine, PlacedLine, Size } from '@karmania/scene';
import { atScale } from './canvas-2d.js';
import type { Canvas2d } from './canvas-2d.js';
import { fontOf } from './export-fonts.js';
import { safeColour } from './legend-swatch.js';

const ELLIPSIS = '…';

/** The part of a text that fits in `room` pixels, with an ellipsis if it is cut: the whole text if it fits. The font is the context's. */
export function fitText(ctx: Canvas2d, text: string, room: number): string {
  if (ctx.measureText(text).width <= room) {
    return text;
  }
  let low = 0;
  let high = text.length;
  // The longest start of the text that, with the ellipsis, fits (a width only grows with the text).
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, middle)}${ELLIPSIS}`).width <= room) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low === 0 ? ELLIPSIS : `${text.slice(0, low).trimEnd()}${ELLIPSIS}`;
}

/** The fonts of the lines, at the scale of the picture. */
function fonts(scale: number): { name: string; group: string; entry: string } {
  return {
    name: fontOf(EXPORT_TYPE.regular, EXPORT_TYPE.name.size, scale),
    group: fontOf(EXPORT_TYPE.medium, EXPORT_TYPE.name.size, scale),
    entry: fontOf(EXPORT_TYPE.regular, EXPORT_TYPE.class.size, scale),
  };
}

/** How far in a line's own content starts from the left of its column, in pixels of the picture: a group's layers are one step in. */
function inset(line: ExportLine, scale: number): number {
  const at = atScale(scale);
  return line.kind !== 'group' && line.indented ? at(LEGEND_ROW.indent) : 0;
}

/** The room of a layer's swatch and the gap after it: where the name of a layer, and the swatch of its classes, start from the line's content. */
function nameAt(scale: number): number {
  const at = atScale(scale);
  return at(LEGEND_ROW.rampWidth) + at(LEGEND_ROW.gap);
}

/**
 * How big a line of the legend is: its natural width (what the layout makes the columns as wide as the widest of, between 200 and 320) and its height (the row's).
 * The font of the context is set, as drawing sets it.
 */
export function measureLegendLine(ctx: Canvas2d, line: ExportLine, scale: number): Size {
  const at = atScale(scale);
  const f = fonts(scale);
  switch (line.kind) {
    case 'group': {
      ctx.font = f.group;
      return { width: Math.ceil(ctx.measureText(line.name).width), height: at(LEGEND_ROW.group) };
    }
    case 'layer': {
      ctx.font = f.name;
      return {
        width: inset(line, scale) + nameAt(scale) + Math.ceil(ctx.measureText(line.name).width),
        height: at(LEGEND_ROW.layer),
      };
    }
    case 'class': {
      ctx.font = f.entry;
      const label = Math.ceil(ctx.measureText(line.entry.label).width);
      const count = Math.ceil(ctx.measureText(line.entry.countLabel).width);
      return {
        width:
          inset(line, scale) +
          nameAt(scale) +
          at(LEGEND_ROW.classSwatch) +
          at(LEGEND_ROW.gap) +
          label +
          at(LEGEND_ROW.countGap) +
          count,
        height: at(LEGEND_ROW.class),
      };
    }
  }
}

/**
 * A swatch: a box of `width` by `height` at `(x, y)` with a line round it of the border colour and corners of 4, filled with one colour, or with `fills` as stripes of the
 * same width side by side (a ramp: the classes are steps and not a blend), or with nothing (`null`: no value). Stripes start on whole pixels.
 */
function drawSwatch(
  ctx: Canvas2d,
  box: { x: number; y: number; width: number; height: number },
  fills: readonly string[] | null,
  scale: number,
): void {
  const at = atScale(scale);
  const border = Math.max(1, at(1));
  const radius = at(4);
  ctx.save();
  if (fills !== null && fills.length > 0) {
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.width, box.height, radius);
    ctx.clip();
    fills.forEach((fill, k) => {
      const from = Math.round(box.x + (box.width * k) / fills.length);
      const to = Math.round(box.x + (box.width * (k + 1)) / fills.length);
      ctx.fillStyle = safeColour(fill);
      ctx.fillRect(from, box.y, to - from, box.height);
    });
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(
    box.x + border / 2,
    box.y + border / 2,
    box.width - border,
    box.height - border,
    radius - border / 2,
  );
  ctx.strokeStyle = EXPORT_COLOURS.border;
  ctx.lineWidth = border;
  ctx.stroke();
  ctx.restore();
}

/** Draws one line of the legend in the rectangle the layout gave it: the width is its column's, the height its row's. */
export function drawLegendLine(ctx: Canvas2d, placed: PlacedLine, scale: number): void {
  const { line, rect } = placed;
  const at = atScale(scale);
  const f = fonts(scale);
  const left = rect.x + inset(line, scale);
  const right = rect.x + rect.width;
  const middle = rect.y + rect.height / 2;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  switch (line.kind) {
    case 'group': {
      ctx.font = f.group;
      ctx.fillStyle = EXPORT_COLOURS.text;
      ctx.fillText(fitText(ctx, line.name, right - left), left, middle);
      break;
    }
    case 'layer': {
      const ramp = line.swatch.kind === 'ramp';
      const [width, height] = ramp
        ? [at(LEGEND_ROW.rampWidth), at(LEGEND_ROW.rampHeight)]
        : [at(LEGEND_ROW.swatch), at(LEGEND_ROW.swatch)];
      drawSwatch(
        ctx,
        { x: left, y: Math.round(middle - height / 2), width, height },
        line.swatch.kind === 'ramp' ? line.swatch.colours : [line.swatch.colour],
        scale,
      );
      const x = left + nameAt(scale);
      ctx.font = f.name;
      ctx.fillStyle = EXPORT_COLOURS.text;
      ctx.fillText(fitText(ctx, line.name, right - x), x, middle);
      break;
    }
    case 'class': {
      const size = at(LEGEND_ROW.classSwatch);
      const swatchX = left + nameAt(scale);
      drawSwatch(
        ctx,
        { x: swatchX, y: Math.round(middle - size / 2), width: size, height: size },
        line.entry.colour === null ? null : [line.entry.colour],
        scale,
      );
      ctx.font = f.entry;
      // The count is at the right edge of the column, as wide as it is: numbers are right-aligned, and so line up whatever their digits are wide.
      const count = ctx.measureText(line.entry.countLabel).width;
      const labelX = swatchX + size + at(LEGEND_ROW.gap);
      ctx.fillStyle = EXPORT_COLOURS.text;
      ctx.fillText(
        fitText(ctx, line.entry.label, right - count - at(LEGEND_ROW.countGap) - labelX),
        labelX,
        middle,
      );
      ctx.fillStyle = EXPORT_COLOURS.muted;
      ctx.textAlign = 'right';
      ctx.fillText(line.entry.countLabel, right, middle);
      break;
    }
  }
  ctx.restore();
}

/** Draws every line of the legend where the layout put it. */
export function drawLegend(ctx: Canvas2d, layout: ExportLayout, scale: number): void {
  for (const column of layout.columns) {
    for (const placed of column.lines) {
      drawLegendLine(ctx, placed, scale);
    }
  }
}
