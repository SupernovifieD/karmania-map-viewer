/**
 * Where everything goes in the exported picture (section 10.6 of the brief): the map with its north arrow and scale
 * bar, and the legend in columns to the right of it. Pure arithmetic in pixels of the picture: the text is measured by a
 * callback (the export measures with the real font, the tests with a fake one), so the layout depends on nothing
 * of the platform. Every length of the brief is in pixels of a screen of 96 to the inch and is multiplied by
 * `dpi / 96` here, and all of them are whole pixels, so that the border of the map is one crisp line.
 */
import type { ExportLine } from './export-lines.js';

/** A size in pixels of the picture. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A rectangle in pixels of the picture, the origin at the top left. */
export interface Rect extends Size {
  readonly x: number;
  readonly y: number;
}

/** What the layout is made from. */
export interface ExportLayoutInput {
  /** The size of the picture, in pixels. */
  readonly size: Size;
  /** Dots to the inch of the picture: 96 is the size of the screen. */
  readonly dpi: number;
  /** The lines of the legend, from `exportLegendLines`. */
  readonly lines: readonly ExportLine[];
  /** How big a line is when it is drawn, in pixels of the picture: its natural width and its height. */
  readonly measure: (line: ExportLine) => Size;
  /** The size of the scale bar in pixels of the picture, or `null` if there is none (3D, degrees, no scale). */
  readonly scaleBar: Size | null;
}

/** A line of the legend, and where it goes. */
export interface PlacedLine {
  readonly line: ExportLine;
  readonly rect: Rect;
}

/** A column of the legend. */
export interface LegendColumn {
  readonly rect: Rect;
  readonly lines: readonly PlacedLine[];
}

/** What the export dialog tells the person before it exports. */
export type ExportWarning = 'map_narrow' | 'no_room_for_map';

/** The layout of the picture. */
export interface ExportLayout {
  readonly size: Size;
  /** `dpi / 96`. */
  readonly scale: number;
  /** The frame of the map, border included. */
  readonly map: Rect;
  /** Inside the map, at the top right. */
  readonly northArrow: Rect;
  /** Inside the map, at the bottom left; `null` if there is none. */
  readonly scaleBar: Rect | null;
  /** The columns of the legend, left to right; none if there is nothing to list. */
  readonly columns: readonly LegendColumn[];
  /** The one rectangle that all the columns are in, or `null` if there are none. */
  readonly legend: Rect | null;
  /**
   * `map_narrow` when the map is less than half of the picture wide (section 10.6: the dialog warns), and
   * `no_room_for_map` when the legend leaves no width for a map at all.
   */
  readonly warnings: readonly ExportWarning[];
}

/** The margin all round the picture, in pixels of a screen. */
export const MARGIN = 24;
/** The space between the map and the legend. */
export const LEGEND_GAP = 24;
/** The space between two columns of the legend. */
export const COLUMN_GAP = 16;
/** The least and the most a column of the legend is wide. */
export const COLUMN_WIDTH = { min: 200, max: 320 } as const;
/** The side of the north arrow. */
export const NORTH_ARROW_SIZE = 40;
/** The space between the north arrow or the scale bar and the edge of the map. */
export const FURNITURE_INSET = 16;

/** Whether a line has to be kept with the line that follows it: a heading, or a layer that has lines of classes. */
function keepsWithNext(line: ExportLine): boolean {
  return line.kind === 'group' || (line.kind === 'layer' && line.hasClasses);
}

/**
 * The lines in columns of at most `height` pixels: top to bottom, then the next column. **A line that is a heading
 * (a group, or a layer that has lines of classes under it) is never the last of a column**, unless it is alone in it,
 * where nothing can be done, or unless it, what goes with it and the next line are together taller than a column, where moving them
 * would only make the next column too tall: the brief asks for this of group headings, and the same is done for layers with
 * classes, whose name would otherwise be left at the bottom with its classes at the top of the next column. A line
 * that is taller than a column has a column of its own.
 */
function inColumns(
  lines: readonly { line: ExportLine; size: Size }[],
  height: number,
): { line: ExportLine; size: Size }[][] {
  const columns: { line: ExportLine; size: Size }[][] = [];
  let column: { line: ExportLine; size: Size }[] = [];
  let used = 0;
  for (const item of lines) {
    if (column.length > 0 && used + item.size.height > height) {
      // The lines at the end that go with the line that is next move with it, one after the other (a group heading
      // and then the name of the layer under it), but never all of the column.
      const moved: { line: ExportLine; size: Size }[] = [];
      for (
        let last = column.at(-1);
        column.length > 1 && last !== undefined && keepsWithNext(last.line);
        last = column.at(-1)
      ) {
        const taken = column.pop();
        if (taken !== undefined) {
          moved.unshift(taken);
        }
      }
      // They go only if they fit in the next column together with the line that is waiting: a heading that would make
      // that column taller than the picture stays where it is, which is the one thing the rule gives way to.
      const together =
        moved.reduce((sum, placed) => sum + placed.size.height, 0) + item.size.height;
      if (together > height) {
        column.push(...moved);
        moved.length = 0;
      }
      columns.push(column);
      column = moved;
      used = column.reduce((sum, placed) => sum + placed.size.height, 0);
    }
    column.push(item);
    used += item.size.height;
  }
  if (column.length > 0) {
    columns.push(column);
  }
  return columns;
}

/**
 * The layout of the picture: a margin of 24 all round, the map on the left with its north arrow (40) at the top right and
 * its scale bar at the bottom left (both 16 in), and to the right of it, 24 away and from the same top, the
 * legend in columns of the width of the widest line (not less than 200 nor more than 320) 16 apart, which take the
 * height between the margins. The map has the width that is left. All the lengths are in pixels of a screen and
 * are multiplied by `dpi / 96`, rounded to whole pixels; the sizes that `measure` gives are rounded up.
 *
 * @throws RangeError if the picture or the dpi is not a number above 0: the export dialog limits both, so it is a mistake.
 */
export function exportLayout(input: ExportLayoutInput): ExportLayout {
  const { size, dpi } = input;
  if (![size.width, size.height, dpi].every((n) => Number.isFinite(n) && n > 0)) {
    throw new RangeError(
      `The picture and its dpi must be numbers above 0, not ${String(size.width)} x ${String(size.height)} at ${String(dpi)}.`,
    );
  }
  const scale = dpi / 96;
  const px = (length: number): number => Math.round(length * scale);
  const margin = px(MARGIN);
  const top = margin;
  const height = Math.max(0, size.height - 2 * margin);
  const measured = input.lines.map((line) => {
    const natural = input.measure(line);
    return { line, size: { width: Math.ceil(natural.width), height: Math.ceil(natural.height) } };
  });
  const widest = Math.max(0, ...measured.map((item) => item.size.width));
  const columnWidth = Math.min(px(COLUMN_WIDTH.max), Math.max(px(COLUMN_WIDTH.min), widest));
  const groups = inColumns(measured, height);
  const columnGap = px(COLUMN_GAP);
  const legendWidth =
    groups.length === 0 ? 0 : groups.length * columnWidth + (groups.length - 1) * columnGap;
  const mapWidth =
    size.width - 2 * margin - (groups.length === 0 ? 0 : px(LEGEND_GAP) + legendWidth);
  const map: Rect = { x: margin, y: top, width: Math.max(0, mapWidth), height };
  const legendX = margin + map.width + px(LEGEND_GAP);
  const columns = groups.map((group, index): LegendColumn => {
    const x = legendX + index * (columnWidth + columnGap);
    let y = top;
    const lines = group.map((item): PlacedLine => {
      const rect = { x, y, width: columnWidth, height: item.size.height };
      y += item.size.height;
      return { line: item.line, rect };
    });
    return { rect: { x, y: top, width: columnWidth, height: y - top }, lines };
  });
  const arrow = px(NORTH_ARROW_SIZE);
  const inset = px(FURNITURE_INSET);
  const bar = input.scaleBar;
  const warnings: ExportWarning[] = [];
  if (mapWidth <= 0) {
    warnings.push('no_room_for_map');
  } else if (mapWidth < size.width / 2) {
    warnings.push('map_narrow');
  }
  return {
    size,
    scale,
    map,
    northArrow: {
      x: map.x + map.width - inset - arrow,
      y: map.y + inset,
      width: arrow,
      height: arrow,
    },
    scaleBar:
      bar === null
        ? null
        : {
            x: map.x + inset,
            y: map.y + map.height - inset - Math.ceil(bar.height),
            width: Math.ceil(bar.width),
            height: Math.ceil(bar.height),
          },
    columns,
    legend:
      columns.length === 0
        ? null
        : {
            x: legendX,
            y: top,
            width: legendWidth,
            height: Math.max(...columns.map((c) => c.rect.height)),
          },
    warnings,
  };
}
