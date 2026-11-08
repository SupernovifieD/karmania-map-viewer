import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { camera, dispatch, expectLayersDrawn, sceneFrame, withData } from './support/render.js';
import { importAsLocalGrid } from './support/wizard.js';

const chip = (page: Page): Locator => page.locator('karmania-status-chip .status');
const button = (page: Page): Locator => page.locator('karmania-status-chip button.crs');

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${what} is not shown.`);
  }
  return box;
}

/** Counts the times the chip asks for the map's coordinate system to be changed, from now on. */
async function listenForRequests(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const target = window as unknown as { requests: number };
    target.requests = 0;
    document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer')
      ?.shadowRoot?.querySelector('karmania-map-area')
      ?.addEventListener('karmania-map-crs-request', () => {
        target.requests += 1;
      });
  });
  return () => page.evaluate(() => (window as unknown as { requests: number }).requests);
}

test.describe('the status chip: the map’s coordinate system', () => {
  test('is a button after a separator, with the code on it', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await expect(button(page)).toHaveText('EPSG:32640');
    await expect(chip(page).locator('.separator')).toBeVisible();
    const [separator, crs, coordinates] = [
      await boxOf(chip(page).locator('.separator'), 'the separator'),
      await boxOf(button(page), 'the button'),
      await boxOf(chip(page).locator('.coordinates'), 'the coordinates'),
    ];
    // The coordinates, then the separator, then the button, in a row, 8 apart.
    expect(separator.x - (coordinates.x + coordinates.width)).toBe(8);
    expect(crs.x - (separator.x + separator.width)).toBeGreaterThanOrEqual(8);
    expect(separator.width).toBe(1);
  });

  test('has the name of the system in its tooltip, and as its description', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await expect(button(page)).toHaveAccessibleName('Map coordinate system: EPSG:32640');
    await expect
      .poll(async () => button(page).getAttribute('aria-description'))
      .toBe('EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres)');
    await expect(button(page)).toHaveAccessibleDescription(
      'EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres)',
    );
    await button(page).hover();
    await expect(page.locator('karmania-status-chip k-tooltip .tip')).toBeVisible();
    await expect(page.locator('karmania-status-chip k-tooltip .tip')).toHaveText(
      'EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres)',
    );
    // The whole of the name is inside the tooltip's box (the chip does not wrap, and the tooltip is inside it).
    const runsOut = await page
      .locator('karmania-status-chip k-tooltip .tip')
      .evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(runsOut).toBe(false);
  });

  test('says a local grid with its units, in feet and in US survey feet too', async ({ page }) => {
    for (const [units, label, title] of [
      ['m', 'Local grid, m', 'A local grid, in metres'],
      ['ft', 'Local grid, ft', 'A local grid, in feet'],
      ['us_ft', 'Local grid, US ft', 'A local grid, in US survey feet'],
    ] as const) {
      await page.goto('/');
      await importAsLocalGrid(page, units, 'points.csv');
      await expectLayersDrawn(page, 1);
      await expect(button(page), units).toHaveText(label);
      await expect(button(page), units).toHaveAccessibleName(`Map coordinate system: ${label}`);
      await expect(button(page), units).toHaveAccessibleDescription(title);
    }
  });

  test('follows the map’s coordinate system when it is changed, and the name comes with it', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await dispatch(page, {
      type: 'setFrame',
      frame: { mapCrs: { kind: 'epsg', code: 4326 }, origin: [0, 0, 0], source: 'user' },
    });
    await expect
      .poll(async () => (await sceneFrame(page))?.mapCrs)
      .toEqual({
        kind: 'epsg',
        code: 4326,
      });
    await expect(button(page)).toHaveText('EPSG:4326');
    await expect(button(page)).toHaveAccessibleDescription(
      'EPSG 4326, WGS 84 (longitude and latitude, in degrees)',
    );
  });

  test('says that the code is not one of the definitions’ when it is not', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    // A system the person chose, which the definitions do not have: nothing can be drawn in it, and the chip still names it.
    await dispatch(page, {
      type: 'setFrame',
      frame: { mapCrs: { kind: 'epsg', code: 999_999 }, origin: [0, 0, 0], source: 'user' },
    });
    await expect(button(page)).toHaveText('EPSG:999999');
    await expect(button(page)).toHaveAccessibleDescription(
      'EPSG 999999, which is not one of the coordinate systems Karmania knows',
    );
  });

  test('asks for the coordinate system to be changed when it is pressed, with the mouse and the keyboard', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    const requests = await listenForRequests(page);
    await button(page).click();
    expect(await requests()).toBe(1);
    // The request opens the dialog (step 17.5c), which has the keyboard: Esc closes it, and the keyboard is on the button again.
    await page.keyboard.press('Escape');
    await expect(button(page)).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await requests()).toBe(2);
    await page.keyboard.press('Escape');
    await expect(button(page)).toBeFocused();
    await page.keyboard.press('Space');
    expect(await requests()).toBe(3);
  });

  test('does not move as the pointer moves over the map', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    const before = await boxOf(button(page), 'the button');
    const map = await boxOf(page.locator('karmania-map-area canvas'), 'the map');
    for (const [x, y] of [
      [20, 20],
      [map.width / 2, map.height / 2],
      [map.width - 20, map.height - 20],
    ] as const) {
      await page.mouse.move(map.x + x, map.y + y);
      await expect
        .poll(async () => (await chip(page).locator('.value').first().textContent())?.trim())
        .not.toBe('');
      expect(await boxOf(button(page), 'the button')).toEqual(before);
    }
  });

  test('is the last stop of the keyboard on the map, after the navigation group, with a ring inside it', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await page
      .locator('karmania-nav-group')
      .getByRole('button', { name: 'Reset view', exact: true })
      .focus();
    await page.keyboard.press('Tab');
    await expect(button(page)).toBeFocused();
    const ring = await button(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle, offset: style.outlineOffset };
    });
    expect(ring).toEqual({ width: '2px', style: 'solid', offset: '-2px' });
    await expect(page.locator('karmania-status-chip k-tooltip .tip')).toBeVisible();
  });

  test('is for the pointer, and pressing it does not move the map', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    const before = await camera(page);
    const box = await boxOf(button(page), 'the button');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(await camera(page)).toEqual(before);
  });

  test('is 24 high with the button inside it, and shows in the dark theme as well', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await withData(page);
    const [chipBox, crs] = [
      await boxOf(chip(page), 'the chip'),
      await boxOf(button(page), 'the button'),
    ];
    expect(chipBox.height).toBe(24);
    expect(crs.height).toBe(20);
    expect(crs.y).toBeGreaterThanOrEqual(chipBox.y);
    expect(crs.y + crs.height).toBeLessThanOrEqual(chipBox.y + chipBox.height);
    await expect(button(page)).toBeVisible();
  });
});
