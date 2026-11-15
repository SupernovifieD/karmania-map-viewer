/**
 * What the style editor of the Legend tab does with a layer's style, as functions, so that it is tried without a browser: the choices of "Colour by", what
 * choosing one makes of the colour, and what a person typing a colour is understood to mean (section 10.3 of the brief).
 */
import type { Summary } from '@karmania/engine';
import { DEFAULT_CLASSES, DEFAULT_METHOD, DEFAULT_RAMP, rampById } from '@karmania/scene';
import type { LayerColour, LayerStyle, SceneDocument } from '@karmania/scene';
import type { SelectOption } from '@karmania/ui';

/** The twelve colours of the swatches that a single colour is chosen from: the ramp `Paired` (ColorBrewer), which is twelve colours that can be told apart. */
export const SWATCHES: readonly string[] = rampById('paired')?.colours ?? [];

/** The value of the choice "Single colour"; a column is `column:` and its name. */
export const SINGLE = 'single';

const COLUMN = 'column:';

/** A column of a dataset, as far as the editor needs it. */
export type ColumnInfo = Pick<Summary['columns'][number], 'name' | 'type'>;

/** What the editor of one layer is given: what its dataset is (a kind and columns) and the style it has now. */
export interface StyleInfo {
  readonly kind: Summary['kind'];
  readonly columns: readonly ColumnInfo[];
  readonly style: LayerStyle;
}

/** The styles of the layers of a scene, with what their datasets are, by layer id; a layer whose dataset is not known is left out. */
export function styleInfos(
  doc: SceneDocument,
  datasets: readonly Summary[],
): Readonly<Record<string, StyleInfo>> {
  const found: Record<string, StyleInfo> = {};
  for (const layer of Object.values(doc.layers)) {
    const dataset = datasets.find((candidate) => candidate.id === layer.datasetId);
    if (dataset !== undefined) {
      found[layer.id] = {
        kind: dataset.kind,
        columns: dataset.columns.map(({ name, type }) => ({ name, type })),
        style: layer.style,
      };
    }
  }
  return found;
}

/** The choices of "Colour by": a single colour, or each column of the dataset. */
export function colourByOptions(columns: readonly ColumnInfo[]): SelectOption[] {
  return [
    { value: SINGLE, label: 'Single colour' },
    ...columns.map((column) => ({ value: `${COLUMN}${column.name}`, label: column.name })),
  ];
}

/** The choice that a colour is: `single`, or `column:` and the name of the column it is classified by. */
export function colourByValue(colour: LayerColour): string {
  return colour.mode === 'single' ? SINGLE : `${COLUMN}${colour.column}`;
}

/**
 * What choosing `choice` makes of the colour of a layer that has `current`: **a single colour** (the first swatch), or **classes of the column**, with the
 * method that its kind of values asks for (equal intervals for numbers and one class for each value for the rest, which is what the other methods cannot
 * do) and a ramp that suits it, keeping the number of classes and the direction of the ramp that the layer had if it was by classes already. `undefined`
 * when it would change nothing (the choice is what it is already) or the choice is not one there is.
 */
export function colourFor(
  choice: string,
  current: LayerColour,
  columns: readonly ColumnInfo[],
): LayerColour | undefined {
  if (choice === colourByValue(current)) {
    return undefined;
  }
  if (choice === SINGLE) {
    return { mode: 'single', value: SWATCHES[0] ?? '#0072b2' };
  }
  const column = columns.find((candidate) => `${COLUMN}${candidate.name}` === choice);
  if (column === undefined) {
    return undefined;
  }
  const numbers = column.type === 'float' || column.type === 'int';
  return {
    mode: 'classes',
    column: column.name,
    method: numbers ? DEFAULT_METHOD : 'categories',
    classes: current.mode === 'classes' ? current.classes : DEFAULT_CLASSES,
    ramp: numbers ? DEFAULT_RAMP : 'okabe-ito',
    reverse: current.mode === 'classes' ? current.reverse : false,
  };
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The `#rrggbb` that some text a person typed means, in lower case: six hex digits or three (each doubled), with or without the `#`, and space round it
 * ignored. `undefined` for anything else.
 */
export function colourFromText(text: string): string | undefined {
  const match = HEX.exec(text.trim());
  const digits = match?.[1];
  if (digits === undefined) {
    return undefined;
  }
  const full = digits.length === 3 ? digits.replace(/./g, '$&$&') : digits;
  return `#${full.toLowerCase()}`;
}
