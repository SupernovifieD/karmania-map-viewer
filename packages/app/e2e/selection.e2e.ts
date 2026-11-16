/**
 * What ends a selection (step 21.6): Escape with the keyboard on the map or the table, and removing the dataset that holds the element. The selection is part of
 * the scene, so it is kept when the camera or the view moves, and a field that has a use for Escape keeps it.
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
  stats,
} from './support/render.js';

/** Loads `count` points in a row 20 metres apart from `east`, and waits for them to be drawn. */
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
      for (let i = 0; i < n; i += 1) {
        x[i] = from + i * 20;
        y[i] = 2_765_000;
      }
      return viewer.load({
        kind: 'points',
        name: title,
        crs: { kind: 'epsg', code: 32640 },
        x,
        y,
        columns: [],
      });
    },
    [name, east, count] as const,
  );
}

const select = (page: Page, layerId: string, element: number) =>
  dispatch(page, { type: 'setSelection', selection: { layerId, element } });

/** Clicks the point `element` of a row of points from 500,000 (the map looked at with it in the middle), which selects it and opens the popover. */
async function clickPoint(page: Page, element: number): Promise<void> {
  await dispatch(page, {
    type: 'setCamera',
    patch: {
      camera2d: {
        centre: [500_000 + element * 20 - 100, 2_765_000 - 50],
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
  await page.mouse.click(box.x + box.width / 2 + 100, box.y + box.height / 2 - 50);
}

test.describe('ending a selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    await loadRow(page, 'Row', 500_000, 12);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
  });

  test('is done by Escape with the keyboard on the map: the selection and the popover go, and the outline with them', async ({
    page,
  }) => {
    await clickPoint(page, 5);
    await expect(page.locator('karmania-identify section')).toBeVisible();
    expect(await selection(page)).toEqual({ layerId: 'layer-1', element: 5 });
    // The click gave the map the focus (its keys are its own): Escape ends it.
    await page.keyboard.press('Escape');
    await expect.poll(() => selection(page)).toBeNull();
    await expect(page.locator('karmania-identify')).toHaveCount(0);
  });

  test('is done by Escape with the keyboard on the table, where a row was selected', async ({
    page,
  }) => {
    await page.getByRole('tab', { name: 'Data' }).click();
    const cell = page
      .locator('karmania-data-tab k-table [role="row"][aria-rowindex="6"] [role="gridcell"]')
      .first();
    await cell.click();
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 4 });
    await expect(page.locator('karmania-data-tab k-table [role="grid"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect.poll(() => selection(page)).toBeNull();
    await expect(
      page.locator('karmania-data-tab k-table [role="row"][aria-selected="true"]'),
    ).toHaveCount(0);
  });

  test('is not done by Escape on a button of the panel, which is neither the map nor the table', async ({
    page,
  }) => {
    await select(page, 'layer-1', 3);
    await page.getByRole('tab', { name: 'Legend' }).click();
    await page.getByRole('button', { name: 'New group' }).focus();
    await page.keyboard.press('Escape');
    expect(await selection(page)).toEqual({ layerId: 'layer-1', element: 3 });
  });

  test('is kept while the map moves and in the other view, as a part of the scene', async ({
    page,
  }) => {
    await select(page, 'layer-1', 3);
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [500_300, 2_765_040], unitsPerPixel: 2, heading: 20 } },
    });
    expect(await selection(page)).toEqual({ layerId: 'layer-1', element: 3 });
    await dispatch(page, { type: 'setViewMode', mode: '3d' });
    await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
    expect(await selection(page)).toEqual({ layerId: 'layer-1', element: 3 });
  });
});

test.describe('removing the dataset of the selected element', () => {
  /** Removes the dataset called `name` from the Data tab, confirming. */
  async function remove(page: Page, name: string): Promise<void> {
    await page.getByRole('tab', { name: 'Data' }).click();
    await page
      .locator(`karmania-dataset-list li[data-dataset="${name}"] .remove k-button button`)
      .click();
    await page
      .locator('karmania-dataset-list k-dialog')
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    await loadRow(page, 'Row', 500_000, 12);
    await loadRow(page, 'Other', 500_400, 5);
    await expect
      .poll(async () => layerStatuses(page))
      .toEqual([
        ['layer-1', 'drawn'],
        ['layer-2', 'drawn'],
      ]);
  });

  test('clears the selection, ends the popover and takes the outline away', async ({ page }) => {
    await clickPoint(page, 5);
    await expect(page.locator('karmania-identify section')).toBeVisible();
    const accent = await page.locator('karmania-map-area canvas').evaluate((element) => {
      const text = getComputedStyle(element).accentColor;
      return [...(text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number), 255];
    });
    const now = await drawn(page);
    const ring = async (): Promise<number> =>
      distance(
        (
          await around(
            page,
            Math.floor(now.width / 2) + 100 + 5,
            Math.floor(now.height / 2) + 50,
            0,
          )
        ).at(0, 0),
        accent,
      );
    await expect.poll(ring).toBeLessThanOrEqual(6);
    await remove(page, 'Row');
    await expect.poll(() => selection(page)).toBeNull();
    await expect(page.locator('karmania-identify')).toHaveCount(0);
    await expect.poll(ring).toBeGreaterThan(30);
  });

  test('keeps the selection of an element of another dataset', async ({ page }) => {
    await select(page, 'layer-2', 2);
    await remove(page, 'Row');
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-2', 'drawn']]);
    expect(await selection(page)).toEqual({ layerId: 'layer-2', element: 2 });
  });
});
