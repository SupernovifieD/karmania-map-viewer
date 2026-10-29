import type { DetectedCrs } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import {
  crsBlocker,
  crsDraftFor,
  crsOf,
  describeCrs,
  describeSource,
  epsgError,
  parseEpsg,
  summarizeCrs,
} from './import-crs.js';

const fromPrj: DetectedCrs = { crs: { kind: 'epsg', code: 32640 }, source: 'prj_file' };
const guessed: DetectedCrs = { crs: { kind: 'epsg', code: 4326 }, source: 'geojson_default' };

describe('the coordinate system a file starts with', () => {
  it('is the one that was found, and nothing when none was', () => {
    expect(crsDraftFor(fromPrj)).toEqual({ mode: 'detected', epsg: '', units: 'm' });
    expect(crsDraftFor(undefined)).toEqual({ mode: undefined, epsg: '', units: 'm' });
  });
});

describe('an EPSG code as it is typed', () => {
  it('is a whole number from 1, of up to six digits', () => {
    expect(parseEpsg('32640')).toBe(32640);
    expect(parseEpsg(' 4326 ')).toBe(4326);
    expect(parseEpsg('1')).toBe(1);
    expect(parseEpsg('999999')).toBe(999999);
  });

  it('is not nothing, zero, or anything that is not a whole number of that size', () => {
    for (const text of [
      '',
      ' ',
      '0',
      '000',
      '-1',
      '1.5',
      '1,5',
      '1e3',
      '326x0',
      'EPSG:4326',
      '1234567',
      '+4326',
    ]) {
      expect(parseEpsg(text), text).toBeUndefined();
    }
  });

  it('is complained about in words only when something was typed that is not one', () => {
    expect(epsgError('')).toBeUndefined();
    expect(epsgError('  ')).toBeUndefined();
    expect(epsgError('32640')).toBeUndefined();
    expect(epsgError('326x0')).toBe('An EPSG code is a whole number, such as 32640.');
  });
});

describe('the coordinate system the import is given', () => {
  const draft = { mode: 'detected' as const, epsg: '', units: 'm' as const };

  it('is the one that was found, when that is what was chosen', () => {
    expect(crsOf(draft, fromPrj)).toEqual({ kind: 'epsg', code: 32640 });
    expect(crsOf(draft, undefined)).toBeNull();
  });

  it('is the code that was typed, if it is one', () => {
    expect(crsOf({ ...draft, mode: 'epsg', epsg: '28350' }, fromPrj)).toEqual({
      kind: 'epsg',
      code: 28350,
    });
    expect(crsOf({ ...draft, mode: 'epsg', epsg: 'x' }, fromPrj)).toBeNull();
  });

  it('is a local grid with its units, which a person chose', () => {
    expect(crsOf({ ...draft, mode: 'local', units: 'us_ft' }, undefined)).toEqual({
      kind: 'local',
      units: 'us_ft',
    });
  });

  it('is none until something has been chosen', () => {
    expect(crsOf({ ...draft, mode: undefined }, fromPrj)).toBeNull();
  });
});

describe('what keeps a person from going on', () => {
  const base = { epsg: '', units: 'm' as const };

  it('is not having chosen, and a code that is missing or not one', () => {
    expect(crsBlocker({ ...base, mode: undefined }, undefined)).toBe(
      'Choose a coordinate system: an EPSG code, or a local grid.',
    );
    expect(crsBlocker({ ...base, mode: 'epsg' }, undefined)).toBe(
      'Enter the EPSG code of the coordinate system.',
    );
    expect(crsBlocker({ ...base, mode: 'epsg', epsg: '3x' }, undefined)).toBe(
      'Enter the EPSG code of the coordinate system.',
    );
  });

  it('is nothing for what was found, a code, or a local grid', () => {
    expect(crsBlocker({ ...base, mode: 'detected' }, fromPrj)).toBeUndefined();
    expect(crsBlocker({ ...base, mode: 'epsg', epsg: '32640' }, undefined)).toBeUndefined();
    expect(crsBlocker({ ...base, mode: 'local' }, undefined)).toBeUndefined();
  });

  it('is the found system that is not there, which would be a choice of nothing', () => {
    expect(crsBlocker({ ...base, mode: 'detected' }, undefined)).toBe(
      'Choose a coordinate system: an EPSG code, or a local grid.',
    );
  });
});

describe('writing a coordinate system for people', () => {
  it('gives the code as it is, and a local grid with its units', () => {
    expect(describeCrs({ kind: 'epsg', code: 32640 })).toBe('EPSG 32640');
    expect(describeCrs({ kind: 'local', units: 'm' })).toBe('a local grid, in metres');
    expect(describeCrs({ kind: 'local', units: 'us_ft' })).toBe('a local grid, in us survey feet');
  });

  it('says where a found one came from', () => {
    expect(describeSource('prj_file', 'points.prj')).toBe('the .prj file points.prj');
    expect(describeSource('prj_file', undefined)).toBe('the .prj file beside the data');
    expect(describeSource('geojson_crs_member', undefined)).toBe("the file's own crs member");
    expect(describeSource('geojson_default', undefined)).toContain('assumed');
  });

  it('sums up what was chosen, and says when nothing was', () => {
    const base = { epsg: '', units: 'm' as const };
    expect(summarizeCrs({ ...base, mode: 'detected' }, fromPrj, 'points.prj')).toBe(
      'EPSG 32640, from the .prj file points.prj.',
    );
    expect(summarizeCrs({ ...base, mode: 'detected' }, guessed, undefined)).toContain(
      'EPSG 4326, from the GeoJSON default',
    );
    expect(summarizeCrs({ ...base, mode: 'epsg', epsg: '28350' }, undefined, undefined)).toBe(
      'EPSG 28350, as you entered it.',
    );
    expect(summarizeCrs({ ...base, mode: 'local', units: 'ft' }, undefined, undefined)).toContain(
      'a local grid, in feet',
    );
    expect(summarizeCrs({ ...base, mode: undefined }, undefined, undefined)).toBe(
      'No coordinate system is chosen yet.',
    );
  });
});
