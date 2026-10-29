import { describe, expect, it } from 'vitest';
import {
  CELL_PADDING,
  columnWidth,
  isCut,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  rowNumberWidth,
  textWidth,
} from './table-columns.js';

describe('how wide a column is', () => {
  it('is the words and the room round them, to a whole pixel', () => {
    expect(columnWidth(100)).toBe(100 + CELL_PADDING);
    expect(columnWidth(100.2)).toBe(101 + CELL_PADDING);
  });

  it('is never narrower than 72, however little is in it', () => {
    expect(columnWidth(0)).toBe(MIN_COLUMN_WIDTH);
    expect(columnWidth(MIN_COLUMN_WIDTH - CELL_PADDING)).toBe(MIN_COLUMN_WIDTH);
    expect(columnWidth(MIN_COLUMN_WIDTH - CELL_PADDING + 1)).toBe(MIN_COLUMN_WIDTH + 1);
  });

  it('is never wider than 320, however much is in it', () => {
    expect(columnWidth(MAX_COLUMN_WIDTH - CELL_PADDING)).toBe(MAX_COLUMN_WIDTH);
    expect(columnWidth(MAX_COLUMN_WIDTH)).toBe(MAX_COLUMN_WIDTH);
    expect(columnWidth(100_000)).toBe(MAX_COLUMN_WIDTH);
  });
});

describe('how wide the row numbers are', () => {
  it('has room for the digits of the last row, the room round them and the line at the right', () => {
    expect(rowNumberWidth(100_000, 8)).toBe(6 * 8 + CELL_PADDING + 1);
    expect(rowNumberWidth(9_999, 7.5)).toBe(30 + CELL_PADDING + 1);
  });

  it('has room for three digits at least, so that a short table does not have a sliver', () => {
    expect(rowNumberWidth(5, 8)).toBe(3 * 8 + CELL_PADDING + 1);
    expect(rowNumberWidth(999, 8)).toBe(rowNumberWidth(5, 8));
  });
});

describe('how wide some text is', () => {
  const measure = (text: string): number => text.length * 6;

  it('sets each digit at the one width, and measures what is left', () => {
    expect(textWidth('Feature 123', 8, measure)).toBe(3 * 8 + 'Feature '.length * 6);
    expect(textWidth('500000.5', 8, measure)).toBe(7 * 8 + 6);
  });

  it('measures nothing for text that is only digits', () => {
    let calls = 0;
    const counted = (text: string): number => {
      calls += 1;
      return text.length;
    };
    expect(textWidth('12345', 8, counted)).toBe(40);
    expect(calls).toBe(0);
    expect(textWidth('', 8, counted)).toBe(0);
  });
});

describe('whether text is cut', () => {
  it('is, when it is wider than the column less its padding', () => {
    expect(isCut(104, 120)).toBe(false);
    expect(isCut(104.1, 120)).toBe(true);
    expect(isCut(105, 120)).toBe(true);
    expect(isCut(0, 72)).toBe(false);
  });
});
