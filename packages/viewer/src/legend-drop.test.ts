import { createSceneStore, legendModel } from '@karmania/scene';
import type { LegendModel, NewDataset } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import { EDGE, MAX_STEP, dropCandidates, edgeStep, pickDrop } from './legend-drop.js';
import type { DropRow } from './legend-drop.js';
import { placeOf } from './legend-order.js';

const INDENT = 24;

/**
 * The rows of a legend from the top, each 32 high from y 0 with its left edge at 16 (24 more for a layer in a group): `Samples` (a group) with `a` and `b`,
 * then `c`. `blockBottom` of the group is the bottom of `b`; of `a` the same as its bottom unless it has lines.
 */
function rows(
  over: { readonly aLines?: number; readonly cLines?: number; readonly collapsed?: boolean } = {},
): DropRow[] {
  const lines = over.aLines ?? 0;
  const inside: DropRow[] = over.collapsed
    ? []
    : [
        {
          id: 'a',
          kind: 'layer',
          parent: 'G',
          index: 0,
          top: 32,
          bottom: 64,
          blockBottom: 64 + lines,
          left: 16 + INDENT,
        },
        {
          id: 'b',
          kind: 'layer',
          parent: 'G',
          index: 1,
          top: 64 + lines,
          bottom: 96 + lines,
          blockBottom: 96 + lines,
          left: 16 + INDENT,
        },
      ];
  const end = inside.length === 0 ? 32 : 96 + lines;
  return [
    {
      id: 'G',
      kind: 'group',
      parent: null,
      index: 0,
      collapsed: over.collapsed === true,
      top: 0,
      bottom: 32,
      blockBottom: end,
      left: 16,
    },
    ...inside,
    {
      id: 'c',
      kind: 'layer',
      parent: null,
      index: 1,
      top: end,
      bottom: end + 32,
      blockBottom: end + 32 + (over.cLines ?? 0),
      left: 16,
    },
  ];
}

const places = (list: ReturnType<typeof dropCandidates>) =>
  list.map((candidate) => [
    candidate.place.parent,
    candidate.place.index,
    candidate.y,
    candidate.level,
  ]);

describe('dropCandidates', () => {
  it('has a gap before each row of the top of the legend and after the last, and in a group before each layer and after the last, for a layer', () => {
    expect(places(dropCandidates(rows(), { id: 'x', kind: 'layer' }, INDENT))).toEqual([
      [null, 0, 0, 1],
      [null, 1, 96, 1],
      [null, 2, 128, 1],
      ['G', 0, 32, 2],
      ['G', 1, 64, 2],
      ['G', 2, 96, 2],
    ]);
  });

  it('has the line of a gap at the left of the rows of its list', () => {
    const lefts = dropCandidates(rows(), { id: 'x', kind: 'layer' }, INDENT).map((c) => c.left);
    expect(lefts).toEqual([16, 16, 16, 40, 40, 40]);
  });

  it('has no gap in a group for a group: it is only in the top of the legend, and not where it would stay', () => {
    // G is at 0: the gap before it and the gap after it (before `c`) are where it is; only the end of the legend is left.
    expect(places(dropCandidates(rows(), { id: 'G', kind: 'group' }, INDENT))).toEqual([
      [null, 2 - 1, 128, 1],
    ]);
  });

  it('leaves out the gap before the row and the gap after it, which are where it is, and counts the index once it is out of its list', () => {
    // `a` is first in G: gaps 0 and 1 of G are where it is; the end of G (gap 2) is index 1 (once `a` is out, `b` is first and it goes after it).
    expect(places(dropCandidates(rows(), { id: 'a', kind: 'layer' }, INDENT))).toEqual([
      [null, 0, 0, 1],
      [null, 1, 96, 1],
      [null, 2, 128, 1],
      ['G', 1, 96, 2],
    ]);
    // `c` is last of the top: before it (gap 1) and after it (gap 2) are where it is.
    expect(places(dropCandidates(rows(), { id: 'c', kind: 'layer' }, INDENT))).toEqual([
      [null, 0, 0, 1],
      ['G', 0, 32, 2],
      ['G', 1, 64, 2],
      ['G', 2, 96, 2],
    ]);
  });

  it('puts the gap after a layer under its lines when it is open, and the next gap under them too', () => {
    const open = rows({ aLines: 48 });
    const candidates = dropCandidates(open, { id: 'x', kind: 'layer' }, INDENT);
    expect(candidates.find((c) => c.place.parent === 'G' && c.place.index === 1)?.y).toBe(112);
    expect(candidates.find((c) => c.place.parent === null && c.place.index === 1)?.y).toBe(144);
    // And the end of the legend is under the lines of the last row, when that is open.
    const last = dropCandidates(rows({ cLines: 48 }), { id: 'x', kind: 'layer' }, INDENT);
    expect(last.find((c) => c.place.parent === null && c.place.index === 2)?.y).toBe(128 + 48);
  });

  it('has a gap right under a group that has none of its layers shown, which is the first place in it, with the line indented', () => {
    const folded = dropCandidates(rows({ collapsed: true }), { id: 'x', kind: 'layer' }, INDENT);
    expect(places(folded)).toEqual([
      [null, 0, 0, 1],
      [null, 1, 32, 1],
      [null, 2, 64, 1],
      ['G', 0, 32, 2],
    ]);
    expect(folded.at(-1)?.left).toBe(16 + INDENT);
  });
});

describe('pickDrop', () => {
  const layer = dropCandidates(rows(), { id: 'x', kind: 'layer' }, INDENT);
  const nestAt = 16 + INDENT;

  it('takes the gap nearest to the pointer in height', () => {
    expect(pickDrop(layer, { x: 100, y: 5 }, nestAt)?.place).toEqual({ parent: null, index: 0 });
    expect(pickDrop(layer, { x: 100, y: 60 }, nestAt)?.place).toEqual({ parent: 'G', index: 1 });
    expect(pickDrop(layer, { x: 100, y: 500 }, nestAt)?.place).toEqual({ parent: null, index: 2 });
    expect(pickDrop(layer, { x: 100, y: -50 }, nestAt)?.place).toEqual({ parent: null, index: 0 });
  });

  it('takes the end of a group when the pointer is where its layers are, and the row after it when it is not', () => {
    // y 96 is the end of G's layers and the top of `c`.
    expect(pickDrop(layer, { x: nestAt + 10, y: 96 }, nestAt)?.place).toEqual({
      parent: 'G',
      index: 2,
    });
    expect(pickDrop(layer, { x: nestAt - 10, y: 96 }, nestAt)?.place).toEqual({
      parent: null,
      index: 1,
    });
    // At the edge: from `nestAt` it is in the group.
    expect(pickDrop(layer, { x: nestAt, y: 96 }, nestAt)?.place.parent).toBe('G');
    expect(pickDrop(layer, { x: nestAt - 1, y: 96 }, nestAt)?.place.parent).toBeNull();
  });

  it('takes a gap two pixels away as the same height, and one three away as another', () => {
    const two = [
      { place: { parent: null, index: 1 }, y: 100, left: 16, level: 1 as const },
      { place: { parent: 'G', index: 2 }, y: 102, left: 40, level: 2 as const },
    ];
    // Nearest is 100; 102 is within two of it, so the pointer's place across decides.
    expect(pickDrop(two, { x: 100, y: 100 }, nestAt)?.place.parent).toBe('G');
    const three = [two[0], { ...two[1], y: 103 }];
    expect(pickDrop(three as typeof two, { x: 100, y: 100 }, nestAt)?.place.parent).toBeNull();
  });

  it('takes none when there is no gap, and takes the only one there is, whatever the pointer', () => {
    expect(pickDrop([], { x: 0, y: 0 }, nestAt)).toBeUndefined();
    const group = dropCandidates(rows(), { id: 'G', kind: 'group' }, INDENT);
    expect(pickDrop(group, { x: nestAt + 50, y: 0 }, nestAt)?.place).toEqual({
      parent: null,
      index: 1,
    });
  });
});

const dataset = (id: number): NewDataset => ({
  id,
  name: `Dataset ${String(id)}`,
  kind: 'points',
  elementCount: 2,
  columns: [],
});

/** Five layers and a group: from the top, `group-1` (`layer-3`, `layer-4`), `layer-2`, `layer-1`, `layer-5`'s place being made by the moves. */
function scene() {
  const store = createSceneStore();
  store.dispatch({ type: 'addLayers', datasets: [0, 1, 2, 3, 4].map(dataset) });
  store.dispatch({ type: 'createGroup', name: 'Samples' });
  store.dispatch({ type: 'moveNode', id: 'layer-3', to: { parent: 'group-1', index: 0 } });
  store.dispatch({ type: 'moveNode', id: 'layer-4', to: { parent: 'group-1', index: 1 } });
  return store;
}

/** The rows of a legend as the tab would measure them: each 32 high one under the other (a group's layers 24 in). */
function rowsOf(model: LegendModel): DropRow[] {
  const found: DropRow[] = [];
  let y = 0;
  const push = (row: Omit<DropRow, 'top' | 'bottom' | 'blockBottom'>) => {
    found.push({ ...row, top: y, bottom: y + 32, blockBottom: y + 32 });
    y += 32;
  };
  model.entries.forEach((entry, index) => {
    if (entry.type === 'layer') {
      push({ id: entry.id, kind: 'layer', parent: null, index, left: 16 });
      return;
    }
    const group = found.length;
    push({
      id: entry.id,
      kind: 'group',
      parent: null,
      index,
      collapsed: entry.collapsed,
      left: 16,
    });
    entry.layers.forEach((layer, at) => {
      push({ id: layer.id, kind: 'layer', parent: entry.id, index: at, left: 40 });
    });
    const header = found[group];
    if (header !== undefined) {
      found[group] = { ...header, blockBottom: y };
    }
  });
  return found;
}

describe('dropCandidates and the scene', () => {
  it('lands every row of the legend where each gap says, in the scene, for every gap it can land in', () => {
    const before = legendModel(scene().getState());
    const all = rowsOf(before);
    let tried = 0;
    for (const row of all) {
      for (const candidate of dropCandidates(all, row, INDENT)) {
        const store = scene();
        store.dispatch({ type: 'moveNode', id: row.id, to: candidate.place });
        expect(
          placeOf(legendModel(store.getState()), row.id),
          `${row.id} to ${String(candidate.place.parent)} at ${String(candidate.place.index)}`,
        ).toMatchObject(candidate.place);
        tried += 1;
      }
    }
    // Every row had gaps to try: more than 20 in all (6 rows, a few gaps each).
    expect(tried).toBeGreaterThan(20);
  });
});

describe('edgeStep', () => {
  // A part that scrolls from 100 to 600 in the window.
  const step = (y: number): number => edgeStep(y, 100, 600);

  it('is nothing between the edges, and at the limit of the margin', () => {
    expect(step(300)).toBe(0);
    expect(step(100 + EDGE)).toBe(0);
    expect(step(600 - EDGE)).toBe(0);
  });

  it('is up (negative) near the top and down (positive) near the bottom, faster the nearer the edge', () => {
    expect(step(100 + EDGE - 1)).toBeLessThan(0);
    expect(step(600 - EDGE + 1)).toBeGreaterThan(0);
    expect(Math.abs(step(110))).toBeGreaterThan(Math.abs(step(130)));
    expect(step(590)).toBeGreaterThan(step(570));
  });

  it('is at most MAX_STEP, at the edge and past it (the pointer outside the part, which a drag with the pointer taken can be)', () => {
    expect(step(100)).toBe(-MAX_STEP);
    expect(step(-300)).toBe(-MAX_STEP);
    expect(step(5000)).toBe(MAX_STEP);
  });

  it('is at least 1 inside the margin, so that a pointer at its edge still scrolls', () => {
    expect(step(100 + EDGE - 1)).toBe(-1);
    expect(step(600 - EDGE + 1)).toBe(1);
  });

  it('goes by the nearer edge for a part that is shorter than two margins', () => {
    expect(edgeStep(105, 100, 130)).toBeLessThan(0);
    expect(edgeStep(125, 100, 130)).toBeGreaterThan(0);
  });
});
