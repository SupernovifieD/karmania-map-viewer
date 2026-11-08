import type { Summary } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import { localUnitsOf, sameCrs } from './crs-choice.js';

const dataset = (crs: Summary['crs']): Summary => ({ crs }) as unknown as Summary;

describe('whether two coordinate systems are the same', () => {
  it('is true for the same code, and for the same units of a local grid', () => {
    expect(sameCrs({ kind: 'epsg', code: 32640 }, { kind: 'epsg', code: 32640 })).toBe(true);
    expect(sameCrs({ kind: 'local', units: 'ft' }, { kind: 'local', units: 'ft' })).toBe(true);
  });

  it('is false for another code, other units, and a code and a local grid', () => {
    expect(sameCrs({ kind: 'epsg', code: 32640 }, { kind: 'epsg', code: 32641 })).toBe(false);
    expect(sameCrs({ kind: 'local', units: 'ft' }, { kind: 'local', units: 'm' })).toBe(false);
    expect(sameCrs({ kind: 'epsg', code: 1 }, { kind: 'local', units: 'm' })).toBe(false);
    expect(sameCrs({ kind: 'local', units: 'm' }, { kind: 'epsg', code: 1 })).toBe(false);
  });

  it('is false for a system and none, and true for none and none', () => {
    expect(sameCrs({ kind: 'epsg', code: 1 }, undefined)).toBe(false);
    expect(sameCrs(undefined, { kind: 'local', units: 'm' })).toBe(false);
    expect(sameCrs(undefined, undefined)).toBe(true);
  });
});

describe('the local grids that are loaded', () => {
  it('are the units of each, once, in the order they are first met', () => {
    expect(
      localUnitsOf([
        dataset({ kind: 'local', units: 'ft' }),
        dataset({ kind: 'epsg', code: 32640 }),
        dataset({ kind: 'local', units: 'm' }),
        dataset({ kind: 'local', units: 'ft' }),
        dataset(undefined),
        dataset({ kind: 'local', units: 'm' }),
      ]),
    ).toEqual(['ft', 'm']);
  });

  it('are none when there are none', () => {
    expect(localUnitsOf([])).toEqual([]);
    expect(localUnitsOf([dataset({ kind: 'epsg', code: 1 }), dataset(undefined)])).toEqual([]);
  });
});
