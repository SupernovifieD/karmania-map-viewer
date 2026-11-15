/**
 * What the style editor of the Legend tab does with a layer's style, as functions, so that it is tried without a browser: the choices of "Colour by", what
 * choosing one makes of the colour, and what a person typing a colour is understood to mean (section 10.3 of the brief).
 */
import type { Summary } from '@karmania/engine';
import type { ClassMethod } from '@karmania/engine/display';
import { DEFAULT_CLASSES, DEFAULT_METHOD, DEFAULT_RAMP, RAMPS, rampById } from '@karmania/scene';
import type { ClassColour, LayerColour, LayerStyle, Ramp, SceneDocument } from '@karmania/scene';
import type { SelectOption } from '@karmania/ui';
import { safeColour } from './legend-swatch.js';

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

/** The methods of classes, in the order the brief lists them, with the words for each. */
const METHODS: readonly { readonly value: ClassMethod; readonly label: string }[] = [
  { value: 'equal', label: 'Equal intervals' },
  { value: 'quantile', label: 'Quantiles' },
  { value: 'jenks', label: 'Natural breaks' },
  { value: 'categories', label: 'Categories' },
];

/**
 * The choices of "Method" for a column: every method for a column of numbers, and for any other kind of column only `Categories`, since the others make
 * intervals of numbers (the engine says that it cannot, and the options that would only say so are not offered: they are there and cannot be chosen).
 */
export function methodOptions(column: ColumnInfo | undefined): SelectOption[] {
  const numbers = column?.type === 'float' || column?.type === 'int';
  return METHODS.map((method) => ({
    value: method.value,
    label: method.label,
    disabled: !numbers && method.value !== 'categories',
  }));
}

/** The method that a choice of "Method" is: `undefined` for a value that is not a method, and for one that the column cannot have (it is not offered). */
export function methodChoice(
  value: string,
  column: ColumnInfo | undefined,
): ClassMethod | undefined {
  const offered = methodOptions(column).find((option) => option.value === value);
  return METHODS.find((method) => method.value === value && offered?.disabled !== true)?.value;
}

/** The fewest and the most classes the editor asks for (the scene accepts 2 to 20: a layer that has another number keeps it, and is shown with it). */
export const FEWEST_CLASSES = 3;
export const MOST_CLASSES = 12;

/** The choices of "Classes": 3 to 12, and the number the layer has if it is not among them. */
export function classCountOptions(current: number): SelectOption[] {
  const counts = new Set<number>();
  for (let count = FEWEST_CLASSES; count <= MOST_CLASSES; count += 1) {
    counts.add(count);
  }
  counts.add(current);
  return [...counts]
    .sort((a, b) => a - b)
    .map((count) => ({ value: String(count), label: String(count) }));
}

/** The number of classes that a choice of "Classes" is: `undefined` for text that is not a whole number. */
export function classCountChoice(value: string): number | undefined {
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

/** A ramp as the picker lists it: its id, its name, what kind it is and its colours. */
export type RampOption = Pick<Ramp, 'id' | 'name' | 'kind' | 'colours'>;

/** The ramps there are, in the order the scene lists them: the sequential ones, the diverging ones, the categorical ones. */
export function rampOptions(): readonly RampOption[] {
  return RAMPS.map(({ id, name, kind, colours }) => ({ id, name, kind, colours }));
}

/**
 * The `background` of the preview of a ramp: its colours blended from one end to the other for a sequential or diverging ramp, and one stripe each, with hard
 * edges, for a categorical one (its colours are not steps of one scale); the other way round if the ramp is reversed. Colours go into it only as `#rrggbb`.
 */
export function rampPreview(
  colours: readonly string[],
  kind: Ramp['kind'],
  reverse: boolean,
): string {
  const list = (reverse ? [...colours].reverse() : [...colours]).map(safeColour);
  if (list.length === 0) {
    return 'transparent';
  }
  if (kind !== 'categorical') {
    return `linear-gradient(to right, ${list.join(', ')})`;
  }
  const stops = list.map((colour, at) => {
    const from = Number(((at / list.length) * 100).toFixed(4));
    const to = Number((((at + 1) / list.length) * 100).toFixed(4));
    return `${colour} ${String(from)}% ${String(to)}%`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** What a change of the method, the number of classes, the ramp or its direction makes of the classes of a layer; `undefined` when nothing changes. */
export function classesWith(
  current: ClassColour,
  change: Partial<Pick<ClassColour, 'method' | 'classes' | 'ramp' | 'reverse'>>,
): ClassColour | undefined {
  const next = { ...current, ...change };
  return next.method === current.method &&
    next.classes === current.classes &&
    next.ramp === current.ramp &&
    next.reverse === current.reverse
    ? undefined
    : next;
}
