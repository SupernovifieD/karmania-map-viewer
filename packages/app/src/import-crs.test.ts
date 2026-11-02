import type { CrsInfo, DetectedCrs } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import {
  crsBlocker,
  crsDraftFor,
  crsOf,
  describeCrs,
  describeInfo,
  describeKind,
  describeNamed,
  describeSource,
  epsgAfterTyping,
  epsgError,
  parseEpsg,
  summarizeCrs,
} from './import-crs.js';

const fromPrj: DetectedCrs = { crs: { kind: 'epsg', code: 32640 }, source: 'prj_file' };
const guessed: DetectedCrs = { crs: { kind: 'epsg', code: 4326 }, source: 'geojson_default' };

describe('the coordinate system a file starts with', () => {
  it('is the one that was found, and nothing when none was', () => {
    expect(crsDraftFor(fromPrj)).toEqual({ mode: 'detected', epsg: '', query: '', units: 'm' });
    expect(crsDraftFor(undefined)).toEqual({ mode: undefined, epsg: '', query: '', units: 'm' });
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

  it('is complained about in words only when digits were typed that are not a code', () => {
    const wrong = 'An EPSG code is 1 to 999999, such as 32640.';
    expect(epsgError('')).toBeUndefined();
    expect(epsgError('  ')).toBeUndefined();
    expect(epsgError('32640')).toBeUndefined();
    expect(epsgError('0')).toBe(wrong);
    expect(epsgError('000')).toBe(wrong);
    expect(epsgError('1234567')).toBe(wrong);
    // Anything else is a name to search for, which is not wrong.
    for (const text of ['326x0', 'EPSG:32640', 'utm zone 40', '3264.5', 'WGS84', '-1']) {
      expect(epsgError(text), text).toBeUndefined();
    }
  });

  it('becomes the code in the draft as it is typed, but a name leaves the code as it was', () => {
    expect(epsgAfterTyping('32640', '')).toBe('32640');
    expect(epsgAfterTyping('  4326 ', '32640')).toBe('4326');
    // A number that is not a code is still kept, so that the box can say so.
    expect(epsgAfterTyping('0', '32640')).toBe('0');
    expect(epsgAfterTyping('1234567', '')).toBe('1234567');
    // A name is not a code: what was chosen stays chosen.
    expect(epsgAfterTyping('utm zone 40', '32640')).toBe('32640');
    expect(epsgAfterTyping('utm zone 40', '')).toBe('');
    // Nothing typed is no code.
    expect(epsgAfterTyping('', '32640')).toBe('');
    expect(epsgAfterTyping('   ', '32640')).toBe('');
  });
});

describe('the coordinate system the import is given', () => {
  const draft = { mode: 'detected' as const, epsg: '', query: '', units: 'm' as const };

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
  const base = { epsg: '', query: '', units: 'm' as const };

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
    expect(describeCrs({ kind: 'local', units: 'us_ft' })).toBe('a local grid, in US survey feet');
  });

  it('says where a found one came from', () => {
    expect(describeSource('prj_file', 'points.prj')).toBe('the .prj file points.prj');
    expect(describeSource('prj_file', undefined)).toBe('the .prj file beside the data');
    expect(describeSource('geojson_crs_member', undefined)).toBe("the file's own crs member");
    expect(describeSource('geojson_default', undefined)).toContain('assumed');
  });

  it('sums up what was chosen, and says when nothing was', () => {
    const base = { epsg: '', query: '', units: 'm' as const };
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

describe('writing what the definitions say of a code', () => {
  const utm: CrsInfo = {
    code: 32640,
    name: 'WGS 84 / UTM zone 40N',
    kind: 'projected',
    units: 'm',
    metresPerUnit: 1,
  };
  const wgs84: CrsInfo = { code: 4326, name: 'WGS 84', kind: 'geographic', units: 'degree' };

  it('says what a system is in words a person uses', () => {
    expect(describeKind(utm)).toBe('projected, in metres');
    expect(describeKind(wgs84)).toBe('longitude and latitude, in degrees');
    expect(describeKind({ ...utm, units: 'us_ft', metresPerUnit: 1200 / 3937 })).toBe(
      'projected, in US survey feet',
    );
    expect(describeKind({ ...utm, units: 'ft', metresPerUnit: 0.3048 })).toBe('projected, in feet');
    expect(describeKind({ code: 3993, name: 'EPSG:3993', kind: 'other', units: 'other' })).toBe(
      'another kind, in other units',
    );
  });

  it('gives a system by its name, and what it is', () => {
    expect(describeInfo(utm)).toBe('WGS 84 / UTM zone 40N (projected, in metres)');
    expect(describeInfo(wgs84)).toBe('WGS 84 (longitude and latitude, in degrees)');
  });

  it('gives a code with its name when it has one, and says so when it is not known', () => {
    const code = { kind: 'epsg', code: 32640 } as const;
    expect(describeNamed(code, utm)).toBe(
      'EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres)',
    );
    expect(describeNamed(code, null)).toBe(
      'EPSG 32640, which is not one of the coordinate systems Karmania knows',
    );
    // Not asked yet, or a local grid, which the definitions know nothing of.
    expect(describeNamed(code, undefined)).toBe('EPSG 32640');
    expect(describeNamed({ kind: 'local', units: 'm' }, utm)).toBe('a local grid, in metres');
  });

  it('puts the name into what the step says is chosen, and leaves the rest as it was', () => {
    const draft = { mode: 'detected' as const, epsg: '', query: '', units: 'm' as const };
    expect(summarizeCrs(draft, fromPrj, 'points.prj', utm)).toBe(
      'EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres), from the .prj file points.prj.',
    );
    expect(summarizeCrs({ ...draft, mode: 'epsg', epsg: '32640' }, undefined, undefined, utm)).toBe(
      'EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres), as you entered it.',
    );
    expect(
      summarizeCrs({ ...draft, mode: 'epsg', epsg: '99999' }, undefined, undefined, null),
    ).toBe(
      'EPSG 99999, which is not one of the coordinate systems Karmania knows, as you entered it.',
    );
    // With nothing known of the code the sentence is the one of phase 1.
    expect(summarizeCrs(draft, fromPrj, 'points.prj')).toBe(
      'EPSG 32640, from the .prj file points.prj.',
    );
    expect(summarizeCrs({ ...draft, mode: 'local', units: 'ft' }, undefined, undefined, utm)).toBe(
      'a local grid, in feet: the coordinates are not tied to a place on the Earth, only to each other.',
    );
  });
});
