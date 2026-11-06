import type { ColumnSummary, Kind } from '@karmania/engine/types';
import { describe, expect, it } from 'vitest';
import { addLayers, type NewDataset } from './commands-layers.js';
import { emptyScene } from './empty.js';
import { frozen, sampleScene } from './test-support/documents.js';
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
