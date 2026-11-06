import { describe, expect, it } from 'vitest';
import { MAX_PROBLEMS } from './problems.js';
import { ABSENT, problemsAfter, sampleScene, spoil } from './test-support/documents.js';
import { validateScene } from './validate.js';

describe('validateScene: the document, the frame, the view and the cameras', () => {
  it('finds nothing wrong with a document that uses every field', () => {
    expect(validateScene(sampleScene())).toEqual([]);
    expect(validateScene(JSON.parse(JSON.stringify(sampleScene())))).toEqual([]);
  });

  it('says that something that is not an object is not a scene, and does not throw', () => {
    for (const bad of [null, undefined, 7, 'scene', [], () => 0]) {
      const found = validateScene(bad);
      expect(found).toHaveLength(1);
      expect(found[0]?.code === 'not_an_object' || found[0]?.code === 'missing').toBe(true);
    }
  });

  it('knows only version 1, and says no more of a document of another version', () => {
    const newer = validateScene({ ...sampleScene(), version: 2, whatever: 1 });
    expect(newer).toEqual([
      {
        path: 'version',
        code: 'version',
        message: 'version is 2, which is newer than this viewer reads (1).',
      },
    ]);
    expect(problemsAfter(['version'], ABSENT)).toEqual(['missing version']);
    expect(problemsAfter(['version'], 0)).toEqual(['version version']);
    expect(problemsAfter(['version'], '1')).toEqual(['version version']);
    expect(problemsAfter(['version'], 1.5)).toEqual(['version version']);
  });

  it('does not let a field through that is not in the contract', () => {
    expect(problemsAfter(['opactiy'], 1)).toEqual(['unknown_field opactiy']);
    expect(problemsAfter(['camera2d', 'zoom'], 1)).toEqual(['unknown_field camera2d.zoom']);
  });

  it('accepts no frame, and checks a frame that there is', () => {
    expect(problemsAfter(['frame'], null)).toEqual([]);
    expect(problemsAfter(['frame'], ABSENT)).toEqual(['missing frame']);
    expect(problemsAfter(['frame'], {})).toEqual([
      'missing frame.mapCrs',
      'missing frame.origin',
      'missing frame.source',
    ]);
    expect(problemsAfter(['frame', 'source'], 'robot')).toEqual(['choice frame.source']);
    expect(problemsAfter(['frame', 'origin'], [1, 2])).toEqual(['type frame.origin']);
    expect(problemsAfter(['frame', 'origin', 2], 'up')).toEqual(['type frame.origin[2]']);
  });

  it('checks the map system: a whole EPSG code above 0, or a local grid with a unit', () => {
    expect(problemsAfter(['frame', 'mapCrs'], { kind: 'local', units: 'us_ft' })).toEqual([]);
    expect(problemsAfter(['frame', 'mapCrs', 'code'], 0)).toEqual(['range frame.mapCrs.code']);
    expect(problemsAfter(['frame', 'mapCrs', 'code'], 32640.5)).toEqual([
      'range frame.mapCrs.code',
    ]);
    expect(problemsAfter(['frame', 'mapCrs', 'kind'], 'utm')).toEqual(['choice frame.mapCrs.kind']);
    expect(problemsAfter(['frame', 'mapCrs'], { kind: 'local', units: 'km' })).toEqual([
      'choice frame.mapCrs.units',
    ]);
    // A local grid has no code, and an EPSG system no unit.
    expect(problemsAfter(['frame', 'mapCrs'], { kind: 'local', units: 'm', code: 1 })).toEqual([
      'unknown_field frame.mapCrs.code',
    ]);
    expect(problemsAfter(['frame', 'mapCrs'], { kind: 'epsg', code: 4326, units: 'm' })).toEqual([
      'unknown_field frame.mapCrs.units',
    ]);
  });

  it('knows the two views and the five exaggerations', () => {
    expect(problemsAfter(['viewMode'], '2d')).toEqual([]);
    expect(problemsAfter(['viewMode'], '4d')).toEqual(['choice viewMode']);
    for (const factor of [1, 2, 3, 5, 10]) {
      expect(problemsAfter(['verticalExaggeration'], factor)).toEqual([]);
    }
    expect(problemsAfter(['verticalExaggeration'], 4)).toEqual(['choice verticalExaggeration']);
  });

  it('checks the 2D camera: a centre, a scale above 0 and a heading', () => {
    expect(problemsAfter(['camera2d', 'centre'], [0, 0])).toEqual([]);
    expect(problemsAfter(['camera2d', 'centre'], [0])).toEqual(['type camera2d.centre']);
    expect(problemsAfter(['camera2d', 'unitsPerPixel'], 0)).toEqual([
      'range camera2d.unitsPerPixel',
    ]);
    expect(problemsAfter(['camera2d', 'unitsPerPixel'], -1)).toEqual([
      'range camera2d.unitsPerPixel',
    ]);
    expect(problemsAfter(['camera2d', 'heading'], -30)).toEqual([]);
    expect(problemsAfter(['camera2d', 'heading'], 720.5)).toEqual([]);
    expect(problemsAfter(['camera2d', 'heading'], NaN)).toEqual(['type camera2d.heading']);
    expect(problemsAfter(['camera2d'], ABSENT)).toEqual(['missing camera2d']);
  });

  it('checks the 3D camera: the elevation from -89 to 89 and a field of view between 0 and 180', () => {
    expect(problemsAfter(['camera3d', 'elevation'], -89)).toEqual([]);
    expect(problemsAfter(['camera3d', 'elevation'], 89)).toEqual([]);
    expect(problemsAfter(['camera3d', 'elevation'], 90)).toEqual(['range camera3d.elevation']);
    expect(problemsAfter(['camera3d', 'elevation'], -90)).toEqual(['range camera3d.elevation']);
    expect(problemsAfter(['camera3d', 'fov'], 0)).toEqual(['range camera3d.fov']);
    expect(problemsAfter(['camera3d', 'fov'], 180)).toEqual(['range camera3d.fov']);
    expect(problemsAfter(['camera3d', 'distance'], 0)).toEqual(['range camera3d.distance']);
    expect(problemsAfter(['camera3d', 'target'], [1, 2])).toEqual(['type camera3d.target']);
    expect(problemsAfter(['camera3d', 'target'], [1, 2, Infinity])).toEqual([
      'type camera3d.target[2]',
    ]);
  });

  it('lists every problem, not the first, in the order of the document, with a message that names the place', () => {
    const doc = spoil(
      spoil(spoil(sampleScene(), ['viewMode'], 'x'), ['camera2d', 'heading'], 'n'),
      ['verticalExaggeration'],
      4,
    );
    expect(validateScene(doc).map((p) => p.path)).toEqual([
      'viewMode',
      'camera2d.heading',
      'verticalExaggeration',
    ]);
    expect(validateScene(doc)[1]?.message).toBe(
      'camera2d.heading must be a number, and it is "n".',
    );
  });

  it('stays short for a document that is bad everywhere', () => {
    const bad = spoil(spoil(sampleScene(), ['frame', 'origin'], 'x'), ['camera3d'], {
      ...Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${String(i)}`, 1])),
    });
    expect(validateScene(bad)).toHaveLength(MAX_PROBLEMS + 1);
  });
});
