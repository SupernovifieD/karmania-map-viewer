/**
 * The EPSG exports of the built kernel in Node: what a code means, and the search by code or
 * name. The results are compared with `toStrictEqual`, so a field that is added, or one that is
 * `undefined` where it should be absent, fails here.
 */
import { describe, expect, it } from 'vitest';
import * as generated from '../wasm/karmania_wasm.js';
import { loadKernel } from './test-support/kernel.js';

/** The kernel returns `any`; what comes out of it is checked before it is used. */
function info(code: number): unknown {
  return generated.crsInfo(code) as unknown;
}

function search(query: string, limit: number): readonly { readonly code: number }[] {
  const found = generated.searchCrs(query, limit) as unknown;
  expect(Array.isArray(found)).toBe(true);
  return found as readonly { readonly code: number }[];
}

describe('crsInfo', () => {
  loadKernel();

  it('says what a geographic system is: degrees, and no metres', () => {
    expect(info(4326)).toStrictEqual({
      code: 4326,
      name: 'WGS 84',
      kind: 'geographic',
      units: 'degree',
    });
  });

  it('says what a projected system is, with the metres of its unit', () => {
    expect(info(32640)).toStrictEqual({
      code: 32640,
      name: 'WGS 84 / UTM zone 40N',
      kind: 'projected',
      units: 'm',
      metresPerUnit: 1,
    });
    expect(info(27700)).toStrictEqual({
      code: 27700,
      name: 'OSGB 1936 / British National Grid',
      kind: 'projected',
      units: 'm',
      metresPerUnit: 1,
    });
  });

  it('knows a US survey foot from a foot', () => {
    expect(info(2229)).toStrictEqual({
      code: 2229,
      name: 'NAD83 / California zone 5 (ftUS)',
      kind: 'projected',
      units: 'us_ft',
      metresPerUnit: 1200 / 3937,
    });
  });

  it('calls a geocentric system other, in metres, and one with no definition other with no unit', () => {
    expect(info(4978)).toStrictEqual({
      code: 4978,
      name: 'WGS 84',
      kind: 'other',
      units: 'm',
      metresPerUnit: 1,
    });
    expect(info(3993)).toStrictEqual({
      code: 3993,
      name: 'EPSG:3993',
      kind: 'other',
      units: 'other',
    });
  });

  it('is undefined for a code that is not in the definitions', () => {
    for (const code of [0, 1, 99_999, 65_536, 4_294_967_295]) {
      expect(info(code)).toBeUndefined();
    }
  });

  it('gives plain objects, which can be cloned to a worker', () => {
    const value = info(32640);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(structuredClone(value)).toStrictEqual(value);
  });
});

describe('searchCrs', () => {
  loadKernel();

  it('puts the system with that code first, with or without EPSG before it', () => {
    for (const query of ['4326', ' 4326 ', 'EPSG:4326', 'epsg:4326']) {
      expect(search(query, 5)[0]?.code).toBe(4326);
    }
  });

  it('gives the same objects as crsInfo', () => {
    for (const found of generated.searchCrs('zone 40', 6) as readonly { code: number }[]) {
      expect(found).toStrictEqual(info(found.code));
    }
  });

  it('puts names that start with the query before names that contain it, by code', () => {
    const codes = search('WGS 84 / UTM zone 40', 10).map((found) => found.code);
    expect(codes.slice(0, 2)).toEqual([32640, 32740]);
    expect(search('British National Grid', 10).map((found) => found.code)).toContain(27700);
  });

  it('keeps to the limit, and never gives more than 50', () => {
    expect(search('a', 5)).toHaveLength(5);
    expect(search('a', 1000)).toHaveLength(50);
    expect(search('a', 4_294_967_295)).toHaveLength(50);
    expect(search('a', 0)).toEqual([]);
  });

  it('finds nothing for an empty query or one that matches nothing', () => {
    for (const query of ['', '   ', 'no such system', '99999']) {
      expect(search(query, 10)).toEqual([]);
    }
  });

  it('gives the same list for the same query', () => {
    expect(generated.searchCrs('zone', 50)).toStrictEqual(generated.searchCrs('zone', 50));
  });
});
