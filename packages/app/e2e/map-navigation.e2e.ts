import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { camera, camera3d, dispatch, setViewMode, withData } from './support/render.js';

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

/** Waits for two frames, so that what a press sent to the scene has had its turn (for a press that is expected to change nothing). */
const settle = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );

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

  test('keeps the heading and the centre when it zooms a map that is turned', async ({ page }) => {
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
    // A control: in the middle of the range the same two buttons do move the scale, so that what follows is the limit and not buttons that
    // do nothing.
    await button(page, 'Zoom in').click();
    await expect.poll(async () => (await camera(page)).unitsPerPixel).toBeLessThan(2);
    await button(page, 'Zoom out').click();
    await button(page, 'Zoom out').click();
    await expect.poll(async () => (await camera(page)).unitsPerPixel).toBeGreaterThan(2);
    // The nearest is a hundred thousandth of the fit's scale, the farthest a hundred times it.
    const nearest = fitted.unitsPerPixel / 100_000;
    const farthest = fitted.unitsPerPixel * 100;
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { unitsPerPixel: farthest } } });
    await button(page, 'Zoom out').click();
    await settle(page);
    expect((await camera(page)).unitsPerPixel).toBe(farthest);
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { unitsPerPixel: nearest } } });
    await button(page, 'Zoom in').click();
    await settle(page);
    expect((await camera(page)).unitsPerPixel).toBe(nearest);
    // Nearly there, a press goes as far as the limit and no further.
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { unitsPerPixel: nearest * 1.2 } },
    });
    await button(page, 'Zoom in').click();
    await expect.poll(async () => (await camera(page)).unitsPerPixel).toBe(nearest);
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
    // Turned, it fits the data as it is turned: the heading is the person's, and the centre is the data's again from where the map was moved to.
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [1000, 2000], heading: 40 } },
    });
    await button(page, 'Fit to data').click();
    await expect.poll(async () => (await camera(page)).centre[0]).toBeCloseTo(fitted.centre[0], 6);
    const turned = await camera(page);
    expect(turned.centre[1]).toBeCloseTo(fitted.centre[1], 6);
    expect(turned.heading).toBe(40);
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

  test('has a ring of 2 pixels on the focused button, which the baselines show is not cut off', async ({
    page,
  }) => {
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

/**
 * The navigation group in 3D (step 18.8b): the same four buttons, with what they do to the 3D camera. Zoom changes the distance about the middle of the
 * map, as the keys do, and not past the limits that the last fit gives; fit puts the camera at the middle of the data and far enough for it, and keeps the
 * heading and the elevation the camera has; reset view turns north up and puts the elevation at 45 degrees, and fits.
 */
test.describe('the navigation group in 3D', () => {
  /** The middle of the data of `points.csv` (X 500010.5 to 500185.5, Y 2765020.25 to 2765205.25, Z 109.3 to 120.4), where a fit looks. */
  const MIDDLE = [500_098, 2_765_112.75, 114.85] as const;

  /** A 3D map with a camera that is easy to read, and the 2D camera as it was left, to see that it is not touched. */
  async function start3d(page: Page, heading = 0, elevation = 40) {
    await page.goto('/');
    await withData(page);
    const flat = await camera(page);
    await setViewMode(page, '3d');
    await dispatch(page, {
      type: 'setCamera',
      patch: {
        camera3d: {
          target: [500_300, 2_765_300, 150],
          distance: 500,
          heading,
          elevation,
          fov: 45,
        },
      },
    });
    return flat;
  }

  test('has the four buttons, each with its name, as in 2D', async ({ page }) => {
    await start3d(page);
    for (const name of NAMES) {
      await expect(button(page, name)).toBeVisible();
      await expect(button(page, name)).toBeEnabled();
    }
  });

  test('zooms in and out about the middle of the map, by the same factor as the keys, and keeps the target, the heading and the elevation', async ({
    page,
  }) => {
    const flat = await start3d(page, 70, 33);
    await button(page, 'Zoom in').click();
    await expect.poll(async () => (await camera3d(page)).distance).toBeCloseTo(500 / Math.SQRT2, 6);
    let now = await camera3d(page);
    expect([now.heading, now.elevation, now.fov]).toEqual([70, 33, 45]);
    for (const [axis, value] of [500_300, 2_765_300, 150].entries()) {
      expect(now.target[axis]).toBeCloseTo(value, 6);
    }
    await button(page, 'Zoom out').click();
    await button(page, 'Zoom out').click();
    await expect.poll(async () => (await camera3d(page)).distance).toBeCloseTo(500 * Math.SQRT2, 6);
    now = await camera3d(page);
    for (const [axis, value] of [500_300, 2_765_300, 150].entries()) {
      expect(now.target[axis]).toBeCloseTo(value, 6);
    }
    // The 2D camera is not what was zoomed.
    expect(await camera(page)).toEqual(flat);
  });

  test('zooms the same as the + and − keys of the map', async ({ page }) => {
    await start3d(page);
    await button(page, 'Zoom in').click();
    await expect.poll(async () => (await camera3d(page)).distance).toBeCloseTo(500 / Math.SQRT2, 6);
    const byButton = await camera3d(page);
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera3d: { target: [500_300, 2_765_300, 150], distance: 500 } },
    });
    await area(page).focus();
    await page.keyboard.press('+');
    await expect.poll(async () => (await camera3d(page)).distance).toBeCloseTo(500 / Math.SQRT2, 6);
    const byKey = await camera3d(page);
    expect(byKey.distance).toBeCloseTo(byButton.distance, 9);
    for (const axis of [0, 1, 2]) {
      expect(byKey.target[axis]).toBeCloseTo(byButton.target[axis] ?? 0, 6);
    }
  });

  test('does not go past the limits of the distance that the last fit gives, and does nothing there', async ({
    page,
  }) => {
    await start3d(page);
    await button(page, 'Fit to data').click();
    await expect.poll(async () => (await camera3d(page)).distance).not.toBe(500);
    const fitted = (await camera3d(page)).distance;
    // 100,000 times closer is the nearest, and 100 times farther the farthest (the limits the pipeline makes from a fit).
    for (let press = 0; press < 40; press += 1) {
      await button(page, 'Zoom in').click();
    }
    await expect.poll(async () => (await camera3d(page)).distance).toBeCloseTo(fitted / 100_000, 9);
    const nearest = (await camera3d(page)).distance;
    await button(page, 'Zoom in').click();
    await settle(page);
    expect((await camera3d(page)).distance).toBe(nearest);
    // From the nearest to the farthest is a factor of 10 million, which takes 47 presses of the square root of two.
    for (let press = 0; press < 50; press += 1) {
      await button(page, 'Zoom out').click();
    }
    await expect.poll(async () => (await camera3d(page)).distance).toBeCloseTo(fitted * 100, 3);
    const farthest = (await camera3d(page)).distance;
    await button(page, 'Zoom out').click();
    await settle(page);
    expect((await camera3d(page)).distance).toBe(farthest);
  });

  test('has the limits of the distance from the data when the view was switched to 3D and never fitted: the same as after Fit', async ({
    page,
  }) => {
    // Switched from 2D with no press of Fit: 40 presses of zoom in go as near as the limit lets them.
    await start3d(page);
    for (let press = 0; press < 40; press += 1) {
      await button(page, 'Zoom in').click();
    }
    await expect.poll(async () => (await camera3d(page)).distance).toBeLessThan(500 / 1000);
    const nearest = (await camera3d(page)).distance;
    // After Fit, in another page: the limit is 100,000 times closer than the distance that the fit gives, which is the same.
    await page.goto('/');
    await withData(page);
    await setViewMode(page, '3d');
    await button(page, 'Fit to data').click();
    await expect.poll(async () => (await camera3d(page)).distance).toBeGreaterThan(0);
    const fitted = (await camera3d(page)).distance;
    expect(nearest).toBeCloseTo(fitted / 100_000, 9);
  });

  test('fits the data: the camera looks at the middle of it, from far enough, with the heading and the elevation it has', async ({
    page,
  }) => {
    const flat = await start3d(page, 125, 28);
    await button(page, 'Fit to data').click();
    await expect.poll(async () => (await camera3d(page)).distance).not.toBe(500);
    const now = await camera3d(page);
    expect([now.heading, now.elevation]).toEqual([125, 28]);
    for (const [axis, value] of MIDDLE.entries()) {
      expect(now.target[axis]).toBeCloseTo(value, 2);
    }
    // The same as the key that the tooltip says, Home, does.
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera3d: { target: [500_300, 2_765_300, 150], distance: 500 } },
    });
    await area(page).focus();
    await page.keyboard.press('Home');
    await expect.poll(async () => (await camera3d(page)).distance).toBeCloseTo(now.distance, 6);
    expect(await camera(page)).toEqual(flat);
  });

  test('resets the view: north up, 45 degrees up, and the data fitted', async ({ page }) => {
    const flat = await start3d(page, 133, 12);
    await button(page, 'Reset view').click();
    await expect.poll(async () => (await camera3d(page)).heading).toBe(0);
    await expect.poll(async () => (await camera3d(page)).distance).not.toBe(500);
    const now = await camera3d(page);
    expect(now.elevation).toBe(45);
    for (const [axis, value] of MIDDLE.entries()) {
      expect(now.target[axis]).toBeCloseTo(value, 2);
    }
    // It is the fit that a button gives, from the north-up view at 45 degrees.
    await button(page, 'Fit to data').click();
    await settle(page);
    const fitted = await camera3d(page);
    expect(fitted.distance).toBeCloseTo(now.distance, 6);
    expect(await camera(page)).toEqual(flat);
  });
});
