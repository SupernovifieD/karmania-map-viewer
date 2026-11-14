import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { fixture, projectionFor } from './support/fixtures.js';
import { camera, dispatch, layerStatuses, withData } from './support/render.js';
import { importAndLoad } from './support/wizard.js';

const area = (page: Page): Locator => page.locator('karmania-map-area main');
const canvas = (page: Page): Locator => page.locator('karmania-map-area canvas');
const turn = (page: Page, heading: number): Promise<void> =>
  dispatch(page, { type: 'setCamera', patch: { camera2d: { heading } } });
const keyDescription = (page: Page): Promise<string> =>
  area(page).evaluate((element) => {
    const id = element.getAttribute('aria-describedby') ?? '';
    return element.getRootNode() instanceof ShadowRoot
      ? ((element.getRootNode() as ShadowRoot).getElementById(id)?.textContent ?? '').trim()
      : '';
  });

test.describe('the map for those who cannot see it', () => {
  test('is a picture named for the view, the layers and the way it is turned', async ({ page }) => {
    await page.goto('/');
    await expect(canvas(page)).toHaveAttribute('role', 'img');
    await expect(canvas(page)).toHaveAccessibleName('Map, 2D view, no layers, north up');
    await withData(page);
    await expect(canvas(page)).toHaveAccessibleName('Map, 2D view, 1 layer, north up');
    await expect(page.getByRole('img', { name: 'Map, 2D view, 1 layer, north up' })).toBeVisible();
  });

  test('is kept current: the heading, and the layers that are added and removed', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await turn(page, 30);
    await expect(canvas(page)).toHaveAccessibleName('Map, 2D view, 1 layer, turned 30° from north');
    await turn(page, 270);
    await expect(canvas(page)).toHaveAccessibleName(
      'Map, 2D view, 1 layer, turned 270° from north',
    );
    await turn(page, 0);
    await expect(canvas(page)).toHaveAccessibleName('Map, 2D view, 1 layer, north up');
    await importAndLoad(page, fixture('lines.csv'), projectionFor('lines.prj'));
    await expect.poll(async () => (await layerStatuses(page)).length).toBe(2);
    await expect(canvas(page)).toHaveAccessibleName('Map, 2D view, 2 layers, north up');
    await dispatch(page, { type: 'removeLayersOfDataset', datasetId: 1 });
    await expect(canvas(page)).toHaveAccessibleName('Map, 2D view, 1 layer, north up');
  });

  test('says the 3D view when the scene is in it', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await dispatch(page, { type: 'setViewMode', mode: '3d' });
    await expect(canvas(page)).toHaveAccessibleName('Map, 3D view, 1 layer, north up');
    await dispatch(page, { type: 'setViewMode', mode: '2d' });
    await expect(canvas(page)).toHaveAccessibleName('Map, 2D view, 1 layer, north up');
  });

  test('says the keys that move it, as its description, when it has the keyboard', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(area(page)).not.toHaveAttribute('aria-describedby', /.*/);
    await withData(page);
    await expect(area(page)).toHaveAttribute('tabindex', '0');
    const description = await keyDescription(page);
    for (const part of [
      'The arrow keys move the map.',
      'Plus and minus zoom in and out.',
      'Shift with the left or right arrow turns the map by 15 degrees.',
      '0 puts north up.',
      'Home fits the map to the data.',
    ]) {
      expect(description, part).toContain(part);
    }
    await expect(area(page)).toHaveAccessibleDescription(description.trim());

    await dispatch(page, { type: 'setViewMode', mode: '3d' });
    const description3d = await keyDescription(page);
    for (const part of [
      'The arrow keys orbit the map.',
      'Shift with an arrow pans the map.',
      'Plus and minus zoom in and out.',
      'Home fits the map to the data.',
    ]) {
      expect(description3d, part).toContain(part);
    }
    expect(description3d).not.toContain('0 puts north up.');
    await expect(area(page)).toHaveAccessibleDescription(description3d);
  });

  test('does what the description says', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    const fitted = await camera(page);
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [1000, 2000], unitsPerPixel: 2, heading: 0 } },
    });
    await area(page).focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await camera(page)).centre[0]).toBeGreaterThan(1000);
    await page.keyboard.press('+');
    await expect.poll(async () => (await camera(page)).unitsPerPixel).toBeLessThan(2);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await camera(page)).heading).toBe(15);
    await page.keyboard.press('0');
    await expect.poll(async () => (await camera(page)).heading).toBe(0);
    await page.keyboard.press('Home');
    // The map was moved and zoomed above, so that it is the fit that Home gives back that is read, and not a map that never left it.
    await expect
      .poll(async () => (await camera(page)).unitsPerPixel)
      .toBeCloseTo(fitted.unitsPerPixel, 9);
    const now = await camera(page);
    expect(now.centre[0]).toBeCloseTo(fitted.centre[0], 6);
    expect(now.centre[1]).toBeCloseTo(fitted.centre[1], 6);
  });

  test('has a ring inside its edges when it has the keyboard, so that nothing cuts it off', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    // Tab from the toolbar's last control (the view) to the map area: the keyboard, so that the ring shows.
    await page.locator('karmania-app header.toolbar k-segmented [aria-checked="true"]').focus();
    await page.keyboard.press('Tab');
    await expect(area(page)).toBeFocused();
    const ring = await area(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle, offset: style.outlineOffset };
    });
    expect(ring).toEqual({ width: '2px', style: 'solid', offset: '-2px' });
  });

  test('has no serious accessibility violations with a map in it, in either theme', async ({
    page,
  }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      await withData(page);
      await expectNoSeriousViolations(page);
    }
  });
});
