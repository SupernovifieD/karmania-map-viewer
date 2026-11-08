import type { CrsInfo } from '@karmania/engine';
import type { Frame } from '@karmania/engine/display';
import { emptyScene } from '@karmania/scene';
import type { SceneDocument } from '@karmania/scene';
import { describe, expect, it } from 'vitest';
import { furnitureOf, sameFurniture } from './furniture.js';

const UTM: CrsInfo = { code: 32640, name: 'WGS 84 / UTM zone 40N', kind: 'projected', units: 'm' };
const DEGREES: CrsInfo = { code: 4326, name: 'WGS 84', kind: 'geographic', units: 'degree' };

function scene(overrides: Partial<SceneDocument> = {}): SceneDocument {
  const frame: Frame = { mapCrs: { kind: 'epsg', code: 32640 }, origin: [0, 0, 0], source: 'auto' };
  return {
    ...emptyScene(),
    frame,
    camera2d: { centre: [0, 0], unitsPerPixel: 1, heading: 30 },
    ...overrides,
  };
}

describe('the furniture of the scene', () => {
  it('has the heading of the camera and a scale bar in the units of the map', () => {
    const furniture = furnitureOf(scene(), UTM);
    expect(furniture.heading).toBe(30);
    expect(furniture.scale).toMatchObject({ kind: 'bar', label: '100 m', unit: 'm' });
  });

  it('has no scale bar until the units are known, with no map, in degrees and in 3D', () => {
    expect(furnitureOf(scene(), undefined).scale).toMatchObject({ kind: 'none', reason: 'no_map' });
    expect(furnitureOf(scene({ frame: null }), UTM).scale).toMatchObject({
      kind: 'none',
      reason: 'no_map',
    });
    expect(furnitureOf(scene(), DEGREES).scale).toMatchObject({
      kind: 'none',
      reason: 'geographic',
    });
    expect(furnitureOf(scene({ viewMode: '3d' }), UTM).scale).toMatchObject({
      kind: 'none',
      reason: 'three_d',
    });
  });

  it('has what the status chip says of the map’s coordinate system', () => {
    expect(furnitureOf(scene(), UTM).crs).toEqual({
      label: 'EPSG:32640',
      title: 'EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres)',
    });
    expect(furnitureOf(scene({ frame: null }), undefined).crs.label).toBe('No map CRS');
  });

  it('has the name of the map, which says the heading', () => {
    expect(furnitureOf(scene(), UTM).label).toBe('Map, 2D view, no layers, turned 30° from north');
    expect(furnitureOf(scene({ viewMode: '3d' }), UTM).label).toContain('3D view');
  });

  it('measures a local grid in its own units, whatever the definitions say', () => {
    const frame: Frame = {
      mapCrs: { kind: 'local', units: 'ft' },
      origin: [0, 0, 0],
      source: 'auto',
    };
    expect(furnitureOf(scene({ frame }), DEGREES).scale).toMatchObject({ kind: 'bar', unit: 'ft' });
  });
});

describe('whether two furnitures show the same', () => {
  const same = (a: SceneDocument, b: SceneDocument, info: CrsInfo | undefined = UTM): boolean =>
    sameFurniture(furnitureOf(a, info), furnitureOf(b, info));

  it('is true for a map that is only moved', () => {
    expect(
      same(scene(), scene({ camera2d: { centre: [500, 500], unitsPerPixel: 1, heading: 30 } })),
    ).toBe(true);
  });

  it('is false for another heading', () => {
    expect(
      same(scene(), scene({ camera2d: { centre: [0, 0], unitsPerPixel: 1, heading: 31 } })),
    ).toBe(false);
  });

  it('is false for another length, and for another width of the same length', () => {
    const at = (unitsPerPixel: number) =>
      scene({ camera2d: { centre: [0, 0], unitsPerPixel, heading: 30 } });
    // 100 m is 100 pixels at 1 and 125 at 0.8 (the room is 128 m).
    expect(same(at(1), at(0.8))).toBe(false);
    // 200 m: 100 pixels at 2 and 99.9 at 2.002, which is the same to the pixel; and 98 at 2.04.
    expect(same(at(2), at(2.002))).toBe(true);
    expect(same(at(2), at(2.04))).toBe(false);
    // 100 m and 1 km are the same width, and not the same bar.
    expect(same(at(1), at(10))).toBe(false);
  });

  it('is false when the name of the map changes, for the layers there are and for the view', () => {
    const layer = {
      id: 'layer-1',
      datasetId: 1,
      name: 'a',
      visible: true,
      style: { colour: { mode: 'single', value: '#000000' }, opacity: 1 },
    } as unknown as SceneDocument['layers'][string];
    expect(
      sameFurniture(
        furnitureOf(scene(), UTM),
        furnitureOf(scene({ layers: { 'layer-1': layer } }), UTM),
      ),
    ).toBe(false);
    expect(
      sameFurniture(furnitureOf(scene(), UTM), furnitureOf(scene({ viewMode: '3d' }), UTM)),
    ).toBe(false);
  });

  it('is false when what the chip says of the coordinate system changes: the name that arrives, and another system', () => {
    // The same system, whose name has come: the tooltip is different.
    expect(sameFurniture(furnitureOf(scene(), UTM), furnitureOf(scene(), undefined))).toBe(false);
    expect(sameFurniture(furnitureOf(scene(), UTM), furnitureOf(scene(), UTM))).toBe(true);
    // Another name for the same units: only the tooltip differs.
    expect(
      sameFurniture(
        furnitureOf(scene(), UTM),
        furnitureOf(scene(), { ...UTM, name: 'Another name' }),
      ),
    ).toBe(false);
    const other: Frame = {
      mapCrs: { kind: 'epsg', code: 32641 },
      origin: [0, 0, 0],
      source: 'user',
    };
    expect(
      sameFurniture(furnitureOf(scene(), UTM), furnitureOf(scene({ frame: other }), UTM)),
    ).toBe(false);
  });

  it('is false for a bar and no bar, and for two reasons for none', () => {
    expect(same(scene(), scene({ viewMode: '3d' }))).toBe(false);
    expect(same(scene(), scene(), undefined)).toBe(true);
    expect(sameFurniture(furnitureOf(scene(), DEGREES), furnitureOf(scene(), undefined))).toBe(
      false,
    );
    expect(sameFurniture(furnitureOf(scene(), DEGREES), furnitureOf(scene(), DEGREES))).toBe(true);
  });
});
