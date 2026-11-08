import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { dispatch, withData } from './support/render.js';

const area = (page: Page): Locator => page.locator('karmania-map-area main');
const canvas = (page: Page): Locator => page.locator('karmania-map-area canvas');
const chip = (page: Page): Locator => page.locator('karmania-status-chip .status');
const scale = (page: Page): Locator => page.locator('karmania-scale-bar .scale');

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${what} is not shown.`);
  }
  return box;
}

/** A map with a camera that is easy to read: 2 units a pixel, centred on 1000, 2000, north up. */
async function start(page: Page, unitsPerPixel = 2, heading = 0) {
  await page.goto('/');
  await withData(page);
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: [1000, 2000], unitsPerPixel, heading } },
  });
  return boxOf(canvas(page), 'the map');
}

/** What the chip says of the pointer: the two numbers, or `—`. */
async function said(page: Page): Promise<string[]> {
  return (await chip(page).locator('.coordinates > span:visible').allTextContents()).map((text) =>
    text.trim(),
  );
}

/** Moves the pointer to a point of the map, in CSS pixels from its top left. */
async function pointAt(page: Page, x: number, y: number): Promise<void> {
  const box = await boxOf(canvas(page), 'the map');
  await page.mouse.move(box.x + x, box.y + y);
}

test.describe('the status chip: where the pointer is', () => {
  test('is not there with no data', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('karmania-status-chip')).toHaveCount(0);
  });

  test('is 24 high at the bottom on the left, 16 inside the edges, under the scale bar with 8 between and their left edges level', async ({
    page,
  }) => {
    await start(page);
    const [map, box, bar] = [
      await boxOf(area(page), 'the map'),
      await boxOf(chip(page), 'the chip'),
      await boxOf(scale(page), 'the scale bar'),
    ];
    expect(box.height).toBe(24);
    expect(box.x - map.x).toBe(16);
    expect(map.y + map.height - (box.y + box.height)).toBe(16);
    expect(bar.x).toBe(box.x);
    expect(box.y - (bar.y + bar.height)).toBe(8);
  });

  test('says a dash while the pointer is not on the map', async ({ page }) => {
    await start(page);
    await expect.poll(() => said(page)).toEqual(['—']);
  });

  test('says the point of the map under the pointer, as X and Y', async ({ page }) => {
    const box = await start(page);
    await pointAt(page, box.width / 2, box.height / 2);
    await expect.poll(() => said(page)).toEqual(['X', '1,000', 'Y', '2,000']);
    // 100 pixels to the right and 50 up, at 2 units a pixel.
    await pointAt(page, box.width / 2 + 100, box.height / 2 - 50);
    await expect.poll(() => said(page)).toEqual(['X', '1,200', 'Y', '2,100']);
  });

  test('has as many decimals as make the last digit about a pixel', async ({ page }) => {
    const box = await start(page, 0.01);
    await pointAt(page, box.width / 2, box.height / 2);
    await expect.poll(() => said(page)).toEqual(['X', '1,000.00', 'Y', '2,000.00']);
    await pointAt(page, box.width / 2 + 7, box.height / 2 + 3);
    await expect.poll(() => said(page)).toEqual(['X', '1,000.07', 'Y', '1,999.97']);
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { unitsPerPixel: 0.25 } } });
    await expect.poll(() => said(page)).toEqual(['X', '1,001.8', 'Y', '1,999.3']);
  });

  test('follows the heading of the map', async ({ page }) => {
    const box = await start(page, 2, 90);
    // East is at the top: 100 pixels to the right is 200 units south.
    await pointAt(page, box.width / 2 + 100, box.height / 2);
    await expect.poll(() => said(page)).toEqual(['X', '1,000', 'Y', '1,800']);
  });

  test('keeps the room of the longest coordinate, so that it does not change as the pointer moves', async ({
    page,
  }) => {
    const box = await start(page);
    const widths = new Set<number>();
    widths.add((await boxOf(chip(page), 'the chip')).width);
    // The four corners (a few pixels in from the right, where the panel's resize handle reaches over the map) and the middle.
    for (const [x, y] of [
      [0, 0],
      [box.width - 8, 0],
      [0, box.height - 1],
      [box.width - 8, box.height - 1],
      [box.width / 2, box.height / 2],
    ]) {
      await pointAt(page, x ?? 0, y ?? 0);
      await expect.poll(async () => (await said(page))[0]).toBe('X');
      widths.add((await boxOf(chip(page), 'the chip')).width);
      // Each number is in the room that was kept for it: none runs over into what is next to it.
      const overflowing = await chip(page).evaluate(
        (element) =>
          [...element.querySelectorAll('.value')].filter(
            (value) => value.scrollWidth > value.clientWidth,
          ).length,
      );
      expect(overflowing, `at ${String(x)}, ${String(y)}`).toBe(0);
    }
    // Off the map: the dash has the same room.
    await page.mouse.move(2, 2);
    await expect.poll(() => said(page)).toEqual(['—']);
    widths.add((await boxOf(chip(page), 'the chip')).width);
    expect([...widths]).toHaveLength(1);
  });

  test('is in the caption size with tabular numbers, with the numbers on the right', async ({
    page,
  }) => {
    const box = await start(page);
    await pointAt(page, box.width / 2, box.height / 2);
    const look = await chip(page).evaluate((element) => {
      const style = getComputedStyle(element);
      const value = getComputedStyle(element.querySelector('.value') as Element);
      return { size: style.fontSize, numbers: style.fontVariantNumeric, align: value.textAlign };
    });
    expect(look).toEqual({ size: '12px', numbers: 'tabular-nums', align: 'right' });
  });

  test('goes back to the dash when the pointer leaves the map for the panel', async ({ page }) => {
    const box = await start(page);
    await pointAt(page, box.width / 2, box.height / 2);
    await expect.poll(() => said(page)).toEqual(['X', '1,000', 'Y', '2,000']);
    const panel = await boxOf(page.locator('karmania-panel'), 'the panel');
    await page.mouse.move(panel.x + 20, panel.y + 100);
    await expect.poll(() => said(page)).toEqual(['—']);
  });

  test('is still on the map over what is laid over it', async ({ page }) => {
    await start(page);
    const arrow = await boxOf(page.locator('karmania-north-arrow'), 'the north arrow');
    await page.mouse.move(arrow.x + 20, arrow.y + 20);
    await expect.poll(async () => (await said(page))[0]).toBe('X');
  });

  test('follows the map when it moves under a pointer that is still', async ({ page }) => {
    const box = await start(page);
    await pointAt(page, box.width / 2, box.height / 2);
    await expect.poll(() => said(page)).toEqual(['X', '1,000', 'Y', '2,000']);
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { centre: [1100, 2300] } } });
    await expect.poll(() => said(page)).toEqual(['X', '1,100', 'Y', '2,300']);
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { unitsPerPixel: 4 } } });
    await expect.poll(() => said(page)).toEqual(['X', '1,100', 'Y', '2,300']);
  });

  test('keeps the point under the pointer while the map is dragged', async ({ page }) => {
    const box = await start(page);
    await pointAt(page, box.width / 2, box.height / 2);
    await expect.poll(() => said(page)).toEqual(['X', '1,000', 'Y', '2,000']);
    const here = await boxOf(canvas(page), 'the map');
    await page.mouse.down();
    await page.mouse.move(here.x + box.width / 2 + 60, here.y + box.height / 2 + 40, { steps: 5 });
    // The map followed the pointer, so what is under it is what was under it.
    await expect.poll(() => said(page)).toEqual(['X', '1,000', 'Y', '2,000']);
    await page.mouse.up();
  });

  test('says a dash in the 3D view, and the numbers again in the 2D', async ({ page }) => {
    const box = await start(page);
    await pointAt(page, box.width / 2, box.height / 2);
    await expect.poll(() => said(page)).toEqual(['X', '1,000', 'Y', '2,000']);
    await dispatch(page, { type: 'setViewMode', mode: '3d' });
    await expect.poll(() => said(page)).toEqual(['—']);
    await dispatch(page, { type: 'setViewMode', mode: '2d' });
    await expect.poll(() => said(page)).toEqual(['X', '1,000', 'Y', '2,000']);
  });

  test('is a group with a name, and takes nothing from the pointer: a drag that begins on it pans the map', async ({
    page,
  }) => {
    await start(page);
    await expect(chip(page)).toHaveAttribute('role', 'group');
    await expect(chip(page)).toHaveAccessibleName('Pointer position');
    const box = await boxOf(chip(page), 'the chip');
    const before = await page.evaluate(() => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        scene(): { camera2d: { centre: number[] } };
      };
      return [...viewer.scene().camera2d.centre];
    });
    await page.mouse.move(box.x + 10, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 70, box.y + 12, { steps: 4 });
    await page.mouse.up();
    const after = await page.evaluate(() => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        scene(): { camera2d: { centre: number[] } };
      };
      return [...viewer.scene().camera2d.centre];
    });
    expect(after[0]).toBeLessThan(before[0] ?? 0);
  });
});
