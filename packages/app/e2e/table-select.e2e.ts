/**
 * Selecting a row of the table selects its element on the map (step 21.5): a click on a cell, or Enter or Space on the cell the keyboard is on, makes the
 * element the scene's selection, and the map outlines it. The arrow keys alone move the keyboard and select nothing. There is no popover: that is for a click on
 * the map.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  around,
  camera,
  dispatch,
  distance,
  drawn,
  layerStatuses,
  selection,
} from './support/render.js';

/** Loads `count` points in a row 20 metres apart from `east`, each with a serial number, and says nothing until they are drawn. */
async function loadRow(page: Page, name: string, east: number, count: number): Promise<void> {
  await page.evaluate(
    ([title, from, n]) => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        load(input: unknown): Promise<{ status: string }>;
      };
      const x = new Float64Array(n);
      const y = new Float64Array(n);
      const serial = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        x[i] = from + i * 20;
        y[i] = 2_765_000;
        serial[i] = 1_000 + i;
      }
      return viewer.load({
        kind: 'points',
        name: title,
        crs: { kind: 'epsg', code: 32640 },
        x,
        y,
        columns: [{ name: 'serial', type: 'float', values: serial }],
      });
    },
    [name, east, count] as const,
  );
}

/** The cell of the table at `row` (from 0) and the first column of values. */
const cell = (page: Page, row: number) =>
  page
    .locator(
      `karmania-data-tab k-table [role="row"][aria-rowindex="${String(row + 2)}"] [role="gridcell"]`,
    )
    .first();

test.describe('selecting a row of the table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    await loadRow(page, 'Row', 500_000, 12);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await page.getByRole('tab', { name: 'Data' }).click();
    await expect(page.locator('karmania-data-tab k-table [role="grid"]')).toBeVisible();
    await expect(cell(page, 4)).toBeVisible();
  });

  test('selects the element of the row that is clicked, and has no popover', async ({ page }) => {
    expect(await selection(page)).toBeNull();
    await cell(page, 4).click();
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 4 });
    await expect(
      page.locator(
        'karmania-data-tab k-table [role="row"][aria-selected="true"] [role="rowheader"]',
      ),
    ).toHaveText('5');
    await expect(page.locator('karmania-identify')).toHaveCount(0);
    await cell(page, 9).click();
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 9 });
    await expect(
      page.locator('karmania-data-tab k-table [role="row"][aria-selected="true"]'),
    ).toHaveCount(1);
  });

  test('is the outline on the map: the ring of the accent round the point of the row', async ({
    page,
  }) => {
    const accent = await page.locator('karmania-map-area canvas').evaluate((element) => {
      const text = getComputedStyle(element).accentColor;
      return [...(text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number), 255];
    });
    // The map is looked at with the sixth point (element 5) in the middle.
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [500_100, 2_765_000], unitsPerPixel: 1, heading: 0 } },
    });
    const now = await drawn(page);
    await expect
      .poll(async () => Math.abs((await camera(page)).unitsPerPixel - 1))
      .toBeLessThan(1e-9);
    const middle = { x: Math.floor(now.width / 2), y: Math.floor(now.height / 2) };
    const ringAt = async (): Promise<number> =>
      distance((await around(page, middle.x + 5, middle.y, 0)).at(0, 0), accent);
    expect(await ringAt()).toBeGreaterThan(30);
    await cell(page, 5).click();
    await expect.poll(ringAt).toBeLessThanOrEqual(6);
    // Another row: the ring is round that point and no longer here.
    await cell(page, 7).click();
    await expect.poll(ringAt).toBeGreaterThan(30);
  });

  test('is made with Enter on the cell the keyboard is on, and not by the arrow keys that move it', async ({
    page,
  }) => {
    await cell(page, 2).click();
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 2 });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    expect(await selection(page)).toEqual({ layerId: 'layer-1', element: 2 });
    await page.keyboard.press('Enter');
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 4 });
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press(' ');
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 3 });
  });

  test('is of the dataset that is selected in the list: the layer of another dataset gets its row', async ({
    page,
  }) => {
    await loadRow(page, 'Second', 500_400, 6);
    await expect
      .poll(async () => layerStatuses(page))
      .toEqual([
        ['layer-1', 'drawn'],
        ['layer-2', 'drawn'],
      ]);
    await expect(page.locator('karmania-data-tab k-table')).toHaveAttribute(
      'label',
      'Second, rows',
    );
    await cell(page, 3).click();
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-2', element: 3 });
  });
});
