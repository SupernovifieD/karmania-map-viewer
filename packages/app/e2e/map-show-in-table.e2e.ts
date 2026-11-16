/**
 * "Show in table" of the identify popover (step 21.4): the Data tab is shown, with the dataset of the element selected, and the table scrolls to the
 * element's row, which has the keyboard and the focus. A row that is the selected element of the map is tinted.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { camera, dispatch, drawn, layerStatuses, selection } from './support/render.js';

const COLUMNS = 100;
const ROWS = 60;

/** Loads a dataset of 6,000 points on a lattice of 100 by 60 metres apart, with a number and a name for each, and waits for it to be drawn. */
async function loadMany(page: Page, name: string, origin: [number, number]): Promise<void> {
  await page.evaluate(
    ([title, east, north, columns, rows]) => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        load(input: unknown): Promise<{ status: string }>;
      };
      const count = columns * rows;
      const x = new Float64Array(count);
      const y = new Float64Array(count);
      const serial = new Float64Array(count);
      const label: string[] = [];
      for (let i = 0; i < count; i += 1) {
        x[i] = east + (i % columns) * 10;
        y[i] = north + Math.floor(i / columns) * 10;
        serial[i] = i * 3;
        label.push(`point ${String(i)}`);
      }
      return viewer.load({
        kind: 'points',
        name: title,
        crs: { kind: 'epsg', code: 32640 },
        x,
        y,
        columns: [
          { name: 'serial', type: 'float', values: serial },
          { name: 'label', type: 'text', values: label },
        ],
      });
    },
    [name, origin[0], origin[1], COLUMNS, ROWS] as const,
  );
}

/** Puts the camera on the element `index` of a lattice that starts at `origin` (1 metre a pixel), and gives where it is on the page. */
async function centreOn(
  page: Page,
  origin: [number, number],
  index: number,
): Promise<{ x: number; y: number }> {
  await dispatch(page, {
    type: 'setCamera',
    patch: {
      camera2d: {
        centre: [
          origin[0] + (index % COLUMNS) * 10 - 100,
          origin[1] + Math.floor(index / COLUMNS) * 10 - 40,
        ],
        unitsPerPixel: 1,
        heading: 0,
      },
    },
  });
  await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - 1))
    .toBeLessThan(1e-9);
  const box = await page.locator('karmania-map-area canvas').boundingBox();
  if (box === null) throw new Error('The map is not on the page.');
  return { x: box.x + box.width / 2 + 100, y: box.y + box.height / 2 - 40 };
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name });

test.describe('Show in table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    await loadMany(page, 'Cairns', [500_000, 2_765_000]);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
  });

  test('shows the Data tab with the table at the row of the element, which has the keyboard and the focus', async ({
    page,
  }) => {
    // The Legend is shown: Show in table switches to the Data tab.
    await tab(page, 'Legend').click();
    await expect(tab(page, 'Legend')).toHaveAttribute('aria-selected', 'true');
    const element = 4_321;
    const at = await centreOn(page, [500_000, 2_765_000], element);
    await page.mouse.click(at.x, at.y);
    await expect(page.locator('karmania-identify section')).toBeVisible();
    expect(await selection(page)).toEqual({ layerId: 'layer-1', element });
    await page.getByRole('button', { name: 'Show in table' }).click();
    await expect(tab(page, 'Data')).toHaveAttribute('aria-selected', 'true');
    // The row is in the table, tinted as the selected element, and the keyboard is on a cell of it.
    const row = page.locator('karmania-data-tab k-table [role="row"][aria-selected="true"]');
    await expect(row).toHaveCount(1);
    await expect(row.locator('[role="rowheader"]')).toHaveText(String(element + 1));
    const grid = page.locator('karmania-data-tab k-table [role="grid"]');
    await expect(grid).toBeFocused();
    await expect(grid).toHaveAttribute(
      'aria-activedescendant',
      new RegExp(`^.*${String(element)}`),
    );
    await expect(row.locator('.cell.active')).toHaveCount(1);
    // The row is within the part of the table that is seen.
    const seen = await grid.boundingBox();
    const rowBox = await row.boundingBox();
    if (seen === null || rowBox === null) throw new Error('The table is not on the page.');
    expect(rowBox.y).toBeGreaterThanOrEqual(seen.y);
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(seen.y + seen.height + 1);
  });

  test('selects the dataset of the element in the list when another dataset is selected, and shows its row', async ({
    page,
  }) => {
    await loadMany(page, 'Marks', [510_000, 2_765_000]);
    await expect
      .poll(async () => layerStatuses(page))
      .toEqual([
        ['layer-1', 'drawn'],
        ['layer-2', 'drawn'],
      ]);
    // The newer dataset is the one that is selected in the Data tab; the element is of the first.
    const element = 1_234;
    const at = await centreOn(page, [500_000, 2_765_000], element);
    await page.mouse.click(at.x, at.y);
    await expect(page.locator('karmania-identify section')).toBeVisible();
    await expect(page.locator('karmania-identify h2')).toHaveText('Cairns');
    await page.getByRole('button', { name: 'Show in table' }).click();
    await expect(page.locator('karmania-data-tab k-table')).toHaveAttribute(
      'label',
      'Cairns, rows',
    );
    await expect(
      page.locator(
        'karmania-data-tab k-table [role="row"][aria-selected="true"] [role="rowheader"]',
      ),
    ).toHaveText(String(element + 1));
    await expect(page.locator('karmania-data-tab k-table [role="grid"]')).toBeFocused();
  });

  test('tints the row of the element that a click selected, without going to it, and not a row of another dataset', async ({
    page,
  }) => {
    await tab(page, 'Data').click();
    const element = 7;
    const at = await centreOn(page, [500_000, 2_765_000], element);
    await page.mouse.click(at.x, at.y);
    await expect(page.locator('karmania-identify section')).toBeVisible();
    await expect(
      page.locator(
        'karmania-data-tab k-table [role="row"][aria-selected="true"] [role="rowheader"]',
      ),
    ).toHaveText(String(element + 1));
    // The table of another dataset has no row that is the selected element: the element is of the first.
    await loadMany(page, 'Marks', [510_000, 2_765_000]);
    await expect(page.locator('karmania-data-tab k-table')).toHaveAttribute('label', 'Marks, rows');
    await expect(
      page.locator('karmania-data-tab k-table [role="row"][aria-selected="true"]'),
    ).toHaveCount(0);
    expect(await selection(page)).toEqual({ layerId: 'layer-1', element });
    // Nothing selected: no row is.
    await dispatch(page, { type: 'setSelection', selection: null });
    await expect(
      page.locator('karmania-data-tab k-table [role="row"][aria-selected="true"]'),
    ).toHaveCount(0);
  });
});
