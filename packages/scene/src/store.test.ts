import { describe, expect, it } from 'vitest';
import type { Command } from './commands.js';
import { emptyScene } from './empty.js';
import { createSceneStore } from './store.js';
import { sampleScene } from './test-support/documents.js';
import type { SceneDocument } from './types.js';

const show = (visible: boolean): Command => ({ type: 'setVisible', layerId: 'layer-2', visible });
const mode = (m: '2d' | '3d'): Command => ({ type: 'setViewMode', mode: m });

describe('a scene store', () => {
  it('starts with the empty scene, or with the document it is given, itself and not a copy', () => {
    expect(createSceneStore().getState()).toEqual(emptyScene());
    const doc = sampleScene();
    expect(createSceneStore(doc).getState()).toBe(doc);
  });

  it('gives the same document again and again until a command changes it', () => {
    const store = createSceneStore(sampleScene());
    const first = store.getState();
    expect(store.getState()).toBe(first);
    expect(store.dispatch(show(false))).toBe(first);
    expect(store.getState()).toBe(first);
    const after = store.dispatch(show(true));
    expect(after).not.toBe(first);
    expect(store.getState()).toBe(after);
  });

  it('tells the listeners with the new document and the one before, once, in the order they were added', () => {
    const store = createSceneStore(sampleScene());
    const heard: string[] = [];
    store.subscribe((state, previous) =>
      heard.push(
        `a ${String(previous.layers['layer-2']?.visible)}>${String(state.layers['layer-2']?.visible)}`,
      ),
    );
    store.subscribe(() => heard.push('b'));
    const before = store.getState();
    store.dispatch(show(true));
    expect(heard).toEqual(['a false>true', 'b']);
    const calls: [SceneDocument, SceneDocument][] = [];
    store.subscribe((s, p) => calls.push([s, p]));
    const now = store.getState();
    const next = store.dispatch(show(false));
    expect(calls).toEqual([[next, now]]);
    expect(before).not.toBe(now);
  });

  it('tells no one when a command changes nothing', () => {
    const store = createSceneStore(sampleScene());
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.dispatch(show(false));
    store.dispatch({ type: 'setVisible', layerId: 'layer-9', visible: true });
    store.dispatch(mode('3d'));
    expect(calls).toBe(0);
    store.dispatch(mode('2d'));
    expect(calls).toBe(1);
  });

  it('stops telling a listener that has been taken away, and taking it away twice is harmless', () => {
    const store = createSceneStore(sampleScene());
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    store.dispatch(show(true));
    off();
    off();
    store.dispatch(show(false));
    expect(calls).toBe(1);
  });

  it('calls a listener that was added twice once, and one that was added again after being taken away', () => {
    const store = createSceneStore(sampleScene());
    let calls = 0;
    const listener = (): void => {
      calls += 1;
    };
    store.subscribe(listener);
    store.subscribe(listener);
    store.dispatch(show(true));
    expect(calls).toBe(1);
  });

  it('does not call a listener that an earlier one took away in the same round, nor one that was added in it', () => {
    const store = createSceneStore(sampleScene());
    const heard: string[] = [];
    let offSecond = (): void => undefined;
    store.subscribe(() => {
      heard.push('first');
      offSecond();
      store.subscribe(() => heard.push('added'));
    });
    offSecond = store.subscribe(() => heard.push('second'));
    store.dispatch(show(true));
    expect(heard).toEqual(['first']);
    heard.length = 0;
    store.dispatch(show(false));
    expect(heard).toEqual(['first', 'added']);
  });

  it('tells every listener of the changes in the order they were made, when a listener makes one', () => {
    const store = createSceneStore(sampleScene());
    const heard: string[] = [];
    store.subscribe((state, previous) => {
      heard.push(`one ${previous.viewMode}>${state.viewMode}`);
      if (state.viewMode === '2d') {
        store.dispatch(show(true));
      }
    });
    store.subscribe((state, previous) =>
      heard.push(
        `two ${String(previous.layers['layer-2']?.visible)}>${String(state.layers['layer-2']?.visible)} ${state.viewMode}`,
      ),
    );
    store.dispatch(mode('2d'));
    // The change from the listener is applied at once, and told after the one that is being told.
    expect(store.getState().layers['layer-2']?.visible).toBe(true);
    expect(heard).toEqual(['one 3d>2d', 'two false>false 2d', 'one 2d>2d', 'two false>true 2d']);
  });

  it('tells the changes that a listener makes one after the other in the order they were made, to every listener', () => {
    const store = createSceneStore(sampleScene());
    const heard: string[] = [];
    store.subscribe((state) => {
      if (state.viewMode === '2d' && state.verticalExaggeration === 5) {
        store.dispatch({ type: 'setVerticalExaggeration', factor: 2 });
        store.dispatch({ type: 'setVerticalExaggeration', factor: 3 });
      }
    });
    store.subscribe((state, previous) =>
      heard.push(`${String(previous.verticalExaggeration)}>${String(state.verticalExaggeration)}`),
    );
    store.dispatch(mode('2d'));
    expect(heard).toEqual(['5>5', '5>2', '2>3']);
    expect(store.getState().verticalExaggeration).toBe(3);
  });

  it('calls every listener even when one throws, makes the change, and then throws what the first threw', () => {
    const store = createSceneStore(sampleScene());
    const heard: string[] = [];
    store.subscribe(() => {
      throw new Error('first listener');
    });
    store.subscribe(() => heard.push('second'));
    store.subscribe(() => {
      throw new Error('third listener');
    });
    expect(() => store.dispatch(show(true))).toThrow('first listener');
    expect(heard).toEqual(['second']);
    expect(store.getState().layers['layer-2']?.visible).toBe(true);
    // The store goes on working.
    expect(() => store.dispatch(show(false))).toThrow('first listener');
    expect(store.getState().layers['layer-2']?.visible).toBe(false);
  });

  it('throws what is not an error as an error', () => {
    const store = createSceneStore(sampleScene());
    store.subscribe(() => {
      // A listener of an untyped program can throw anything; the cast lets the test do it.
      throw 'plain text' as unknown as Error;
    });
    let thrown: unknown;
    try {
      store.dispatch(show(true));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('plain text');
  });

  it('is not changed, and tells no one, by a command of a kind that there is not', () => {
    const store = createSceneStore(sampleScene());
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    const doc = store.getState();
    expect(() => store.dispatch({ type: 'explode' } as unknown as Command)).toThrow(TypeError);
    expect([store.getState(), calls]).toEqual([doc, 0]);
  });

  it('can be one of many on a page: two stores know nothing of each other', () => {
    const one = createSceneStore(sampleScene());
    const two = createSceneStore(sampleScene());
    const heard: string[] = [];
    one.subscribe(() => heard.push('one'));
    two.subscribe(() => heard.push('two'));
    one.dispatch(mode('2d'));
    expect([one.getState().viewMode, two.getState().viewMode]).toEqual(['2d', '3d']);
    two.dispatch({ type: 'setVerticalExaggeration', factor: 10 });
    expect([one.getState().verticalExaggeration, two.getState().verticalExaggeration]).toEqual([
      5, 10,
    ]);
    expect(heard).toEqual(['one', 'two']);
    expect(createSceneStore().getState()).toEqual(emptyScene());
  });
});
