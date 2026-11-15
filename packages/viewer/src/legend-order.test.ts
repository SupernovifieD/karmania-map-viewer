import { createSceneStore, legendModel } from '@karmania/scene';
import type { NewDataset } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import { announceMove, placeOf, stepMove } from './legend-order.js';

const dataset = (id: number, name: string): NewDataset => ({
  id,
  name,
  kind: 'points',
  elementCount: 2,
  columns: [],
});

/**
 * From the top: group-1 `Samples` (`Geology`, `Drillholes`), `Assays`, `Topography`. (The layer loaded last is at the top, so `Topography` is
 * `layer-1`, the lowest.)
 */
function scene() {
  const store = createSceneStore();
  store.dispatch({
    type: 'addLayers',
    datasets: [
      dataset(0, 'Topography'),
      dataset(1, 'Assays'),
      dataset(2, 'Geology'),
      dataset(3, 'Drillholes'),
    ],
  });
  store.dispatch({ type: 'createGroup', name: 'Samples' });
  // Drillholes (layer-4) is on top at first; into the group in the order Geology, Drillholes.
  store.dispatch({ type: 'moveNode', id: 'layer-3', to: { parent: 'group-1', index: 0 } });
  store.dispatch({ type: 'moveNode', id: 'layer-4', to: { parent: 'group-1', index: 1 } });
  return store;
}

const model = () => legendModel(scene().getState());

describe('placeOf', () => {
  it('says which list a node is in, where, and how long the list is', () => {
    const now = model();
    expect(placeOf(now, 'group-1')).toEqual({ parent: null, index: 0, size: 3 });
    expect(placeOf(now, 'layer-2')).toEqual({ parent: null, index: 1, size: 3 });
    expect(placeOf(now, 'layer-1')).toEqual({ parent: null, index: 2, size: 3 });
    expect(placeOf(now, 'layer-3')).toEqual({ parent: 'group-1', index: 0, size: 2 });
    expect(placeOf(now, 'layer-4')).toEqual({ parent: 'group-1', index: 1, size: 2 });
  });

  it('says nothing of a node that is not there', () => {
    expect(placeOf(model(), 'layer-9')).toBeUndefined();
  });
});

describe('announceMove', () => {
  it('says "above" the one that is under the node after the move, as the brief has it', () => {
    // Assays (index 1) goes to the bottom of the legend: nothing under it, so it is below Topography... and to the top it is above Samples.
    expect(announceMove(model(), 'layer-2', { parent: null, index: 0 })).toBe(
      'Moved Assays above Samples',
    );
    expect(announceMove(model(), 'layer-3', { parent: 'group-1', index: 0 })).toBe(
      'Moved Geology above Drillholes',
    );
  });

  it('says "below" the one that is over the node when nothing is under it', () => {
    expect(announceMove(model(), 'layer-2', { parent: null, index: 2 })).toBe(
      'Moved Assays below Topography',
    );
    expect(announceMove(model(), 'layer-3', { parent: 'group-1', index: 1 })).toBe(
      'Moved Geology below Drillholes',
    );
  });

  it('counts the place once the node is out of its list, so moving down by one is the index plus one', () => {
    // Assays at 1 of [Samples, Assays, Topography]: to index 1 it stays (above Topography); to 2 it is below Topography.
    expect(announceMove(model(), 'layer-2', { parent: null, index: 1 })).toBe(
      'Moved Assays above Topography',
    );
  });

  it('says into a group, and out of the one it was in', () => {
    expect(announceMove(model(), 'layer-2', { parent: 'group-1', index: 0 })).toBe(
      'Moved Assays into Samples',
    );
    expect(announceMove(model(), 'layer-3', { parent: null, index: 0 })).toBe(
      'Moved Geology out of Samples',
    );
  });

  it('says what it can when the node is not there', () => {
    expect(announceMove(model(), 'layer-9', { parent: null, index: 0 })).toBe(
      'layer-9 cannot be moved.',
    );
  });

  it('says a group moves too, with its own name', () => {
    expect(announceMove(model(), 'group-1', { parent: null, index: 2 })).toBe(
      'Moved Samples below Topography',
    );
  });
});

describe('stepMove', () => {
  it('moves a row up by one place of its list, and says where it is', () => {
    expect(stepMove(model(), 'layer-2', 'up')).toEqual({
      move: { id: 'layer-2', to: { parent: null, index: 0 } },
      say: 'Moved Assays above Samples',
    });
    expect(stepMove(model(), 'layer-4', 'up')).toEqual({
      move: { id: 'layer-4', to: { parent: 'group-1', index: 0 } },
      say: 'Moved Drillholes above Geology',
    });
  });

  it('moves a row down by one place of its list, and says where it is', () => {
    expect(stepMove(model(), 'layer-2', 'down')).toEqual({
      move: { id: 'layer-2', to: { parent: null, index: 2 } },
      say: 'Moved Assays below Topography',
    });
    expect(stepMove(model(), 'group-1', 'down')).toEqual({
      move: { id: 'group-1', to: { parent: null, index: 1 } },
      say: 'Moved Samples above Topography',
    });
  });

  it('does not move a row past the ends of its list, and says so, with the name of the group for a layer in one', () => {
    expect(stepMove(model(), 'group-1', 'up')).toEqual({
      say: 'Samples is already at the top of the legend',
    });
    expect(stepMove(model(), 'layer-1', 'down')).toEqual({
      say: 'Topography is already at the bottom of the legend',
    });
    expect(stepMove(model(), 'layer-3', 'up')).toEqual({
      say: 'Geology is already at the top of Samples',
    });
    expect(stepMove(model(), 'layer-4', 'down')).toEqual({
      say: 'Drillholes is already at the bottom of Samples',
    });
  });

  it('does not move a row that is not there', () => {
    expect(stepMove(model(), 'layer-9', 'up')).toEqual({ say: 'layer-9 cannot be moved.' });
  });
});

describe('what is said, and where the scene puts the row', () => {
  it('has the row where the move says it is when the scene is given the move, and in the order that was said', () => {
    for (const [id, direction] of [
      ['layer-2', 'up'],
      ['layer-2', 'down'],
      ['layer-4', 'up'],
      ['layer-3', 'down'],
      ['group-1', 'down'],
    ] as const) {
      const store = scene();
      const step = stepMove(legendModel(store.getState()), id, direction);
      expect(step.move, `${id} ${direction}`).toBeDefined();
      if (step.move === undefined) {
        continue;
      }
      store.dispatch({ type: 'moveNode', id: step.move.id, to: step.move.to });
      expect(placeOf(legendModel(store.getState()), id), `${id} ${direction}`).toMatchObject(
        step.move.to,
      );
    }
  });

  it('says "below Topography" for Assays moved down, which is the order the scene has after it', () => {
    const store = scene();
    const step = stepMove(legendModel(store.getState()), 'layer-2', 'down');
    store.dispatch({
      type: 'moveNode',
      id: 'layer-2',
      to: step.move?.to ?? { parent: null, index: 0 },
    });
    expect(step.say).toBe('Moved Assays below Topography');
    expect(legendModel(store.getState()).entries.map((entry) => entry.name)).toEqual([
      'Samples',
      'Topography',
      'Assays',
    ]);
  });
});
