import { describe, expect, it } from 'vitest';
import { maxScroll, windowFor } from './table-window.js';

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
