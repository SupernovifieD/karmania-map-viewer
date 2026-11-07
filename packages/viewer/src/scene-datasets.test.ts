import { createSceneStore } from '@karmania/scene';
import type { NewDataset } from '@karmania/scene';
import { describe, expect, it, vi } from 'vitest';
import { syncDatasets } from './scene-datasets.js';

const dataset = (id: number, name = `Dataset ${String(id)}`): NewDataset => ({
  id,
  name,
  kind: 'points',
  elementCount: 10,
  columns: [{ name: 'depth', type: 'float', nullCount: 0 }],
});

/** The layers of a scene, from the top of the legend down: `[id, datasetId, name]`. */
function listed(scene: ReturnType<typeof createSceneStore>): [string, number, string][] {
  const doc = scene.getState();
  return doc.legend.flatMap((node) =>
    node.type === 'layer'
      ? [
          [node.id, doc.layers[node.id]?.datasetId ?? -1, doc.layers[node.id]?.name ?? ''] as [
            string,
            number,
            string,
          ],
        ]
      : [],
  );
}

describe('syncDatasets', () => {
  it('adds a layer for each dataset, named for it, the one loaded last on top', () => {
    const scene = createSceneStore();
    syncDatasets(scene, [dataset(0, 'Wells'), dataset(1, 'Faults')]);
    expect(listed(scene)).toEqual([
      ['layer-2', 1, 'Faults'],
      ['layer-1', 0, 'Wells'],
    ]);
  });

  it('adds a layer for a dataset that comes later, on top, and leaves the layers that were there as they were', () => {
    const scene = createSceneStore();
    syncDatasets(scene, [dataset(0)]);
    scene.dispatch({ type: 'setVisible', layerId: 'layer-1', visible: false });
    const before = scene.getState().layers['layer-1'];
    syncDatasets(scene, [dataset(0), dataset(1)]);
    expect(listed(scene).map(([id]) => id)).toEqual(['layer-2', 'layer-1']);
    expect(scene.getState().layers['layer-1']).toBe(before);
    expect(scene.getState().layers['layer-1']?.visible).toBe(false);
  });

  it('removes the layers of a dataset that is gone, and no other', () => {
    const scene = createSceneStore();
    syncDatasets(scene, [dataset(0), dataset(1), dataset(2)]);
    syncDatasets(scene, [dataset(0), dataset(2)]);
    expect(listed(scene).map(([, id]) => id)).toEqual([2, 0]);
    syncDatasets(scene, []);
    expect(listed(scene)).toEqual([]);
    expect(Object.keys(scene.getState().layers)).toEqual([]);
  });

  it('does nothing, and tells no one, when the datasets are the ones that have layers', () => {
    const scene = createSceneStore();
    syncDatasets(scene, [dataset(3), dataset(4)]);
    const listener = vi.fn();
    scene.subscribe(listener);
    const state = scene.getState();
    syncDatasets(scene, [dataset(3), dataset(4)]);
    expect(scene.getState()).toBe(state);
    expect(listener).not.toHaveBeenCalled();
  });

  it('leaves an empty scene empty when there is nothing loaded', () => {
    const scene = createSceneStore();
    const state = scene.getState();
    syncDatasets(scene, []);
    expect(scene.getState()).toBe(state);
  });

  it('removes and adds in one call, when one dataset is replaced by another', () => {
    const scene = createSceneStore();
    syncDatasets(scene, [dataset(0, 'Old')]);
    syncDatasets(scene, [dataset(1, 'New')]);
    // The old layer is gone before the new one is made, so its number (the highest there was) is free again.
    expect(listed(scene)).toEqual([['layer-1', 1, 'New']]);
  });
});
