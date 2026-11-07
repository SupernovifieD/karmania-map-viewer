import type { RenderBuffers } from '@karmania/engine/display';
import { Group } from 'three';
import type { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { LayerSet } from './layer-set.js';
import type { LayerObject } from './layer-set.js';

const points: RenderBuffers = { kind: 'points', positions: new Float32Array(3) };
const mesh: RenderBuffers = {
  kind: 'mesh',
  positions: new Float32Array(9),
  triangles: new Uint32Array(3),
};

/** A container that says what is in it, and a maker whose layers say when they were freed. */
function setup(drawn: readonly RenderBuffers['kind'][] = ['points']) {
  const inside = new Set<Object3D>();
  const container = {
    add: (object: Object3D) => inside.add(object),
    remove: (object: Object3D) => inside.delete(object),
  };
  const made: { object: Group; freed: number }[] = [];
  const set = new LayerSet(container, (buffers): LayerObject | undefined => {
    if (!drawn.includes(buffers.kind)) {
      return undefined;
    }
    const layer = { object: new Group(), freed: 0 };
    made.push(layer);
    return {
      object: layer.object,
      dispose: () => {
        layer.freed += 1;
      },
    };
  });
  return { set, inside, made };
}

describe('LayerSet', () => {
  it('puts the layer of some buffers in the container, under an id', () => {
    const { set, inside, made } = setup();
    expect(set.set('layer-1', points)).toBe('drawn');
    expect(set.has('layer-1')).toBe(true);
    expect(set.ids()).toEqual(['layer-1']);
    expect(set.size).toBe(1);
    expect([...inside]).toEqual([made[0]?.object]);
  });

  it('replaces a layer when its buffers come again: the old one is taken out and freed, once', () => {
    const { set, inside, made } = setup();
    set.set('layer-1', points);
    set.set('layer-1', points);
    expect(made).toHaveLength(2);
    expect(made.map((layer) => layer.freed)).toEqual([1, 0]);
    expect([...inside]).toEqual([made[1]?.object]);
    expect(set.size).toBe(1);
  });

  it('takes a layer away, frees it once, and says whether there was one', () => {
    const { set, inside, made } = setup();
    set.set('layer-1', points);
    expect(set.remove('layer-1')).toBe(true);
    expect(set.remove('layer-1')).toBe(false);
    expect(made[0]?.freed).toBe(1);
    expect(inside.size).toBe(0);
    expect(set.has('layer-1')).toBe(false);
    expect(set.remove('never')).toBe(false);
  });

  it('has no layer for buffers of a kind that is not drawn, and loses the one that was there', () => {
    const { set, inside, made } = setup(['points']);
    expect(set.set('layer-1', mesh)).toBe('unsupported');
    expect(set.size).toBe(0);
    expect(made).toHaveLength(0);
    set.set('layer-2', points);
    expect(set.set('layer-2', mesh)).toBe('unsupported');
    expect(set.has('layer-2')).toBe(false);
    expect(made[0]?.freed).toBe(1);
    expect(inside.size).toBe(0);
  });

  it('builds a layer a part at a time while it says that there is more, and stops asking once it is done', () => {
    const container = { add: () => undefined, remove: () => undefined };
    const calls: string[] = [];
    const left = { a: 2, b: 1 };
    const set = new LayerSet(container, (buffers) => {
      if (buffers.kind === 'mesh') {
        return { object: new Group(), dispose: () => undefined };
      }
      return {
        object: new Group(),
        dispose: () => undefined,
        step: () => {
          const name = buffers.kind === 'points' && buffers.positions.length === 3 ? 'a' : 'b';
          calls.push(name);
          left[name] -= 1;
          return left[name] > 0;
        },
      };
    });
    set.set('a', points);
    set.set('b', { kind: 'points', positions: new Float32Array(6) });
    // A layer that is made whole has no `step` and costs nothing.
    set.set('whole', mesh);
    expect(set.step()).toBe(true);
    expect(calls).toEqual(['a', 'b']);
    expect(set.step()).toBe(false);
    expect(calls).toEqual(['a', 'b', 'a']);
    // Nothing is left, so nothing is asked.
    expect(set.step()).toBe(false);
    expect(calls).toEqual(['a', 'b', 'a']);
  });

  it('stops building a layer that is removed or replaced', () => {
    const container = { add: () => undefined, remove: () => undefined };
    let steps = 0;
    const set = new LayerSet(container, () => ({
      object: new Group(),
      dispose: () => undefined,
      step: () => {
        steps += 1;
        return true;
      },
    }));
    set.set('a', points);
    expect(set.step()).toBe(true);
    set.remove('a');
    expect(set.step()).toBe(false);
    expect(steps).toBe(1);
    set.set('b', points);
    set.set('b', points);
    expect(set.step()).toBe(true);
    expect(steps).toBe(2);
  });

  it('keeps the layers apart by id and in the order they were put, and clears them all', () => {
    const { set, inside, made } = setup();
    set.set('b', points);
    set.set('a', points);
    set.set('c', points);
    expect(set.ids()).toEqual(['b', 'a', 'c']);
    set.remove('a');
    expect(set.ids()).toEqual(['b', 'c']);
    set.clear();
    expect(set.size).toBe(0);
    expect(inside.size).toBe(0);
    expect(made.map((layer) => layer.freed)).toEqual([1, 1, 1]);
    // Clearing nothing is fine, and frees nothing twice.
    set.clear();
    expect(made.map((layer) => layer.freed)).toEqual([1, 1, 1]);
  });
});
