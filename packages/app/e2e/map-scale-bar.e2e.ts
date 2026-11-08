import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { camera, dispatch, expectLayersDrawn, sceneFrame, withData } from './support/render.js';
import { importAsLocalGrid } from './support/wizard.js';

const area = (page: Page): Locator => page.locator('karmania-map-area main');
const scale = (page: Page): Locator => page.locator('karmania-scale-bar .scale');
const bar = (page: Page): Locator => page.locator('karmania-scale-bar .bar');

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${what} is not shown.`);
  }
  return box;
}

const zoom = (page: Page, unitsPerPixel: number): Promise<void> =>
  dispatch(page, { type: 'setCamera', patch: { camera2d: { unitsPerPixel } } });

/** The text of the bar's label, and how wide the bar is (the box of its line, ticks included). */
async function shown(page: Page): Promise<{ label: string; width: number }> {
  const label = (await scale(page).locator('span').last().textContent())?.trim() ?? '';
  return { label, width: (await boxOf(bar(page), 'the bar')).width };
}

test.describe('the scale bar', () => {
  test('is not there with no data', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('karmania-scale-bar')).toHaveCount(0);
  });

  test('is 24 high, on the left, 16 inside the edge, above the status chip', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    const [map, box] = [await boxOf(area(page), 'the map'), await boxOf(scale(page), 'the bar')];
    expect(box.height).toBe(24);
    expect(box.x - map.x).toBe(16);
    // The status chip is under it, 8 below (map-status.e2e.ts has the chip's own place).
    const under = await boxOf(page.locator('karmania-status-chip .status'), 'the chip');
    expect(under.y - (box.y + box.height)).toBe(8);
  });

  test('is a nice length in metres and kilometres, as wide as the map says it is', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    // The points are in UTM zone 40N, in metres. At a metre a pixel the room is 160 m, and the nice length at most that is 100.
    for (const [unitsPerPixel, label, width] of [
      [1, '100 m', 100],
      [0.1, '10 m', 100],
      [0.3, '20 m', 67],
      [2, '200 m', 100],
      [5, '500 m', 100],
      [10, '1 km', 100],
      [25, '2 km', 80],
      [0.003, '0.2 m', 67],
    ] as const) {
      await zoom(page, unitsPerPixel);
      await expect
        .poll(() => shown(page), `${String(unitsPerPixel)} m a pixel`)
        .toEqual({
          label,
          width,
        });
    }
  });

  test('is never wider than 160 pixels, and is as wide as its length is at the scale', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    for (const unitsPerPixel of [0.07, 0.8, 1.7, 3.3, 9, 14, 99, 180, 4000]) {
      await zoom(page, unitsPerPixel);
      await expect.poll(async () => (await boxOf(bar(page), 'the bar')).width).toBeGreaterThan(0);
      const { label, width } = await shown(page);
      const [number, unit] = label.replaceAll(',', '').split(' ');
      const metres = Number(number) * (unit === 'km' ? 1000 : 1);
      expect(width, `${label} at ${String(unitsPerPixel)}`).toBeLessThanOrEqual(160);
      // The bar is a whole number of pixels: within half of one of its length.
      expect(Math.abs(width - metres / unitsPerPixel), label).toBeLessThanOrEqual(0.5);
    }
  });

  test('has a tick at each end, and its label in the caption size with tabular numbers', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await zoom(page, 1);
    await expect(bar(page)).toBeVisible();
    const look = await bar(page).evaluate((element) => {
      const style = getComputedStyle(element);
      const label = getComputedStyle(element.nextElementSibling as Element);
      return {
        left: style.borderLeftWidth,
        right: style.borderRightWidth,
        bottom: style.borderBottomWidth,
        top: style.borderTopWidth,
        size: label.fontSize,
        numbers: label.fontVariantNumeric,
      };
    });
    expect(look).toEqual({
      left: '1px',
      right: '1px',
      bottom: '1px',
      top: '0px',
      size: '12px',
      numbers: 'tabular-nums',
    });
  });

  test('is a picture with a name that says what it measures', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await zoom(page, 1);
    await expect(page.getByRole('img', { name: 'Scale bar, 100 m' })).toBeVisible();
    await zoom(page, 10);
    await expect(page.getByRole('img', { name: 'Scale bar, 1 km' })).toBeVisible();
  });

  test('is for the map and not the pointer: a drag that begins on it pans the map', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await zoom(page, 1);
    const before = await camera(page);
    const box = await boxOf(scale(page), 'the bar');
    await page.mouse.move(box.x + 10, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 12, { steps: 4 });
    await page.mouse.up();
    // The map followed the pointer to the right, which takes the centre to the left.
    expect((await camera(page)).centre[0]).toBeLessThan(before.centre[0]);
  });

  test('does not change when the map is only moved, and does when it is zoomed', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await zoom(page, 1);
    const before = await shown(page);
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { centre: [1, 1] } } });
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { heading: 40 } } });
    expect(await shown(page)).toEqual(before);
    await zoom(page, 4);
    await expect.poll(() => shown(page)).toEqual({ label: '500 m', width: 125 });
  });

  test('is in feet and miles for a local grid in feet', async ({ page }) => {
    await page.goto('/');
    await importAsLocalGrid(page, 'ft', 'points.csv');
    await expectLayersDrawn(page, 1);
    for (const [unitsPerPixel, label, width] of [
      [1, '100 ft', 100],
      [3, '200 ft', 67],
      // 160 pixels of 100 feet are 16,000 feet, which is above a mile (5,280): the nice length at most that many miles is 2.
      [100, '2 mi', 106],
    ] as const) {
      await zoom(page, unitsPerPixel);
      await expect
        .poll(() => shown(page), `${String(unitsPerPixel)} ft a pixel`)
        .toEqual({
          label,
          width,
        });
    }
  });

  test('is in feet and miles for US survey feet too', async ({ page }) => {
    await page.goto('/');
    await importAsLocalGrid(page, 'us_ft', 'points.csv');
    await expectLayersDrawn(page, 1);
    await zoom(page, 1);
    await expect.poll(() => shown(page)).toEqual({ label: '100 ft', width: 100 });
    await zoom(page, 100);
    await expect.poll(() => shown(page)).toEqual({ label: '2 mi', width: 106 });
  });

  test('is not there for a map in degrees, which has no length to measure', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await zoom(page, 1);
    await expect(scale(page)).toBeVisible();
    // The person chooses WGS 84, which the engine can draw the points in: the map is in degrees.
    await dispatch(page, {
      type: 'setFrame',
      frame: { mapCrs: { kind: 'epsg', code: 4326 }, origin: [0, 0, 0], source: 'user' },
    });
    await expect
      .poll(async () => (await sceneFrame(page))?.mapCrs)
      .toEqual({ kind: 'epsg', code: 4326 });
    await expect(scale(page)).toHaveCount(0);
    // And it is back when the map is in metres again.
    await dispatch(page, {
      type: 'setFrame',
      frame: { mapCrs: { kind: 'epsg', code: 32640 }, origin: [0, 0, 0], source: 'user' },
    });
    await expect
      .poll(async () => (await sceneFrame(page))?.mapCrs)
      .toEqual({ kind: 'epsg', code: 32640 });
    await zoom(page, 1);
    await expect(scale(page)).toBeVisible();
  });

  test('is not there in the 3D view, and is back in the 2D', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await zoom(page, 1);
    await expect(scale(page)).toBeVisible();
    await dispatch(page, { type: 'setViewMode', mode: '3d' });
    await expect(scale(page)).toHaveCount(0);
    await dispatch(page, { type: 'setViewMode', mode: '2d' });
    await expect(scale(page)).toBeVisible();
  });
});
