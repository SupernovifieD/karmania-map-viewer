import { describe, expect, it } from 'vitest';
import { nextId, numberOf } from './ids.js';

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

  it('say which number an id has, and 0 for one that has none', () => {
    expect(numberOf('layer-12')).toBe(12);
    expect(numberOf('group-1')).toBe(1);
    expect(numberOf('mine')).toBe(0);
    expect(numberOf('')).toBe(0);
  });
});
