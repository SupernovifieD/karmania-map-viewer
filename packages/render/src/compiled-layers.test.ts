import { describe, expect, it } from 'vitest';
import { CompiledLayers } from './compiled-layers.js';

describe('CompiledLayers', () => {
  it('has a layer compiled once its compiling ends', () => {
    const layers = new CompiledLayers();
    const scene = {};
    layers.put('a', 'points');
    expect(layers.has('a')).toBe(false);
    const token = layers.start('a', scene);
    expect(token).toBeDefined();
    expect(layers.finish('a', token ?? {}, true)).toBe(true);
    expect(layers.has('a')).toBe(true);
  });

  it('does not start compiling a scene that is being compiled, and does for another', () => {
    const layers = new CompiledLayers();
    const first = {};
    layers.put('a', 'points');
    expect(layers.start('a', first)).toBeDefined();
    expect(layers.start('a', first)).toBeUndefined();
    expect(layers.start('a', {})).toBeDefined();
  });

  it('keeps the mark of a layer that is put in place of one of the same kind', () => {
    const layers = new CompiledLayers();
    layers.put('a', 'points');
    layers.add('a');
    layers.put('a', 'points');
    expect(layers.has('a')).toBe(true);
  });

  it('drops the mark of a layer that is put in place of one of another kind, or is removed', () => {
    const layers = new CompiledLayers();
    layers.put('a', 'points');
    layers.add('a');
    layers.put('a', 'lines');
    expect(layers.has('a')).toBe(false);
    layers.add('a');
    layers.remove('a');
    expect(layers.has('a')).toBe(false);
    // A layer that is put again after it was removed is a new one.
    layers.put('a', 'lines');
    expect(layers.has('a')).toBe(false);
  });

  it('says nothing for the end of a compiling that is not the last one started: the layer was replaced meanwhile', () => {
    const layers = new CompiledLayers();
    layers.put('a', 'points');
    const old = layers.start('a', {});
    // Replaced by a layer of the same kind while the old one was being compiled: the new one is compiled for itself.
    layers.put('a', 'points');
    const next = layers.start('a', {});
    expect(next).toBeDefined();
    expect(layers.finish('a', old ?? {}, false)).toBe(false);
    expect(layers.has('a')).toBe(false);
    // The end of the new one is not lost to the end of the old one that came before it.
    expect(layers.finish('a', next ?? {}, true)).toBe(true);
    expect(layers.has('a')).toBe(true);
  });

  it('does not mark a layer that is gone, or whose scene is not its scene any more, when a compiling ends', () => {
    const layers = new CompiledLayers();
    const scene = {};
    layers.put('a', 'points');
    expect(layers.finish('a', layers.start('a', scene) ?? {}, false)).toBe(false);
    expect(layers.has('a')).toBe(false);
    const token = layers.start('a', scene);
    layers.remove('a');
    expect(layers.finish('a', token ?? {}, true)).toBe(false);
    expect(layers.has('a')).toBe(false);
  });

  it('has nothing compiled after a reset, and ignores what was being compiled before it, even for the same scene again', () => {
    const layers = new CompiledLayers();
    const scene = {};
    layers.put('a', 'points');
    layers.add('a');
    layers.put('b', 'lines');
    const before = layers.start('b', scene);
    layers.reset();
    expect(layers.has('a')).toBe(false);
    expect(layers.finish('b', before ?? {}, true)).toBe(false);
    expect(layers.has('b')).toBe(false);
    // Compiled again for the new context, for the same scene: the end of the compiling from before the reset is not the end of this one.
    const after = layers.start('b', scene);
    expect(after).toBeDefined();
    expect(layers.finish('b', before ?? {}, true)).toBe(false);
    expect(layers.has('b')).toBe(false);
    expect(layers.finish('b', after ?? {}, true)).toBe(true);
    expect(layers.has('b')).toBe(true);
  });
});
