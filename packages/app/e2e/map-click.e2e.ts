/**
 * Selecting by clicking the map (step 21.3a): a click, a press and release in one place on the map, picks what is there and makes it the scene's
 * selection, and a click on the empty map clears it. A drag moves the map and a click on a control does the control's work; neither selects.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixturePath } from './support/picker.js';
import { camera, dispatch, drawn, selection, stats, withData } from './support/render.js';

/** The points of `points.csv`: easting and northing, in the order of the file (element 0 first). */
const POINTS = readFileSync(fixturePath('points.csv'), 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => line.split(',').slice(0, 2).map(Number) as [number, number]);

/** Puts the camera on point `index`, 1 metre a pixel, so that it is in the middle of the map, and gives where that is on the page. */
async function centreOn(page: Page, index: number): Promise<{ x: number; y: number }> {
  const at = POINTS[index] as [number, number];
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: [at[0], at[1]], unitsPerPixel: 1, heading: 0 } },
  });
  await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - 1))
    .toBeLessThan(1e-9);
  const box = await page.locator('karmania-map-area canvas').boundingBox();
  if (box === null) throw new Error('The map is not on the page.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('clicking the map', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    await withData(page);
  });

  test('selects the element under the pointer, and selects another when another is clicked', async ({
    page,
  }) => {
    expect(await selection(page)).toBeNull();
    const here = await centreOn(page, 2);
    await page.mouse.click(here.x, here.y);
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 2 });
    const there = await centreOn(page, 5);
    await page.mouse.click(there.x, there.y);
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 5 });
  });

  test('clears the selection when the empty map is clicked', async ({ page }) => {
    const here = await centreOn(page, 2);
    await page.mouse.click(here.x, here.y);
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 2 });
    // (The empty map up and to the left: the popover of the point is to the right of it and below.)
    await page.mouse.click(here.x - 80, here.y - 60);
    await expect.poll(() => selection(page)).toBeNull();
  });

  test('is not a click when the pointer moves between pressing and letting go: that is a drag, which moves the map and keeps the selection', async ({
    page,
  }) => {
    const here = await centreOn(page, 2);
    await page.mouse.click(here.x, here.y);
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 2 });
    const before = await camera(page);
    await page.mouse.move(here.x - 100, here.y - 100);
    await page.mouse.down();
    await page.mouse.move(here.x - 60, here.y - 100, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await camera(page)).centre[0]).not.toBe(before.centre[0]);
    expect(await selection(page)).toEqual({ layerId: 'layer-1', element: 2 });
    // And a drag that starts on a point does not select it.
    const other = await centreOn(page, 5);
    await dispatch(page, { type: 'setSelection', selection: null });
    await page.mouse.move(other.x, other.y);
    await page.mouse.down();
    await page.mouse.move(other.x + 30, other.y, { steps: 5 });
    await page.mouse.up();
    expect(await selection(page)).toBeNull();
  });

  test('is only the primary button: the others do not select', async ({ page }) => {
    const here = await centreOn(page, 2);
    await page.mouse.click(here.x, here.y, { button: 'right' });
    await page.mouse.click(here.x, here.y, { button: 'middle' });
    expect(await selection(page)).toBeNull();
    await page.mouse.click(here.x, here.y);
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 2 });
  });

  test('is not a click of the map when it is of a control laid over it: the buttons of the navigation group do their work and keep the selection', async ({
    page,
  }) => {
    const here = await centreOn(page, 2);
    await page.mouse.click(here.x, here.y);
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 2 });
    const before = await camera(page);
    await page.locator('karmania-nav-group button').first().click();
    await expect
      .poll(async () => (await camera(page)).unitsPerPixel)
      .not.toBe(before.unitsPerPixel);
    expect(await selection(page)).toEqual({ layerId: 'layer-1', element: 2 });
  });

  test('picks in 3D too: the element at the middle of the map, where the camera looks', async ({
    page,
  }) => {
    // The points have heights (the RL column of the file): the fourth is at 115 metres, and the camera looks at it there. (The scene's own command for the
    // view keeps the camera that is given with it; the viewer's `setViewMode` makes a 3D camera from the 2D one.)
    const at = POINTS[3] as [number, number];
    await dispatch(
      page,
      {
        type: 'setCamera',
        patch: {
          camera3d: {
            target: [at[0], at[1], 115],
            distance: 200,
            heading: 0,
            elevation: 60,
            fov: 45,
          },
        },
      },
      { type: 'setViewMode', mode: '3d' },
    );
    await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
    await drawn(page);
    const box = await page.locator('karmania-map-area canvas').boundingBox();
    if (box === null) throw new Error('The map is not on the page.');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 3 });
  });
});
