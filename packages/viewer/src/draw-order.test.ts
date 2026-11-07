import { createSceneStore } from '@karmania/scene';
import type { NewDataset } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import { drawOrder } from './draw-order.js';

const dataset = (id: number): NewDataset => ({
  id,
  name: `Dataset ${String(id)}`,
  kind: 'points',
  elementCount: 1,
  columns: [],
});

function store(count: number) {
  const scene = createSceneStore();
  scene.dispatch({
    type: 'addLayers',
    datasets: Array.from({ length: count }, (_, i) => dataset(i)),
  });
  return scene;
}

describe('drawOrder', () => {
  it('is nothing for no layers', () => {
    expect(drawOrder(createSceneStore().getState())).toEqual([]);
  });

  it('draws the layers from the bottom of the legend to the top, so that the one that was loaded last, which is on top, is drawn last', () => {
    const scene = store(3);
    // The legend lists the last loaded first.
    expect(scene.getState().legend.map((node) => node.id)).toEqual([
      'layer-3',
      'layer-2',
      'layer-1',
    ]);
    expect(drawOrder(scene.getState())).toEqual(['layer-1', 'layer-2', 'layer-3']);
  });

  it('follows the legend when a layer is moved', () => {
    const scene = store(3);
    scene.dispatch({ type: 'moveNode', id: 'layer-3', to: { parent: null, index: 2 } });
    expect(drawOrder(scene.getState())).toEqual(
      ['layer-3', 'layer-1', 'layer-2'].reverse().reverse(),
    );
  });

  it('puts the layers of a group where the group is, in its own order', () => {
    const scene = store(4);
    scene.dispatch({ type: 'createGroup', name: 'Group', index: 1 });
    const group = scene.getState().legend.find((node) => node.type === 'group');
    expect(group).toBeDefined();
    scene.dispatch({
      type: 'moveNode',
      id: 'layer-3',
      to: { parent: group?.id ?? null, index: 0 },
    });
    scene.dispatch({
      type: 'moveNode',
      id: 'layer-1',
      to: { parent: group?.id ?? null, index: 1 },
    });
    // Top to bottom: layer-4, then the group (layer-3, layer-1), then layer-2: from the bottom, layer-2, layer-1, layer-3, layer-4.
    expect(scene.getState().legend.map((node) => node.id)).toEqual([
      'layer-4',
      group?.id,
      'layer-2',
    ]);
    expect(drawOrder(scene.getState())).toEqual(['layer-2', 'layer-1', 'layer-3', 'layer-4']);
  });
});
