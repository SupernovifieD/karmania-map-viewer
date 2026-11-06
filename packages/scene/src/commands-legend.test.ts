import { describe, expect, it } from 'vitest';
import {
  createGroup,
  deleteGroup,
  moveNode,
  renameGroup,
  setGroupCollapsed,
} from './commands-legend.js';
import { frozen, sampleScene } from './test-support/documents.js';
import { validateScene } from './validate.js';
import type { LegendNode, SceneDocument } from './types.js';

const layer = (id: string): LegendNode => ({ type: 'layer', id });
const group = (id: string, children: string[], name = 'G'): LegendNode => ({
  type: 'group',
  id,
  name,
  collapsed: false,
  children,
});

/** The sample document with its three layers laid out as `legend`. */
function withLegend(legend: LegendNode[]): SceneDocument {
  return { ...sampleScene(), legend };
}

const shape = (doc: SceneDocument): string[] =>
  doc.legend.map((n) => (n.type === 'layer' ? n.id : `${n.id}[${n.children.join(',')}]`));

describe('moveNode: at the top of the legend', () => {
  const doc = withLegend([layer('layer-1'), layer('layer-2'), layer('layer-3')]);

  it('moves a layer to a place in the list, counted without the layer itself', () => {
    expect(shape(moveNode(doc, 'layer-1', { parent: null, index: 1 }))).toEqual([
      'layer-2',
      'layer-1',
      'layer-3',
    ]);
    expect(shape(moveNode(doc, 'layer-1', { parent: null, index: 2 }))).toEqual([
      'layer-2',
      'layer-3',
      'layer-1',
    ]);
    expect(shape(moveNode(doc, 'layer-3', { parent: null, index: 0 }))).toEqual([
      'layer-3',
      'layer-1',
      'layer-2',
    ]);
    expect(shape(moveNode(doc, 'layer-2', { parent: null, index: 0 }))).toEqual([
      'layer-2',
      'layer-1',
      'layer-3',
    ]);
  });

  it('puts a layer at the end for a place at the end or beyond, and at the start for one before it', () => {
    expect(shape(moveNode(doc, 'layer-1', { parent: null, index: 99 }))).toEqual([
      'layer-2',
      'layer-3',
      'layer-1',
    ]);
    expect(shape(moveNode(doc, 'layer-3', { parent: null, index: -1 }))).toEqual([
      'layer-3',
      'layer-1',
      'layer-2',
    ]);
    expect(shape(moveNode(doc, 'layer-3', { parent: null, index: -5 }))).toEqual([
      'layer-3',
      'layer-1',
      'layer-2',
    ]);
    expect(shape(moveNode(doc, 'layer-1', { parent: null, index: Infinity }))).toEqual([
      'layer-2',
      'layer-3',
      'layer-1',
    ]);
    expect(shape(moveNode(doc, 'layer-3', { parent: null, index: -Infinity }))).toEqual([
      'layer-3',
      'layer-1',
      'layer-2',
    ]);
    expect(shape(moveNode(doc, 'layer-1', { parent: null, index: 1.9 }))).toEqual([
      'layer-2',
      'layer-1',
      'layer-3',
    ]);
  });

  it('moves a group, with its layers, among the layers and the other groups', () => {
    const grouped = withLegend([layer('layer-1'), group('group-1', ['layer-2', 'layer-3'])]);
    expect(shape(moveNode(grouped, 'group-1', { parent: null, index: 0 }))).toEqual([
      'group-1[layer-2,layer-3]',
      'layer-1',
    ]);
    expect(validateScene(moveNode(grouped, 'group-1', { parent: null, index: 0 }))).toEqual([]);
  });

  it('is the same document when the node is where it is sent, or is not there, or the place is not a number', () => {
    expect(moveNode(doc, 'layer-2', { parent: null, index: 1 })).toBe(doc);
    expect(moveNode(doc, 'layer-3', { parent: null, index: 99 })).toBe(doc);
    expect(moveNode(doc, 'layer-9', { parent: null, index: 0 })).toBe(doc);
    expect(moveNode(doc, 'layer-3', { parent: null, index: NaN })).toBe(doc);
  });
});

describe('moveNode: into and out of groups', () => {
  const doc = withLegend([layer('layer-1'), group('group-1', ['layer-2', 'layer-3'])]);

  it('moves a layer into a group, at a place in it, and out of the top of the legend', () => {
    expect(shape(moveNode(doc, 'layer-1', { parent: 'group-1', index: 0 }))).toEqual([
      'group-1[layer-1,layer-2,layer-3]',
    ]);
    expect(shape(moveNode(doc, 'layer-1', { parent: 'group-1', index: 1 }))).toEqual([
      'group-1[layer-2,layer-1,layer-3]',
    ]);
    expect(shape(moveNode(doc, 'layer-1', { parent: 'group-1', index: 99 }))).toEqual([
      'group-1[layer-2,layer-3,layer-1]',
    ]);
  });

  it('moves a layer out of its group to the top of the legend, and the group stays, empty if need be', () => {
    expect(shape(moveNode(doc, 'layer-2', { parent: null, index: 0 }))).toEqual([
      'layer-2',
      'layer-1',
      'group-1[layer-3]',
    ]);
    const one = withLegend([group('group-1', ['layer-2']), layer('layer-1'), layer('layer-3')]);
    expect(shape(moveNode(one, 'layer-2', { parent: null, index: 3 }))).toEqual([
      'group-1[]',
      'layer-1',
      'layer-3',
      'layer-2',
    ]);
  });

  it('moves a layer from one group to another, and within its group', () => {
    const two = withLegend([
      group('group-1', ['layer-1', 'layer-2']),
      group('group-2', ['layer-3']),
    ]);
    expect(shape(moveNode(two, 'layer-1', { parent: 'group-2', index: 0 }))).toEqual([
      'group-1[layer-2]',
      'group-2[layer-1,layer-3]',
    ]);
    expect(shape(moveNode(two, 'layer-1', { parent: 'group-1', index: 1 }))).toEqual([
      'group-1[layer-2,layer-1]',
      'group-2[layer-3]',
    ]);
  });

  it('does not put a group into a group, or anything into a group that is not there or is a layer', () => {
    const two = withLegend([
      group('group-1', ['layer-1', 'layer-2']),
      group('group-2', ['layer-3']),
    ]);
    expect(moveNode(two, 'group-1', { parent: 'group-2', index: 0 })).toBe(two);
    expect(moveNode(two, 'layer-1', { parent: 'group-9', index: 0 })).toBe(two);
    expect(moveNode(two, 'layer-1', { parent: 'layer-3', index: 0 })).toBe(two);
  });

  it('is the same document when a layer is sent to the place it is in', () => {
    expect(moveNode(doc, 'layer-2', { parent: 'group-1', index: 0 })).toBe(doc);
    expect(moveNode(doc, 'layer-3', { parent: 'group-1', index: 1 })).toBe(doc);
    expect(moveNode(doc, 'layer-1', { parent: null, index: 0 })).toBe(doc);
  });

  it('keeps every other node as it was, and the rest of the document, and gives a document that is right', () => {
    const next = moveNode(doc, 'layer-1', { parent: 'group-1', index: 1 });
    expect({ ...next, legend: doc.legend }).toEqual(doc);
    expect(validateScene(next)).toEqual([]);
    for (const place of [
      { parent: null, index: 0 },
      { parent: 'group-1', index: 0 },
      { parent: null, index: 5 },
    ]) {
      expect(validateScene(moveNode(doc, 'layer-3', place))).toEqual([]);
    }
  });

  it('never changes the document it is given', () => {
    expect(shape(moveNode(frozen(doc), 'layer-1', { parent: 'group-1', index: 0 }))).toEqual([
      'group-1[layer-1,layer-2,layer-3]',
    ]);
  });
});

describe('createGroup', () => {
  it('makes an empty group at the top of the legend, open, with the next group number', () => {
    const doc = sampleScene();
    const next = createGroup(doc, 'Drilling');
    expect(next.legend[0]).toEqual({
      type: 'group',
      id: 'group-2',
      name: 'Drilling',
      collapsed: false,
      children: [],
    });
    expect(next.legend.slice(1)).toEqual(doc.legend);
    expect(next.layers).toBe(doc.layers);
    expect(validateScene(next)).toEqual([]);
    expect(
      createGroup(createGroup(createGroup(sampleScene(), 'a'), 'b'), 'c')
        .legend.map((n) => n.id)
        .slice(0, 3),
    ).toEqual(['group-4', 'group-3', 'group-2']);
  });

  it('numbers from 1 when there is no group, and counts groups only, not layers', () => {
    expect(
      createGroup(withLegend([layer('layer-1'), layer('layer-2'), layer('layer-3')]), 'g').legend[0]
        ?.id,
    ).toBe('group-1');
  });

  it('puts the group at a place when it is given one, as moveNode counts it', () => {
    const doc = withLegend([layer('layer-1'), layer('layer-2'), layer('layer-3')]);
    expect(shape(createGroup(doc, 'g', 1))).toEqual(['layer-1', 'group-1[]', 'layer-2', 'layer-3']);
    expect(shape(createGroup(doc, 'g', 99))).toEqual([
      'layer-1',
      'layer-2',
      'layer-3',
      'group-1[]',
    ]);
    expect(shape(createGroup(doc, 'g', -1))).toEqual([
      'group-1[]',
      'layer-1',
      'layer-2',
      'layer-3',
    ]);
  });

  it('takes the space off the name, and a name that is only space is no group', () => {
    expect(createGroup(sampleScene(), '  Drilling \t').legend[0]).toMatchObject({
      name: 'Drilling',
    });
    const doc = sampleScene();
    expect(createGroup(doc, '')).toBe(doc);
    expect(createGroup(doc, ' \n ')).toBe(doc);
    expect(createGroup(doc, 'g', NaN)).toBe(doc);
  });

  it('never changes the document it is given', () => {
    expect(createGroup(frozen(sampleScene()), 'g').legend).toHaveLength(3);
  });
});

describe('renameGroup', () => {
  it('names a group, without the space around the name, and changes nothing else', () => {
    const doc = sampleScene();
    const next = renameGroup(doc, 'group-1', '  Boreholes ');
    expect(next.legend[1]).toEqual({ ...doc.legend[1], name: 'Boreholes' });
    expect({ ...next, legend: doc.legend }).toEqual(doc);
    expect(validateScene(next)).toEqual([]);
  });

  it('is the same document for a name that is nothing but space, the name it has, or a group that is not there', () => {
    const doc = sampleScene();
    expect(renameGroup(doc, 'group-1', '   ')).toBe(doc);
    expect(renameGroup(doc, 'group-1', 'Survey')).toBe(doc);
    expect(renameGroup(doc, 'group-1', ' Survey ')).toBe(doc);
    expect(renameGroup(doc, 'group-9', 'x')).toBe(doc);
    expect(renameGroup(doc, 'layer-1', 'x')).toBe(doc);
  });

  it('never changes the document it is given', () => {
    expect(renameGroup(frozen(sampleScene()), 'group-1', 'x').legend[1]).toMatchObject({
      name: 'x',
    });
  });
});

describe('setGroupCollapsed', () => {
  it('folds a group and opens it again, and nothing else changes', () => {
    const doc = sampleScene();
    const folded = setGroupCollapsed(doc, 'group-1', true);
    expect(folded.legend[1]).toEqual({ ...doc.legend[1], collapsed: true });
    expect(setGroupCollapsed(folded, 'group-1', false)).toEqual(doc);
    expect(validateScene(folded)).toEqual([]);
  });

  it('is the same document when the group is as it is told, or is not there', () => {
    const doc = sampleScene();
    expect(setGroupCollapsed(doc, 'group-1', false)).toBe(doc);
    expect(setGroupCollapsed(doc, 'group-9', true)).toBe(doc);
  });
});

describe('deleteGroup', () => {
  it('puts the layers of the group where the group was, in their order, and loses none', () => {
    const doc = withLegend([layer('layer-1'), group('group-1', ['layer-2', 'layer-3'])]);
    expect(shape(deleteGroup(doc, 'group-1'))).toEqual(['layer-1', 'layer-2', 'layer-3']);
    const middle = withLegend([
      group('group-1', ['layer-1']),
      group('group-2', ['layer-2', 'layer-3']),
    ]);
    expect(shape(deleteGroup(middle, 'group-2'))).toEqual([
      'group-1[layer-1]',
      'layer-2',
      'layer-3',
    ]);
    expect(shape(deleteGroup(middle, 'group-1'))).toEqual(['layer-1', 'group-2[layer-2,layer-3]']);
    expect(validateScene(deleteGroup(middle, 'group-1'))).toEqual([]);
  });

  it('takes away an empty group, and leaves the layers, the selection and the rest of the document alone', () => {
    const doc = withLegend([
      group('group-2', []),
      layer('layer-1'),
      group('group-1', ['layer-2', 'layer-3']),
    ]);
    const next = deleteGroup(doc, 'group-2');
    expect(shape(next)).toEqual(['layer-1', 'group-1[layer-2,layer-3]']);
    expect({ ...next, legend: doc.legend }).toEqual(doc);
    expect(deleteGroup(sampleScene(), 'group-1').selection).toEqual(sampleScene().selection);
  });

  it('is the same document when there is no such group, or the id is a layer`s', () => {
    const doc = sampleScene();
    expect(deleteGroup(doc, 'group-9')).toBe(doc);
    expect(deleteGroup(doc, 'layer-1')).toBe(doc);
  });

  it('never changes the document it is given', () => {
    expect(shape(deleteGroup(frozen(sampleScene()), 'group-1'))).toEqual([
      'layer-1',
      'layer-2',
      'layer-3',
    ]);
  });
});
