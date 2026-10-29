import type { Finding, Summary } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import {
  crsLabel,
  describeWarnings,
  extentRows,
  formatCoordinate,
  selectionAfterRemoving,
  warningCount,
} from './datasets.js';

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

describe('the coordinate system of a dataset', () => {
  it('is the code as given, or a local grid with its units', () => {
    expect(crsLabel({ kind: 'epsg', code: 32640 })).toBe('EPSG 32640');
    expect(crsLabel({ kind: 'local', units: 'm' })).toBe('Local grid, metres');
    expect(crsLabel({ kind: 'local', units: 'ft' })).toBe('Local grid, feet');
    expect(crsLabel({ kind: 'local', units: 'us_ft' })).toBe('Local grid, US survey feet');
    expect(crsLabel(undefined)).toBe('Not set');
  });
});

describe('a coordinate as shown', () => {
  it('has up to six decimals, with no zeros at the end', () => {
    expect(formatCoordinate(500010.5)).toBe('500010.5');
    expect(formatCoordinate(2765020.25)).toBe('2765020.25');
    expect(formatCoordinate(120)).toBe('120');
    expect(formatCoordinate(55.3)).toBe('55.3');
  });

  it('is cut at six decimals, for a negative coordinate with twelve', () => {
    expect(formatCoordinate(-123.456789012345)).toBe('-123.456789');
    expect(formatCoordinate(0.1 + 0.2)).toBe('0.3');
  });

  it('is never minus zero', () => {
    expect(formatCoordinate(-0)).toBe('0');
    expect(formatCoordinate(-0.0000001)).toBe('0');
  });
});

describe('the box round a dataset', () => {
  const box = {
    min: [500010.5, 2765020.25, 109.3] as const,
    max: [500185.5, 2765205.25, 120.4] as const,
  };

  it('has a row for X and Y, and one for Z when the dataset has heights', () => {
    const flat = extentRows({ ...dataset(1), bbox: box, hasZ: false });
    expect(flat.map((row) => row.axis)).toEqual(['X', 'Y']);
    const tall = extentRows({ ...dataset(1), bbox: box, hasZ: true });
    expect(tall.map((row) => [row.axis, row.text])).toEqual([
      ['X', '500010.5 to 500185.5'],
      ['Y', '2765020.25 to 2765205.25'],
      ['Z', '109.3 to 120.4'],
    ]);
  });

  it('keeps every digit for the title, when the text is cut', () => {
    const [x] = extentRows({
      ...dataset(1),
      bbox: { min: [-123.456789012345, 0, 0], max: [-100, 1, 1] },
    });
    expect(x?.text).toBe('-123.456789 to -100');
    expect(x?.full).toBe('-123.456789012345 to -100');
  });

  it('has no rows when there is no box', () => {
    expect(extentRows(dataset(1))).toEqual([]);
  });
});
