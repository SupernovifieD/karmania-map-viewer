import type { ColumnSummary, Kind } from '@karmania/engine/types';
import { describe, expect, it } from 'vitest';
import {
  addLayers,
  removeLayersOfDataset,
  setGroupVisible,
  setVisible,
  type NewDataset,
} from './commands-layers.js';
import { emptyScene } from './empty.js';
import { frozen, layerById, sampleScene } from './test-support/documents.js';
import type { SceneDocument } from './types.js';
import { validateScene } from './validate.js';

const grade: ColumnSummary = { name: 'grade', type: 'float', nullCount: 0 };

function dataset(
  id: number,
  name: string,
  kind: Kind = 'points',
  columns: readonly ColumnSummary[] = [grade],
): NewDataset {
  return { id, name, kind, elementCount: 10, columns };
}

describe('emptyScene', () => {
  it('is a scene that validateScene accepts, with nothing in it', () => {
    const scene = emptyScene();
    expect(validateScene(scene)).toEqual([]);
    expect([scene.frame, scene.legend, scene.layers, scene.selection]).toEqual([
      null,
      [],
      {},
      null,
    ]);
    expect(scene.viewMode).toBe('2d');
  });

  it('is a new scene every time, so that nothing is shared between two viewers', () => {
    expect(emptyScene()).not.toBe(emptyScene());
    expect(emptyScene().camera2d).not.toBe(emptyScene().camera2d);
  });
});

describe('addLayers', () => {
  it('makes a visible layer for a dataset, named for it, in its default style, at the top of the legend', () => {
    const next = addLayers(emptyScene(), [dataset(7, 'Assays')]);
    expect(next.layers).toEqual({
      'layer-1': {
        id: 'layer-1',
        datasetId: 7,
        name: 'Assays',
        visible: true,
        style: { colour: { mode: 'single', value: '#e69f00' }, opacity: 1, pointSize: 6 },
      },
    });
    expect(next.legend).toEqual([{ type: 'layer', id: 'layer-1' }]);
  });

  it('puts the datasets of one call in the order they were given, the last on top, each with the next colour', () => {
    const next = addLayers(emptyScene(), [
      dataset(1, 'a'),
      dataset(2, 'b', 'lines'),
      dataset(3, 'c', 'polygons'),
    ]);
    expect(next.legend.map((n) => n.id)).toEqual(['layer-3', 'layer-2', 'layer-1']);
    expect(Object.values(next.layers).map((l) => [l.id, l.datasetId, l.style.colour])).toEqual([
      ['layer-1', 1, { mode: 'single', value: '#e69f00' }],
      ['layer-2', 2, { mode: 'single', value: '#56b4e9' }],
      ['layer-3', 3, { mode: 'single', value: '#009e73' }],
    ]);
    expect(addLayers(emptyScene(), [dataset(1, 'a'), dataset(2, 'b')])).toEqual(
      addLayers(addLayers(emptyScene(), [dataset(1, 'a')]), [dataset(2, 'b')]),
    );
  });

  it('colours a grid by its first numeric column', () => {
    const next = addLayers(emptyScene(), [dataset(1, 'Topography', 'grid')]);
    expect(next.layers['layer-1']?.style.colour).toEqual({
      mode: 'classes',
      column: 'grade',
      method: 'equal',
      classes: 7,
      ramp: 'viridis',
      reverse: false,
    });
  });

  it('goes on from the highest number there is, puts the layer on top and not in a group, and keeps the rest', () => {
    const before = sampleScene();
    const next = addLayers(before, [dataset(9, 'New')]);
    expect(next.legend[0]).toEqual({ type: 'layer', id: 'layer-4' });
    expect(next.legend.slice(1)).toEqual(before.legend);
    expect(Object.keys(next.layers)).toEqual(['layer-1', 'layer-2', 'layer-3', 'layer-4']);
    expect(next.layers['layer-4']?.style.colour).toEqual({ mode: 'single', value: '#d55e00' });
    expect({ ...next, legend: before.legend, layers: before.layers }).toEqual(before);
    expect(validateScene(next)).toEqual([]);
  });

  it('gives the next colour after the one of the highest number even when layers below it were removed', () => {
    const rest = Object.fromEntries(
      Object.entries(sampleScene().layers).filter(([id]) => id !== 'layer-1'),
    );
    const doc = {
      ...sampleScene(),
      layers: rest,
      legend: sampleScene().legend.slice(1),
      selection: null,
    };
    expect(addLayers(doc, [dataset(1, 'x')]).layers['layer-4']?.style.colour).toEqual({
      mode: 'single',
      value: '#d55e00',
    });
  });

  it('does not give a layer the id of a group, whatever number the group has', () => {
    const doc: SceneDocument = {
      ...sampleScene(),
      legend: [
        { type: 'group', id: 'layer-7', name: 'Odd', collapsed: false, children: [] },
        ...sampleScene().legend,
      ],
    };
    const next = addLayers(doc, [dataset(1, 'x')]);
    expect(Object.keys(next.layers)).toContain('layer-8');
    expect(validateScene(next)).toEqual([]);
  });

  it('does not repeat an id, nor give up, when the numbers are beyond what a double holds or have 400 digits', () => {
    const big = (id: string): SceneDocument => {
      const base = emptyScene();
      return {
        ...base,
        layers: { [id]: { ...layerById(sampleScene(), 'layer-2'), id } },
        legend: [{ type: 'layer', id }],
      };
    };
    const first = addLayers(big('layer-9007199254740993'), [dataset(1, 'x')]);
    expect(Object.keys(first.layers)).toEqual(['layer-9007199254740993', 'layer-9007199254740994']);
    expect(validateScene(first)).toEqual([]);
    const long = `layer-${'9'.repeat(400)}`;
    const second = addLayers(big(long), [dataset(1, 'x'), dataset(2, 'y')]);
    expect(Object.keys(second.layers)).toHaveLength(3);
    expect(validateScene(second)).toEqual([]);
  });

  it('refuses datasets that are not what the engine gives, all of them, with the same document', () => {
    const doc = sampleScene();
    const wrong: NewDataset[] = [
      { ...dataset(1, 'x'), id: -1 },
      { ...dataset(1, 'x'), id: 1.5 },
      { ...dataset(1, 'x'), id: NaN },
      { ...dataset(1, 'x'), kind: 'bogus' as Kind },
      { ...dataset(1, 'x'), name: 7 as unknown as string },
      { ...dataset(1, 'x'), columns: 'a' as unknown as readonly ColumnSummary[] },
    ];
    for (const one of wrong) {
      expect(addLayers(doc, [dataset(3, 'fine'), one])).toBe(doc);
    }
  });

  it('shows a dataset twice if it is asked to, each layer with its own id', () => {
    const next = addLayers(addLayers(emptyScene(), [dataset(1, 'a')]), [dataset(1, 'a')]);
    expect(Object.values(next.layers).map((l) => [l.id, l.datasetId])).toEqual([
      ['layer-1', 1],
      ['layer-2', 1],
    ]);
  });

  it('gives back the very document when there is nothing to add, and never changes the one it is given', () => {
    const doc = emptyScene();
    expect(addLayers(doc, [])).toBe(doc);
    const solid = frozen(sampleScene());
    expect(addLayers(solid, [dataset(1, 'x'), dataset(2, 'y')]).legend).toHaveLength(4);
  });
});

describe('removeLayersOfDataset', () => {
  it('takes the layer out of the layers and of the legend, wherever it is, and keeps the rest as it was', () => {
    const doc = sampleScene();
    const next = removeLayersOfDataset(doc, 2);
    expect(Object.keys(next.layers)).toEqual(['layer-1', 'layer-3']);
    // layer-2 was in the group, which stays, with the layer that is left.
    expect(next.legend).toEqual([
      { type: 'layer', id: 'layer-1' },
      { type: 'group', id: 'group-1', name: 'Survey', collapsed: false, children: ['layer-3'] },
    ]);
    expect(next.layers['layer-1']).toBe(doc.layers['layer-1']);
    expect(validateScene(next)).toEqual([]);
  });

  it('takes out a layer that is at the top of the legend, and every layer of a dataset that has more than one', () => {
    const twice = addLayers(addLayers(emptyScene(), [dataset(1, 'a')]), [
      dataset(2, 'b'),
      dataset(1, 'a'),
    ]);
    const next = removeLayersOfDataset(twice, 1);
    expect(Object.values(next.layers).map((l) => l.datasetId)).toEqual([2]);
    expect(next.legend).toEqual([{ type: 'layer', id: 'layer-2' }]);
    expect(validateScene(next)).toEqual([]);
  });

  it('takes out what is made from the layers that go: the contours of a layer, with the layer', () => {
    const next = removeLayersOfDataset(sampleScene(), 1);
    expect(Object.keys(next.layers)).toEqual(['layer-2']);
    expect(next.legend).toEqual([
      { type: 'group', id: 'group-1', name: 'Survey', collapsed: false, children: ['layer-2'] },
    ]);
    expect(validateScene(next)).toEqual([]);
  });

  it('takes out the contours of a layer by their own dataset, and leaves the layer they were made from', () => {
    const next = removeLayersOfDataset(sampleScene(), 3);
    expect(Object.keys(next.layers)).toEqual(['layer-1', 'layer-2']);
    expect(validateScene(next)).toEqual([]);
  });

  it('clears the selection when its layer goes, and keeps it when another goes', () => {
    expect(removeLayersOfDataset(sampleScene(), 2).selection).toBeNull();
    expect(removeLayersOfDataset(sampleScene(), 3).selection).toEqual({
      layerId: 'layer-2',
      element: 0,
    });
  });

  it('keeps the frame and the cameras, and leaves a scene with nothing in it when the last layer goes', () => {
    const one = addLayers(emptyScene(), [dataset(1, 'a')]);
    expect(removeLayersOfDataset(one, 1)).toEqual(emptyScene());
    const doc = sampleScene();
    const next = removeLayersOfDataset(doc, 2);
    expect([next.frame, next.camera2d, next.camera3d, next.viewMode]).toEqual([
      doc.frame,
      doc.camera2d,
      doc.camera3d,
      doc.viewMode,
    ]);
  });

  it('is the same document when no layer is of that dataset, and never changes the one it is given', () => {
    const doc = sampleScene();
    expect(removeLayersOfDataset(doc, 99)).toBe(doc);
    expect(removeLayersOfDataset(emptyScene(), 1).legend).toEqual([]);
    expect(Object.keys(removeLayersOfDataset(frozen(sampleScene()), 2).layers)).toHaveLength(2);
  });
});

describe('setVisible', () => {
  it('shows and hides a layer, and nothing else', () => {
    const doc = sampleScene();
    const shown = setVisible(doc, 'layer-2', true);
    expect(shown.layers['layer-2']?.visible).toBe(true);
    expect({ ...shown, layers: doc.layers }).toEqual(doc);
    expect(shown.layers['layer-1']).toBe(doc.layers['layer-1']);
    expect(setVisible(shown, 'layer-2', false)).toEqual(doc);
    expect(validateScene(shown)).toEqual([]);
  });

  it('is the same document when the layer is not there, or already is so', () => {
    const doc = sampleScene();
    expect(setVisible(doc, 'layer-9', true)).toBe(doc);
    expect(setVisible(doc, 'constructor', true)).toBe(doc);
    expect(setVisible(doc, 'layer-1', true)).toBe(doc);
    expect(setVisible(doc, 'layer-2', false)).toBe(doc);
  });

  it('never changes the document it is given', () => {
    expect(setVisible(frozen(sampleScene()), 'layer-2', true).layers['layer-2']?.visible).toBe(
      true,
    );
  });
});

describe('setGroupVisible', () => {
  it('shows or hides every layer in the group, and no layer outside it', () => {
    const doc = sampleScene();
    const hidden = setGroupVisible(doc, 'group-1', false);
    expect(['layer-1', 'layer-2', 'layer-3'].map((id) => hidden.layers[id]?.visible)).toEqual([
      true,
      false,
      false,
    ]);
    const shown = setGroupVisible(doc, 'group-1', true);
    expect(['layer-1', 'layer-2', 'layer-3'].map((id) => shown.layers[id]?.visible)).toEqual([
      true,
      true,
      true,
    ]);
    expect(validateScene(hidden)).toEqual([]);
  });

  it('is the same document when the group is not there, is a layer, is empty, or its layers are all so already', () => {
    const doc = sampleScene();
    expect(setGroupVisible(doc, 'group-9', true)).toBe(doc);
    expect(setGroupVisible(doc, 'layer-1', false)).toBe(doc);
    expect(setGroupVisible(doc, 'group-1', true).layers['layer-2']?.visible).toBe(true);
    const hidden = setGroupVisible(doc, 'group-1', false);
    expect(setGroupVisible(hidden, 'group-1', false)).toBe(hidden);
    const empty = {
      ...doc,
      legend: [
        ...doc.legend,
        { type: 'group' as const, id: 'group-2', name: '', collapsed: false, children: [] },
      ],
    };
    expect(setGroupVisible(empty, 'group-2', true)).toBe(empty);
  });

  it('never changes the document it is given', () => {
    expect(
      setGroupVisible(frozen(sampleScene()), 'group-1', false).layers['layer-3']?.visible,
    ).toBe(false);
  });
});
