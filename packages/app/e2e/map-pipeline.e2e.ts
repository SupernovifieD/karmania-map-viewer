import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { camera, dispatch, layerStatuses, sceneFrame, stats, withData } from './support/render.js';
import { fixture, projectionFor } from './support/fixtures.js';
import { goTo, importAndLoad, kept, startWizard, wizard } from './support/wizard.js';

const PADDING = 24;

/** The extent of the first dataset that is loaded, in its own coordinates (which are the map's when it has a projected one). */
type Triple = [number, number, number];

async function bbox(page: Page): Promise<{ min: Triple; max: Triple }> {
  const { datasets } = await kept(page);
  const box = datasets[0]?.bbox as { min: Triple; max: Triple } | undefined;
  if (box === undefined) {
    throw new Error('The dataset has no extent.');
  }
  return box;
}

test.describe('from the loaded file to the map', () => {
  test("asks the engine for the frame, which is the file's own system, with an origin at the middle of the data", async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await expect.poll(async () => (await sceneFrame(page))?.source).toBe('auto');
    const frame = await sceneFrame(page);
    const box = await bbox(page);
    // A projected file is drawn in its own system, and the origin is the middle of the data to the nearest 1,000 (100 up).
    expect(frame?.mapCrs).toEqual({ kind: 'epsg', code: 32640 });
    expect(frame?.origin).toEqual([
      Math.round((box.min[0] + box.max[0]) / 2 / 1000) * 1000,
      Math.round((box.min[1] + box.max[1]) / 2 / 1000) * 1000,
      Math.round((box.min[2] + box.max[2]) / 2 / 100) * 100,
    ]);
  });

  test('prepares the layer, and says that it is drawn', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
  });

  test('fits the camera to the extent of the data, with a margin for the overlays, when the first layer is there', async ({
    page,
  }) => {
    await page.goto('/');
    const now = await withData(page);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
    const view = await camera(page);
    const box = await bbox(page);
    expect(view.centre[0]).toBeCloseTo((box.min[0] + box.max[0]) / 2, 6);
    expect(view.centre[1]).toBeCloseTo((box.min[1] + box.max[1]) / 2, 6);
    const scale = Math.max(
      (box.max[0] - box.min[0]) / (now.cssWidth - 2 * PADDING),
      (box.max[1] - box.min[1]) / (now.cssHeight - 2 * PADDING),
    );
    expect(view.unitsPerPixel).toBeCloseTo(scale, 6);
    expect(view.heading).toBe(0);
    // And the renderer looks through it: the box it shows is the map area at that scale.
    const frame = (await stats(page))?.frame;
    expect(frame?.right).toBeCloseTo((now.cssWidth * scale) / 2, 4);
  });

  test('fits again with Home, as the data is now, and not once the layer is hidden', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
    const fitted = await camera(page);
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [1, 1], unitsPerPixel: 50, heading: 20 } },
    });
    const box = await page.locator('karmania-map-area canvas').boundingBox();
    await page.mouse.click(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );
    await page.keyboard.press('Home');
    const again = await camera(page);
    expect(again.centre[0]).toBeCloseTo(fitted.centre[0], 6);
    expect(again.centre[1]).toBeCloseTo(fitted.centre[1], 6);
    // The heading is kept: a fit does not turn the map.
    expect(again.heading).toBe(20);
    // With nothing visible there is nothing to fit.
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: false });
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { centre: [7, 7] } } });
    await page.keyboard.press('Home');
    expect((await camera(page)).centre).toEqual([7, 7]);
  });

  test('limits the scale to the data: a hundred thousand times closer than the fit and a hundred times farther', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
    const fit = (await camera(page)).unitsPerPixel;
    const box = await page.locator('karmania-map-area canvas').boundingBox();
    await page.mouse.move((box?.x ?? 0) + 100, (box?.y ?? 0) + 100);
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(0, -4000);
    }
    await expect
      .poll(async () => (await camera(page)).unitsPerPixel)
      .toBeCloseTo(fit / 100_000, 12);
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.wheel(0, 4000);
    }
    await expect.poll(async () => (await camera(page)).unitsPerPixel).toBeCloseTo(fit * 100, 6);
  });

  test('chooses a UTM zone for a file in longitude and latitude, has a layer for each of its three datasets, and fits to them', async ({
    page,
  }) => {
    await page.goto('/');
    await importAndLoad(page, 'mixed.geojson');
    await expect.poll(async () => (await layerStatuses(page)).length).toBe(3);
    await expect.poll(async () => (await sceneFrame(page))?.mapCrs.code).toBeGreaterThan(32600);
    const frame = await sceneFrame(page);
    expect(frame?.mapCrs.kind).toBe('epsg');
    expect(frame?.mapCrs.code).toBeLessThanOrEqual(32760);
    expect(frame?.source).toBe('auto');
    expect((await layerStatuses(page)).map(([, status]) => status)).toEqual([
      'drawn',
      'drawn',
      'drawn',
    ]);
    // The map is in UTM metres now: a camera that was at 0, 0 is somewhere in the zone, at a scale of metres to a pixel.
    await expect.poll(async () => (await camera(page)).centre[0]).toBeGreaterThan(100_000);
    const view = await camera(page);
    expect(view.centre[0]).toBeLessThan(900_000);
    expect(view.unitsPerPixel).not.toBe(1);
  });

  test('forgets the frame when the last dataset is removed, and fits the next one', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await expect.poll(async () => (await sceneFrame(page))?.source).toBe('auto');
    await page
      .locator('karmania-dataset-list li')
      .first()
      .locator('.remove k-button button')
      .click();
    await page.locator('karmania-dataset-list k-button[slot="footer-end"]').click();
    await expect.poll(async () => layerStatuses(page)).toEqual([]);
    expect(await sceneFrame(page)).toBeNull();
    await importAndLoad(page, 'points.csv', 'points.prj');
    await expect.poll(async () => (await sceneFrame(page))?.source).toBe('auto');
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
  });

  test('is taken out of the page while the file is being prepared without an error', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await importAndLoad(page, 'points.csv', 'points.prj');
    await page.evaluate(() => {
      document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer')
        ?.remove();
    });
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('says that nothing can be drawn when the only layer cannot be, with the reason the engine gives, and the button opens the Legend', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    const w = wizard(page);
    await startWizard(page, fixture('blocks.csv'), projectionFor('blocks.prj'));
    await goTo(page, 'mapping');
    const sizes = w.host.locator('karmania-mapping-step .block-size input');
    for (let axis = 0; axis < 3; axis += 1) {
      await sizes.nth(axis).fill('10');
    }
    for (const step of ['nodata', 'crs', 'review']) {
      await goTo(page, step);
    }
    await w.next.click();
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    const area = page.locator('karmania-map-area k-empty-state');
    await expect(area).toHaveCount(0);
    // The map is made another system than the model's, and a block model is drawn only in its own: the one layer is not drawn.
    await dispatch(page, {
      type: 'setFrame',
      frame: { mapCrs: { kind: 'epsg', code: 32641 }, origin: [0, 0, 0], source: 'user' },
    });
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'not_drawn']]);
    await expect(area.locator('.heading')).toHaveText('Nothing can be drawn yet');
    await expect(area).toContainText(
      "a block model is drawn only in the map's own coordinate system",
    );
    await expect(area).toContainText(
      "Change the map's coordinate system to the one this dataset is in.",
    );
    await page.locator('karmania-panel k-tabs').getByRole('tab', { name: 'Data' }).click();
    await area.getByRole('button', { name: 'Show the Legend' }).click();
    await expect(
      page.locator('karmania-panel k-tabs').getByRole('tab', { name: 'Legend' }),
    ).toHaveAttribute('aria-selected', 'true');
    // The map's own system again: drawn, and the empty state is gone.
    await dispatch(page, {
      type: 'setFrame',
      frame: { mapCrs: { kind: 'epsg', code: 32640 }, origin: [0, 0, 0], source: 'user' },
    });
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect(area).toHaveCount(0);
  });
});
