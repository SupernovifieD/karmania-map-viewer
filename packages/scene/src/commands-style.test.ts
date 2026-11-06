import { describe, expect, it } from 'vitest';
import { setContours, setStyle } from './commands-style.js';
import { frozen, sampleScene } from './test-support/documents.js';
import type { SceneDocument } from './types.js';
import { validateScene } from './validate.js';

const classes = {
  mode: 'classes',
  column: 'grade',
  method: 'quantile',
  classes: 5,
  ramp: 'blues',
  reverse: true,
} as const;

describe('setStyle', () => {
  it('changes the opacity, and nothing else of the layer or of the document', () => {
    const doc = sampleScene();
    const next = setStyle(doc, 'layer-2', { opacity: 0.4 });
    expect(next.layers['layer-2']?.style).toEqual({
      ...doc.layers['layer-2']?.style,
      opacity: 0.4,
    });
    expect(next.layers['layer-1']).toBe(doc.layers['layer-1']);
    expect({ ...next, layers: doc.layers }).toEqual(doc);
    expect(validateScene(next)).toEqual([]);
  });

  it('changes a single colour, and writes it in lower case', () => {
    const next = setStyle(sampleScene(), 'layer-2', {
      colour: { mode: 'single', value: '#56B4E9' },
    });
    expect(next.layers['layer-2']?.style.colour).toEqual({ mode: 'single', value: '#56b4e9' });
  });

  it('changes from a single colour to classes and back', () => {
    const doc = sampleScene();
    const by = setStyle(doc, 'layer-2', { colour: classes });
    expect(by.layers['layer-2']?.style.colour).toEqual(classes);
    expect(validateScene(by)).toEqual([]);
    const back = setStyle(by, 'layer-2', { colour: { mode: 'single', value: '#e69f00' } });
    expect(back).toEqual(doc);
  });

  it('sees a change of any one part of a colour by classes: the column, the method, the count, the ramp, the order', () => {
    const doc = sampleScene();
    const now = doc.layers['layer-1']?.style.colour;
    expect(now?.mode).toBe('classes');
    const base = {
      mode: 'classes',
      column: 'z',
      method: 'equal',
      classes: 7,
      ramp: 'viridis',
      reverse: false,
    } as const;
    expect(setStyle(doc, 'layer-1', { colour: base })).toBe(doc);
    for (const change of [
      { column: 'y' },
      { method: 'jenks' },
      { classes: 8 },
      { ramp: 'magma' },
      { reverse: true },
    ] as const) {
      const next = setStyle(doc, 'layer-1', { colour: { ...base, ...change } });
      expect(next).not.toBe(doc);
      expect(next.layers['layer-1']?.style.colour).toEqual({ ...base, ...change });
    }
  });

  it('changes the sizes, and gives a layer one that it did not have', () => {
    const doc = sampleScene();
    expect(setStyle(doc, 'layer-2', { pointSize: 12 }).layers['layer-2']?.style.pointSize).toBe(12);
    expect(setStyle(doc, 'layer-2', { lineWidth: 3 }).layers['layer-2']?.style).toEqual({
      ...doc.layers['layer-2']?.style,
      lineWidth: 3,
    });
    expect(validateScene(setStyle(doc, 'layer-2', { lineWidth: 3, pointSize: 2 }))).toEqual([]);
  });

  it('refuses the whole patch when any value in it is wrong, with the same document', () => {
    const doc = sampleScene();
    const wrong: Parameters<typeof setStyle>[2][] = [
      { opacity: 1.5 },
      { opacity: -0.1 },
      { opacity: NaN },
      { pointSize: 1 },
      { pointSize: 25 },
      { lineWidth: 0 },
      { lineWidth: 9 },
      { colour: { mode: 'single', value: 'red' } },
      { colour: { ...classes, ramp: 'rainbow' } },
      { colour: { ...classes, classes: 21 } },
      { colour: { ...classes, classes: 1 } },
      { colour: { ...classes, classes: 4.5 } },
      { colour: { ...classes, column: '' } },
      { opacity: 0.5, pointSize: 99 },
    ];
    for (const patch of wrong) {
      expect(setStyle(doc, 'layer-2', patch)).toBe(doc);
    }
    expect(setStyle(doc, 'layer-2', { colour: { ...classes, method: 'median' as never } })).toBe(
      doc,
    );
  });

  it('accepts the limits themselves', () => {
    for (const patch of [
      { opacity: 0 },
      { opacity: 1 },
      { pointSize: 2 },
      { pointSize: 24 },
      { lineWidth: 1 },
      { lineWidth: 8 },
      { colour: { ...classes, classes: 2 } },
      { colour: { ...classes, classes: 20 } },
    ]) {
      const next = setStyle(sampleScene(), 'layer-2', patch);
      expect(next).not.toBe(sampleScene());
      expect(validateScene(next)).toEqual([]);
    }
  });

  it('is the same document for an empty patch, a patch that changes nothing, and a layer that is not there', () => {
    const doc = sampleScene();
    expect(setStyle(doc, 'layer-2', {})).toBe(doc);
    expect(setStyle(doc, 'layer-2', { opacity: 1, pointSize: 6 })).toBe(doc);
    expect(setStyle(doc, 'layer-2', { colour: { mode: 'single', value: '#E69F00' } })).toBe(doc);
    expect(
      setStyle(doc, 'layer-1', {
        colour: { ...(doc.layers['layer-1']?.style.colour as typeof classes) },
      }),
    ).toBe(doc);
    expect(setStyle(doc, 'layer-9', { opacity: 0.5 })).toBe(doc);
    expect(setStyle(doc, 'constructor', { opacity: 0.5 })).toBe(doc);
  });

  it('never changes the document it is given', () => {
    expect(
      setStyle(frozen(sampleScene()), 'layer-2', { opacity: 0.5 }).layers['layer-2']?.style.opacity,
    ).toBe(0.5);
  });
});

describe('setContours', () => {
  const params = { column: 'z', interval: 25, base: 5, indexEvery: 4, visible: true };

  it('gives a layer contours, and takes them away again with null, leaving the rest of the layer as it was', () => {
    const doc = sampleScene();
    const next = setContours(doc, 'layer-2', params);
    expect(next.layers['layer-2']).toEqual({ ...doc.layers['layer-2'], contours: params });
    expect(validateScene(next)).toEqual([]);
    expect(setContours(next, 'layer-2', null)).toEqual(doc);
    const without = setContours(doc, 'layer-1', null);
    expect(without.layers['layer-1']).toEqual({ ...doc.layers['layer-1'], contours: undefined });
    expect('contours' in (without.layers['layer-1'] ?? {})).toBe(false);
  });

  it('changes the contours a layer has, for the lines and for whether they are shown', () => {
    const doc = sampleScene();
    expect(
      setContours(doc, 'layer-1', {
        column: 'z',
        interval: 10,
        base: 0,
        indexEvery: 5,
        visible: false,
      }).layers['layer-1']?.contours?.visible,
    ).toBe(false);
    expect(
      setContours(doc, 'layer-1', { interval: 2, base: 0, indexEvery: 5, visible: true }).layers[
        'layer-1'
      ]?.contours,
    ).toEqual({ interval: 2, base: 0, indexEvery: 5, visible: true });
  });

  it('is the same document for contours that are wrong, that are what the layer has, or on a layer that is not there', () => {
    const doc = sampleScene();
    for (const bad of [
      { ...params, interval: 0 },
      { ...params, indexEvery: 0 },
      { ...params, indexEvery: 2.5 },
      { ...params, base: NaN },
      { ...params, column: '' },
    ]) {
      expect(setContours(doc, 'layer-2', bad)).toBe(doc);
    }
    expect(
      setContours(doc, 'layer-1', {
        column: 'z',
        interval: 10,
        base: 0,
        indexEvery: 5,
        visible: true,
      }),
    ).toBe(doc);
    expect(setContours(doc, 'layer-9', params)).toBe(doc);
    expect(setContours(doc, 'layer-2', null)).toBe(doc);
  });

  it('does not give contours to a layer that is made of contours', () => {
    const doc: SceneDocument = sampleScene();
    expect(setContours(doc, 'layer-3', params)).toBe(doc);
  });

  it('never changes the document it is given', () => {
    expect(
      setContours(frozen(sampleScene()), 'layer-2', params).layers['layer-2']?.contours,
    ).toEqual(params);
  });
});
