import { describe, expect, it } from 'vitest';
import { MAX_EXPORT_FOV, exportCamera2d, exportCamera3d } from './export-frame.js';
import type { Camera2d, Camera3d } from './types.js';

const CAMERA_2D: Camera2d = { centre: [500_100, 2_765_050], unitsPerPixel: 2, heading: 30 };
const CAMERA_3D: Camera3d = {
  target: [500_100, 2_765_050, 110],
  distance: 400,
  heading: 30,
  elevation: 40,
  fov: 45,
};
/** The map on screen: 1,160 by 648 CSS pixels. */
const SCREEN = { width: 1160, height: 648 };

/** The half extents (across, up) of what a 2D export shows, in map units. */
const shown2d = (camera: Camera2d, map: { width: number; height: number }, scale: number) => ({
  across: (camera.unitsPerPixel * map.width) / scale / 2,
  up: (camera.unitsPerPixel * map.height) / scale / 2,
});

/** The half extents (across, up) at the target of what a 3D export shows, in map units. */
const shown3d = (camera: Camera3d, map: { width: number; height: number }) => {
  const up = camera.distance * Math.tan((camera.fov * Math.PI) / 360);
  return { across: (up * map.width) / map.height, up };
};

describe('exportCamera2d', () => {
  it('is the camera as it is when the picture is the map on screen, at any dpi', () => {
    for (const scale of [1, 1.5625, 3.125]) {
      const map = { width: SCREEN.width * scale, height: SCREEN.height * scale };
      expect(exportCamera2d(CAMERA_2D, SCREEN, map, scale).unitsPerPixel).toBeCloseTo(2, 12);
    }
  });

  it('keeps the centre and the heading, and changes only the scale', () => {
    const out = exportCamera2d(CAMERA_2D, SCREEN, { width: 3508, height: 2480 }, 3.125);
    expect(out.centre).toEqual(CAMERA_2D.centre);
    expect(out.heading).toBe(30);
  });

  it('shows at least what the screen shows, whatever the shape of the picture, and exactly it in one of the two directions', () => {
    // The map on screen is 1,160 by 648 CSS pixels at 2 map units a pixel: 1,160 across and 648 up from the middle (half of 2,320 and 1,296).
    const wanted = shown2d(CAMERA_2D, SCREEN, 1);
    for (const [map, scale] of [
      [{ width: 3508, height: 2480 }, 3.125],
      [{ width: 2480, height: 3508 }, 3.125],
      [{ width: 500, height: 500 }, 1],
      [{ width: 4000, height: 300 }, 1.5625],
      [{ width: 1160, height: 648 }, 1],
    ] as const) {
      const out = shown2d(exportCamera2d(CAMERA_2D, SCREEN, map, scale), map, scale);
      expect(out.across).toBeGreaterThanOrEqual(wanted.across - 1e-9);
      expect(out.up).toBeGreaterThanOrEqual(wanted.up - 1e-9);
      // No more than it has to: one of the two is the screen's.
      expect(Math.min(out.across - wanted.across, out.up - wanted.up)).toBeCloseTo(0, 6);
    }
  });

  it('shows more of the map for a portrait picture than for a landscape one of the same width', () => {
    const landscape = exportCamera2d(CAMERA_2D, SCREEN, { width: 2480, height: 1754 }, 3.125);
    const portrait = exportCamera2d(CAMERA_2D, SCREEN, { width: 2480, height: 3508 }, 3.125);
    expect(portrait.unitsPerPixel).toBe(landscape.unitsPerPixel);
    const narrow = exportCamera2d(CAMERA_2D, SCREEN, { width: 1240, height: 3508 }, 3.125);
    expect(narrow.unitsPerPixel).toBeGreaterThan(portrait.unitsPerPixel);
  });

  it('refuses sizes that are not sizes, which is a mistake of the caller', () => {
    expect(() =>
      exportCamera2d(CAMERA_2D, { width: 0, height: 648 }, { width: 10, height: 10 }, 1),
    ).toThrow(RangeError);
    expect(() => exportCamera2d(CAMERA_2D, SCREEN, { width: 10, height: Number.NaN }, 1)).toThrow(
      RangeError,
    );
    expect(() => exportCamera2d(CAMERA_2D, SCREEN, { width: 10, height: 10 }, 0)).toThrow(
      RangeError,
    );
  });
});

describe('exportCamera3d', () => {
  it('is the camera itself for a picture of the shape of the screen or a wider one', () => {
    expect(exportCamera3d(CAMERA_3D, SCREEN, { width: 1160, height: 648 })).toBe(CAMERA_3D);
    expect(exportCamera3d(CAMERA_3D, SCREEN, { width: 3508, height: 1200 })).toBe(CAMERA_3D);
  });

  it('keeps the target, heading, elevation and distance, and widens only the lens, for a taller picture', () => {
    const out = exportCamera3d(CAMERA_3D, SCREEN, { width: 1000, height: 1000 });
    expect(out.target).toEqual(CAMERA_3D.target);
    expect(out.heading).toBe(30);
    expect(out.elevation).toBe(40);
    expect(out.distance).toBe(400);
    expect(out.fov).toBeGreaterThan(45);
    expect(out.fov).toBeLessThan(MAX_EXPORT_FOV);
  });

  it('shows at least what the screen shows across and up at the target, and exactly it across', () => {
    const wanted = shown3d(CAMERA_3D, SCREEN);
    for (const map of [
      { width: 1000, height: 1000 },
      { width: 2480, height: 3508 },
      { width: 800, height: 1200 },
    ]) {
      const out = shown3d(exportCamera3d(CAMERA_3D, SCREEN, map), map);
      expect(out.across).toBeGreaterThanOrEqual(wanted.across - 1e-9);
      expect(out.up).toBeGreaterThanOrEqual(wanted.up - 1e-9);
      expect(out.across).toBeCloseTo(wanted.across, 6);
    }
  });

  it('never goes past the widest lens: it moves the camera back by what the lens would have shown, and still shows the screen', () => {
    const map = { width: 600, height: 4000 };
    const out = exportCamera3d(CAMERA_3D, SCREEN, map);
    expect(out.fov).toBe(MAX_EXPORT_FOV);
    expect(out.distance).toBeGreaterThan(CAMERA_3D.distance);
    const wanted = shown3d(CAMERA_3D, SCREEN);
    const got = shown3d(out, map);
    expect(got.across).toBeGreaterThanOrEqual(wanted.across - 1e-9);
    expect(got.up).toBeGreaterThanOrEqual(wanted.up - 1e-9);
  });

  it('refuses sizes that are not sizes', () => {
    expect(() => exportCamera3d(CAMERA_3D, SCREEN, { width: -1, height: 10 })).toThrow(RangeError);
  });
});
