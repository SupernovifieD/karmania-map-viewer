import type { Finding } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import { describeLocation, describeOccurrences, SEVERITY_NAMES } from './findings-text.js';

const finding = (count: number, examples: Finding['examples']): Finding => ({
  code: 'csv.number.invalid',
  severity: 'warning',
  message: 'A value is not a number.',
  count,
  examples,
});

describe('where something was', () => {
  it('counts lines as a text editor does, and rows, elements and vertices from 1 as a person counts', () => {
    expect(describeLocation({ line: 1203 })).toBe('line 1,203');
    expect(describeLocation({ row: 0 })).toBe('row 1');
    expect(describeLocation({ element: 4 })).toBe('element 5');
    expect(describeLocation({ vertex: 9 })).toBe('vertex 10');
  });

  it('names a column and a cell', () => {
    expect(describeLocation({ column: 'Au_ppm' })).toBe('column "Au_ppm"');
    expect(describeLocation({ cell: [2, 5, 0] })).toBe('cell (2, 5, 0)');
  });

  it('puts several parts of one place together, and says nothing of no place', () => {
    expect(describeLocation({ line: 3, column: 'Au' })).toBe('line 3 column "Au"');
    expect(describeLocation({})).toBe('');
  });
});

describe('how often a finding happened', () => {
  it('says nothing of one that happened once, whose message has its place', () => {
    expect(describeOccurrences(finding(1, [{ line: 3 }]))).toBeUndefined();
  });

  it('counts the times and names the first places, then counts the rest', () => {
    const many = finding(12, [{ line: 3 }, { line: 8 }, { line: 15 }, { line: 20 }]);
    expect(describeOccurrences(many)).toBe('Seen 12 times: line 3, line 8, line 15 and 9 more.');
  });

  it('names all the places when there are no more than that', () => {
    expect(describeOccurrences(finding(2, [{ line: 3 }, { line: 8 }]))).toBe(
      'Seen 2 times: line 3 and line 8.',
    );
    expect(describeOccurrences(finding(3, [{ line: 3 }, { line: 8 }, { line: 9 }]))).toBe(
      'Seen 3 times: line 3, line 8 and line 9.',
    );
  });

  it('counts the times when there are no places, with the thousands grouped', () => {
    expect(describeOccurrences(finding(1_204_000, []))).toBe('Seen 1,204,000 times.');
  });
});

describe('the names of the severities', () => {
  it('are plain words', () => {
    expect(SEVERITY_NAMES).toEqual({ error: 'Error', warning: 'Warning', info: 'Note' });
  });
});
