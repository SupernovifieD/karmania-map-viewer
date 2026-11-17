/**
 * The furniture of the exported picture, drawn on a canvas from the same models as on the screen (step 22.2): the north arrow, with the needle of the screen's own
 * drawing (the three paths of the scene package, as `Path2D`), and the scale bar, from the scene's model, in a box like the one over the map. Everything is the light
 * theme's. Lengths are of a screen of 96 to the inch times `scale` (`dpi / 96`), and whole pixels.
 */
import {
  EXPORT_COLOURS,
  EXPORT_FURNITURE,
  EXPORT_SCALE_BAR,
  EXPORT_TYPE,
  NORTH_ARROW_BOX,
  NORTH_ARROW_CENTRE,
  NORTH_ARROW_HEAD,
  NORTH_ARROW_LETTER,
  NORTH_ARROW_STROKE,
  NORTH_ARROW_TAIL,
} from '@karmania/scene';
import type { Rect, ScaleBar, Size } from '@karmania/scene';
import { atScale } from './canvas-2d.js';
import type { Canvas2d } from './canvas-2d.js';

/** The box that the furniture is on: raised, with a line round it just inside the rectangle, and corners. */
function drawBox(ctx: Canvas2d, rect: Rect, scale: number, line: string): void {
  const at = atScale(scale);
  const border = Math.max(1, at(EXPORT_FURNITURE.border));
  ctx.beginPath();
  ctx.roundRect(
    rect.x + border / 2,
    rect.y + border / 2,
    rect.width - border,
    rect.height - border,
    at(EXPORT_FURNITURE.radius) - border / 2,
  );
  ctx.fillStyle = EXPORT_COLOURS.raised;
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = border;
  ctx.stroke();
}

/**
 * The north arrow in `rect` (a square of 40 times `scale`): the button's box, and the needle turned by `angle` degrees clockwise about the middle of it
 * (`northArrow(heading).angle`: the screen's needle, which is drawn at the angle of the map's turn to the other way). The needle is the paths of the scene package in a
 * box of 40 that is scaled to the rectangle.
 */
export function drawNorthArrow(ctx: Canvas2d, rect: Rect, angle: number, scale: number): void {
  ctx.save();
  drawBox(ctx, rect, scale, EXPORT_COLOURS.border);
  ctx.translate(rect.x, rect.y);
  const factor = rect.width / NORTH_ARROW_BOX;
  ctx.scale(factor, factor);
  ctx.translate(NORTH_ARROW_CENTRE, NORTH_ARROW_CENTRE);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-NORTH_ARROW_CENTRE, -NORTH_ARROW_CENTRE);
  ctx.lineWidth = NORTH_ARROW_STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = EXPORT_COLOURS.text;
  ctx.stroke(new Path2D(NORTH_ARROW_LETTER));
  ctx.fillStyle = EXPORT_COLOURS.accent;
  ctx.fill(new Path2D(NORTH_ARROW_HEAD));
  ctx.strokeStyle = EXPORT_COLOURS.muted;
  ctx.stroke(new Path2D(NORTH_ARROW_TAIL));
  ctx.restore();
}

/** The font of the label of the scale bar, at the scale of the picture. */
export function captionFont(scale: number): string {
  return `${String(EXPORT_TYPE.regular)} ${String(atScale(scale)(EXPORT_TYPE.caption.size))}px ${EXPORT_TYPE.family}`;
}

/** The parts of the scale bar's box, in pixels of the picture, from its left. */
interface BarParts {
  readonly border: number;
  readonly pad: number;
  readonly bar: number;
  readonly gap: number;
  readonly label: number;
  readonly height: number;
}

function partsOf(ctx: Canvas2d, bar: ScaleBar, scale: number): BarParts {
  const at = atScale(scale);
  ctx.font = captionFont(scale);
  return {
    border: Math.max(1, at(EXPORT_FURNITURE.border)),
    pad: at(8),
    // A whole number of pixels, so that the ticks are on pixels, and no wider than the screen's bar is at the scale of the picture.
    bar: Math.max(1, Math.round(bar.widthPx * scale)),
    gap: at(EXPORT_SCALE_BAR.gap),
    label: Math.ceil(ctx.measureText(bar.label).width),
    height: at(EXPORT_SCALE_BAR.height),
  };
}

/** How big the scale bar's box is in the picture: what the layout of the export is given. The font is set on the context, as the drawing sets it. */
export function measureScaleBar(ctx: Canvas2d, bar: ScaleBar, scale: number): Size {
  const parts = partsOf(ctx, bar, scale);
  return {
    width: 2 * parts.border + 2 * parts.pad + parts.bar + parts.gap + parts.label,
    height: parts.height,
  };
}

/**
 * The scale bar in `rect` (its place from the layout, of the size `measureScaleBar` gave): the box, a line with a tick up from each end as wide as the model says, and the
 * length after it. The line is as thick as a pixel of the screen is at this scale.
 */
export function drawScaleBar(ctx: Canvas2d, rect: Rect, bar: ScaleBar, scale: number): void {
  ctx.save();
  const parts = partsOf(ctx, bar, scale);
  const at = atScale(scale);
  drawBox(ctx, rect, scale, EXPORT_COLOURS.divider);
  const line = Math.max(1, at(EXPORT_SCALE_BAR.line / 2));
  const left = rect.x + parts.border + parts.pad;
  const base = rect.y + (rect.height + at(8)) / 2;
  const top = base - at(8);
  ctx.beginPath();
  ctx.moveTo(left + line / 2, top);
  ctx.lineTo(left + line / 2, base - line / 2);
  ctx.lineTo(left + parts.bar - line / 2, base - line / 2);
  ctx.lineTo(left + parts.bar - line / 2, top);
  ctx.lineWidth = line;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = EXPORT_COLOURS.text;
  ctx.stroke();
  ctx.font = captionFont(scale);
  ctx.fillStyle = EXPORT_COLOURS.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(bar.label, left + parts.bar + parts.gap, rect.y + rect.height / 2);
  ctx.restore();
}
