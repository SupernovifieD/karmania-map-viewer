import type { Finding, Summary } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import { describeWarnings, selectionAfterRemoving, warningCount } from './datasets.js';

const finding = (severity: Finding['severity']): Finding => ({
  code: 'x.y',
  severity,
  message: 'm',
  count: 1,
  examples: [],
});

const dataset = (id: number, findings: Finding[] = []): Summary => ({
  id,
  name: `d${String(id)}`,
  kind: 'points',
  elementCount: 1,
  hasZ: false,
  columns: [],
  findings,
});

describe('the warnings of a dataset', () => {
  it('are counted as warnings only, not notes', () => {
    expect(warningCount(dataset(1))).toBe(0);
    expect(
      warningCount(dataset(1, [finding('warning'), finding('info'), finding('warning')])),
    ).toBe(2);
    expect(warningCount(dataset(1, [finding('info')]))).toBe(0);
  });

  it('are said in words, in the singular for one', () => {
    expect(describeWarnings(1)).toBe('1 warning');
    expect(describeWarnings(3)).toBe('3 warnings');
  });
});

describe('what is selected once a dataset is removed', () => {
  const three = [dataset(1), dataset(2), dataset(3)];

  it('stays, when it was another dataset that was removed', () => {
    expect(selectionAfterRemoving(three, 2, 3)).toBe(3);
    expect(selectionAfterRemoving(three, 1, undefined)).toBeUndefined();
  });

  it('is the dataset after the one that was selected, or before it if that was the last', () => {
    expect(selectionAfterRemoving(three, 2, 2)).toBe(3);
    expect(selectionAfterRemoving(three, 1, 1)).toBe(2);
    expect(selectionAfterRemoving(three, 3, 3)).toBe(2);
  });

  it('is nothing when the only dataset is removed', () => {
    expect(selectionAfterRemoving([dataset(7)], 7, 7)).toBeUndefined();
  });
});
