/** The checks of what the kernel says about contour lines: they accept what it gives and refuse what it should not. */
import { describe, expect, it } from 'vitest';
import {
  ContractError,
  checkedContourParams,
  checkedDerivedFrom,
  checkedSummary,
} from './contract-check.js';
import { checkedContourDefaults, checkedContourStep } from './contours-check.js';

/** A copy of an object without one key. */
function omit(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

const params = { column: 'z', interval: 2.5, base: 0, indexEvery: 5 };
const finding = {
  code: 'contours.levels.none',
  severity: 'warning',
  message: 'No contour line was made, because the values never cross a level of these settings.',
  hint: 'Try a smaller interval, or another base.',
  count: 1,
  examples: [],
};
const lines = {
  id: 2,
  name: 'Contours of Cone (every 2.5)',
  kind: 'lines',
  elementCount: 3,
  vertexCount: 30,
  hasZ: true,
  columns: [
    { name: 'level', type: 'float', nullCount: 0 },
    { name: 'index', type: 'bool', nullCount: 0 },
  ],
  findings: [],
  derivedFrom: { id: 1, kind: 'contours', params },
};

describe('the settings of contours', () => {
  it('are an interval above 0, a base, a whole number of lines for the index lines, and a column that may be left out', () => {
    expect(checkedContourParams(params)).toEqual(params);
    const without = omit(params, 'column');
    expect(checkedContourParams(without)).toEqual(without);
    expect(checkedContourParams({ ...params, base: -3.5, interval: 1e-9 })).toBeTruthy();
  });

  it('are refused when they are not', () => {
    const bad: unknown[] = [
      null,
      [],
      {},
      { ...params, interval: 0 },
      { ...params, interval: -1 },
      { ...params, interval: Number.NaN },
      { ...params, interval: Infinity },
      { ...params, interval: '2' },
      { ...params, base: Number.NaN },
      { ...params, indexEvery: 0 },
      { ...params, indexEvery: 2.5 },
      { ...params, indexEvery: -5 },
      { ...params, column: 5 },
      { ...params, column: undefined },
      { ...params, level: 3 },
    ];
    for (const value of bad) {
      expect(() => checkedContourParams(value), JSON.stringify(value)).toThrow(ContractError);
    }
  });
});

describe('what a dataset was made from', () => {
  it('is the dataset, the kind and the settings, and a summary may have it', () => {
    expect(checkedDerivedFrom(lines.derivedFrom)).toEqual(lines.derivedFrom);
    expect(checkedSummary(lines)).toEqual(lines);
    const plain = omit(lines, 'derivedFrom');
    expect(checkedSummary(plain)).toEqual(plain);
  });

  it('is refused when the id is 0, the kind is not one, or a key is not known', () => {
    for (const bad of [
      { ...lines.derivedFrom, id: 0 },
      { ...lines.derivedFrom, kind: 'hillshade' },
      { ...lines.derivedFrom, params: { ...params, interval: 0 } },
      { ...lines.derivedFrom, extra: 1 },
      { id: 1, kind: 'contours' },
    ]) {
      expect(() => checkedDerivedFrom(bad), JSON.stringify(bad)).toThrow(ContractError);
      expect(() => checkedSummary({ ...lines, derivedFrom: bad })).toThrow(ContractError);
    }
  });
});

describe('a step of making contours', () => {
  it('is progress from 0 to 1, the end, or that the job is gone (the dataset was removed, or a newer job took its place)', () => {
    expect(checkedContourStep({ status: 'progress', fraction: 0.25 })).toEqual({
      status: 'progress',
      fraction: 0.25,
    });
    expect(checkedContourStep({ status: 'cancelled' })).toEqual({ status: 'cancelled' });
    expect(checkedContourStep({ status: 'superseded' })).toEqual({ status: 'superseded' });
    const loaded = { status: 'done', result: { status: 'loaded', summaries: [lines] } };
    expect(checkedContourStep(loaded)).toEqual(loaded);
  });

  it('may end in findings that are warnings: a dataset that cannot be contoured is not an error of the data', () => {
    const blocked = { status: 'done', result: { status: 'blocked', findings: [finding] } };
    expect(checkedContourStep(blocked)).toEqual(blocked);
  });

  it('is refused when it is not one of those, or the end is not lines made as contours', () => {
    const bad: unknown[] = [
      { status: 'progress' },
      { status: 'progress', fraction: 1.5 },
      { status: 'progress', fraction: -0.1 },
      { status: 'cancelled', fraction: 0 },
      { status: 'superseded', result: {} },
      { status: 'done' },
      { status: 'done', result: { status: 'loaded', summaries: [] } },
      { status: 'done', result: { status: 'loaded', summaries: [lines, lines] } },
      { status: 'done', result: { status: 'loaded', summaries: [{ ...lines, kind: 'points' }] } },
      {
        status: 'done',
        result: {
          status: 'loaded',
          summaries: [{ ...lines, derivedFrom: undefined }],
        },
      },
      { status: 'done', result: { status: 'blocked', findings: [] } },
      { status: 'done', result: { status: 'maybe' } },
      { status: 'finished' },
    ];
    for (const value of bad) {
      expect(() => checkedContourStep(value), JSON.stringify(value)).toThrow(ContractError);
    }
    // A summary that is not lines made as contours.
    const plain = omit(lines, 'derivedFrom');
    expect(() =>
      checkedContourStep({ status: 'done', result: { status: 'loaded', summaries: [plain] } }),
    ).toThrow(ContractError);
  });
});

describe('the settings a set of contours starts with', () => {
  it('are the settings, or the reason there are none', () => {
    expect(checkedContourDefaults({ status: 'defaults', params })).toEqual({
      status: 'defaults',
      params,
    });
    const none = { status: 'not_available', findings: [finding] };
    expect(checkedContourDefaults(none)).toEqual(none);
    for (const bad of [
      { status: 'defaults' },
      { status: 'defaults', params: { ...params, interval: 0 } },
      { status: 'not_available', findings: [] },
      { status: 'not_available' },
      { status: 'defaults', params, findings: [] },
      { status: 'unknown' },
    ]) {
      expect(() => checkedContourDefaults(bad), JSON.stringify(bad)).toThrow(ContractError);
    }
  });
});
