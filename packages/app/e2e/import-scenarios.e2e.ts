/**
 * The import wizard from start to finish, as a person uses it: one journey for each kind of thing a
 * person brings. Each goes through the real steps with the real engine and kernel, and ends by
 * looking at what was loaded.
 */
import { expect, test } from '@playwright/test';
import { goTo, kept, startWizard, textsOf, wizard } from './support/wizard.js';

test.describe('importing', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('a CSV of points, with its projection file: edited on the way, loaded, and shown', async ({
    page,
  }) => {
    const w = wizard(page);
    await expect(w.map).toContainText('No data yet');

    // File: the kernel found points, and a person names the dataset.
    await startWizard(page, 'points.csv', 'points.prj');
    await expect(w.host.locator('karmania-file-step .detail')).toHaveText(
      'CSV · UTF-8 · comma-separated · about 8 rows · with points.prj',
    );
    await expect(w.host.locator('karmania-file-step k-select select')).toHaveValue('points');
    await w.host.locator('karmania-file-step k-input input').fill('Drill collars');
    await goTo(page, 'mapping');

    // Mapping: the coordinates were found; the rock is not wanted, and the grade gets a better name.
    const mapping = w.host.locator('karmania-mapping-step');
    const roles = mapping.locator('thead select');
    expect(
      await roles.evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value)),
    ).toEqual(['x', 'y', 'z', 'attribute', 'attribute', 'attribute']);
    await roles.nth(5).selectOption('ignore');
    await mapping.locator('thead .column-name').nth(4).click();
    await mapping.locator('.details k-input input').fill('Gold');
    await goTo(page, 'nodata');

    // Nodata: what the kernel suggested stays as it was.
    await expect(w.host.locator('karmania-nodata-step .words input')).toBeChecked();
    await expect(w.host.locator('karmania-nodata-step .numbers input')).toBeChecked();
    await goTo(page, 'crs');

    // CRS: from the projection file.
    await expect(w.host.locator('karmania-crs-step .found-text')).toHaveText(
      'Found EPSG 32640, from the .prj file points.prj.',
    );
    await goTo(page, 'review');

    // Review: it works, and nothing is wrong.
    const review = w.host.locator('karmania-review-step');
    await expect(review.locator('.verdict')).toHaveText('Ready to load');
    expect(await textsOf(review.locator('.dataset'))).toEqual(['Drill collars 8 points']);
    await expect(w.next).toHaveText('Load');
    await w.next.click();

    // Loaded: the dialog has gone, the Data tab is open, the map area has been told.
    await expect(w.dialog).toBeHidden();
    await expect(w.map).toContainText('1 dataset loaded');
    await expect(w.tabs.filter({ hasText: 'Data' })).toHaveAttribute('aria-selected', 'true');
    const result = await kept(page);
    expect(result.datasets).toHaveLength(1);
    const [dataset] = result.datasets;
    expect(dataset).toMatchObject({
      name: 'Drill collars',
      kind: 'points',
      elementCount: 8,
      hasZ: true,
      crs: { kind: 'epsg', code: 32640 },
      findings: [],
    });
    expect(result.selected).toBe(dataset?.id);
    expect(result.inEngine).toEqual([dataset?.id]);
    // The rock is not there, and the grade has the name that was given; its -999 and its empty cell
    // are the two nulls.
    expect(dataset?.columns.map((column) => column.name)).toEqual(['Hole', 'Gold']);
    expect(dataset?.columns.find((column) => column.name === 'Gold')).toMatchObject({
      type: 'float',
      nullCount: 2,
    });
    expect(dataset?.bbox).toEqual({
      min: [500010.5, 2765020.25, 109.3],
      max: [500185.5, 2765205.25, 120.4],
    });
  });
});
