import { describe, expect, it } from 'vitest';
import { mapLabel } from './map-label.js';

const scene = (
  heading: number,
  layers: number,
  viewMode: '2d' | '3d' = '2d',
): Parameters<typeof mapLabel>[0] => ({
  viewMode,
  layers: Object.fromEntries(
    Array.from({ length: layers }, (_, index) => [`layer-${String(index + 1)}`, {}]),
  ) as never,
  camera2d: { heading },
  camera3d: { heading },
});

describe('the name of the map', () => {
  it('says the view, the layers and the way the map is turned', () => {
    expect(mapLabel(scene(30, 3))).toBe('Map, 2D view, 3 layers, turned 30° from north');
  });

  it('says north up for a map that is, to the whole degree', () => {
    expect(mapLabel(scene(0, 2))).toBe('Map, 2D view, 2 layers, north up');
    expect(mapLabel(scene(360, 2))).toBe('Map, 2D view, 2 layers, north up');
    expect(mapLabel(scene(0.4, 2))).toBe('Map, 2D view, 2 layers, north up');
  });

  it('says one layer and no layers in words', () => {
    expect(mapLabel(scene(0, 1))).toBe('Map, 2D view, 1 layer, north up');
    expect(mapLabel(scene(0, 0))).toBe('Map, 2D view, no layers, north up');
  });

  it('says the angle clockwise from north as a whole number from 0 up to 360', () => {
    expect(mapLabel(scene(-90, 1))).toContain('turned 270° from north');
    expect(mapLabel(scene(450, 1))).toContain('turned 90° from north');
    expect(mapLabel(scene(359.6, 1))).toContain('north up');
    expect(mapLabel(scene(12.4, 1))).toContain('turned 12° from north');
  });

  it('says the 3D view', () => {
    expect(mapLabel(scene(0, 1, '3d'))).toBe('Map, 3D view, 1 layer, north up');
  });

  it('says how the map is turned in the view that is shown: the 3D camera’s heading in 3D, the 2D camera’s in 2D', () => {
    const both = (viewMode: '2d' | '3d') => ({
      ...scene(0, 1, viewMode),
      camera2d: { heading: 30 },
      camera3d: { heading: 200 },
    });
    expect(mapLabel(both('2d'))).toBe('Map, 2D view, 1 layer, turned 30° from north');
    expect(mapLabel(both('3d'))).toBe('Map, 3D view, 1 layer, turned 200° from north');
  });
});
