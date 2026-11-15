import type { ClassBreaks } from '@karmania/engine/display';
import { createSceneStore, legendModel } from '@karmania/scene';
import type { NewDataset } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import {
  expansionFor,
  itemKey,
  keyAction,
  moveFrom,
  stillThere,
  toggleCommand,
  treeItems,
  withExpansion,
} from './legend-tree.js';
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

const gridDataset = (id: number): NewDataset => ({
  id,
  name: `Grid ${String(id)}`,
  kind: 'grid',
  elementCount: 5,
  columns: [{ name: 'Au', type: 'float', nullCount: 1 }],
});

const breaks: ClassBreaks = {
  kind: 'ranges',
  column: 'Au',
  bounds: [0, 1, 2],
  counts: [2, 2],
  nulls: 1,
};

/**
 * `layer-1` is a grid coloured by classes, with the classes given (two ranges and a cell with no value), `layer-2` is a grid with no classes given yet,
 * and `layer-3` is points in one colour; a group holds `layer-4`, a grid with classes.
 */
function classified() {
  const store = createSceneStore();
  store.dispatch({ type: 'addLayers', datasets: [gridDataset(0), gridDataset(1)] });
  store.dispatch({ type: 'addLayers', datasets: [dataset(2), gridDataset(3)] });
  store.dispatch({ type: 'createGroup', name: 'Samples' });
  store.dispatch({ type: 'moveNode', id: 'layer-4', to: { parent: 'group-1', index: 0 } });
  return legendModel(store.getState(), {
    breaks: { 'layer-1': breaks, 'layer-4': breaks },
  });
}

describe('treeItems with layers that can be opened', () => {
  it('has every layer closed to begin with, those that have classes and those that have none, and says the level and the group of each', () => {
    const items = treeItems(classified());
    const layers = items.filter((item) => item.kind === 'layer');
    expect(layers.map((item) => item.id).sort()).toEqual([
      'layer-1',
      'layer-2',
      'layer-3',
      'layer-4',
    ]);
    expect(layers.every((item) => !item.expanded)).toBe(true);
    expect(layers.find((item) => item.id === 'layer-4')).toMatchObject({
      level: 2,
      parent: 'group-1',
    });
    expect(layers.find((item) => item.id === 'layer-1')).toMatchObject({ level: 1, parent: null });
  });

  it('says a layer is open when it has been opened, and only that one: the others stay closed, and an id that is not a layer opens nothing', () => {
    const items = treeItems(classified(), new Set(['layer-1', 'layer-3', 'group-1', 'layer-9']));
    const open = items.flatMap((item) => (item.kind === 'layer' && item.expanded ? [item.id] : []));
    expect(open.sort()).toEqual(['layer-1', 'layer-3']);
  });
});

describe('withExpansion', () => {
  it('gives a set with the layer opened or closed, and the same set when nothing changes', () => {
    const none: ReadonlySet<string> = new Set();
    const one = withExpansion(none, 'layer-1', true);
    expect([...one]).toEqual(['layer-1']);
    expect(none.size).toBe(0);
    expect(withExpansion(one, 'layer-1', true)).toBe(one);
    expect([...withExpansion(one, 'layer-1', false)]).toEqual([]);
    expect(withExpansion(none, 'layer-1', false)).toBe(none);
  });
});

describe('stillThere', () => {
  it('keeps the ids that are layers of the legend, in groups or not, and drops the others', () => {
    const model = classified();
    expect([...stillThere(new Set(['layer-1', 'layer-4', 'layer-9', 'group-1']), model)]).toEqual([
      'layer-1',
      'layer-4',
    ]);
  });

  it('gives the same set when all are still there', () => {
    const open: ReadonlySet<string> = new Set(['layer-1']);
    expect(stillThere(open, classified())).toBe(open);
  });
});

describe('expansionFor', () => {
  const items = treeItems(classified(), new Set(['layer-4']));
  const row = (kind: 'layer' | 'group', id: string) => {
    const found = items.find((item) => item.kind === kind && item.id === id);
    if (found === undefined) {
      throw new Error(`There is no row ${id}.`);
    }
    return found;
  };

  it('opens a layer that can be opened with Right, and closes one that is open with Left', () => {
    expect(expansionFor(row('layer', 'layer-1'), 'ArrowRight')).toBe(true);
    expect(expansionFor(row('layer', 'layer-4'), 'ArrowLeft')).toBe(false);
  });

  it('opens a layer that has no classes too, with Right: its style is behind it', () => {
    expect(expansionFor(row('layer', 'layer-3'), 'ArrowRight')).toBe(true);
    expect(expansionFor(row('layer', 'layer-2'), 'ArrowRight')).toBe(true);
  });

  it('does nothing when the layer is so already, is a group, or the key is another', () => {
    expect(expansionFor(row('layer', 'layer-1'), 'ArrowLeft')).toBeUndefined();
    expect(expansionFor(row('layer', 'layer-4'), 'ArrowRight')).toBeUndefined();
    expect(expansionFor(row('group', 'group-1'), 'ArrowRight')).toBeUndefined();
    expect(expansionFor(row('layer', 'layer-1'), 'Enter')).toBeUndefined();
  });
});

describe('keyAction', () => {
  /** `classified()` with a second group that is empty and a third that is folded (with `layer-5`, a layer with classes). */
  function withGroups() {
    const store = createSceneStore();
    store.dispatch({ type: 'addLayers', datasets: [gridDataset(0), gridDataset(1)] });
    store.dispatch({ type: 'addLayers', datasets: [dataset(2), gridDataset(3), gridDataset(4)] });
    store.dispatch({ type: 'createGroup', name: 'Samples' });
    store.dispatch({ type: 'createGroup', name: 'Empty' });
    store.dispatch({ type: 'createGroup', name: 'Folded' });
    store.dispatch({ type: 'moveNode', id: 'layer-4', to: { parent: 'group-1', index: 0 } });
    store.dispatch({ type: 'moveNode', id: 'layer-5', to: { parent: 'group-3', index: 0 } });
    store.dispatch({ type: 'setGroupCollapsed', groupId: 'group-3', collapsed: true });
    return legendModel(store.getState(), {
      breaks: { 'layer-1': breaks, 'layer-4': breaks, 'layer-5': breaks },
    });
  }
  const model = withGroups();
  const row = (items: ReturnType<typeof treeItems>, key: string) => {
    const found = items.find((item) => itemKey(item) === key);
    if (found === undefined) {
      throw new Error(`There is no row ${key}.`);
    }
    return found;
  };

  it('folds a group that is open with Left and goes to its first layer with Right, and unfolds one that is folded with Right', () => {
    const items = treeItems(model);
    expect(keyAction(items, row(items, 'group:group-1'), 'ArrowLeft')).toEqual({
      kind: 'fold',
      groupId: 'group-1',
      collapsed: true,
    });
    expect(keyAction(items, row(items, 'group:group-1'), 'ArrowRight')).toEqual({
      kind: 'focus',
      key: 'layer:layer-4',
    });
    expect(keyAction(items, row(items, 'group:group-3'), 'ArrowRight')).toEqual({
      kind: 'fold',
      groupId: 'group-3',
      collapsed: false,
    });
  });

  it('does nothing with Left on a group that is folded, or with Right on one that has no layer under it', () => {
    const items = treeItems(model);
    expect(keyAction(items, row(items, 'group:group-3'), 'ArrowLeft')).toBeUndefined();
    expect(keyAction(items, row(items, 'group:group-2'), 'ArrowRight')).toBeUndefined();
  });

  it('opens a layer with Right and closes one that is open with Left, and with Left goes from a layer that is closed to its group', () => {
    const closed = treeItems(model);
    expect(keyAction(closed, row(closed, 'layer:layer-4'), 'ArrowRight')).toEqual({
      kind: 'open',
      id: 'layer-4',
      open: true,
    });
    expect(keyAction(closed, row(closed, 'layer:layer-4'), 'ArrowLeft')).toEqual({
      kind: 'focus',
      key: 'group:group-1',
    });
    const open = treeItems(model, new Set(['layer-4']));
    expect(keyAction(open, row(open, 'layer:layer-4'), 'ArrowLeft')).toEqual({
      kind: 'open',
      id: 'layer-4',
      open: false,
    });
  });

  it('does nothing on a layer of the top that is closed, with Left, and for any other key', () => {
    const items = treeItems(model);
    expect(keyAction(items, row(items, 'layer:layer-1'), 'ArrowLeft')).toBeUndefined();
    expect(keyAction(items, row(items, 'layer:layer-3'), 'ArrowLeft')).toBeUndefined();
    expect(keyAction(items, row(items, 'layer:layer-3'), 'ArrowRight')).toEqual({
      kind: 'open',
      id: 'layer-3',
      open: true,
    });
    expect(keyAction(items, row(items, 'group:group-1'), 'Enter')).toBeUndefined();
    expect(keyAction(items, row(items, 'layer:layer-4'), 'ArrowDown')).toBeUndefined();
  });

  it('says in treeItems which group a layer is in', () => {
    const items = treeItems(model);
    expect(row(items, 'layer:layer-4')).toMatchObject({ parent: 'group-1' });
    expect(row(items, 'layer:layer-1')).toMatchObject({ parent: null });
  });
});
