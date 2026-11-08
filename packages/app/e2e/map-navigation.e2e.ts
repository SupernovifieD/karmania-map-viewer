import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { camera, dispatch, withData } from './support/render.js';

const area = (page: Page): Locator => page.locator('karmania-map-area main');
const group = (page: Page): Locator => page.locator('karmania-nav-group .group');
const button = (page: Page, name: string): Locator =>
  page.locator('karmania-nav-group').getByRole('button', { name, exact: true });

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${what} is not shown.`);
  }
  return box;
}

const NAMES = ['Zoom in', 'Zoom out', 'Fit to data', 'Reset view'] as const;

/** A map with a camera that is easy to read, and the one the pipeline fitted, to compare Fit with. */
async function start(page: Page) {
  await page.goto('/');
  await withData(page);
  const fitted = await camera(page);
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: [1000, 2000], unitsPerPixel: 2, heading: 0 } },
  });
  return fitted;
}

test.describe('the navigation group', () => {
  test('is not there with no data', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('karmania-nav-group')).toHaveCount(0);
  });

  test('is at the bottom on the right, 16 inside the edges, with four buttons of 32 by 32, 4 apart, in a box with 4 of padding', async ({
    page,
  }) => {
    await start(page);
    const [map, box] = [await boxOf(area(page), 'the map'), await boxOf(group(page), 'the group')];
    // 4 buttons of 32, 3 gaps of 4, 4 of padding and a border on each side.
    expect([box.width, box.height]).toEqual([32 + 8 + 2, 4 * 32 + 3 * 4 + 8 + 2]);
    expect(map.x + map.width - (box.x + box.width)).toBe(16);
    expect(map.y + map.height - (box.y + box.height)).toBe(16);
    const boxes = await Promise.all(NAMES.map((name) => boxOf(button(page, name), name)));
    boxes.forEach((each, index) => {
      const name = NAMES[index];
      expect([each.width, each.height], name).toEqual([32, 32]);
      // A border and 4 of padding from the left of the box; the first 5 from its top, and the others 4 under the one before.
      expect(each.x - box.x, name).toBe(5);
      const before = boxes[index - 1];
      expect(each.y, name).toBe(before === undefined ? box.y + 5 : before.y + 32 + 4);
    });
  });

  test('has the four buttons in the order of the brief, each with its name', async ({ page }) => {
    await start(page);
    await expect(group(page)).toHaveAccessibleName('Map navigation');
    const names = await group(page)
      .getByRole('button')
      .evaluateAll((all) => all.map((each) => each.getAttribute('aria-label')));
    expect(names).toEqual([...NAMES]);
    const tops = await Promise.all(
      NAMES.map(async (name) => (await boxOf(button(page, name), name)).y),
    );
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });

  test('zooms in and out about the middle of the map, by the same factor as the keys', async ({
    page,
  }) => {
    await start(page);
    await button(page, 'Zoom in').click();
    await expect
      .poll(async () => (await camera(page)).unitsPerPixel)
      .toBeCloseTo(2 / Math.SQRT2, 9);
    let now = await camera(page);
    expect(now.centre[0]).toBeCloseTo(1000, 6);
    expect(now.centre[1]).toBeCloseTo(2000, 6);
    expect(now.heading).toBe(0);
    await button(page, 'Zoom in').click();
    await expect.poll(async () => (await camera(page)).unitsPerPixel).toBeCloseTo(1, 9);
    await button(page, 'Zoom out').click();
    await button(page, 'Zoom out').click();
    await button(page, 'Zoom out').click();
    await expect
      .poll(async () => (await camera(page)).unitsPerPixel)
      .toBeCloseTo(2 * Math.SQRT2, 9);
    now = await camera(page);
    expect(now.centre[0]).toBeCloseTo(1000, 6);
    expect(now.centre[1]).toBeCloseTo(2000, 6);
  });

  test('zooms the same as the + and − keys of the map', async ({ page }) => {
    await start(page);
    await button(page, 'Zoom in').click();
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(2);
    const byButton = await camera(page);
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [1000, 2000], unitsPerPixel: 2, heading: 0 } },
    });
    await area(page).focus();
    await page.keyboard.press('+');
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(2);
    expect(await camera(page)).toEqual(byButton);
  });

  test('keeps the heading when it zooms, and turns about the middle', async ({ page }) => {
    await start(page);
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [1000, 2000], unitsPerPixel: 2, heading: 40 } },
    });
    await button(page, 'Zoom out').click();
    await expect
      .poll(async () => (await camera(page)).unitsPerPixel)
      .toBeCloseTo(2 * Math.SQRT2, 9);
    const now = await camera(page);
    expect(now.heading).toBe(40);
    expect(now.centre[0]).toBeCloseTo(1000, 6);
    expect(now.centre[1]).toBeCloseTo(2000, 6);
  });

  test('does not go past the limits of the scale, and does nothing there', async ({ page }) => {
    const fitted = await start(page);
    // The nearest is a hundred thousandth of the fit's scale, the farthest a hundred times it.
    const nearest = fitted.unitsPerPixel / 100_000;
    const farthest = fitted.unitsPerPixel * 100;
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { unitsPerPixel: nearest } } });
    await button(page, 'Zoom in').click();
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { unitsPerPixel: farthest } } });
    await button(page, 'Zoom out').click();
    expect((await camera(page)).unitsPerPixel).toBe(farthest);
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { unitsPerPixel: nearest } } });
    await button(page, 'Zoom in').click();
    expect((await camera(page)).unitsPerPixel).toBe(nearest);
  });

  test('fits the data, with the heading the map has', async ({ page }) => {
    const fitted = await start(page);
    await button(page, 'Fit to data').click();
    await expect
      .poll(async () => (await camera(page)).unitsPerPixel)
      .toBeCloseTo(fitted.unitsPerPixel, 9);
    const now = await camera(page);
    expect(now.centre[0]).toBeCloseTo(fitted.centre[0], 6);
    expect(now.centre[1]).toBeCloseTo(fitted.centre[1], 6);
    expect(now.heading).toBe(0);
    // Turned, it fits the data as it is turned: the heading is the person's.
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { heading: 40 } } });
    await button(page, 'Fit to data').click();
    await expect.poll(async () => (await camera(page)).centre[0]).not.toBe(1000);
    expect((await camera(page)).heading).toBe(40);
  });

  test('resets the view: north up, and the data fitted as at the start', async ({ page }) => {
    const fitted = await start(page);
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [5, 5], unitsPerPixel: 9, heading: 133 } },
    });
    await button(page, 'Reset view').click();
    await expect.poll(async () => (await camera(page)).heading).toBe(0);
    await expect
      .poll(async () => (await camera(page)).unitsPerPixel)
      .toBeCloseTo(fitted.unitsPerPixel, 9);
    const now = await camera(page);
    expect(now.centre[0]).toBeCloseTo(fitted.centre[0], 6);
    expect(now.centre[1]).toBeCloseTo(fitted.centre[1], 6);
  });

  test('is reached with Tab after the north arrow, in order, and works with Enter and Space', async ({
    page,
  }) => {
    await start(page);
    await page.locator('karmania-north-arrow').getByRole('button').focus();
    for (const name of NAMES) {
      await page.keyboard.press('Tab');
      await expect(button(page, name)).toBeFocused();
    }
    await button(page, 'Zoom in').focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await camera(page)).unitsPerPixel)
      .toBeCloseTo(2 / Math.SQRT2, 9);
    await button(page, 'Zoom out').focus();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await camera(page)).unitsPerPixel).toBeCloseTo(2, 9);
  });

  test('says the key that does the same in its tooltip, and tells the control what it says', async ({
    page,
  }) => {
    await start(page);
    await area(page).focus();
    // Tab to the first of the group: the north arrow comes first.
    await page.keyboard.press('Tab');
    const tips = [
      ['Zoom in', 'Zoom in (+)'],
      ['Zoom out', 'Zoom out (−)'],
      ['Fit to data', 'Fit to data (Home)'],
      ['Reset view', 'Reset view: north up, data fitted'],
    ] as const;
    for (const [index, [name, tip]] of tips.entries()) {
      await page.keyboard.press('Tab');
      await expect(button(page, name)).toBeFocused();
      await expect(page.locator(`karmania-nav-group k-tooltip[text="${tip}"] .tip`)).toBeVisible();
      // The tooltip tells its control what it says (the control is the `k-button`, as everywhere in the app): the keys are for screen readers
      // in the description of the map itself (step 17.7).
      await expect(
        page.locator('karmania-nav-group k-tooltip').nth(index).locator('k-button'),
      ).toHaveAttribute('aria-description', tip);
    }
  });

  test('has a ring on the focused button that is not cut off', async ({ page }) => {
    await start(page);
    await button(page, 'Fit to data').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(button(page, 'Fit to data')).toBeFocused();
    const ring = await button(page, 'Fit to data').evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(ring).toEqual({ width: '2px', style: 'solid' });
  });

  test('is not the map: pressing a button and dragging does not drag the map', async ({ page }) => {
    await start(page);
    const before = await camera(page);
    const box = await boxOf(button(page, 'Zoom in'), 'the button');
    await page.mouse.move(box.x + 16, box.y + 16);
    await page.mouse.down();
    await page.mouse.move(box.x - 150, box.y - 60, { steps: 4 });
    await page.mouse.up();
    expect(await camera(page)).toEqual(before);
  });
});
