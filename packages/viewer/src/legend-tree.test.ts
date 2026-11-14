import { createSceneStore, legendModel } from '@karmania/scene';
import type { NewDataset } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import { itemKey, moveFrom, toggleCommand, treeItems } from './legend-tree.js';
import type { TreeItem } from './legend-tree.js';

const dataset = (id: number): NewDataset => ({
  id,
  name: `Dataset ${String(id)}`,
  kind: 'points',
  elementCount: 2,
  columns: [],
});

/**
 * Four layers (`layer-1` the lowest), two groups at the top: `group-1` with `layer-2` and `layer-3`, `group-2` with `layer-4`, and `layer-1` under them. From
 * the top: group-2, layer-4, group-1, layer-2, layer-3, layer-1 (a group made later is above the one before).
 */
function scene() {
  const store = createSceneStore();
  store.dispatch({ type: 'addLayers', datasets: [0, 1, 2, 3].map(dataset) });
  store.dispatch({ type: 'createGroup', name: 'Samples' });
  store.dispatch({ type: 'createGroup', name: 'Surveys' });
  store.dispatch({ type: 'moveNode', id: 'layer-2', to: { parent: 'group-1', index: 0 } });
  store.dispatch({ type: 'moveNode', id: 'layer-3', to: { parent: 'group-1', index: 1 } });
  store.dispatch({ type: 'moveNode', id: 'layer-4', to: { parent: 'group-2', index: 0 } });
  return store;
}

const keys = (items: readonly TreeItem[]): string[] => items.map(itemKey);

describe('treeItems', () => {
  it('lists the rows from the top: each group and, under it, its layers, with the level of each', () => {
    const items = treeItems(legendModel(scene().getState()));
    expect(items.map((item) => [itemKey(item), item.level])).toEqual([
      ['group:group-2', 1],
      ['layer:layer-4', 2],
      ['group:group-1', 1],
      ['layer:layer-2', 2],
      ['layer:layer-3', 2],
      ['layer:layer-1', 1],
    ]);
  });

  it('leaves out the layers of a group that is folded, and keeps the group', () => {
    const store = scene();
    store.dispatch({ type: 'setGroupCollapsed', groupId: 'group-1', collapsed: true });
    expect(keys(treeItems(legendModel(store.getState())))).toEqual([
      'group:group-2',
      'layer:layer-4',
      'group:group-1',
      'layer:layer-1',
    ]);
  });

  it('says whether a layer is on, and how many of a group are', () => {
    const store = scene();
    store.dispatch({ type: 'setVisible', layerId: 'layer-3', visible: false });
    const items = treeItems(legendModel(store.getState()));
    expect(items.find((item) => itemKey(item) === 'layer:layer-3')).toMatchObject({
      visible: false,
    });
    expect(items.find((item) => itemKey(item) === 'group:group-1')).toMatchObject({
      visibility: 'some',
    });
    expect(items.find((item) => itemKey(item) === 'group:group-2')).toMatchObject({
      visibility: 'all',
    });
  });

  it('has no rows for a legend with no layers', () => {
    expect(treeItems(legendModel(createSceneStore().getState()))).toEqual([]);
  });

  it('tells a layer from a group that has the same id', () => {
    expect(itemKey({ kind: 'layer', id: 'a' })).not.toBe(itemKey({ kind: 'group', id: 'a' }));
  });
});

describe('moveFrom', () => {
  const items = treeItems(legendModel(scene().getState()));

  it('goes to the next row down and the one before up, and stays at the ends', () => {
    expect(moveFrom(items, 'group:group-2', 'ArrowDown')).toBe('layer:layer-4');
    expect(moveFrom(items, 'layer:layer-4', 'ArrowDown')).toBe('group:group-1');
    expect(moveFrom(items, 'layer:layer-3', 'ArrowUp')).toBe('layer:layer-2');
    expect(moveFrom(items, 'layer:layer-1', 'ArrowDown')).toBe('layer:layer-1');
    expect(moveFrom(items, 'group:group-2', 'ArrowUp')).toBe('group:group-2');
  });

  it('goes to the first row with Home and the last with End, from anywhere', () => {
    expect(moveFrom(items, 'layer:layer-3', 'Home')).toBe('group:group-2');
    expect(moveFrom(items, 'layer:layer-3', 'End')).toBe('layer:layer-1');
    expect(moveFrom(items, undefined, 'Home')).toBe('group:group-2');
    expect(moveFrom(items, undefined, 'End')).toBe('layer:layer-1');
  });

  it('starts at the first row going down and the last going up when nothing has the keyboard, or its row is gone', () => {
    expect(moveFrom(items, undefined, 'ArrowDown')).toBe('group:group-2');
    expect(moveFrom(items, undefined, 'ArrowUp')).toBe('layer:layer-1');
    expect(moveFrom(items, 'layer:layer-9', 'ArrowDown')).toBe('group:group-2');
    expect(moveFrom(items, 'layer:layer-9', 'ArrowUp')).toBe('layer:layer-1');
  });

  it('goes nowhere when there are no rows, and does not step over a group that is folded to reach its layers', () => {
    expect(moveFrom([], undefined, 'ArrowDown')).toBeUndefined();
    const store = scene();
    store.dispatch({ type: 'setGroupCollapsed', groupId: 'group-1', collapsed: true });
    const folded = treeItems(legendModel(store.getState()));
    expect(moveFrom(folded, 'group:group-1', 'ArrowDown')).toBe('layer:layer-1');
  });
});

describe('toggleCommand', () => {
  const store = scene();
  store.dispatch({ type: 'setVisible', layerId: 'layer-3', visible: false });
  const items = treeItems(legendModel(store.getState()));
  const row = (key: string): TreeItem => {
    const found = items.find((item) => itemKey(item) === key);
    if (found === undefined) {
      throw new Error(`There is no row ${key}.`);
    }
    return found;
  };

  it('hides a layer that is shown and shows one that is hidden', () => {
    expect(toggleCommand(row('layer:layer-2'))).toEqual({
      type: 'setVisible',
      layerId: 'layer-2',
      visible: false,
    });
    expect(toggleCommand(row('layer:layer-3'))).toEqual({
      type: 'setVisible',
      layerId: 'layer-3',
      visible: true,
    });
  });

  it('turns every layer of a group off when all are on, and on when some or none are', () => {
    expect(toggleCommand(row('group:group-2'))).toEqual({
      type: 'setGroupVisible',
      groupId: 'group-2',
      visible: false,
    });
    // group-1 has one of its two on: neither ticked nor not, so it goes to all on.
    expect(toggleCommand(row('group:group-1'))).toEqual({
      type: 'setGroupVisible',
      groupId: 'group-1',
      visible: true,
    });
    const none = scene();
    none.dispatch({ type: 'setGroupVisible', groupId: 'group-2', visible: false });
    const hidden = treeItems(legendModel(none.getState())).find(
      (item) => itemKey(item) === 'group:group-2',
    );
    expect(hidden && toggleCommand(hidden)).toEqual({
      type: 'setGroupVisible',
      groupId: 'group-2',
      visible: true,
    });
  });
});
