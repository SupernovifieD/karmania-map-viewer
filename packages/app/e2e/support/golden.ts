/**
 * What the render golden images share (section 10.8 of the phase 2 brief): a map canvas of exactly 800 by 600 CSS pixels, taken in the
 * browser of the Docker image in both themes, one picture for each case. They are not the screenshots of the layout of the app: they are
 * of the canvas alone, and are named `render-<case>-<theme>.png`.
 */
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { camera, camera3d, dispatch, drawn, layerStatuses } from './render.js';

/** The size of the map canvas of every golden image, in CSS pixels. */
export const GOLDEN_SIZE = { width: 800, height: 600 } as const;

/** The themes the pictures are taken in. */
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Makes the window the size that leaves the map area exactly `GOLDEN_SIZE`: the rest of the app takes what it takes. */
export async function sizeMap(page: Page): Promise<void> {
  const area = page.locator('karmania-map-area');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const box = await area.boundingBox();
    const window = page.viewportSize();
    if (box === null || window === null) {
      throw new Error('The map is not shown.');
    }
    if (
      Math.abs(box.width - GOLDEN_SIZE.width) < 0.01 &&
      Math.abs(box.height - GOLDEN_SIZE.height) < 0.01
    ) {
      return;
    }
    await page.setViewportSize({
      width: window.width + GOLDEN_SIZE.width - Math.round(box.width),
      height: window.height + GOLDEN_SIZE.height - Math.round(box.height),
    });
    await page.waitForTimeout(250);
  }
  throw new Error('The map area could not be made 800 by 600.');
}

/** Waits for every layer to be drawn, and for the camera to be where it was put. */
export async function settled(page: Page, layers: number): Promise<void> {
  await drawn(page);
  await expect
    .poll(async () => (await layerStatuses(page)).filter(([, status]) => status === 'drawn').length)
    .toBe(layers);
}

/** Looks at `centre` at `scale` map units a pixel, turned `heading` degrees, and waits for the camera to be there. */
export async function lookAt(
  page: Page,
  centre: readonly [number, number],
  scale: number,
  heading = 0,
): Promise<void> {
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre, unitsPerPixel: scale, heading } },
  });
  await expect
    .poll(async () => {
      const now = await camera(page);
      return Math.abs(now.unitsPerPixel - scale) / scale + Math.abs(now.heading - heading);
    })
    .toBeLessThan(1e-9);
  await drawn(page);
}

/**
 * Looks in 3D at `target` (map units, with its height) from `distance` away, `heading` degrees clockwise from north and `elevation` degrees above
 * the horizon, with the lens of the scene, and waits for the camera to be there and a frame to be drawn.
 */
export async function lookFrom(
  page: Page,
  target: readonly [number, number, number],
  distance: number,
  heading: number,
  elevation: number,
  exaggeration: 1 | 2 | 3 | 5 | 10 = 1,
): Promise<void> {
  await dispatch(
    page,
    { type: 'setVerticalExaggeration', factor: exaggeration },
    {
      type: 'setCamera',
      patch: { camera3d: { target: [...target], distance, heading, elevation, fov: 45 } },
    },
    { type: 'setViewMode', mode: '3d' },
  );
  await expect
    .poll(async () => {
      const now = await camera3d(page);
      return Math.abs(now.distance - distance) / distance + Math.abs(now.heading - heading);
    })
    .toBeLessThan(1e-9);
  await drawn(page);
}

/** The picture of the canvas, which has to be the golden image of `name` in `theme` to the pixel. */
export async function expectGolden(page: Page, name: string, theme: Theme): Promise<void> {
  // Only the map is photographed: what the area puts over it (its words when there is nothing to show, its notices, its furniture) is not the render's.
  await page
    .locator('karmania-map-area :is(k-empty-state, .notice, .drop-zone, .furniture)')
    .evaluateAll((elements) => {
      for (const element of elements) {
        (element as HTMLElement).style.visibility = 'hidden';
      }
    });
  const canvas = page.locator('karmania-map-area canvas');
  const box = await canvas.boundingBox();
  expect([box?.width, box?.height], 'the canvas is the size of every golden image').toEqual([
    GOLDEN_SIZE.width,
    GOLDEN_SIZE.height,
  ]);
  await expect(canvas).toHaveScreenshot(`render-${name}-${theme}.png`, {
    // A difference is a failure, however small (10.8): no colour tolerance and no pixel that may differ.
    threshold: 0,
    maxDiffPixels: 0,
  });
}
