import type { CrsInfo } from '@karmania/engine';
import type { Frame } from '@karmania/engine/display';
import { describe, expect, it } from 'vitest';
import { unitsOf } from './map-units.js';

const epsg = (code: number): Frame => ({
  mapCrs: { kind: 'epsg', code },
  origin: [0, 0, 0],
  source: 'auto',
});
const local = (units: 'm' | 'ft' | 'us_ft'): Frame => ({
  mapCrs: { kind: 'local', units },
  origin: [0, 0, 0],
  source: 'auto',
});
const info = (units: CrsInfo['units']): CrsInfo => ({
  code: 1,
  name: 'x',
  kind: 'projected',
  units,
});

describe('the units of the map', () => {
  it('are not known when there is no map', () => {
    expect(unitsOf(null, undefined)).toBeUndefined();
    expect(unitsOf(null, info('m'))).toBeUndefined();
  });

  it('are the grid’s own for a local grid, whatever the definitions say', () => {
    expect(unitsOf(local('m'), undefined)).toBe('m');
    expect(unitsOf(local('ft'), null)).toBe('ft');
    expect(unitsOf(local('us_ft'), info('m'))).toBe('us_ft');
  });

  it('are pending for an EPSG code until the definitions have answered', () => {
    expect(unitsOf(epsg(32640), undefined)).toBe('pending');
  });

  it('are the definitions’ for an EPSG code', () => {
    expect(unitsOf(epsg(32640), info('m'))).toBe('m');
    expect(unitsOf(epsg(2263), info('us_ft'))).toBe('us_ft');
    expect(unitsOf(epsg(4326), info('degree'))).toBe('degree');
  });

  it('are other for a code that is not in the definitions', () => {
    expect(unitsOf(epsg(999_999), null)).toBe('other');
  });
});
