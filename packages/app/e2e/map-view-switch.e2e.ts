import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  camera,
  camera3d,
  dispatch,
  drawn,
  layerStatuses,
  loadLattice,
  recordingViewChanges,
  setViewMode,
  stats,
} from './support/render.js';

/**
 * The switch between the 2D and the 3D view (step 18.3b): the camera of the view it goes to is made from the camera of the one it leaves, so the
 * centre, the heading and the scale at the centre are kept. The toolbar's control, the viewer's `setViewMode`, is what a person and a page use.
 */

/** A grid of 3 by 2 cells, flat 40 metres above the sea, so that the data has a height to look at. */
const grid = {
  name: 'high',
  crs: { kind: 'epsg', code: 32640 },
  origin: [500_000, 2_765_000, 0],
  elevation: 40,
  spacing: [10, 10, 5],
  dims: [3, 2, 1],
  values: [1, 2, 3, 4, 5, 6],
} as const;

const canvas = (page: Page) => page.locator('karmania-map-area canvas');

/** A map with that grid in it, drawn and fitted, and a 2D camera that is easy to read. */
async function start(page: Page, heading = 30): Promise<{ height: number }> {
  await page.goto('/');
  await loadLattice(page, 'grid', {
    ...grid,
    crs: { ...grid.crs },
    origin: [...grid.origin],
    spacing: [...grid.spacing],
    dims: [...grid.dims],
    values: [...grid.values],
  });
  await drawn(page);
  await expect
    .poll(async () => (await layerStatuses(page)).map(([, status]) => status))
    .toEqual(['drawn']);
  await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: [500_015, 2_765_010], unitsPerPixel: 0.25, heading } },
  });
  const box = await canvas(page).boundingBox();
  if (box === null) {
    throw new Error('The canvas is not shown.');
  }
  return { height: box.height };
}

/** The scale at the target of a 3D camera, in map units a pixel: the height of the view there over the height of the map area. */
const scaleOf = (view: { distance: number; fov: number }, height: number): number =>
  (2 * view.distance * Math.tan((view.fov * Math.PI) / 360)) / height;

const near = (actual: number, expected: number, digits = 6): void => {
  expect(actual).toBeCloseTo(expected, digits);
};

test.describe('the switch between the 2D and the 3D view', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('from 2D keeps the centre, the heading and the scale, and looks at the height of the data', async ({
    page,
  }) => {
    const { height } = await start(page);
    const before2d = await camera(page);
    await setViewMode(page, '3d');
    const now = await camera3d(page);
    near(now.target[0], 500_015);
    near(now.target[1], 2_765_010);
    near(now.target[2], 40);
    expect(now.heading).toBe(30);
    // The elevation and the lens are the 3D camera's own, as they were.
    expect([now.elevation, now.fov]).toEqual([45, 45]);
    near(scaleOf(now, height), 0.25, 9);
    // The 2D camera is as it was left.
    expect(await camera(page)).toEqual(before2d);
    await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
    expect((await stats(page))?.perspective).not.toBeNull();
  });

  test('from 3D keeps the centre, the heading and the scale at the centre, and lets the 3D camera be', async ({
    page,
  }) => {
    const { height } = await start(page, 0);
    await dispatch(
      page,
      {
        type: 'setCamera',
        patch: {
          camera3d: {
            target: [500_020, 2_765_005, 40],
            distance: 300,
            heading: 75,
            elevation: 20,
            fov: 60,
          },
        },
      },
      { type: 'setViewMode', mode: '3d' },
    );
    const view = await camera3d(page);
    await setViewMode(page, '2d');
    const now = await camera(page);
    near(now.centre[0], 500_020);
    near(now.centre[1], 2_765_005);
    expect(now.heading).toBe(75);
    near(now.unitsPerPixel, scaleOf(view, height), 9);
    expect(await camera3d(page)).toEqual(view);
    await expect.poll(async () => (await stats(page))?.viewMode).toBe('2d');
  });

  test('there and back gives the 2D camera it started from', async ({ page }) => {
    await start(page, 123);
    const before = await camera(page);
    await setViewMode(page, '3d');
    await setViewMode(page, '2d');
    const after = await camera(page);
    near(after.centre[0], before.centre[0], 6);
    near(after.centre[1], before.centre[1], 6);
    near(after.unitsPerPixel, before.unitsPerPixel, 9);
    expect(after.heading).toBeCloseTo(before.heading, 9);
  });

  test('changes the camera before the mode, so the scene is never in 3D with a camera that was not made for it, and asking for the view it is in changes nothing', async ({
    page,
  }) => {
    await start(page, 50);
    const before = await camera3d(page);
    // '2d' while in 2D changes nothing; '3d' changes the 3D camera and then the mode; '3d' again changes nothing.
    const toThree = await recordingViewChanges(page, ['2d', '3d', '3d']);
    expect(toThree.map((record) => record.viewMode)).toEqual(['2d', '3d']);
    const [camera, mode] = toThree;
    expect(camera?.target3d).not.toEqual(before.target);
    expect(camera?.heading3d).toBe(50);
    expect(mode?.target3d).toEqual(camera?.target3d);
    // Back to 2D after the 3D camera was moved: the 2D camera changes first, while the scene is still in 3D, and then the mode.
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera3d: { target: [500_030, 2_765_020, 40], heading: 80 } },
    });
    const toTwo = await recordingViewChanges(page, ['2d']);
    expect(toTwo.map((record) => record.viewMode)).toEqual(['3d', '2d']);
    expect(toTwo[0]?.centre2d).toEqual([500_030, 2_765_020]);
    expect(toTwo[0]?.heading2d).toBe(80);
    expect(toTwo[1]?.centre2d).toEqual([500_030, 2_765_020]);
  });

  test('makes a 3D camera with no data too, and sends nothing wrong to the page', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await setViewMode(page, '3d');
    await setViewMode(page, '2d');
    await setViewMode(page, '3d');
    expect((await camera3d(page)).heading).toBe(0);
    expect(errors).toEqual([]);
  });
});
