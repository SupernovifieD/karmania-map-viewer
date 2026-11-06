/**
 * The style a new layer starts with (section 11.6 of the brief), the same every time for the same dataset and the same
 * place in the order of loading: no randomness and no clock.
 */
import type { ColumnSummary, Kind, Summary } from '@karmania/engine/types';
import { rampById } from './ramps.js';
import type { LayerStyle } from './types.js';

/** A point is drawn this wide, in pixels. */
export const DEFAULT_POINT_SIZE = 6;
/** A line is drawn this wide, in pixels. */
export const DEFAULT_LINE_WIDTH = 2;
/** What everything is drawn at but polygons: solid. */
export const DEFAULT_OPACITY = 1;
/** Polygons are drawn at this opacity, so that what is under them shows. */
export const DEFAULT_POLYGON_OPACITY = 0.6;
/** A grid or a block model is coloured in this many classes... */
export const DEFAULT_CLASSES = 7;
/** ...from the ramp... */
export const DEFAULT_RAMP = 'viridis';
/** ...divided by equal intervals. */
export const DEFAULT_METHOD = 'equal';

/** The part of a dataset's summary that decides how it starts out. */
export type DatasetBrief = Pick<Summary, 'kind' | 'elementCount' | 'columns'>;

/** The colours new layers take in turn: those of the Okabe-Ito palette, in its order for the map. */
export const LAYER_COLOURS: readonly string[] = rampById('okabe-ito')?.colours ?? [];

/**
 * The colour of the layer that is the `ordinal`th one made (from 0): the next of the palette, and the first again
 * after the last.
 */
export function layerColour(ordinal: number): string {
  const colour = LAYER_COLOURS[ordinal % LAYER_COLOURS.length];
  if (colour === undefined) {
    throw new RangeError(`There is no colour for layer number ${String(ordinal)}.`);
  }
  return colour;
}

function isNumeric(column: ColumnSummary, rows: number): boolean {
  return (column.type === 'float' || column.type === 'int') && column.nullCount < rows;
}

/** The first column that holds numbers and at least one value, or `undefined`. */
export function firstNumericColumn(dataset: DatasetBrief): string | undefined {
  return dataset.columns.find((column) => isNumeric(column, dataset.elementCount))?.name;
}

const SHAPES_BY_CLASS: readonly Kind[] = ['grid', 'blocks'];

/**
 * The style of a new layer of `dataset`, which is the `ordinal`th layer made (from 0). A grid or a block model is
 * coloured by its first numeric column; anything else, and a grid with no column of numbers, has the next colour
 * of the palette, and the size or opacity of its kind.
 */
export function defaultStyle(dataset: DatasetBrief, ordinal: number): LayerStyle {
  const column = SHAPES_BY_CLASS.includes(dataset.kind) ? firstNumericColumn(dataset) : undefined;
  const colour: LayerStyle['colour'] =
    column === undefined
      ? { mode: 'single', value: layerColour(ordinal) }
      : {
          mode: 'classes',
          column,
          method: DEFAULT_METHOD,
          classes: DEFAULT_CLASSES,
          ramp: DEFAULT_RAMP,
          reverse: false,
        };
  switch (dataset.kind) {
    case 'points':
      return { colour, opacity: DEFAULT_OPACITY, pointSize: DEFAULT_POINT_SIZE };
    case 'lines':
      return { colour, opacity: DEFAULT_OPACITY, lineWidth: DEFAULT_LINE_WIDTH };
    case 'polygons':
      return { colour, opacity: DEFAULT_POLYGON_OPACITY };
    case 'mesh':
    case 'grid':
    case 'blocks':
      return { colour, opacity: DEFAULT_OPACITY };
    default: {
      const kind: unknown = dataset.kind;
      throw new TypeError(
        `There is no default style for a dataset of the kind ${JSON.stringify(kind)}.`,
      );
    }
  }
}
