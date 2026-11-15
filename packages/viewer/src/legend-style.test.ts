import { createSceneStore } from '@karmania/scene';
import type { LayerColour, NewDataset } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import {
  SINGLE,
  SWATCHES,
  colourByOptions,
  colourByValue,
  colourFor,
  colourFromText,
  styleInfos,
} from './legend-style.js';
import type { ColumnInfo } from './legend-style.js';

const COLUMNS: readonly ColumnInfo[] = [
  { name: 'Au', type: 'float' },
  { name: 'Rock', type: 'category' },
  { name: 'Count', type: 'int' },
];

const SINGLE_COLOUR: LayerColour = { mode: 'single', value: '#e69f00' };
const CLASSES: LayerColour = {
  mode: 'classes',
  column: 'Au',
  method: 'quantile',
  classes: 5,
  ramp: 'magma',
  reverse: true,
};

describe('SWATCHES', () => {
  it('are twelve colours of six hex digits, all different', () => {
    expect(SWATCHES).toHaveLength(12);
    expect(SWATCHES.every((colour) => /^#[0-9a-f]{6}$/.test(colour))).toBe(true);
    expect(new Set(SWATCHES).size).toBe(12);
  });
});

describe('colourByOptions and colourByValue', () => {
  it('are a single colour and then each column, by name, in the order of the dataset', () => {
    expect(colourByOptions(COLUMNS)).toEqual([
      { value: 'single', label: 'Single colour' },
      { value: 'column:Au', label: 'Au' },
      { value: 'column:Rock', label: 'Rock' },
      { value: 'column:Count', label: 'Count' },
    ]);
    expect(colourByOptions([])).toEqual([{ value: 'single', label: 'Single colour' }]);
  });

  it('say which choice a colour is, and a column called single is not the single colour', () => {
    expect(colourByValue(SINGLE_COLOUR)).toBe(SINGLE);
    expect(colourByValue(CLASSES)).toBe('column:Au');
    expect(colourByValue({ ...CLASSES, column: 'single' })).toBe('column:single');
  });
});

describe('colourFor', () => {
  it('is the first swatch for a single colour, when the layer was by classes', () => {
    expect(colourFor(SINGLE, CLASSES, COLUMNS)).toEqual({ mode: 'single', value: SWATCHES[0] });
  });

  it('is classes of a column of numbers by equal intervals from viridis, 7 of them, when the layer was in one colour', () => {
    expect(colourFor('column:Au', SINGLE_COLOUR, COLUMNS)).toEqual({
      mode: 'classes',
      column: 'Au',
      method: 'equal',
      classes: 7,
      ramp: 'viridis',
      reverse: false,
    });
    expect(colourFor('column:Count', SINGLE_COLOUR, COLUMNS)).toMatchObject({ method: 'equal' });
  });

  it('is one class for each value for a column that is not numbers, from the colours that tell values apart', () => {
    expect(colourFor('column:Rock', SINGLE_COLOUR, COLUMNS)).toEqual({
      mode: 'classes',
      column: 'Rock',
      method: 'categories',
      classes: 7,
      ramp: 'okabe-ito',
      reverse: false,
    });
  });

  it('keeps the number of classes and the direction of the ramp of a layer that was by classes, and changes the method with the kind of column', () => {
    expect(colourFor('column:Count', CLASSES, COLUMNS)).toEqual({
      mode: 'classes',
      column: 'Count',
      method: 'equal',
      classes: 5,
      ramp: 'viridis',
      reverse: true,
    });
    expect(colourFor('column:Rock', CLASSES, COLUMNS)).toMatchObject({
      method: 'categories',
      classes: 5,
      reverse: true,
    });
  });

  it('is nothing when the choice is what the layer has, or is not a choice there is', () => {
    expect(colourFor(SINGLE, SINGLE_COLOUR, COLUMNS)).toBeUndefined();
    expect(colourFor('column:Au', CLASSES, COLUMNS)).toBeUndefined();
    expect(colourFor('column:Nothing', SINGLE_COLOUR, COLUMNS)).toBeUndefined();
    expect(colourFor('', SINGLE_COLOUR, COLUMNS)).toBeUndefined();
  });
});

describe('colourFromText', () => {
  it('reads six hex digits, with or without the #, in any case, with space round them', () => {
    expect(colourFromText('#E69F00')).toBe('#e69f00');
    expect(colourFromText('e69f00')).toBe('#e69f00');
    expect(colourFromText('  #0072B2 ')).toBe('#0072b2');
  });

  it('reads three hex digits as each of them twice', () => {
    expect(colourFromText('#f80')).toBe('#ff8800');
    expect(colourFromText('ABC')).toBe('#aabbcc');
  });

  it('reads nothing else: not a colour name, not other lengths, not other characters', () => {
    for (const text of [
      '',
      '#',
      'red',
      '#12',
      '#1234',
      '#12345',
      '#1234567',
      '#12345g',
      'rgb(1,2,3)',
      '# 123',
    ]) {
      expect(colourFromText(text), text).toBeUndefined();
    }
  });
});

describe('styleInfos', () => {
  const dataset = (id: number, kind: NewDataset['kind']): NewDataset => ({
    id,
    name: `D${String(id)}`,
    kind,
    elementCount: 3,
    columns: [{ name: 'Au', type: 'float', nullCount: 0 }],
  });

  it('gives each layer the kind and columns of its dataset and its style, and leaves out a layer whose dataset is not known', () => {
    const store = createSceneStore();
    store.dispatch({ type: 'addLayers', datasets: [dataset(0, 'points'), dataset(1, 'grid')] });
    const known = [
      {
        id: 1,
        name: 'D1',
        kind: 'grid',
        elementCount: 3,
        columns: [{ name: 'Au', type: 'float', nullCount: 0 }],
      },
    ];
    const infos = styleInfos(store.getState(), known as never);
    expect(Object.keys(infos)).toEqual(['layer-2']);
    expect(infos['layer-2']).toMatchObject({
      kind: 'grid',
      columns: [{ name: 'Au', type: 'float' }],
    });
    expect(infos['layer-2']?.style.colour.mode).toBe('classes');
  });
});
