import type { CrsInfo } from '@karmania/engine';
import type { Frame } from '@karmania/engine/display';
import { describe, expect, it } from 'vitest';
import { mapCrsText } from './map-crs-text.js';

const epsg = (code: number): Frame => ({
  mapCrs: { kind: 'epsg', code },
  origin: [0, 0, 0],
  source: 'auto',
});
const local = (units: 'm' | 'ft' | 'us_ft'): Frame => ({
  mapCrs: { kind: 'local', units },
  origin: [0, 0, 0],
  source: 'user',
});
const UTM: CrsInfo = { code: 32640, name: 'WGS 84 / UTM zone 40N', kind: 'projected', units: 'm' };

describe('what the status chip says of the map’s coordinate system', () => {
  it('has the code on the button, and the name and what it is in the tooltip', () => {
    expect(mapCrsText(epsg(32640), UTM)).toEqual({
      label: 'EPSG:32640',
      title: 'EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres)',
    });
  });

  it('has the code alone in the tooltip until the definitions have been asked', () => {
    expect(mapCrsText(epsg(32640), undefined)).toEqual({
      label: 'EPSG:32640',
      title: 'EPSG 32640',
    });
  });

  it('says so when the code is not one of the definitions’', () => {
    expect(mapCrsText(epsg(999_999), null)).toEqual({
      label: 'EPSG:999999',
      title: 'EPSG 999999, which is not one of the coordinate systems Karmania knows',
    });
  });

  it('says a local grid with its units, short on the button and in words in the tooltip', () => {
    expect(mapCrsText(local('m'), undefined)).toEqual({
      label: 'Local grid, m',
      title: 'A local grid, in metres',
    });
    expect(mapCrsText(local('ft'), null)).toEqual({
      label: 'Local grid, ft',
      title: 'A local grid, in feet',
    });
    expect(mapCrsText(local('us_ft'), UTM)).toEqual({
      label: 'Local grid, US ft',
      title: 'A local grid, in US survey feet',
    });
  });

  it('says that there is no system when there is no frame', () => {
    expect(mapCrsText(null, undefined)).toEqual({
      label: 'No map CRS',
      title: 'The map has no coordinate system yet.',
    });
  });

  it('names a geographic system by its degrees', () => {
    const wgs84: CrsInfo = { code: 4326, name: 'WGS 84', kind: 'geographic', units: 'degree' };
    expect(mapCrsText(epsg(4326), wgs84).title).toBe(
      'EPSG 4326, WGS 84 (longitude and latitude, in degrees)',
    );
  });
});
