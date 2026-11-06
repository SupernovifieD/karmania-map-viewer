import type { Frame } from '@karmania/engine/display';
import { describe, expect, it } from 'vitest';
import { setFrame, setSelection } from './commands-frame.js';
import { emptyScene } from './empty.js';
import { SAMPLE_FRAME, frozen, sampleScene } from './test-support/documents.js';
import { validateScene } from './validate.js';

const placeholders = { camera2d: emptyScene().camera2d, camera3d: emptyScene().camera3d };
const utm41: Frame = {
  mapCrs: { kind: 'epsg', code: 32641 },
  origin: [300000, 5000000, 100],
  source: 'user',
};

describe('setFrame', () => {
  it('sets the frame of a scene that has none, as a copy, and validateScene accepts it', () => {
    const next = setFrame(emptyScene(), SAMPLE_FRAME);
    expect(next.frame).toEqual(SAMPLE_FRAME);
    expect(next.frame).not.toBe(SAMPLE_FRAME);
    expect(validateScene(next)).toEqual([]);
  });

  it('holds a copy, so that changing the frame that was given afterwards does not change the document', () => {
    const origin = [1, 2, 3];
    const given = {
      mapCrs: { kind: 'epsg', code: 32640 },
      origin,
      source: 'auto',
    } as unknown as Frame;
    const next = setFrame(emptyScene(), given);
    origin[0] = 99;
    expect(next.frame?.origin).toEqual([1, 2, 3]);
  });

  it('sends the cameras back to their placeholders when the map system changes, and keeps everything else', () => {
    const doc = sampleScene();
    const next = setFrame(doc, utm41);
    expect(next.frame).toEqual(utm41);
    expect({ camera2d: next.camera2d, camera3d: next.camera3d }).toEqual(placeholders);
    expect({
      ...next,
      frame: doc.frame,
      ...{ camera2d: doc.camera2d, camera3d: doc.camera3d },
    }).toEqual(doc);
    expect(validateScene(next)).toEqual([]);
  });

  it('counts a local grid in another unit, and a local grid for an EPSG system, as another system', () => {
    const local = (units: 'm' | 'ft'): Frame => ({
      mapCrs: { kind: 'local', units },
      origin: [0, 0, 0],
      source: 'auto',
    });
    const inMetres = setFrame(sampleScene(), local('m'));
    expect(inMetres.camera2d).toEqual(placeholders.camera2d);
    const moved = setCamera2d(inMetres);
    expect(setFrame(moved, local('ft')).camera2d).toEqual(placeholders.camera2d);
    expect(setFrame(moved, local('m'))).toBe(moved);
  });

  it('keeps the cameras when only the origin or only the source changes, in the same system', () => {
    const doc = sampleScene();
    const moved = setFrame(doc, { ...SAMPLE_FRAME, origin: [513000, 4012000, 0] });
    expect(moved.frame?.origin).toEqual([513000, 4012000, 0]);
    expect(moved.camera2d).toBe(doc.camera2d);
    expect(moved.camera3d).toBe(doc.camera3d);
    const chosen = setFrame(doc, { ...SAMPLE_FRAME, source: 'user' });
    expect([chosen.frame?.source, chosen.camera2d]).toEqual(['user', doc.camera2d]);
  });

  it('clears the frame with null, and the cameras with it; and the cameras start again from a frame after none', () => {
    const doc = sampleScene();
    const none = setFrame(doc, null);
    expect([none.frame, none.camera2d, none.camera3d]).toEqual([
      null,
      placeholders.camera2d,
      placeholders.camera3d,
    ]);
    const back = setFrame(setCamera2d(none), SAMPLE_FRAME);
    expect(back.camera2d).toEqual(placeholders.camera2d);
  });

  it('is the same document for a frame that is the one there is, even if it is another object, and for null when there is none', () => {
    const doc = sampleScene();
    expect(setFrame(doc, { ...SAMPLE_FRAME, origin: [512000, 4012000, 0] })).toBe(doc);
    expect(setFrame(emptyScene(), null).frame).toBeNull();
    const none = emptyScene();
    expect(setFrame(none, null)).toBe(none);
  });

  it('is the same document for a frame that is not right', () => {
    const doc = sampleScene();
    const wrong: unknown[] = [
      { ...utm41, mapCrs: { kind: 'epsg', code: 0 } },
      { ...utm41, mapCrs: { kind: 'local', units: 'km' } },
      { ...utm41, origin: [NaN, 0, 0] },
      { ...utm41, origin: [0, 0] },
      { ...utm41, source: 'robot' },
      { mapCrs: utm41.mapCrs },
      undefined,
    ];
    for (const frame of wrong) {
      expect(setFrame(doc, frame as Frame)).toBe(doc);
    }
  });

  it('never changes the document it is given', () => {
    expect(setFrame(frozen(sampleScene()), utm41).frame?.mapCrs).toEqual(utm41.mapCrs);
  });
});

/** The document with its 2D camera somewhere other than the placeholder, so that a reset can be seen. */
function setCamera2d(doc: ReturnType<typeof emptyScene>): ReturnType<typeof emptyScene> {
  return { ...doc, camera2d: { centre: [5, 6], unitsPerPixel: 2, heading: 10 } };
}

describe('setSelection', () => {
  it('picks an element of a layer, and clears the pick with null', () => {
    const doc = sampleScene();
    const next = setSelection(doc, { layerId: 'layer-1', element: 41 });
    expect(next.selection).toEqual({ layerId: 'layer-1', element: 41 });
    expect({ ...next, selection: doc.selection }).toEqual(doc);
    expect(setSelection(next, null).selection).toBeNull();
    expect(validateScene(next)).toEqual([]);
  });

  it('picks from a layer that is hidden, as the table does for a row (step 21.5)', () => {
    expect(setSelection(sampleScene(), { layerId: 'layer-2', element: 3 }).selection).toEqual({
      layerId: 'layer-2',
      element: 3,
    });
  });

  it('holds a copy of the pick it was given', () => {
    const given = { layerId: 'layer-1', element: 1 };
    const next = setSelection(sampleScene(), given);
    expect(next.selection).not.toBe(given);
  });

  it('is the same document for the pick there is, for none when there is none, and for a pick that is not right', () => {
    const doc = sampleScene();
    expect(setSelection(doc, { layerId: 'layer-2', element: 0 })).toBe(doc);
    const none = emptyScene();
    expect(setSelection(none, null)).toBe(none);
    for (const wrong of [
      { layerId: 'layer-9', element: 0 },
      { layerId: 'constructor', element: 0 },
      { layerId: '', element: 0 },
      { layerId: 'layer-1', element: -1 },
      { layerId: 'layer-1', element: 0.5 },
      { layerId: 'layer-1', element: NaN },
    ]) {
      expect(setSelection(doc, wrong)).toBe(doc);
    }
    expect(setSelection(emptyScene(), { layerId: 'layer-1', element: 0 }).selection).toBeNull();
  });

  it('never changes the document it is given', () => {
    expect(setSelection(frozen(sampleScene()), null).selection).toBeNull();
  });
});
