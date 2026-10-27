/**
 * Reading rows of a dataset through a small cache.
 *
 * A table asks for the rows in view and, a moment later, for rows that overlap them.
 * Rows are fetched in fixed pages of 256, and the most recently used pages are kept, so
 * scrolling a little back or forth costs nothing and a window never straddles pages that
 * are fetched twice. A window is assembled from the pages as new arrays, so what the
 * caller gets is theirs to keep or change.
 */
import type { Page, PageColumn, PageValues } from './types.js';

/** How many rows are fetched, and kept, at a time. */
export const PAGE_ROWS = 256;

/** How many pages are kept: 64 pages are 16,384 rows. */
const DEFAULT_CAPACITY = 64;

/** A window of more rows than this is fetched as it is asked for and not kept. */
const MAX_CACHED_ROWS = 16 * PAGE_ROWS;

/** The most rows a start can address: the kernel counts rows in 32 bits. */
const MAX_START = 0xffff_ffff;

/** Fetches rows from the worker. */
export type FetchPage = (dataset: number, start: number, count: number) => Promise<Page>;

/** Reads windows of rows through the cache. */
export interface PageCache {
  /**
   * Rows `start` to `start + count` of a dataset, fewer at the end of the data. A window
   * that starts past the end has no rows but still has the columns.
   */
  readonly window: (dataset: number, start: number, count: number) => Promise<Page>;
  /** Forgets the pages of one dataset. */
  readonly forget: (dataset: number) => void;
  /** Forgets everything. */
  readonly clear: () => void;
}

/** One page's share of a window: rows `from` to `to` of the page. */
interface Part {
  readonly page: Page;
  readonly from: number;
  readonly to: number;
}

function gather<A extends Float64Array | Int32Array | Uint8Array>(
  out: A,
  parts: readonly { readonly values: PageValues; readonly from: number; readonly to: number }[],
  isOfType: (values: PageValues) => values is A,
): A {
  let at = 0;
  for (const { values, from, to } of parts) {
    if (!isOfType(values)) {
      throw new Error('A column changed type between two pages of the same dataset.');
    }
    out.set(values.subarray(from, to), at);
    at += to - from;
  }
  return out;
}

/** One column of a window, joined from its share of each page. */
function joinColumn(index: number, parts: readonly Part[], total: number): PageColumn {
  const shares = parts.map(({ page, from, to }) => {
    const column = page.columns[index];
    if (column === undefined) {
      throw new Error('The pages of a dataset do not have the same columns.');
    }
    return { column, from, to };
  });
  const first = shares[0]?.column;
  if (first === undefined) {
    throw new Error('A window needs at least one page.');
  }
  const values = shares.map(({ column, from, to }) => ({ values: column.values, from, to }));
  const nulls = new Uint8Array(total);
  let at = 0;
  for (const { column, from, to } of shares) {
    nulls.set(column.nulls.subarray(from, to), at);
    at += to - from;
  }
  const kind = first.values;
  let joined: PageValues;
  if (kind instanceof Float64Array) {
    joined = gather(
      new Float64Array(total),
      values,
      (v): v is Float64Array => v instanceof Float64Array,
    );
  } else if (kind instanceof Int32Array) {
    joined = gather(new Int32Array(total), values, (v): v is Int32Array => v instanceof Int32Array);
  } else if (kind instanceof Uint8Array) {
    joined = gather(new Uint8Array(total), values, (v): v is Uint8Array => v instanceof Uint8Array);
  } else {
    joined = values.flatMap(({ values: v, from, to }) => {
      if (ArrayBuffer.isView(v)) {
        throw new Error('A column changed type between two pages of the same dataset.');
      }
      return v.slice(from, to);
    });
  }
  return { name: first.name, values: joined, nulls };
}

function checkWhole(what: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${what} must be a whole number, 0 or more, but is ${String(value)}.`);
  }
}

/**
 * Makes a cache that fetches pages with `fetchPage` and keeps at most `capacity` of them,
 * dropping the one used longest ago when it is full.
 */
export function createPageCache(fetchPage: FetchPage, capacity = DEFAULT_CAPACITY): PageCache {
  // Insertion order is recency order: a page that is used is taken out and put back last.
  const pages = new Map<string, Promise<Page>>();

  function page(dataset: number, index: number): Promise<Page> {
    const key = `${String(dataset)}:${String(index)}`;
    const kept = pages.get(key);
    if (kept !== undefined) {
      pages.delete(key);
      pages.set(key, kept);
      return kept;
    }
    const fetching = fetchPage(dataset, index * PAGE_ROWS, PAGE_ROWS);
    // A page that could not be fetched is not kept, so asking again tries again.
    fetching.catch(() => {
      if (pages.get(key) === fetching) {
        pages.delete(key);
      }
    });
    pages.set(key, fetching);
    for (const oldest of pages.keys()) {
      if (pages.size <= capacity) {
        break;
      }
      pages.delete(oldest);
    }
    return fetching;
  }

  return {
    window: async (dataset, start, count) => {
      checkWhole('The first row', start);
      checkWhole('The number of rows', count);
      if (start > MAX_START) {
        throw new TypeError(`The first row must be at most ${String(MAX_START)}.`);
      }
      if (count === 0 || count > MAX_CACHED_ROWS) {
        return fetchPage(dataset, start, count);
      }
      const first = Math.floor(start / PAGE_ROWS);
      const last = Math.floor((start + count - 1) / PAGE_ROWS);
      const fetched = await Promise.all(
        Array.from({ length: last - first + 1 }, (_, i) => page(dataset, first + i)),
      );
      const parts: Part[] = [];
      let total = 0;
      fetched.forEach((fetchedPage, i) => {
        const pageStart = (first + i) * PAGE_ROWS;
        const from = Math.max(start, pageStart) - pageStart;
        const to = Math.min(start + count - pageStart, fetchedPage.count);
        if (to > from) {
          parts.push({ page: fetchedPage, from, to });
          total += to - from;
        }
      });
      // Past the end there are no rows to take, but the page still says what the columns are.
      const shape =
        parts.length > 0 ? parts : [{ page: fetched[0] ?? emptyPage(), from: 0, to: 0 }];
      const columnCount = shape[0]?.page.columns.length ?? 0;
      return {
        start,
        count: total,
        columns: Array.from({ length: columnCount }, (_, index) => joinColumn(index, shape, total)),
      };
    },
    forget: (dataset) => {
      for (const key of [...pages.keys()]) {
        if (key.startsWith(`${String(dataset)}:`)) {
          pages.delete(key);
        }
      }
    },
    clear: () => {
      pages.clear();
    },
  };
}

function emptyPage(): Page {
  return { start: 0, count: 0, columns: [] };
}
