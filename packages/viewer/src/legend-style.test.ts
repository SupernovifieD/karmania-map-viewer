import { createSceneStore } from '@karmania/scene';
import type { LayerColour, NewDataset } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import {
  FEWEST_CLASSES,
  MOST_CLASSES,
  SINGLE,
  SWATCHES,
  classCountChoice,
  classCountOptions,
  classesWith,
  colourByOptions,
  colourByValue,
  colourFor,
  colourFromText,
  methodChoice,
  methodOptions,
  rampOptions,
  rampPreview,
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

describe('methodOptions', () => {
  it('has all four methods for a column of numbers, in the order of the brief, with the words of the brief', () => {
    for (const column of [COLUMNS[0], COLUMNS[2]]) {
      expect(methodOptions(column)).toEqual([
        { value: 'equal', label: 'Equal intervals', disabled: false },
        { value: 'quantile', label: 'Quantiles', disabled: false },
        { value: 'jenks', label: 'Natural breaks', disabled: false },
        { value: 'categories', label: 'Categories', disabled: false },
      ]);
    }
  });

  it('can only be Categories for a column that is not numbers, and for no column at all', () => {
    for (const column of [COLUMNS[1], { name: 'Flag', type: 'bool' as const }, undefined]) {
      const options = methodOptions(column);
      expect(options.map((option) => option.disabled)).toEqual([true, true, true, false]);
    }
  });
});

describe('methodChoice', () => {
  it('is the method that the value names, for a column of numbers', () => {
    expect(
      ['equal', 'quantile', 'jenks', 'categories'].map((value) => methodChoice(value, COLUMNS[0])),
    ).toEqual(['equal', 'quantile', 'jenks', 'categories']);
  });

  it('is only Categories for a column that is not numbers, and for no column at all: the others are not offered, so they are not taken', () => {
    for (const column of [COLUMNS[1], undefined]) {
      expect(methodChoice('equal', column)).toBeUndefined();
      expect(methodChoice('quantile', column)).toBeUndefined();
      expect(methodChoice('jenks', column)).toBeUndefined();
      expect(methodChoice('categories', column)).toBe('categories');
    }
  });

  it('is nothing for a value that is not a method', () => {
    expect(methodChoice('', COLUMNS[0])).toBeUndefined();
    expect(methodChoice('Equal intervals', COLUMNS[0])).toBeUndefined();
    expect(methodChoice('__proto__', COLUMNS[0])).toBeUndefined();
  });
});

describe('classCountChoice', () => {
  it('is the whole number that the text is', () => {
    expect(classCountChoice('3')).toBe(3);
    expect(classCountChoice('12')).toBe(12);
    expect(classCountChoice('20')).toBe(20);
  });

  it('is nothing for anything else: empty, signed, fractional, in another notation or with text', () => {
    for (const text of ['', ' ', '-3', '3.5', '1e1', '0x10', 'five', '3 ', ' 3']) {
      expect(classCountChoice(text), JSON.stringify(text)).toBeUndefined();
    }
  });
});

describe('classCountOptions', () => {
  it('are 3 to 12, ascending', () => {
    const options = classCountOptions(7);
    expect(options.map((option) => option.value)).toEqual([
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ]);
    expect(options.every((option) => option.value === option.label)).toBe(true);
    expect([FEWEST_CLASSES, MOST_CLASSES]).toEqual([3, 12]);
  });

  it('keep the number of a layer that has one the editor does not offer, in its place, so that the field shows it', () => {
    expect(classCountOptions(2).map((option) => option.value)).toEqual([
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ]);
    expect(classCountOptions(20).at(-1)?.value).toBe('20');
    expect(classCountOptions(20)).toHaveLength(11);
  });
});

describe('rampOptions and rampPreview', () => {
  it('lists the ramps of the scene with their ids, names and kinds, the sequential ones first and the categorical ones last', () => {
    const ramps = rampOptions();
    expect(ramps[0]).toMatchObject({ id: 'viridis', name: 'Viridis', kind: 'sequential' });
    expect(ramps.at(-1)).toMatchObject({ id: 'paired', kind: 'categorical' });
    expect(new Set(ramps.map((ramp) => ramp.id)).size).toBe(ramps.length);
  });

  it('blends the colours of a sequential ramp and goes the other way round when it is reversed', () => {
    expect(rampPreview(['#000000', '#ffffff'], 'sequential', false)).toBe(
      'linear-gradient(to right, #000000, #ffffff)',
    );
    expect(rampPreview(['#000000', '#ffffff'], 'diverging', true)).toBe(
      'linear-gradient(to right, #ffffff, #000000)',
    );
  });

  it('is a stripe for each colour of a categorical ramp, with hard edges, since its colours are not steps of one scale', () => {
    expect(rampPreview(['#ff0000', '#00ff00', '#0000ff', '#ffff00'], 'categorical', false)).toBe(
      'linear-gradient(to right, #ff0000 0% 25%, #00ff00 25% 50%, #0000ff 50% 75%, #ffff00 75% 100%)',
    );
  });

  it('puts no text of a document into a style, and is no colour for no colours', () => {
    expect(rampPreview(['#000000', 'red; background: url(x)'], 'sequential', false)).toBe(
      'linear-gradient(to right, #000000, transparent)',
    );
    expect(rampPreview([], 'sequential', false)).toBe('transparent');
  });
});

describe('classesWith', () => {
  it('makes the classes that a change makes, keeping the rest', () => {
    expect(classesWith(CLASSES, { method: 'jenks' })).toEqual({ ...CLASSES, method: 'jenks' });
    expect(classesWith(CLASSES, { classes: 9 })).toEqual({ ...CLASSES, classes: 9 });
    expect(classesWith(CLASSES, { ramp: 'blues' })).toEqual({ ...CLASSES, ramp: 'blues' });
    expect(classesWith(CLASSES, { reverse: false })).toEqual({ ...CLASSES, reverse: false });
  });

  it('is nothing when the change is what the layer has, whatever else is said with it', () => {
    expect(classesWith(CLASSES, { method: 'quantile' })).toBeUndefined();
    expect(classesWith(CLASSES, { classes: 5, reverse: true })).toBeUndefined();
    expect(classesWith(CLASSES, {})).toBeUndefined();
  });
});
