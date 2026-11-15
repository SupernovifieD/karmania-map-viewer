/**
 * What the style editor of the Legend tab does with a layer's style, as functions, so that it is tried without a browser: the choices of "Colour by", what
 * choosing one makes of the colour, what a person typing a colour is understood to mean, the fields of numbers (opacity, point size, line width) and what a
 * number that is typed or stepped is (section 10.3 of the brief).
 */
import type { Summary } from '@karmania/engine';
import type { ClassMethod } from '@karmania/engine/display';
import {
  DEFAULT_CLASSES,
  DEFAULT_LINE_WIDTH,
  DEFAULT_METHOD,
  DEFAULT_POINT_SIZE,
  DEFAULT_RAMP,
  RAMPS,
  rampById,
} from '@karmania/scene';
import type {
  ClassColour,
  LayerColour,
  LayerContours,
  LayerStyle,
  Ramp,
  SceneDocument,
  StylePatch,
} from '@karmania/scene';
import type { SelectOption } from '@karmania/ui';
import type { ContoursState } from './contours-manager.js';
import { safeColour } from './legend-swatch.js';

/** The twelve colours of the swatches that a single colour is chosen from: the ramp `Paired` (ColorBrewer), which is twelve colours that can be told apart. */
export const SWATCHES: readonly string[] = rampById('paired')?.colours ?? [];

/** The value of the choice "Single colour"; a column is `column:` and its name. */
export const SINGLE = 'single';

const COLUMN = 'column:';

/** A column of a dataset, as far as the editor needs it. */
export type ColumnInfo = Pick<Summary['columns'][number], 'name' | 'type'>;

/** The contours of a layer, as the editor is given them: the settings it has (none until they are turned on) and where making them is. */
export interface ContoursInfo {
  readonly settings: LayerContours | undefined;
  readonly state: ContoursState;
}

/**
 * What the editor of one layer is given: what its dataset is (a kind and columns), the style it has now, and, for a layer that can have contour lines (a grid
 * or a mesh that is not itself made from another layer), its contours.
 */
export interface StyleInfo {
  readonly kind: Summary['kind'];
  readonly columns: readonly ColumnInfo[];
  readonly style: LayerStyle;
  readonly contours?: ContoursInfo;
}

/** The styles of the layers of a scene, with what their datasets are, by layer id; a layer whose dataset is not known is left out. */
export function styleInfos(
  doc: SceneDocument,
  datasets: readonly Summary[],
  contoursState: (layerId: string) => ContoursState = () => ({ status: 'idle' }),
): Readonly<Record<string, StyleInfo>> {
  const found: Record<string, StyleInfo> = {};
  for (const layer of Object.values(doc.layers)) {
    const dataset = datasets.find((candidate) => candidate.id === layer.datasetId);
    if (dataset !== undefined) {
      // Contour lines are made of a grid or a mesh, and not of lines that are contours already.
      const contourable =
        layer.derived === undefined && (dataset.kind === 'grid' || dataset.kind === 'mesh');
      found[layer.id] = {
        kind: dataset.kind,
        columns: dataset.columns.map(({ name, type }) => ({ name, type })),
        style: layer.style,
        ...(contourable
          ? { contours: { settings: layer.contours, state: contoursState(layer.id) } }
          : {}),
      };
    }
  }
  return found;
}

/** The columns of numbers, which are the ones that heights can be in. */
export function numericColumns(columns: readonly ColumnInfo[]): readonly ColumnInfo[] {
  return columns.filter((column) => column.type === 'float' || column.type === 'int');
}

/** The choices of the column that the contours of a grid are made from: its columns of numbers. */
export function contourColumnOptions(columns: readonly ColumnInfo[]): SelectOption[] {
  return numericColumns(columns).map((column) => ({ value: column.name, label: column.name }));
}

/** The column that the contours of a grid are made from, as the editor shows it: the one the settings name, or, with none named, the first of numbers. */
export function contourColumnValue(
  settings: LayerContours,
  columns: readonly ColumnInfo[],
): string | undefined {
  return settings.column ?? numericColumns(columns)[0]?.name;
}

/** The numbers of the settings of contours that the editor has a field for. */
export type ContourKey = 'interval' | 'base' | 'indexEvery';

/** A field of the settings of contours: what it is called. */
export interface ContourField {
  readonly key: ContourKey;
  readonly label: string;
}

/** The fields of the settings of contours, in the order the brief lists them: the interval, the base and how often there is an index line. */
export const CONTOUR_FIELDS: readonly ContourField[] = [
  { key: 'interval', label: 'Interval' },
  { key: 'base', label: 'Base' },
  { key: 'indexEvery', label: 'Index line every' },
];

/** What a field of the settings shows: the number the settings have. */
export function contourText(key: ContourKey, settings: LayerContours): string {
  return String(settings[key]);
}

/**
 * The number that some text typed in a field of the settings of contours is, or what is wrong with it, in words: the interval is a number above 0, the
 * base is a number, and an index line comes every so many lines, a whole number of 1 or more.
 */
export function contourFromText(
  key: ContourKey,
  text: string,
): { readonly value: number } | { readonly error: string } {
  const value = text.trim() === '' ? Number.NaN : Number(text.trim());
  if (!Number.isFinite(value)) {
    return { error: key === 'interval' ? 'Enter a number above 0.' : 'Enter a number.' };
  }
  if (key === 'interval' && !(value > 0)) {
    return { error: 'Enter a number above 0.' };
  }
  if (key === 'indexEvery' && (!Number.isInteger(value) || value < 1)) {
    return { error: 'Enter a whole number, 1 or more.' };
  }
  return { value };
}

/** The settings with one number changed, or `undefined` when it is the number they have. */
export function contoursWith(
  settings: LayerContours,
  key: ContourKey,
  value: number,
): LayerContours | undefined {
  return settings[key] === value ? undefined : { ...settings, [key]: value };
}

/** The settings with another column, or `undefined` when it is the one they have (or they have none and it is the first of numbers). */
export function contoursWithColumn(
  settings: LayerContours,
  column: string,
  columns: readonly ColumnInfo[],
): LayerContours | undefined {
  return contourColumnValue(settings, columns) === column ? undefined : { ...settings, column };
}

/** What to tell a person who has contours that were not made: the engine's words (what is wrong and what to do), or, for a fault of the engine, that it could not and what it said. */
export function contoursProblem(state: ContoursState): string | undefined {
  if (state.status !== 'failed') {
    return undefined;
  }
  const [first] = state.findings;
  if (first !== undefined) {
    return first.hint === undefined || first.hint === ''
      ? first.message
      : `${first.message} ${first.hint}`;
  }
  return `The contour lines could not be made.${state.fault === undefined ? '' : ` ${state.fault}`}`;
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

/** The numbers of a style that the editor has a field for. */
export type NumberKey = 'opacity' | 'pointSize' | 'lineWidth';

/** A field of numbers: what it is called, the unit that is written after the number, and from what to what the scene accepts it (in that unit). */
export interface NumberField {
  readonly key: NumberKey;
  readonly label: string;
  readonly unit: '%' | 'px';
  readonly min: number;
  readonly max: number;
}

const OPACITY: NumberField = { key: 'opacity', label: 'Opacity (%)', unit: '%', min: 0, max: 100 };
const POINT_SIZE: NumberField = {
  key: 'pointSize',
  label: 'Point size (px)',
  unit: 'px',
  min: 2,
  max: 24,
};
const LINE_WIDTH: NumberField = {
  key: 'lineWidth',
  label: 'Line width (px)',
  unit: 'px',
  min: 1,
  max: 8,
};

/** The fields of numbers of a layer of `kind`, in the order of the brief: its opacity, and then the size of its points or the width of its lines. */
export function numberFields(kind: Summary['kind']): readonly NumberField[] {
  if (kind === 'points') {
    return [OPACITY, POINT_SIZE];
  }
  return kind === 'lines' ? [OPACITY, LINE_WIDTH] : [OPACITY];
}

/** `value` to at most `places` decimals, without the digits that are only the noise of floating point. */
const rounded = (value: number, places: number): number => Number(value.toFixed(places));

/** The number that a style has for `field`, in the unit of the field: opacity as a percent (the style has it from 0 to 1), the sizes as the style has them. */
export function numberOf(field: NumberField, style: LayerStyle): number {
  switch (field.key) {
    case 'opacity':
      return rounded(style.opacity * 100, 2);
    case 'pointSize':
      return style.pointSize ?? DEFAULT_POINT_SIZE;
    case 'lineWidth':
      return style.lineWidth ?? DEFAULT_LINE_WIDTH;
  }
}

/** What the field shows for a style: the number, and no unit (the label has it). */
export function numberText(field: NumberField, style: LayerStyle): string {
  return String(numberOf(field, style));
}

/** The patch that sets `field` to `value` (in the unit of the field): opacity goes back to a fraction, to four decimals. */
export function numberPatch(field: NumberField, value: number): StylePatch {
  switch (field.key) {
    case 'opacity':
      return { opacity: rounded(value / 100, 4) };
    case 'pointSize':
      return { pointSize: value };
    case 'lineWidth':
      return { lineWidth: value };
  }
}

/**
 * The number that a style has once `value` (in the unit of the field) is taken: the opacity is kept as a fraction of four decimals, so that `12.001` % is the
 * 12 % that the layer may have already, and the sizes are what they were typed. The field shows this, and a number that is the layer's own is not a change.
 */
export function numberTaken(field: NumberField, value: number): number {
  return field.key === 'opacity' ? rounded(rounded(value / 100, 4) * 100, 2) : value;
}

/** What some text typed in a field of numbers is: the number, or what is wrong with it in words. */
export type TypedNumber = { readonly value: number } | { readonly error: string };

const NUMBER = /^(\d+(?:\.\d+)?|\.\d+)\s*(%|px)?$/i;

/**
 * The number that text typed in `field` means, in the unit of the field: digits with a point for the decimals, and the unit of the field after them if the
 * person likes, and space round it. Nothing else is a number (not a sign, not an exponent, not the unit of another field, not a comma, which is the decimal
 * mark of some places and the thousands mark of others, so that `1,000` would be read as 1 by one and 1000 by the other), and one outside what the scene
 * accepts is not one either: the error says the range.
 */
export function numberFromText(field: NumberField, text: string): TypedNumber {
  const match = NUMBER.exec(text.trim());
  const digits = match?.[1];
  const unit = match?.[2]?.toLowerCase();
  const value = digits === undefined ? Number.NaN : Number(digits);
  if (
    digits === undefined ||
    (unit !== undefined && unit !== field.unit) ||
    value < field.min ||
    value > field.max
  ) {
    return { error: `Use a number from ${String(field.min)} to ${String(field.max)}.` };
  }
  return { value };
}

/** The number that a step of an arrow key from `from` is, in the unit of the field: 1 (10 with Shift), kept within what the scene accepts. */
export function numberStep(
  field: NumberField,
  from: number,
  direction: 1 | -1,
  large: boolean,
): number {
  const next = rounded(from + direction * (large ? 10 : 1), 2);
  return Math.min(field.max, Math.max(field.min, next));
}
