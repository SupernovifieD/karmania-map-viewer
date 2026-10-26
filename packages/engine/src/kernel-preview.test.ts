import { describe, expect, it } from 'vitest';
import { checkedPreview } from './contract-check.js';
import { fixtureBytes, loadKernel } from './test-support/kernel.js';

const FIXTURES = [
  'points.csv',
  'lines.csv',
  'blocks.csv',
  'mixed.geojson',
  'grid.asc',
  'mesh.obj',
  'points.prj',
  'esri.prj',
];

describe('the kernel module in Node', () => {
  it('reports its version', () => {
    expect(loadKernel().version()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('preview() through the WebAssembly boundary', () => {
  const { preview } = loadKernel();

  for (const name of FIXTURES) {
    it(`gives ${name} the shape of Preview`, () => {
      const checked = checkedPreview(preview(name, fixtureBytes(name), []), name);
      expect(checked.fileName).toBe(name);
      expect(checked.format).toBeDefined();
    });
  }

  it('carries a delimited file across with its numbers, strings and nested lists intact', () => {
    const p = checkedPreview(preview('points.csv', fixtureBytes('points.csv'), []));
    expect(p.format).toBe('csv');
    expect(p.suggestedKind).toBe('points');
    expect(p.encoding).toBe('UTF-8');
    const table = p.table;
    expect(table?.delimiter).toBe('comma');
    expect(table?.header).toEqual(['Easting', 'Northing', 'RL', 'Hole', 'Au_ppm', 'Rock']);
    expect(table?.rows).toHaveLength(8);
    expect(table?.rows[0]).toEqual(['500010.5', '2765020.25', '120.4', 'DH001', '0.35', 'granite']);
    expect(table?.estimatedRows).toBe(8);
    expect(table?.columnTypes[0]).toBe('float');
    expect(table?.roles.map((r) => r.role)).toEqual([
      'x',
      'y',
      'z',
      'attribute',
      'attribute',
      'attribute',
    ]);
    expect(table?.roles[0]?.confidence).toBeGreaterThan(0.9);
    expect(table?.nodata.numbers.some((n) => n.value === -999 && n.count === 1)).toBe(true);
    expect(p.crs).toBeUndefined();
    expect('crs' in p).toBe(false);
  });

  it('gives GeoJSON its default coordinate system, with a nested object and no table', () => {
    const p = checkedPreview(preview('mixed.geojson', fixtureBytes('mixed.geojson'), []));
    expect(p.crs).toEqual({ crs: { kind: 'epsg', code: 4326 }, source: 'geojson_default' });
    expect('table' in p).toBe(false);
  });

  it('takes the coordinate system from a .prj sidecar', () => {
    const sidecars = [{ name: 'points.PRJ', bytes: fixtureBytes('points.prj') }];
    const p = checkedPreview(preview('points.csv', fixtureBytes('points.csv'), sidecars));
    expect(p.crs).toEqual({ crs: { kind: 'epsg', code: 32640 }, source: 'prj_file' });
    const none = checkedPreview(preview('points.csv', fixtureBytes('points.csv'), undefined));
    expect(none.crs).toBeUndefined();
  });

  it('returns findings, not exceptions, for a file it cannot read', () => {
    const p = checkedPreview(preview('data.shp', new Uint8Array([0, 0, 1]), []));
    expect(p.format).toBeUndefined();
    expect(p.findings[0]?.code).toBe('file.format.unrecognized');
    const empty = checkedPreview(preview('empty.csv', new Uint8Array(), []));
    expect(empty.findings[0]?.code).toBe('file.empty');
  });

  it('throws, with a clear message, only for misuse', () => {
    expect(() => preview('a.csv', new Uint8Array(), 'nope')).toThrow(/sidecars must be an array/);
    expect(() => preview('a.csv', new Uint8Array(), [{ name: 'a.prj' }])).toThrow(/bytes/);
    expect(() => preview('a.csv', new Uint8Array(), [{ bytes: new Uint8Array() }])).toThrow(/name/);
  });

  it('gives the same answer every time', () => {
    const bytes = fixtureBytes('points.csv');
    expect(preview('points.csv', bytes, [])).toEqual(preview('points.csv', bytes, []));
  });
});
