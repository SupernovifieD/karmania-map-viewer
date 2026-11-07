import { describe, expect, it } from 'vitest';
import { CompiledLayers } from './compiled-layers.js';

describe('CompiledLayers', () => {
  it('has a layer compiled once its compiling ends for the scene it was started for', () => {
    const layers = new CompiledLayers();
    const scene = {};
    layers.put('a', 'points');
    expect(layers.has('a')).toBe(false);
    expect(layers.start('a', scene)).toBe(true);
    expect(layers.finish('a', scene, true)).toBe(true);
    expect(layers.has('a')).toBe(true);
  });

  it('does not start compiling a scene that is being compiled, and does for another', () => {
    const layers = new CompiledLayers();
    const first = {};
    layers.put('a', 'points');
    expect(layers.start('a', first)).toBe(true);
    expect(layers.start('a', first)).toBe(false);
    expect(layers.start('a', {})).toBe(true);
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
    const old = {};
    const next = {};
    layers.put('a', 'points');
    layers.start('a', old);
    // Replaced by a layer of the same kind while the old one was being compiled: the new one is compiled for itself.
    layers.put('a', 'points');
    expect(layers.start('a', next)).toBe(true);
    expect(layers.finish('a', old, false)).toBe(false);
    expect(layers.has('a')).toBe(false);
    // The end of the new one is not lost to the end of the old one that came before it.
    expect(layers.finish('a', next, true)).toBe(true);
    expect(layers.has('a')).toBe(true);
  });

  it('does not mark a layer that is gone, or replaced by another scene, when the compiling of its old scene ends', () => {
    const layers = new CompiledLayers();
    const scene = {};
    layers.put('a', 'points');
    layers.start('a', scene);
    expect(layers.finish('a', scene, false)).toBe(false);
    expect(layers.has('a')).toBe(false);
    layers.start('a', scene);
    layers.remove('a');
    expect(layers.finish('a', scene, true)).toBe(false);
    expect(layers.has('a')).toBe(false);
  });

  it('has nothing compiled after a reset, and ignores what was being compiled before it', () => {
    const layers = new CompiledLayers();
    const scene = {};
    layers.put('a', 'points');
    layers.add('a');
    layers.put('b', 'lines');
    layers.start('b', scene);
    layers.reset();
    expect(layers.has('a')).toBe(false);
    expect(layers.finish('b', scene, true)).toBe(false);
    expect(layers.has('b')).toBe(false);
    // Compiling starts again for the new context, and a layer put in place of one of the same kind does not bring the old mark back.
    expect(layers.start('a', scene)).toBe(true);
    layers.put('a', 'points');
    expect(layers.has('a')).toBe(false);
  });
});
