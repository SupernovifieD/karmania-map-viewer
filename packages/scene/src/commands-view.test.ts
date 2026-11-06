import { describe, expect, it } from 'vitest';
import {
  heldElevation,
  normalHeading,
  setCamera,
  setVerticalExaggeration,
  setViewMode,
} from './commands-view.js';
import { frozen, sampleScene } from './test-support/documents.js';
import type { ViewMode, VerticalExaggeration } from './types.js';
import { validateScene } from './validate.js';

describe('setViewMode', () => {
  it('changes the view and nothing else', () => {
    const doc = sampleScene();
    const next = setViewMode(doc, '2d');
    expect(next.viewMode).toBe('2d');
    expect({ ...next, viewMode: '3d' }).toEqual(doc);
    expect(validateScene(next)).toEqual([]);
  });

  it('is the same document for the view it has, and for anything that is not a view', () => {
    const doc = sampleScene();
    expect(setViewMode(doc, '3d')).toBe(doc);
    expect(setViewMode(doc, '4d' as ViewMode)).toBe(doc);
    expect(setViewMode(doc, 'constructor' as ViewMode)).toBe(doc);
  });

  it('never changes the document it is given', () => {
    expect(setViewMode(frozen(sampleScene()), '2d').viewMode).toBe('2d');
  });
});

describe('setVerticalExaggeration', () => {
  it('takes each of the five factors', () => {
    for (const factor of [1, 2, 3, 5, 10] as const) {
      const next = setVerticalExaggeration(
        frozen({ ...sampleScene(), verticalExaggeration: 5 }),
        factor,
      );
      expect(next.verticalExaggeration).toBe(factor);
      expect(validateScene(next)).toEqual([]);
    }
  });

  it('is the same document for the factor it has, and for any other number', () => {
    const doc = sampleScene();
    expect(setVerticalExaggeration(doc, 5)).toBe(doc);
    for (const bad of [0, 4, 6, 11, -1, NaN, 2.5]) {
      expect(setVerticalExaggeration(doc, bad as VerticalExaggeration)).toBe(doc);
    }
  });
});

describe('the heading and the elevation', () => {
  it('turns a heading into the degrees from 0 up to 360 that point the same way', () => {
    expect([0, 30, 359.5, 360, 361, 720, -30, -360, -720.5].map(normalHeading)).toEqual([
      0, 30, 359.5, 0, 1, 0, 330, 0, 359.5,
    ]);
    expect(Object.is(normalHeading(-0), 0)).toBe(true);
    expect(normalHeading(-1e-20)).toBe(0);
    expect(Number.isNaN(normalHeading(NaN))).toBe(true);
    expect(normalHeading(Infinity)).toBe(Infinity);
  });

  it('holds an elevation between -89 and 89 degrees', () => {
    expect([-120, -89, -88.9, 0, 45, 89, 89.1, 90, 1000].map(heldElevation)).toEqual([
      -89, -89, -88.9, 0, 45, 89, 89, 89, 89,
    ]);
    expect(Number.isNaN(heldElevation(NaN))).toBe(true);
  });
});

describe('setCamera', () => {
  it('moves the 2D camera by the fields it is given and leaves the 3D camera alone', () => {
    const doc = sampleScene();
    const next = setCamera(doc, { camera2d: { centre: [1, 2], unitsPerPixel: 4 } });
    expect(next.camera2d).toEqual({ centre: [1, 2], unitsPerPixel: 4, heading: 30 });
    expect(next.camera3d).toBe(doc.camera3d);
    expect(validateScene(next)).toEqual([]);
  });

  it('moves the 3D camera by the fields it is given and leaves the 2D camera alone', () => {
    const doc = sampleScene();
    const next = setCamera(doc, { camera3d: { target: [1, 2, 3], distance: 50, fov: 60 } });
    expect(next.camera3d).toEqual({
      target: [1, 2, 3],
      distance: 50,
      heading: 30,
      elevation: 35,
      fov: 60,
    });
    expect(next.camera2d).toBe(doc.camera2d);
  });

  it('moves both at once', () => {
    const next = setCamera(sampleScene(), { camera2d: { heading: 90 }, camera3d: { heading: 90 } });
    expect([next.camera2d.heading, next.camera3d.heading]).toEqual([90, 90]);
  });

  it('turns a heading that is given into 0 up to 360, in both cameras', () => {
    const next = setCamera(sampleScene(), {
      camera2d: { heading: -45 },
      camera3d: { heading: 725 },
    });
    expect([next.camera2d.heading, next.camera3d.heading]).toEqual([315, 5]);
  });

  it('holds an elevation that is given between -89 and 89, and does not refuse it', () => {
    expect(setCamera(sampleScene(), { camera3d: { elevation: 120 } }).camera3d.elevation).toBe(89);
    expect(setCamera(sampleScene(), { camera3d: { elevation: -91 } }).camera3d.elevation).toBe(-89);
    expect(setCamera(sampleScene(), { camera3d: { elevation: 10 } }).camera3d.elevation).toBe(10);
  });

  it('touches only the fields it is given, even a heading that the document has outside 0 to 360', () => {
    const doc = { ...sampleScene(), camera3d: { ...sampleScene().camera3d, heading: 400 } };
    expect(setCamera(doc, { camera3d: { distance: 10 } }).camera3d.heading).toBe(400);
  });

  it('refuses the whole change when a value is wrong: a scale, a distance or a field of view not above 0, or not a number', () => {
    const doc = sampleScene();
    const wrong = [
      { camera2d: { unitsPerPixel: 0 } },
      { camera2d: { unitsPerPixel: -1 } },
      { camera2d: { centre: [NaN, 0] as const } },
      { camera2d: { heading: NaN } },
      { camera2d: { centre: [1, 2, 3] as unknown as readonly [number, number] } },
      { camera3d: { distance: 0 } },
      { camera3d: { fov: 0 } },
      { camera3d: { fov: 180 } },
      { camera3d: { elevation: NaN } },
      { camera3d: { target: [0, 0, Infinity] as const } },
      // One wrong value refuses what else is in the change, in either camera.
      { camera2d: { heading: 10 }, camera3d: { distance: -1 } },
      { camera2d: { unitsPerPixel: 0 }, camera3d: { heading: 10 } },
    ];
    for (const patch of wrong) {
      expect(setCamera(doc, patch)).toBe(doc);
    }
  });

  it('is the same document for a change that changes nothing, and for an empty one', () => {
    const doc = sampleScene();
    expect(setCamera(doc, {})).toBe(doc);
    expect(setCamera(doc, { camera2d: {}, camera3d: {} })).toBe(doc);
    expect(setCamera(doc, { camera2d: { centre: [512345.12, 4012345.67], heading: 30 } })).toBe(
      doc,
    );
    expect(
      setCamera(doc, { camera3d: { elevation: 35, target: [512345.12, 4012345.67, 12] } }),
    ).toBe(doc);
    expect(setCamera(doc, { camera2d: { heading: 390 } })).toBe(doc);
  });

  it('never changes the document it is given', () => {
    expect(
      setCamera(frozen(sampleScene()), { camera2d: { unitsPerPixel: 2 } }).camera2d.unitsPerPixel,
    ).toBe(2);
  });
});
