import type { BBox } from '@karmania/engine/types';
import { describe, expect, it } from 'vitest';
import { cameraTo2d, cameraTo3d, fitCamera2d, fitCamera3d } from './cameras.js';
import type { Camera2d, Camera3d } from './types.js';
import { validateCamera2d, validateCamera3d } from './validate.js';

const box = (min: [number, number, number], max: [number, number, number]): BBox => ({ min, max });
const flat = (x0: number, y0: number, x1: number, y1: number): BBox =>
  box([x0, y0, 0], [x1, y1, 0]);
const screen = { width: 800, height: 400 };

describe('fitCamera2d', () => {
  it('centres on the extent and takes the scale at which it just fills the map area', () => {
    expect(fitCamera2d({ extent: flat(0, 0, 1000, 500), viewport: screen })).toEqual({
      centre: [500, 250],
      unitsPerPixel: 1.25,
      heading: 0,
    });
  });

  it('is limited by the side that fills first: a tall extent by the height, a wide one by the width', () => {
    expect(fitCamera2d({ extent: flat(0, 0, 1000, 1000), viewport: screen })?.unitsPerPixel).toBe(
      2.5,
    );
    expect(fitCamera2d({ extent: flat(0, 0, 4000, 100), viewport: screen })?.unitsPerPixel).toBe(5);
  });

  it('leaves the padding free on each side', () => {
    const fit = fitCamera2d({ extent: flat(0, 0, 768, 368), viewport: screen, padding: 16 });
    expect(fit?.unitsPerPixel).toBeCloseTo(1, 12);
    expect(
      fitCamera2d({ extent: flat(0, 0, 800, 400), viewport: screen, padding: 0 })?.unitsPerPixel,
    ).toBe(1);
  });

  it('keeps one pixel of room, whatever the padding, so that a map area smaller than its padding still fits', () => {
    const fit = fitCamera2d({
      extent: flat(0, 0, 10, 10),
      viewport: { width: 20, height: 20 },
      padding: 50,
    });
    expect(fit?.unitsPerPixel).toBe(10);
    // Width with no room left, height with plenty: the width is the side that says how far to go.
    const narrow = fitCamera2d({
      extent: flat(0, 0, 10, 10),
      viewport: { width: 20, height: 400 },
      padding: 50,
    });
    expect(narrow?.unitsPerPixel).toBe(10);
    const low = fitCamera2d({
      extent: flat(0, 0, 10, 10),
      viewport: { width: 400, height: 20 },
      padding: 50,
    });
    expect(low?.unitsPerPixel).toBe(10);
  });

  it('measures a turned map across its own screen: facing east, the width is the north to south of the extent', () => {
    const fit = fitCamera2d({ extent: flat(0, 0, 1000, 500), viewport: screen, heading: 90 });
    expect(fit?.heading).toBe(90);
    expect(fit?.unitsPerPixel).toBeCloseTo(2.5, 9);
    const diagonal = fitCamera2d({
      extent: flat(0, 0, 100, 100),
      viewport: { width: 400, height: 400 },
      heading: 45,
    });
    expect(diagonal?.unitsPerPixel).toBeCloseTo((100 * Math.SQRT2) / 400, 12);
  });

  it('keeps a heading outside 0 to 360 as the direction it is the same as', () => {
    expect(
      fitCamera2d({ extent: flat(0, 0, 10, 10), viewport: screen, heading: -90 })?.heading,
    ).toBe(270);
    expect(
      fitCamera2d({ extent: flat(0, 0, 10, 10), viewport: screen, heading: 450 })?.heading,
    ).toBe(90);
  });

  it('puts a point at one map unit to a pixel', () => {
    expect(fitCamera2d({ extent: flat(5, 7, 5, 7), viewport: screen })).toEqual({
      centre: [5, 7],
      unitsPerPixel: 1,
      heading: 0,
    });
  });

  it('shows the whole extent for any extent, heading and map area, touching the edge on one axis', () => {
    let state = 11;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < 2000; i += 1) {
      const x0 = (next() - 0.5) * 1e6;
      const y0 = (next() - 0.5) * 1e6;
      const extent = flat(x0, y0, x0 + next() * 1e4 + 1, y0 + next() * 1e4 + 1);
      const viewport = { width: 100 + next() * 1500, height: 100 + next() * 900 };
      const heading = next() * 720 - 360;
      const padding = next() * 40;
      const fit = fitCamera2d({ extent, viewport, heading, padding });
      expect(fit).toBeDefined();
      if (fit === undefined) {
        continue;
      }
      const radians = (fit.heading * Math.PI) / 180;
      let widest = 0;
      for (const x of [extent.min[0], extent.max[0]]) {
        for (const y of [extent.min[1], extent.max[1]]) {
          const dx = (x - fit.centre[0]) / fit.unitsPerPixel;
          const dy = (y - fit.centre[1]) / fit.unitsPerPixel;
          const right = dx * Math.cos(radians) - dy * Math.sin(radians);
          const up = dx * Math.sin(radians) + dy * Math.cos(radians);
          const roomX = (viewport.width - 2 * padding) / 2;
          const roomY = (viewport.height - 2 * padding) / 2;
          expect(Math.abs(right)).toBeLessThanOrEqual(roomX + 1e-6);
          expect(Math.abs(up)).toBeLessThanOrEqual(roomY + 1e-6);
          widest = Math.max(widest, Math.abs(right) / roomX, Math.abs(up) / roomY);
        }
      }
      expect(widest).toBeCloseTo(1, 6);
      expect(validateCamera2d(fit)).toEqual([]);
    }
  });

  it('is undefined for an extent or a map area that cannot be used, so the camera is left as it is', () => {
    const bad: [string, Parameters<typeof fitCamera2d>[0]][] = [
      ['NaN', { extent: flat(NaN, 0, 1, 1), viewport: screen }],
      ['infinite', { extent: flat(0, 0, Infinity, 1), viewport: screen }],
      ['negative width', { extent: flat(5, 0, 1, 1), viewport: screen }],
      ['negative height', { extent: flat(0, 5, 1, 1), viewport: screen }],
      ['no width', { extent: flat(0, 0, 1, 1), viewport: { width: 0, height: 400 } }],
      ['no height', { extent: flat(0, 0, 1, 1), viewport: { width: 800, height: 0 } }],
      ['not a size', { extent: flat(0, 0, 1, 1), viewport: { width: NaN, height: 400 } }],
      ['negative padding', { extent: flat(0, 0, 1, 1), viewport: screen, padding: -1 }],
      ['padding not a number', { extent: flat(0, 0, 1, 1), viewport: screen, padding: NaN }],
    ];
    for (const [what, input] of bad) {
      expect(fitCamera2d(input), what).toBeUndefined();
    }
  });
});

describe('fitCamera3d', () => {
  const cube = box([0, 0, 0], [100, 100, 100]);
  const wide = { width: 1000, height: 500 };

  it('looks at the middle of the extent from far enough that the sphere around it fits the field of view', () => {
    const fit = fitCamera3d({ extent: cube, viewport: wide, fov: 60 });
    expect(fit?.target).toEqual([50, 50, 50]);
    // The radius of the sphere is half of the diagonal, and a field of 60 degrees has half of it 30, whose sine is a half.
    expect(fit?.distance).toBeCloseTo(Math.hypot(100, 100, 100), 9);
    expect(fit).toMatchObject({ heading: 0, elevation: 45, fov: 60 });
  });

  it('is limited by the narrower field of view: a map area that is taller than it is wide needs more distance', () => {
    const tall = fitCamera3d({ extent: cube, viewport: { width: 500, height: 1000 }, fov: 60 });
    const horizontal = Math.atan(Math.tan((30 * Math.PI) / 180) * 0.5);
    expect(tall?.distance).toBeCloseTo(Math.hypot(100, 100, 100) / 2 / Math.sin(horizontal), 9);
    expect(tall?.distance ?? 0).toBeGreaterThan(
      fitCamera3d({ extent: cube, viewport: wide, fov: 60 })?.distance ?? 0,
    );
  });

  it('counts the heights times the exaggeration, and leaves the target at the middle of the heights as they are', () => {
    const flatBox = box([0, 0, 0], [100, 0, 10]);
    const plain = fitCamera3d({ extent: flatBox, viewport: wide, fov: 60 });
    const tenfold = fitCamera3d({
      extent: flatBox,
      viewport: wide,
      fov: 60,
      verticalExaggeration: 10,
    });
    expect(plain?.distance).toBeCloseTo(Math.hypot(100, 10), 9);
    expect(tenfold?.distance).toBeCloseTo(Math.hypot(100, 100), 9);
    expect(tenfold?.target).toEqual([50, 0, 5]);
  });

  it('gives the heading and elevation it is asked for, the heading as one turn and the elevation held', () => {
    expect(
      fitCamera3d({ extent: cube, viewport: wide, fov: 45, heading: -90, elevation: 120 }),
    ).toMatchObject({ heading: 270, elevation: 89, fov: 45 });
    expect(fitCamera3d({ extent: cube, viewport: wide, fov: 45, elevation: -120 })?.elevation).toBe(
      -89,
    );
    expect(fitCamera3d({ extent: cube, viewport: wide, fov: 45, elevation: 20 })?.elevation).toBe(
      20,
    );
  });

  it('keeps a sphere of a map unit for an extent that is a point', () => {
    const fit = fitCamera3d({ extent: box([3, 4, 5], [3, 4, 5]), viewport: wide, fov: 90 });
    expect(fit?.target).toEqual([3, 4, 5]);
    expect(fit?.distance).toBeCloseTo(1 / Math.sin(Math.PI / 4), 9);
  });

  it('gives a camera that validateScene would accept, for any extent', () => {
    let state = 5;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < 500; i += 1) {
      const lo: [number, number, number] = [next() * 1e5, next() * 1e5, next() * 1e3];
      const hi: [number, number, number] = [
        lo[0] + next() * 1e3,
        lo[1] + next() * 1e3,
        lo[2] + next() * 100,
      ];
      const fit = fitCamera3d({
        extent: box(lo, hi),
        viewport: wide,
        fov: 10 + next() * 150,
        heading: next() * 1000,
        elevation: next() * 400 - 200,
        verticalExaggeration: 1 + Math.floor(next() * 9),
      });
      expect(fit).toBeDefined();
      expect(validateCamera3d(fit)).toEqual([]);
    }
  });

  it('is undefined for an extent, a map area, a field of view or an exaggeration that cannot be used', () => {
    const base = { extent: cube, viewport: wide, fov: 60 };
    const bad: [string, Parameters<typeof fitCamera3d>[0]][] = [
      ['NaN extent', { ...base, extent: box([NaN, 0, 0], [1, 1, 1]) }],
      ['negative height', { ...base, extent: box([0, 0, 5], [1, 1, 1]) }],
      ['no viewport', { ...base, viewport: { width: 0, height: 0 } }],
      ['fov 0', { ...base, fov: 0 }],
      ['fov 180', { ...base, fov: 180 }],
      ['fov NaN', { ...base, fov: NaN }],
      ['exaggeration 0', { ...base, verticalExaggeration: 0 }],
      ['exaggeration NaN', { ...base, verticalExaggeration: NaN }],
    ];
    for (const [what, input] of bad) {
      expect(fitCamera3d(input), what).toBeUndefined();
    }
  });
});

describe('cameraTo3d and cameraTo2d: switching views', () => {
  const view: Camera2d = { centre: [512345.12, 4012345.67], unitsPerPixel: 2, heading: 30 };
  const viewport = { width: 1000, height: 600 };

  it('keeps the centre and the heading, and puts the camera where the map area is as high as it was', () => {
    const three = cameraTo3d({ camera2d: view, viewport, fov: 60, elevation: 35, targetZ: 12 });
    expect(three?.target).toEqual([512345.12, 4012345.67, 12]);
    expect(three).toMatchObject({ heading: 30, elevation: 35, fov: 60 });
    // 600 pixels of 2 units are 1,200 units high; a field of 60 degrees is 2 tan 30 = 1.1547 high at a distance of 1.
    expect(three?.distance).toBeCloseTo(1200 / (2 * Math.tan(Math.PI / 6)), 9);
  });

  it('turns a heading outside 0 to 360 into the same direction in the other view too', () => {
    expect(cameraTo3d({ camera2d: { ...view, heading: 400 }, viewport, fov: 60 })?.heading).toBe(
      40,
    );
    expect(cameraTo3d({ camera2d: { ...view, heading: -30 }, viewport, fov: 60 })?.heading).toBe(
      330,
    );
  });

  it('puts the 3D camera at the height of the target given, 0 if none, and at 45 degrees if no elevation', () => {
    expect(cameraTo3d({ camera2d: view, viewport, fov: 45 })).toMatchObject({ elevation: 45 });
    expect(cameraTo3d({ camera2d: view, viewport, fov: 45 })?.target[2]).toBe(0);
    expect(cameraTo3d({ camera2d: view, viewport, fov: 45, elevation: 200 })?.elevation).toBe(89);
    expect(cameraTo3d({ camera2d: view, viewport, fov: 45, targetZ: -30.5 })?.target[2]).toBe(
      -30.5,
    );
  });

  it('turns a 3D camera into the 2D camera with the same centre, heading and scale at what it looks at', () => {
    const three: Camera3d = {
      target: [10, 20, 99],
      distance: 900,
      heading: 400,
      elevation: 20,
      fov: 90,
    };
    const two = cameraTo2d({ camera3d: three, viewport });
    expect(two?.centre).toEqual([10, 20]);
    expect(two?.heading).toBe(40);
    // A field of 90 degrees is 2 high at a distance of 1: 1,800 units over 600 pixels.
    expect(two?.unitsPerPixel).toBeCloseTo(3, 9);
  });

  it('comes back to where it was: 2D to 3D to 2D, and 3D to 2D to 3D with the same elevation', () => {
    let state = 3;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < 1000; i += 1) {
      const camera2d: Camera2d = {
        centre: [next() * 1e6, next() * 1e7],
        unitsPerPixel: 10 ** (next() * 6 - 3),
        heading: next() * 360,
      };
      const port = { width: 100 + next() * 2000, height: 100 + next() * 1200 };
      const fov = 5 + next() * 150;
      const three = cameraTo3d({
        camera2d,
        viewport: port,
        fov,
        elevation: 10 + next() * 70,
        targetZ: next() * 500,
      });
      expect(three).toBeDefined();
      if (three === undefined) {
        continue;
      }
      expect(validateCamera3d(three)).toEqual([]);
      const back = cameraTo2d({ camera3d: three, viewport: port });
      expect(back?.centre).toEqual(camera2d.centre);
      expect(back?.heading).toBeCloseTo(camera2d.heading, 9);
      expect(back?.unitsPerPixel ?? 0).toBeCloseTo(
        camera2d.unitsPerPixel,
        9 - Math.max(0, Math.ceil(Math.log10(camera2d.unitsPerPixel))),
      );
      const again = cameraTo3d({
        camera2d: back ?? camera2d,
        viewport: port,
        fov,
        elevation: three.elevation,
        targetZ: three.target[2],
      });
      expect(again?.distance).toBeCloseTo(three.distance, 6);
    }
  });

  it('gives a camera that validateScene accepts', () => {
    expect(validateCamera3d(cameraTo3d({ camera2d: view, viewport, fov: 45 }))).toEqual([]);
    expect(
      validateCamera2d(
        cameraTo2d({
          camera3d: { target: [1, 2, 3], distance: 50, heading: 0, elevation: 45, fov: 45 },
          viewport,
        }),
      ),
    ).toEqual([]);
  });

  it('is undefined when a camera, the map area or the field of view cannot be used', () => {
    const three: Camera3d = {
      target: [0, 0, 0],
      distance: 100,
      heading: 0,
      elevation: 45,
      fov: 45,
    };
    expect(
      cameraTo3d({ camera2d: { ...view, unitsPerPixel: 0 }, viewport, fov: 45 }),
    ).toBeUndefined();
    expect(
      cameraTo3d({ camera2d: { ...view, centre: [NaN, 0] }, viewport, fov: 45 }),
    ).toBeUndefined();
    expect(
      cameraTo3d({ camera2d: { ...view, heading: Infinity }, viewport, fov: 45 }),
    ).toBeUndefined();
    expect(
      cameraTo3d({ camera2d: view, viewport: { width: 0, height: 600 }, fov: 45 }),
    ).toBeUndefined();
    expect(cameraTo3d({ camera2d: view, viewport, fov: 0 })).toBeUndefined();
    expect(cameraTo3d({ camera2d: view, viewport, fov: 180 })).toBeUndefined();
    expect(cameraTo3d({ camera2d: view, viewport, fov: 45, targetZ: NaN })).toBeUndefined();
    expect(cameraTo2d({ camera3d: { ...three, distance: 0 }, viewport })).toBeUndefined();
    expect(cameraTo2d({ camera3d: { ...three, target: [0, NaN, 0] }, viewport })).toBeUndefined();
    expect(cameraTo2d({ camera3d: { ...three, fov: 180 }, viewport })).toBeUndefined();
    expect(cameraTo2d({ camera3d: { ...three, heading: NaN }, viewport })).toBeUndefined();
    expect(cameraTo2d({ camera3d: three, viewport: { width: 100, height: NaN } })).toBeUndefined();
  });
});

describe('the cameras are undefined for an angle that is not a number', () => {
  // Found by the review of the milestone: a camera with a heading or an elevation that is NaN or infinite came back, and
  // validateScene refuses it, though the cameras are said to be ones that it accepts.
  const cube = box([0, 0, 0], [100, 100, 100]);
  const viewport = { width: 800, height: 600 };
  const view: Camera2d = { centre: [1, 2], unitsPerPixel: 2, heading: 30 };

  it('in fitCamera2d: a heading', () => {
    for (const heading of [NaN, Infinity, -Infinity]) {
      expect(
        fitCamera2d({ extent: flat(0, 0, 10, 10), viewport, heading }),
        String(heading),
      ).toBeUndefined();
    }
  });

  it('in fitCamera3d: a heading or an elevation', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(
        fitCamera3d({ extent: cube, viewport, fov: 45, heading: bad }),
        `heading ${String(bad)}`,
      ).toBeUndefined();
      expect(
        fitCamera3d({ extent: cube, viewport, fov: 45, elevation: bad }),
        `elevation ${String(bad)}`,
      ).toBeUndefined();
    }
  });

  it('in cameraTo3d: an elevation', () => {
    for (const elevation of [NaN, Infinity, -Infinity]) {
      expect(
        cameraTo3d({ camera2d: view, viewport, fov: 45, elevation }),
        String(elevation),
      ).toBeUndefined();
    }
  });

  it('and every camera that is given is one that validateScene accepts', () => {
    expect(
      validateCamera2d(fitCamera2d({ extent: flat(0, 0, 10, 10), viewport, heading: 725 })),
    ).toEqual([]);
    expect(
      validateCamera3d(
        fitCamera3d({ extent: cube, viewport, fov: 45, heading: -725, elevation: 500 }),
      ),
    ).toEqual([]);
    expect(
      validateCamera3d(cameraTo3d({ camera2d: view, viewport, fov: 45, elevation: -500 })),
    ).toEqual([]);
  });
});
