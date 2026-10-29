import { describe, expect, it } from 'vitest';
import {
  MAX_SCROLL_HEIGHT,
  maxScroll,
  scrollHeightOf,
  scrollRatio,
  windowFor,
} from './table-window.js';

const base = { rowCount: 1000, rowHeight: 28, viewportHeight: 280, scrollTop: 0, overscan: 4 };

describe('the rows in view at the top of a table', () => {
  it('start at row 0, with no extra rows before it, and some after', () => {
    const w = windowFor(base);
    expect(w.firstRow).toBe(0);
    // 10 rows fit, one more may be part in view, and four are drawn beyond that.
    expect(w.endRow).toBe(15);
    expect(w.scrollHeight).toBe(28_000);
  });
});

describe('the rows in view part way down a table', () => {
  it('begin with the row at the top, less the extra rows', () => {
    const w = windowFor({ ...base, scrollTop: 28 * 100 + 10 });
    expect(w.firstRow).toBe(96);
    expect(w.endRow).toBe(115);
  });

  it('always draw every row that is in view', () => {
    for (let scrollTop = 0; scrollTop <= 27_720; scrollTop += 137) {
      const w = windowFor({ ...base, scrollTop });
      const first = Math.floor(scrollTop / 28);
      const last = Math.ceil((scrollTop + 280) / 28) - 1;
      expect(w.firstRow).toBeLessThanOrEqual(first);
      expect(w.endRow).toBeGreaterThan(Math.min(last, 999));
    }
  });

  it('draw about as many rows wherever the table is scrolled to', () => {
    for (const scrollTop of [0, 5000, 13_999, 27_720]) {
      const w = windowFor({ ...base, scrollTop });
      expect(w.endRow - w.firstRow).toBeLessThanOrEqual(19);
    }
  });
});

describe('the rows in view at the bottom of a table', () => {
  it('end with the last row, and never go past it', () => {
    const bottom = maxScroll(base);
    expect(bottom).toBe(28_000 - 280);
    const w = windowFor({ ...base, scrollTop: bottom });
    expect(w.endRow).toBe(1000);
    expect(w.firstRow).toBe(990 - 4);
    expect(windowFor({ ...base, scrollTop: bottom + 5000 })).toEqual(w);
  });

  it('is not scrolled below 0', () => {
    expect(windowFor({ ...base, scrollTop: -50 })).toEqual(windowFor(base));
  });
});

describe('a table with few rows', () => {
  it('has nothing to scroll, and draws all of them', () => {
    const few = { ...base, rowCount: 3 };
    expect(maxScroll(few)).toBe(0);
    const w = windowFor({ ...few, scrollTop: 100 });
    expect([w.firstRow, w.endRow]).toEqual([0, 3]);
  });

  it('draws nothing for no rows', () => {
    const w = windowFor({ ...base, rowCount: 0 });
    expect([w.firstRow, w.endRow, w.scrollHeight]).toEqual([0, 0, 0]);
  });
});

describe('rows that are scrolled as they are', () => {
  it('are placed where they would be if all of them were drawn, and are not scaled', () => {
    for (const scrollTop of [0, 1, 27.5, 1234, 20_000, 99_999]) {
      const w = windowFor({ ...base, scrollTop });
      expect(w.scaled).toBe(false);
      expect(w.layerTop).toBe(w.firstRow * 28);
    }
    expect(scrollRatio(base)).toBe(1);
    expect(scrollHeightOf(base)).toBe(28_000);
  });
});

describe('rows that are too many to scroll as they are', () => {
  // 100,000 rows are 2,800,000 pixels, in a box that is not made taller than a million.
  const many = { ...base, rowCount: 100_000, maxScrollHeight: 1_000_000 };
  const bottom = maxScroll(many);

  /** The row at the top of the table, found from where the layer is put and how far the box is scrolled. */
  const topOf = (input: typeof many, scrollTop: number): number => {
    const w = windowFor({ ...input, scrollTop });
    const real = Math.min(Math.max(0, scrollTop), maxScroll(input));
    return w.firstRow + Math.floor((real - w.layerTop) / 28);
  };

  it('are scrolled in a box that is as tall as is allowed, and say so', () => {
    const w = windowFor(many);
    expect(w.scaled).toBe(true);
    expect(w.scrollHeight).toBe(1_000_000);
    expect(bottom).toBe(1_000_000 - 280);
    expect(scrollRatio(many)).toBeGreaterThan(2.7);
    expect(scrollRatio(many)).toBeLessThan(2.9);
  });

  it('begin with the first row at the top, as they do when there are fewer', () => {
    const w = windowFor(many);
    expect([w.firstRow, w.layerTop]).toEqual([0, 0]);
    expect(w.endRow).toBe(15);
  });

  it('end with the last row at the bottom of the table, and not past it', () => {
    const w = windowFor({ ...many, scrollTop: bottom });
    expect(w.endRow).toBe(100_000);
    // The last row's lower edge is the lower edge of the table: the box has been scrolled `bottom`
    // and the table is 280 high.
    const lower = w.layerTop + (w.endRow - w.firstRow) * 28;
    expect(Math.abs(lower - (bottom + 280))).toBeLessThanOrEqual(1);
    expect(windowFor({ ...many, scrollTop: bottom + 9999 })).toEqual(w);
    expect(windowFor({ ...many, scrollTop: -9 })).toEqual(windowFor(many));
  });

  it('draw rows that cover the whole table, wherever it is scrolled to', () => {
    for (let scrollTop = 0; scrollTop <= bottom; scrollTop += 7919) {
      const w = windowFor({ ...many, scrollTop });
      // The top of the first row is at or above the top of the table, and the foot of the last is at
      // or below the foot of it, in the table's own terms: pixels from the top of the table.
      const firstTop = w.layerTop - scrollTop;
      const lastBottom = firstTop + (w.endRow - w.firstRow) * 28;
      expect(firstTop, `top at ${String(scrollTop)}`).toBeLessThanOrEqual(0);
      expect(lastBottom, `foot at ${String(scrollTop)}`).toBeGreaterThanOrEqual(280);
    }
    const w = windowFor({ ...many, scrollTop: bottom });
    expect(w.layerTop - bottom + (w.endRow - w.firstRow) * 28).toBeGreaterThanOrEqual(280);
  });

  it('draw about as many rows wherever it is, however many there are', () => {
    for (const scrollTop of [0, 123_456, 500_000, bottom]) {
      const w = windowFor({ ...many, scrollTop });
      expect(w.endRow - w.firstRow).toBeLessThanOrEqual(19);
    }
  });

  it('never go back when scrolled on, and never skip a row that was in view', () => {
    // 2,000 rows in a box of 20,000 pixels: a pixel of scrolling is 2.8 pixels of rows, as in the
    // table above, and every pixel of it is tried.
    const dense = { ...base, rowCount: 2_000, maxScrollHeight: 20_000 };
    let before = topOf(dense, 0);
    for (let scrollTop = 1; scrollTop <= maxScroll(dense); scrollTop += 1) {
      const row = topOf(dense, scrollTop);
      expect(row).toBeGreaterThanOrEqual(before);
      // 2.8 pixels is less than one row: no row is gone past unseen.
      expect(row - before).toBeLessThanOrEqual(1);
      before = row;
    }
    expect(before).toBe(2_000 - 10);
  });

  it('can be scrolled to any row, to within one', () => {
    const ratio = scrollRatio(many);
    for (const row of [0, 1, 17, 255, 256, 9_999, 31_415, 50_000, 77_777, 99_000, 99_989]) {
      expect(
        Math.abs(topOf(many, (row * 28) / ratio) - row),
        `row ${String(row)}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('are twice what a browser allows at 2,000,000 rows, and still reach the end and every row', () => {
    const huge = { ...base, rowCount: 2_000_000, scrollTop: 0 };
    expect(huge.rowCount * 28).toBeGreaterThan(MAX_SCROLL_HEIGHT);
    const w = windowFor(huge);
    expect(w.scaled).toBe(true);
    expect(w.scrollHeight).toBe(MAX_SCROLL_HEIGHT);
    const end = windowFor({ ...huge, scrollTop: maxScroll(huge) });
    expect(end.endRow).toBe(2_000_000);
    // A pixel of scrolling is 7 pixels of rows: less than a row, so no row is out of reach.
    expect(scrollRatio(huge)).toBeLessThan(28);
  });
});
