import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { fixture, projectionFor } from './support/fixtures.js';
import { camera, layerStatuses, sceneFrame, stats, withData } from './support/render.js';
import { importAndLoad, importAsLocalGrid } from './support/wizard.js';

const chip = (page: Page): Locator => page.locator('karmania-status-chip button.crs');
const dialog = (page: Page): Locator => page.locator('karmania-map-crs-dialog dialog');
const search = (page: Page): Locator => page.locator('karmania-map-crs-dialog k-input input');
const rows = (page: Page): Locator =>
  page.locator('karmania-map-crs-dialog karmania-crs-matches .match');
const apply = (page: Page): Locator =>
  page.locator('karmania-map-crs-dialog k-button[slot="footer-end"] button');

/** Opens the dialog, finds a system by its code, picks the first match and applies it. */
async function applyCode(page: Page, code: number): Promise<void> {
  await chip(page).click();
  await expect(dialog(page)).toBeVisible();
  await search(page).fill(String(code));
  await expect(rows(page).first()).toContainText(`EPSG ${String(code)}`);
  await rows(page).first().click();
  await apply(page).click();
  await expect(dialog(page)).toBeHidden();
}

/** Opens the dialog, chooses the first local grid it offers and applies it. */
async function applyLocalGrid(page: Page): Promise<void> {
  await chip(page).click();
  await expect(dialog(page)).toBeVisible();
  await page.locator('karmania-map-crs-dialog .local input').first().check();
  await apply(page).click();
  await expect(dialog(page)).toBeHidden();
}

const statuses = async (page: Page): Promise<string[]> =>
  (await layerStatuses(page)).map(([, status]) => status);

/** Counts the calls to the engine's `prepare` from now on. */
async function countPrepares(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      engine: { prepare: (...args: unknown[]) => unknown };
    };
    const holder = window as unknown as { prepares: number };
    holder.prepares = 0;
    const real = viewer.engine.prepare.bind(viewer.engine);
    viewer.engine.prepare = (...args: unknown[]) => {
      holder.prepares += 1;
      return real(...args);
    };
  });
  return () => page.evaluate(() => (window as unknown as { prepares: number }).prepares);
}

test.describe('applying a map coordinate system', () => {
  test('puts the map in the system the person chose, which the scene says was theirs, and draws it again', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    const before = { frame: await sceneFrame(page), camera: await camera(page) };
    expect(before.frame?.source).toBe('auto');
    await applyCode(page, 32641);
    await expect
      .poll(async () => (await sceneFrame(page))?.mapCrs)
      .toEqual({ kind: 'epsg', code: 32641 });
    const frame = await sceneFrame(page);
    expect(frame?.source).toBe('user');
    // The engine made the origin: it is not the 0 that the dialog sent.
    expect(frame?.origin).not.toEqual([0, 0, 0]);
    await expect.poll(() => statuses(page)).toEqual(['drawn']);
    await expect(chip(page)).toHaveText('EPSG:32641');
    // The map is in other units (a hundred kilometres to the west), and the camera was fitted to the data in them.
    const after = await camera(page);
    expect(Math.abs(after.centre[0] - before.camera.centre[0])).toBeGreaterThan(100_000);
    expect(after.unitsPerPixel).toBeGreaterThan(0);
    // The map is drawn in it: the renderer has the layer and has made frames since.
    await expect.poll(async () => (await stats(page))?.layersDrawn ?? 0).toBeGreaterThan(0);
  });

  test('prepares every layer again, and not before it is applied', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await importAndLoad(page, fixture('lines.csv'), projectionFor('lines.prj'));
    await expect.poll(async () => (await layerStatuses(page)).length).toBe(2);
    await expect.poll(() => statuses(page)).toEqual(['drawn', 'drawn']);
    const prepares = await countPrepares(page);
    await chip(page).click();
    await search(page).fill('32641');
    await rows(page).first().click();
    // Looking at what would change prepares nothing.
    await expect(page.locator('karmania-map-crs-dialog .changes')).toContainText(
      'No dataset would',
    );
    expect(await prepares()).toBe(0);
    await apply(page).click();
    await expect.poll(prepares).toBeGreaterThanOrEqual(2);
    await expect.poll(() => statuses(page)).toEqual(['drawn', 'drawn']);
  });

  test('keeps the person’s choice when more data is loaded', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await applyCode(page, 32641);
    await expect.poll(async () => (await sceneFrame(page))?.source).toBe('user');
    await expect.poll(() => statuses(page)).toEqual(['drawn']);
    await importAndLoad(page, fixture('lines.csv'), projectionFor('lines.prj'));
    await expect.poll(() => statuses(page)).toEqual(['drawn', 'drawn']);
    expect((await sceneFrame(page))?.mapCrs).toEqual({ kind: 'epsg', code: 32641 });
    expect((await sceneFrame(page))?.source).toBe('user');
    await expect(chip(page)).toHaveText('EPSG:32641');
  });

  test('is a map in degrees when the person chooses WGS 84, with no scale bar', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await expect(page.locator('karmania-scale-bar .scale')).toBeVisible();
    await applyCode(page, 4326);
    await expect(chip(page)).toHaveText('EPSG:4326');
    await expect.poll(() => statuses(page)).toEqual(['drawn']);
    await expect(page.locator('karmania-scale-bar .scale')).toHaveCount(0);
  });

  test('says that nothing can be drawn when the system is one that the data cannot be drawn in, and back again', async ({
    page,
  }) => {
    await page.goto('/');
    await importAsLocalGrid(page, 'ft', 'points.csv');
    await expect.poll(() => statuses(page)).toEqual(['drawn']);
    await importAndLoad(page, fixture('lines.csv'), projectionFor('lines.prj'));
    // The map is in the local grid (the first dataset), and the lines, which are in UTM 40, are not drawn.
    await expect.poll(() => statuses(page)).toEqual(['drawn', 'not_drawn']);
    // Choose the lines' system: the points are not drawn in it and the lines are.
    await applyCode(page, 32640);
    await expect.poll(() => statuses(page)).toEqual(['not_drawn', 'drawn']);
    expect((await sceneFrame(page))?.origin).not.toEqual([0, 0, 0]);
    // And back to the local grid.
    await applyLocalGrid(page);
    await expect.poll(() => statuses(page)).toEqual(['drawn', 'not_drawn']);
    await expect(chip(page)).toHaveText('Local grid, ft');
  });

  test('keeps the status chip working: the pointer’s coordinates are in the new system', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await applyCode(page, 32641);
    await expect.poll(() => statuses(page)).toEqual(['drawn']);
    const map = await page.locator('karmania-map-area canvas').boundingBox();
    if (map === null) {
      throw new Error('There is no map.');
    }
    await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
    const values = page.locator('karmania-status-chip .value');
    await expect(values.first()).not.toHaveText('');
    // The data are about 6 degrees west of the central meridian of zone 41, so their easting there is far from the 500,100 or so that they have in
    // zone 40 (it is a hundred kilometres west of zone 41's own 0 m).
    const x = Number(
      ((await values.first().textContent()) ?? '').replaceAll(',', '').replace('−', '-'),
    );
    expect(Math.abs(x - 500_100)).toBeGreaterThan(100_000);
  });
});
