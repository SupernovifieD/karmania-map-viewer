import { describe, expect, it } from 'vitest';
import { createRegistry } from './registry.js';
import type { Summary } from './types.js';

const summary = (id: number, name = `dataset ${String(id)}`): Summary => ({
  id,
  name,
  kind: 'points',
  elementCount: 3,
  hasZ: false,
  columns: [],
  findings: [],
});

const ids = (list: readonly Summary[]): number[] => list.map((s) => s.id);

describe('the list of datasets', () => {
  it('keeps the datasets in the order they were added, and takes one out of the middle', () => {
    const registry = createRegistry();
    registry.add([summary(1), summary(2)]);
    registry.add([summary(3)]);
    expect(ids(registry.summaries())).toEqual([1, 2, 3]);
    registry.remove(2);
    expect(ids(registry.summaries())).toEqual([1, 3]);
  });

  it('never changes a list it has given out', () => {
    const registry = createRegistry();
    registry.add([summary(1)]);
    const before = registry.summaries();
    registry.add([summary(2)]);
    registry.remove(1);
    expect(ids(before)).toEqual([1]);
    expect(ids(registry.summaries())).toEqual([2]);
  });

  it('gives the very same list again while nothing has changed', () => {
    const registry = createRegistry();
    registry.add([summary(1)]);
    registry.remove(99);
    registry.add([]);
    const first = registry.summaries();
    expect(registry.summaries()).toBe(first);
  });
});

describe('listeners', () => {
  it('hear of each change with the list as it is then, and not of what changed nothing', () => {
    const registry = createRegistry();
    const heard: number[][] = [];
    registry.subscribe((list) => heard.push(ids(list)));
    registry.add([summary(1)]);
    registry.add([]);
    registry.remove(7);
    registry.add([summary(2)]);
    registry.remove(1);
    expect(heard).toEqual([[1], [1, 2], [2]]);
  });

  it('are not told anything when they subscribe', () => {
    const registry = createRegistry();
    registry.add([summary(1)]);
    let calls = 0;
    registry.subscribe(() => (calls += 1));
    expect(calls).toBe(0);
  });

  it('stop hearing when they unsubscribe, however often that is asked', () => {
    const registry = createRegistry();
    let calls = 0;
    const stop = registry.subscribe(() => (calls += 1));
    registry.add([summary(1)]);
    stop();
    stop();
    registry.add([summary(2)]);
    expect(calls).toBe(1);
  });

  it('can subscribe the same function twice, and end the two separately', () => {
    const registry = createRegistry();
    let calls = 0;
    const listener = () => (calls += 1);
    const stopFirst = registry.subscribe(listener);
    registry.subscribe(listener);
    registry.add([summary(1)]);
    expect(calls).toBe(2);
    stopFirst();
    registry.add([summary(2)]);
    expect(calls).toBe(3);
  });

  it('are not told after they have ended during the telling of the others', () => {
    const registry = createRegistry();
    const heard: string[] = [];
    const stops: (() => void)[] = [];
    stops.push(
      registry.subscribe(() => {
        heard.push('first');
        stops[1]?.();
      }),
    );
    stops.push(registry.subscribe(() => heard.push('second')));
    registry.add([summary(1)]);
    expect(heard).toEqual(['first']);
  });

  it('do not stop the others hearing when one of them throws', () => {
    const reported: unknown[] = [];
    const registry = createRegistry((error) => reported.push(error));
    const heard: string[] = [];
    const broken = new Error('a listener broke');
    registry.subscribe(() => {
      throw broken;
    });
    registry.subscribe(() => heard.push('second'));
    registry.add([summary(1)]);
    expect(heard).toEqual(['second']);
    expect(reported).toEqual([broken]);
    expect(ids(registry.summaries())).toEqual([1]);
  });

  it('may change the registry from inside a listener', () => {
    const registry = createRegistry();
    registry.subscribe((list) => {
      if (list.length === 1) {
        registry.add([summary(2)]);
      }
    });
    registry.add([summary(1)]);
    expect(ids(registry.summaries())).toEqual([1, 2]);
  });
});

describe('a change made while the listeners are being told of another', () => {
  it('reaches every listener last, so none is left holding an older list', () => {
    const registry = createRegistry();
    registry.subscribe((list) => {
      if (list.length === 1) {
        registry.add([summary(2)]);
      }
    });
    const heard: number[][] = [];
    registry.subscribe((list) => heard.push(ids(list)));
    registry.add([summary(1)]);
    expect(heard.at(-1)).toEqual([1, 2]);
    // Nothing is told twice, and nothing goes back to an older list.
    expect(heard).toEqual([[1, 2]]);
  });
});

describe('clearing', () => {
  it('empties the list and drops the listeners without telling them', () => {
    const registry = createRegistry();
    let calls = 0;
    registry.subscribe(() => (calls += 1));
    registry.add([summary(1)]);
    registry.clear();
    expect(registry.summaries()).toEqual([]);
    registry.add([summary(2)]);
    expect(calls).toBe(1);
  });
});
