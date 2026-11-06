import { describe, expect, it } from 'vitest';
import { nextId, ordinalOf } from './ids.js';

describe('the ids of layers and groups', () => {
  it('start at 1, and go on from the highest there is, not from how many there are', () => {
    expect(nextId('layer', [])).toBe('layer-1');
    expect(nextId('layer', ['layer-1', 'layer-2'])).toBe('layer-3');
    expect(nextId('layer', ['layer-2', 'layer-7', 'layer-3'])).toBe('layer-8');
    expect(nextId('layer', ['layer-10', 'layer-9'])).toBe('layer-11');
  });

  it('look only at ids that are the prefix and a number, so a group is not a layer and a name of an embedder is not either', () => {
    expect(
      nextId('layer', ['group-5', 'mine', 'layer-x', 'layer-1a', 'my-layer-9', 'layer-']),
    ).toBe('layer-1');
    expect(nextId('group', ['layer-5', 'group-2'])).toBe('group-3');
  });

  it('give a number back that the highest layer gave up by being removed', () => {
    expect(nextId('layer', ['layer-1', 'layer-2'])).toBe('layer-3');
  });

  it('do not lose a digit when the number is beyond what a double holds, so a new id is never one that exists', () => {
    expect(nextId('layer', ['layer-9007199254740992'])).toBe('layer-9007199254740993');
    expect(nextId('layer', ['layer-9007199254740992', 'layer-9007199254740993'])).toBe(
      'layer-9007199254740994',
    );
    expect(nextId('layer', [`layer-${'9'.repeat(400)}`])).toBe(`layer-1${'0'.repeat(400)}`);
  });

  it('say which place in a palette of a given size an id has: the number less one, round again after the last', () => {
    expect([1, 2, 8, 9, 16, 17].map((n) => ordinalOf(`layer-${String(n)}`, 8))).toEqual([
      0, 1, 7, 0, 7, 0,
    ]);
    expect(ordinalOf('layer-9007199254740993', 8)).toBe(Number((9007199254740993n - 1n) % 8n));
    expect(ordinalOf(`layer-${'9'.repeat(400)}`, 8)).toBe(
      Number((BigInt('9'.repeat(400)) - 1n) % 8n),
    );
  });

  it('say place 0 for an id that has no number or is 0, never a place before the first', () => {
    for (const id of ['mine', '', 'layer-0', 'layer-']) {
      expect(ordinalOf(id, 8), id).toBe(0);
    }
  });
});
