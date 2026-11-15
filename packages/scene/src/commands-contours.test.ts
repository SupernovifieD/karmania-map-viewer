import { describe, expect, it } from 'vitest';
import { CONTOURS_COLOUR, setContoursLayer } from './commands-contours.js';
import { addLayers } from './commands-layers.js';
import { emptyScene } from './empty.js';
import { frozen, layerById, sampleScene } from './test-support/documents.js';
import type { SceneDocument } from './types.js';
import { validateScene } from './validate.js';

/** Two layers, a grid and points, and the grid is in a group with a layer under it. */
function surveyed(): SceneDocument {
  const base = addLayers(emptyScene(), [
    { id: 1, name: 'Surface', kind: 'grid', elementCount: 12, columns: [] },
    { id: 2, name: 'Wells', kind: 'points', elementCount: 5, columns: [] },
    { id: 3, name: 'Faults', kind: 'lines', elementCount: 5, columns: [] },
  ]);
  // The legend is top to bottom: Faults (layer-3), Wells (layer-2), Surface (layer-1). Put Surface and Wells in a group.
  return {
    ...base,
    legend: [
      { type: 'layer', id: 'layer-3' },
      {
        type: 'group',
        id: 'group-1',
        name: 'Survey',
        collapsed: false,
        children: ['layer-2', 'layer-1'],
      },
    ],
  };
}

const order = (doc: SceneDocument): string[] =>
  doc.legend.flatMap((node) => (node.type === 'layer' ? [node.id] : [node.id, ...node.children]));

describe('setContoursLayer', () => {
  it('makes the layer of the lines directly under its source, in its group, with a style of its own', () => {
    const doc = surveyed();
    const next = setContoursLayer(doc, 'layer-1', 10, 'Contours of Surface (every 2.5)');
    expect(layerById(next, 'layer-4')).toEqual({
      id: 'layer-4',
      datasetId: 10,
      name: 'Contours of Surface (every 2.5)',
      visible: true,
      style: { colour: { mode: 'single', value: CONTOURS_COLOUR }, opacity: 1, lineWidth: 1 },
      derived: { kind: 'contours', sourceLayer: 'layer-1' },
    });
    expect(order(next)).toEqual(['layer-3', 'group-1', 'layer-2', 'layer-1', 'layer-4']);
    expect(validateScene(next)).toEqual([]);
    // The source and every other layer are as they were.
    expect(layerById(next, 'layer-1')).toBe(layerById(doc, 'layer-1'));
  });

  it('puts it right under its source at the top level too, and not at the end of the legend', () => {
    const next = setContoursLayer(surveyed(), 'layer-3', 11);
    expect(order(next)).toEqual(['layer-3', 'layer-4', 'group-1', 'layer-2', 'layer-1']);
    expect(layerById(next, 'layer-4').name).toBe('Contours of Faults');
  });

  it('is visible if the contours of its source are shown or are not set, and hidden if they are not shown', () => {
    const doc = surveyed();
    const shown = (visible: boolean): SceneDocument => ({
      ...doc,
      layers: {
        ...doc.layers,
        'layer-1': {
          ...layerById(doc, 'layer-1'),
          contours: { interval: 5, base: 0, indexEvery: 5, visible },
        },
      },
    });
    expect(layerById(setContoursLayer(shown(true), 'layer-1', 10), 'layer-4').visible).toBe(true);
    expect(layerById(setContoursLayer(shown(false), 'layer-1', 10), 'layer-4').visible).toBe(false);
    expect(layerById(setContoursLayer(doc, 'layer-1', 10), 'layer-4').visible).toBe(true);
  });

  it('shows the new lines in the same layer when they are made again: the dataset and the name change, the style and the place stay', () => {
    const first = setContoursLayer(surveyed(), 'layer-1', 10, 'Contours of Surface (every 2.5)');
    const styled: SceneDocument = {
      ...first,
      layers: {
        ...first.layers,
        'layer-4': {
          ...layerById(first, 'layer-4'),
          visible: false,
          style: { colour: { mode: 'single', value: '#112233' }, opacity: 0.5, lineWidth: 3 },
        },
      },
    };
    const again = setContoursLayer(styled, 'layer-1', 12, 'Contours of Surface (every 5)');
    expect(layerById(again, 'layer-4')).toEqual({
      ...layerById(styled, 'layer-4'),
      datasetId: 12,
      name: 'Contours of Surface (every 5)',
    });
    expect(order(again)).toEqual(order(styled));
    expect(Object.keys(again.layers)).toEqual(Object.keys(styled.layers));
    // The name is kept when none is given.
    expect(layerById(setContoursLayer(styled, 'layer-1', 13), 'layer-4').name).toBe(
      'Contours of Surface (every 2.5)',
    );
    expect(validateScene(again)).toEqual([]);
  });

  it('takes the layer away with null, from the legend too, and clears a selection that was in it', () => {
    const made = setContoursLayer(surveyed(), 'layer-1', 10);
    const selected: SceneDocument = { ...made, selection: { layerId: 'layer-4', element: 2 } };
    const gone = setContoursLayer(selected, 'layer-1', null);
    expect(Object.keys(gone.layers).sort()).toEqual(['layer-1', 'layer-2', 'layer-3']);
    expect(order(gone)).toEqual(['layer-3', 'group-1', 'layer-2', 'layer-1']);
    expect(gone.selection).toBeNull();
    const kept = setContoursLayer(
      { ...made, selection: { layerId: 'layer-2', element: 0 } },
      'layer-1',
      null,
    );
    expect(kept.selection).toEqual({ layerId: 'layer-2', element: 0 });
  });

  it('is the same document for what is already so, a source that is not a layer or is derived, and a dataset that is not usable', () => {
    const made = setContoursLayer(surveyed(), 'layer-1', 10, 'Lines');
    expect(setContoursLayer(made, 'layer-1', 10, 'Lines')).toBe(made);
    expect(setContoursLayer(made, 'layer-1', 10)).toBe(made);
    const doc = surveyed();
    expect(setContoursLayer(doc, 'layer-1', null)).toBe(doc);
    expect(setContoursLayer(doc, 'layer-9', 10)).toBe(doc);
    expect(setContoursLayer(doc, '__proto__', 10)).toBe(doc);
    // The lines of a layer have no lines of their own.
    expect(setContoursLayer(made, 'layer-4', 11)).toBe(made);
    for (const bad of [-1, 1.5, Number.NaN, Infinity, '3' as unknown as number]) {
      expect(setContoursLayer(doc, 'layer-1', bad)).toBe(doc);
    }
    // A name that is not text is not used.
    expect(
      layerById(setContoursLayer(doc, 'layer-1', 10, 5 as unknown as string), 'layer-4').name,
    ).toBe('Contours of Surface');
  });

  it('does not change the document it is given, and the sample scene stays valid', () => {
    const doc = frozen(surveyed());
    expect(() => setContoursLayer(doc, 'layer-1', 10)).not.toThrow();
    const sample = frozen(sampleScene());
    const next = setContoursLayer(sample, 'layer-2', 20);
    expect(validateScene(next)).toEqual([]);
    // The layer of the sample that is already made from layer-1 is that layer's, and is retargeted.
    const retargeted = setContoursLayer(sample, 'layer-1', 99);
    expect(layerById(retargeted, 'layer-3').datasetId).toBe(99);
    expect(Object.keys(retargeted.layers)).toEqual(Object.keys(sample.layers));
  });
});
