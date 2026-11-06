import { describe, expect, it } from 'vitest';
import { moveNode } from './commands-legend.js';
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
