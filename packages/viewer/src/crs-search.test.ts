import type { CrsInfo } from '@karmania/engine';
import { describe, expect, it, vi } from 'vitest';
import { CrsSearch, MAX_MATCHES } from './crs-search.js';

const info = (code: number): CrsInfo => ({
  code,
  name: `System ${String(code)}`,
  kind: 'projected',
  units: 'm',
});
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** An engine whose searches the test answers by hand, and counts. */
function control() {
  const asked: [string, number][] = [];
  const waiting: {
    resolve: (found: readonly CrsInfo[]) => void;
    reject: (error: Error) => void;
  }[] = [];
  const engine = {
    searchCrs: (query: string, limit: number): Promise<readonly CrsInfo[]> => {
      asked.push([query, limit]);
      return new Promise((resolve, reject) => {
        waiting.push({ resolve, reject });
      });
    },
  };
  return { engine, asked, waiting };
}

describe('the search of the coordinate systems', () => {
  it('asks for what the box holds, at most 20, and keeps the answer', async () => {
    const { engine, asked, waiting } = control();
    const changed = vi.fn();
    const search = new CrsSearch(changed);
    expect(search.results).toBeUndefined();
    search.search(engine, 'utm 40');
    expect(asked).toEqual([['utm 40', MAX_MATCHES]]);
    waiting[0]?.resolve([info(32640)]);
    await settle();
    expect(search.results).toEqual([info(32640)]);
    expect(search.failed).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('does not ask again for what it asked last, and asks for a change', async () => {
    const { engine, asked, waiting } = control();
    const search = new CrsSearch(vi.fn());
    search.search(engine, 'utm');
    search.search(engine, 'utm');
    waiting[0]?.resolve([]);
    await settle();
    search.search(engine, 'utm');
    expect(asked).toHaveLength(1);
    search.search(engine, 'utm 4');
    expect(asked).toHaveLength(2);
  });

  it('finds nothing for an empty box, without asking', () => {
    const { engine, asked } = control();
    const changed = vi.fn();
    const search = new CrsSearch(changed);
    search.search(engine, '   ');
    expect(asked).toEqual([]);
    expect(search.results).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an engine', () => {
    const changed = vi.fn();
    const search = new CrsSearch(changed);
    search.search(undefined, 'utm');
    expect(search.results).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
  });

  it('lets the latest asking win: an answer to an earlier one is dropped', async () => {
    const { engine, waiting } = control();
    const search = new CrsSearch(vi.fn());
    search.search(engine, 'utm');
    search.search(engine, 'utm 40');
    waiting[1]?.resolve([info(32640)]);
    await settle();
    waiting[0]?.resolve([info(1), info(2)]);
    await settle();
    expect(search.results).toEqual([info(32640)]);
  });

  it('says it failed, with nothing found, when the engine cannot search, and an earlier failure does not count', async () => {
    const { engine, waiting } = control();
    const search = new CrsSearch(vi.fn());
    search.search(engine, 'utm');
    search.search(engine, 'utm 40');
    waiting[0]?.reject(new Error('late'));
    await settle();
    expect(search.failed).toBe(false);
    waiting[1]?.reject(new Error('no'));
    await settle();
    expect(search.failed).toBe(true);
    expect(search.results).toEqual([]);
    // A search after it is not marked as failed.
    search.search(engine, 'utm 41');
    waiting[2]?.resolve([info(32641)]);
    await settle();
    expect(search.failed).toBe(false);
  });

  it('starts again on reset, and ignores what was being asked', async () => {
    const { engine, asked, waiting } = control();
    const search = new CrsSearch(vi.fn());
    search.search(engine, 'utm');
    search.reset();
    waiting[0]?.resolve([info(32640)]);
    await settle();
    expect(search.results).toBeUndefined();
    search.search(engine, 'utm');
    expect(asked).toHaveLength(2);
  });

  it('says how many it found, and that there may be more', async () => {
    const { engine, waiting } = control();
    const search = new CrsSearch(vi.fn());
    expect(search.help('utm')).toBe('');
    search.search(engine, 'utm');
    waiting[0]?.resolve([info(1)]);
    await settle();
    expect(search.help('utm')).toBe('1 match.');
    expect(search.help('')).toBe('');
    search.search(engine, 'utm 4');
    waiting[1]?.resolve([info(1), info(2), info(3)]);
    await settle();
    expect(search.help('utm 4')).toBe('3 matches.');
    search.search(engine, 'u');
    waiting[2]?.resolve(Array.from({ length: MAX_MATCHES }, (_, index) => info(index)));
    await settle();
    expect(search.help('u')).toBe('The first 20 matches; type more to narrow them.');
  });
});
