import { describe, expect, it } from 'vitest';
import { createPageCache, PAGE_ROWS } from './page-cache.js';
import type { FetchPage } from './page-cache.js';
import type { Page } from './types.js';

type Call = readonly [dataset: number, start: number, count: number];

/** A dataset of `rows` rows, read as the worker would read it, with the calls recorded. */
function fakeWorker(rows: number) {
  const calls: Call[] = [];
  const fetchPage: FetchPage = (dataset, start, count) => {
    calls.push([dataset, start, count]);
    const taken = Math.max(0, Math.min(count, rows - start));
    const row = Array.from({ length: taken }, (_, i) => start + i);
    return Promise.resolve({
      start,
      count: taken,
      columns: [
        { name: 'row #', values: Int32Array.from(row, (r) => r + 1), nulls: new Uint8Array(taken) },
        {
          name: 'value',
          values: Float64Array.from(row, (r) => r * 2),
          nulls: Uint8Array.from(row, (r) => (r % 10 === 0 ? 1 : 0)),
        },
        { name: 'flag', values: Uint8Array.from(row, (r) => r % 2), nulls: new Uint8Array(taken) },
        { name: 'label', values: row.map((r) => `row ${String(r)}`), nulls: new Uint8Array(taken) },
      ],
    });
  };
  return { calls, fetchPage };
}

/** The numbers of the rows in a page, as the first column gives them. */
function rowNumbers(page: Page): number[] {
  const values = page.columns[0]?.values;
  return values instanceof Int32Array ? Array.from(values) : [];
}

describe('a window of rows', () => {
  it('inside one page is cut out of that page, which is fetched whole', async () => {
    const { calls, fetchPage } = fakeWorker(1000);
    const page = await createPageCache(fetchPage).window(1, 10, 5);
    expect(calls).toEqual([[1, 0, PAGE_ROWS]]);
    expect([page.start, page.count]).toEqual([10, 5]);
    expect(rowNumbers(page)).toEqual([11, 12, 13, 14, 15]);
  });

  it('across pages is joined from them, in every kind of column', async () => {
    const { calls, fetchPage } = fakeWorker(1000);
    const page = await createPageCache(fetchPage).window(1, 254, 5);
    expect(calls).toEqual([
      [1, 0, PAGE_ROWS],
      [1, PAGE_ROWS, PAGE_ROWS],
    ]);
    expect(rowNumbers(page)).toEqual([255, 256, 257, 258, 259]);
    const [, value, flag, label] = page.columns;
    expect(value?.values).toEqual(new Float64Array([508, 510, 512, 514, 516]));
    expect(value?.nulls).toEqual(new Uint8Array([0, 0, 0, 0, 0]));
    expect(flag?.values).toEqual(new Uint8Array([0, 1, 0, 1, 0]));
    expect(label?.values).toEqual(['row 254', 'row 255', 'row 256', 'row 257', 'row 258']);
    expect(page.columns.map((c) => c.name)).toEqual(['row #', 'value', 'flag', 'label']);
  });

  it('keeps the nulls with their rows', async () => {
    const { fetchPage } = fakeWorker(1000);
    const page = await createPageCache(fetchPage).window(1, 258, 5);
    expect(page.columns[1]?.nulls).toEqual(new Uint8Array([0, 0, 1, 0, 0])); // row 260
  });

  it('can span many pages', async () => {
    const { calls, fetchPage } = fakeWorker(10_000);
    const page = await createPageCache(fetchPage).window(1, 100, 3000);
    // Rows 100 to 3099 are in pages 0 to 12.
    expect(calls).toHaveLength(13);
    expect(page.count).toBe(3000);
    expect(rowNumbers(page).at(0)).toBe(101);
    expect(rowNumbers(page).at(-1)).toBe(3100);
  });

  it('is cut short at the end of the data', async () => {
    const { fetchPage } = fakeWorker(600);
    const page = await createPageCache(fetchPage).window(1, 500, 200);
    expect([page.start, page.count]).toEqual([500, 100]);
    expect(rowNumbers(page).at(-1)).toBe(600);
    expect(page.columns.every((c) => c.nulls.length === 100)).toBe(true);
  });

  it('past the end has no rows but still has the columns, of the right types', async () => {
    const { fetchPage } = fakeWorker(300);
    const cache = createPageCache(fetchPage);
    for (const start of [300, 1000, 5000]) {
      const page = await cache.window(1, start, 10);
      expect([page.start, page.count]).toEqual([start, 0]);
      expect(page.columns.map((c) => c.name)).toEqual(['row #', 'value', 'flag', 'label']);
      expect(page.columns.map((c) => c.values.constructor)).toEqual([
        Int32Array,
        Float64Array,
        Uint8Array,
        Array,
      ]);
    }
  });

  it('of a dataset with no rows has no rows', async () => {
    const { fetchPage } = fakeWorker(0);
    const page = await createPageCache(fetchPage).window(1, 0, 10);
    expect([page.count, page.columns.length]).toEqual([0, 4]);
  });

  it('is new arrays each time, so changing one cannot change another', async () => {
    const { fetchPage } = fakeWorker(1000);
    const cache = createPageCache(fetchPage);
    const first = await cache.window(1, 0, 3);
    const values = first.columns[1]?.values;
    if (values instanceof Float64Array) {
      values.fill(-1);
    }
    (first.columns[3]?.values as string[]).fill('changed');
    const second = await cache.window(1, 0, 3);
    expect(second.columns[1]?.values).toEqual(new Float64Array([0, 2, 4]));
    expect(second.columns[3]?.values).toEqual(['row 0', 'row 1', 'row 2']);
  });
});

describe('what is kept', () => {
  it('is fetched once, however often it is asked for', async () => {
    const { calls, fetchPage } = fakeWorker(1000);
    const cache = createPageCache(fetchPage);
    await cache.window(1, 10, 20);
    await cache.window(1, 10, 20);
    await cache.window(1, 100, 50);
    expect(calls).toHaveLength(1);
  });

  it('is shared by windows that overlap, and by requests made at the same time', async () => {
    const { calls, fetchPage } = fakeWorker(2000);
    const cache = createPageCache(fetchPage);
    await Promise.all([cache.window(1, 0, 300), cache.window(1, 200, 400), cache.window(1, 0, 10)]);
    expect(calls.map(([, start]) => start).sort((a, b) => a - b)).toEqual([0, 256, 512]);
  });

  it('is kept for each dataset on its own', async () => {
    const { calls, fetchPage } = fakeWorker(1000);
    const cache = createPageCache(fetchPage);
    await cache.window(1, 0, 10);
    await cache.window(2, 0, 10);
    expect(calls).toEqual([
      [1, 0, PAGE_ROWS],
      [2, 0, PAGE_ROWS],
    ]);
  });

  it('is limited, and what is dropped is the page used longest ago', async () => {
    const { calls, fetchPage } = fakeWorker(10_000);
    const cache = createPageCache(fetchPage, 2);
    const at = (page: number) => cache.window(1, page * PAGE_ROWS, 1);
    await at(0);
    await at(1);
    await at(0); // page 1 is now the one used longest ago
    await at(2); // drops page 1
    expect(calls).toHaveLength(3);
    await at(0); // still kept
    expect(calls).toHaveLength(3);
    await at(1); // fetched again
    expect(calls.map(([, start]) => start / PAGE_ROWS)).toEqual([0, 1, 2, 1]);
  });

  it('does not include a page that could not be fetched, so asking again tries again', async () => {
    const { fetchPage: works } = fakeWorker(1000);
    let attempts = 0;
    const flaky: FetchPage = (dataset, start, count) => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error('the worker was busy'))
        : works(dataset, start, count);
    };
    const cache = createPageCache(flaky);
    await expect(cache.window(1, 0, 5)).rejects.toThrow('the worker was busy');
    expect((await cache.window(1, 0, 5)).count).toBe(5);
    expect(attempts).toBe(2);
  });

  it('can be forgotten for one dataset, or altogether', async () => {
    const { calls, fetchPage } = fakeWorker(1000);
    const cache = createPageCache(fetchPage);
    await cache.window(1, 0, 1);
    await cache.window(2, 0, 1);
    cache.forget(1);
    await cache.window(2, 0, 1);
    expect(calls).toHaveLength(2);
    await cache.window(1, 0, 1);
    expect(calls).toHaveLength(3);
    cache.clear();
    await cache.window(2, 0, 1);
    expect(calls).toHaveLength(4);
  });

  it('forgets nothing it has not got when a dataset whose number is a prefix is forgotten', async () => {
    const { calls, fetchPage } = fakeWorker(1000);
    const cache = createPageCache(fetchPage);
    await cache.window(12, 0, 1);
    cache.forget(1);
    await cache.window(12, 0, 1);
    expect(calls).toHaveLength(1);
  });
});

describe('a window that is not worth keeping', () => {
  it('of no rows is asked of the worker as it is', async () => {
    const { calls, fetchPage } = fakeWorker(1000);
    const page = await createPageCache(fetchPage).window(1, 5, 0);
    expect(calls).toEqual([[1, 5, 0]]);
    expect(page.count).toBe(0);
  });

  it('of very many rows is asked of the worker as it is, and not kept', async () => {
    const { calls, fetchPage } = fakeWorker(100_000);
    const cache = createPageCache(fetchPage);
    const page = await cache.window(1, 1000, 20_000);
    await cache.window(1, 1000, 20_000);
    expect(calls).toEqual([
      [1, 1000, 20_000],
      [1, 1000, 20_000],
    ]);
    expect(page.count).toBe(20_000);
  });
});

describe('asking for what cannot be', () => {
  it('is misuse that says what was wrong', async () => {
    const { calls, fetchPage } = fakeWorker(1000);
    const cache = createPageCache(fetchPage);
    await expect(cache.window(1, -1, 5)).rejects.toThrow(
      'The first row must be a whole number, 0 or more, but is -1.',
    );
    await expect(cache.window(1, 1.5, 5)).rejects.toThrow(/first row.*1\.5/);
    await expect(cache.window(1, 0, -5)).rejects.toThrow(/number of rows.*-5/);
    await expect(cache.window(1, 0, Number.NaN)).rejects.toBeInstanceOf(TypeError);
    await expect(cache.window(1, 2 ** 32, 5)).rejects.toThrow(/at most 4294967295/);
    expect(calls).toEqual([]);
  });
});
