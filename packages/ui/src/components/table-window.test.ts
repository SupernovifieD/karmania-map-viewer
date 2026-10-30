import { describe, expect, it } from 'vitest';
import {
  MAX_SCROLL_HEIGHT,
  maxScroll,
  maxTop,
  pageRows,
  scrollForTop,
  scrollHeightOf,
  scrollRatio,
  topToReveal,
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
    // An `expect` costs far more than the comparison it makes, and there are 20,000 pixels to try, so
    // the pixels that go wrong are collected and said once, at the end.
    const wrong: string[] = [];
    let before = topOf(dense, 0);
    for (let scrollTop = 1; scrollTop <= maxScroll(dense); scrollTop += 1) {
      const row = topOf(dense, scrollTop);
      if (row < before) {
        wrong.push(
          `at ${String(scrollTop)} went back, from row ${String(before)} to ${String(row)}`,
        );
      } else if (row - before > 1) {
        // 2.8 pixels is less than one row: no row is gone past unseen.
        wrong.push(`at ${String(scrollTop)} skipped, from row ${String(before)} to ${String(row)}`);
      }
      before = row;
    }
    expect(wrong.slice(0, 5)).toEqual([]);
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

describe('where the top of the table is', () => {
  it('is how far it is scrolled, when the rows are scrolled as they are', () => {
    expect(windowFor({ ...base, scrollTop: 1234 }).top).toBe(1234);
    expect(windowFor({ ...base, scrollTop: 1e9 }).top).toBe(28_000 - 280);
    expect(windowFor(base).top).toBe(0);
    expect(maxTop(base)).toBe(28_000 - 280);
  });

  it('is moved by what the keyboard has taken up, and no further than the rows go', () => {
    expect(windowFor({ ...base, scrollTop: 100, fine: 14 }).top).toBe(114);
    expect(windowFor({ ...base, scrollTop: 100, fine: -500 }).top).toBe(0);
    expect(windowFor({ ...base, scrollTop: 27_000, fine: 5000 }).top).toBe(28_000 - 280);
  });
});

describe('scrolling to have the top of the table where a row is', () => {
  const sizes = { rowCount: 1000, rowHeight: 28, viewportHeight: 280 };

  it('is the scroll bar position itself, when the rows are scrolled as they are', () => {
    expect(scrollForTop(sizes, 2800)).toEqual({ scrollTop: 2800, fine: 0 });
    expect(scrollForTop(sizes, -5)).toEqual({ scrollTop: 0, fine: 0 });
    expect(scrollForTop(sizes, 1e9)).toEqual({ scrollTop: 28_000 - 280, fine: 0 });
  });

  it('is the nearest pixel of the scroll bar, and the rest in `fine`, when they are not', () => {
    const many = { ...sizes, rowCount: 100_000_000, maxScrollHeight: 10_000_000 };
    const ratio = scrollRatio(many);
    // A pixel of scrolling is 280 pixels of rows: ten rows.
    expect(ratio).toBeGreaterThan(279);
    expect(ratio).toBeLessThan(281);
    for (const top of [0, 28, 1_234_567 * 28, 73_456_789 * 28, maxTop(many)]) {
      const { scrollTop, fine } = scrollForTop(many, top);
      expect(Number.isInteger(scrollTop)).toBe(true);
      expect(Math.abs(fine)).toBeLessThanOrEqual(ratio / 2 + 1e-6);
      expect(windowFor({ ...many, scrollTop, fine, overscan: 4 }).top).toBeCloseTo(top, 3);
    }
  });
});

describe('where the top of the table has to be for a row to be in view', () => {
  const sizes = { rowCount: 1000, rowHeight: 28, viewportHeight: 280 };

  it('is where it is, when the row is wholly in view', () => {
    expect(topToReveal(sizes, 2800, 100)).toBe(2800);
    expect(topToReveal(sizes, 2800, 109)).toBe(2800);
  });

  it('has a row that is above at the top, and a row that is below at the bottom', () => {
    expect(topToReveal(sizes, 2800, 50)).toBe(1400);
    expect(topToReveal(sizes, 2800, 110)).toBe(111 * 28 - 280);
  });

  it('shows a row that is only part in view, whole', () => {
    expect(topToReveal(sizes, 2800 + 14, 99)).toBe(99 * 28);
    expect(topToReveal(sizes, 2800 - 14, 109)).toBe(110 * 28 - 280);
  });

  it('stays within the rows', () => {
    expect(topToReveal(sizes, 0, 0)).toBe(0);
    expect(topToReveal(sizes, 27_000, 999)).toBe(28_000 - 280);
    expect(topToReveal({ ...sizes, rowCount: 3 }, 0, 2)).toBe(0);
  });

  it('shows any row of a hundred million, whole, whatever the scroll bar cannot stop at', () => {
    const many = { ...sizes, rowCount: 100_000_000 };
    let top = 0;
    for (const row of [
      0, 1, 9, 10, 255, 1_000_001, 49_999_999, 73_456_789, 99_999_990, 99_999_999,
    ]) {
      top = topToReveal(many, top, row);
      const { scrollTop, fine } = scrollForTop(many, top);
      const shown = windowFor({ ...many, scrollTop, fine, overscan: 4 });
      // The row is among those drawn, and the top of the table is within a pixel of what was asked.
      expect(shown.firstRow, `row ${String(row)}`).toBeLessThanOrEqual(row);
      expect(shown.endRow, `row ${String(row)}`).toBeGreaterThan(row);
      expect(Math.abs(shown.top - top)).toBeLessThan(0.001);
      // And it is wholly in the table, with its upper edge from the top of the table.
      const fromTop = row * 28 - shown.top;
      expect(fromTop).toBeGreaterThanOrEqual(-0.001);
      expect(fromTop + 28).toBeLessThanOrEqual(280 + 0.001);
      // Where the rows are drawn puts that row where it belongs, in the box that scrolls.
      const drawnAt = shown.layerTop + (row - shown.firstRow) * 28 - scrollTop;
      expect(Math.abs(drawnAt - fromTop)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('a page of rows', () => {
  it('is the rows that fit, and at least one', () => {
    expect(pageRows(280, 28)).toBe(10);
    expect(pageRows(279, 28)).toBe(9);
    expect(pageRows(10, 28)).toBe(1);
    expect(pageRows(0, 28)).toBe(1);
  });
});
