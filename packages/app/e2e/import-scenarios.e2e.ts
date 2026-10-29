/**
 * The import wizard from start to finish, as a person uses it: one journey for each kind of thing a
 * person brings. Each goes through the real steps with the real engine and kernel, and ends by
 * looking at what was loaded.
 */
import { expect, test } from '@playwright/test';
import type { Pick } from './support/picker.js';
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

  test('a CSV with a coordinate missing: stopped by the kernel, fixed in the wizard, checked again, loaded', async ({
    page,
  }) => {
    const w = wizard(page);
    // Semicolons, decimal commas; the second row has no northing, and the third an NA for its grade.
    const survey: Pick = {
      name: 'survey.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'Easting;Northing;Level;Grade',
          '500000,5;2765000,25;100,5;1,2',
          '500010,5;;101,5;1,4',
          '500020,5;2765020,25;102,5;NA',
          '500030,5;2765030,25;103,5;2,1',
          '',
        ].join('\n'),
      ),
    };
    const projection: Pick = {
      name: 'survey.prj',
      mimeType: 'text/plain',
      buffer: Buffer.from('PROJCS["GDA94 / MGA zone 50",AUTHORITY["EPSG","28350"]]'),
    };

    await startWizard(page, survey, projection);
    await expect(w.host.locator('karmania-file-step .detail')).toHaveText(
      'CSV · UTF-8 · semicolon-separated · about 4 rows · with survey.prj',
    );
    await goTo(page, 'mapping');

    // Mapping: the kernel knows the easting and northing; the level is said to be the height.
    const mapping = w.host.locator('karmania-mapping-step');
    const roles = mapping.locator('thead select');
    const values = () =>
      roles.evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value));
    expect((await values()).slice(0, 2)).toEqual(['x', 'y']);
    await roles.nth(2).selectOption('z');
    expect(await values()).toEqual(['x', 'y', 'z', 'attribute']);
    await goTo(page, 'nodata');

    // Nodata: the kernel read the numbers with commas, and found the NA.
    const nodata = w.host.locator('karmania-nodata-step');
    await expect(nodata.locator('k-select').nth(1).locator('select')).toHaveValue(',');
    await expect(nodata.locator('.words')).toContainText('NA');
    await goTo(page, 'crs');
    await goTo(page, 'review');

    // Review: stopped. Nothing is loaded, and the error says which step can fix it.
    const review = w.host.locator('karmania-review-step');
    await expect(review.locator('.verdict')).toHaveText('Nothing was loaded');
    await expect(review.locator('.group[data-severity="error"] li')).toHaveCount(1);
    await expect(review.locator('.group[data-severity="error"] li')).toContainText('Northing');
    await expect(w.next).toHaveText('Load');
    await expect(w.next.locator('button')).toBeDisabled();
    expect((await kept(page)).inEngine).toEqual([]);

    // Fix: go to the step the error names, say to skip rows with an empty coordinate, and check again.
    await review.getByRole('button', { name: 'Fix in the Nodata step' }).click();
    await expect(w.step).toHaveAttribute('data-step', 'nodata');
    await expect(w.next).toHaveText('Check again');
    await nodata.locator('k-select').first().locator('select').selectOption('skip');
    await w.next.click();
    await expect(w.step).toHaveAttribute('data-step', 'review');

    // Now it works, with a warning that a row was left out.
    await expect(review.locator('.verdict')).toHaveText('Ready to load');
    await expect(review.locator('.group[data-severity="warning"] li').first()).toBeVisible();
    await expect(w.next).toHaveText(/^\s*Load with \d+ warnings?\s*$/);
    expect(await textsOf(review.locator('.dataset'))).toEqual(['survey 3 points']);
    await w.next.click();

    await expect(w.dialog).toBeHidden();
    const result = await kept(page);
    expect(result.datasets).toHaveLength(1);
    const [dataset] = result.datasets;
    expect(dataset).toMatchObject({
      name: 'survey',
      kind: 'points',
      elementCount: 3,
      hasZ: true,
      crs: { kind: 'epsg', code: 28350 },
    });
    // The NA is a null, and the numbers with commas were read as numbers.
    expect(dataset?.columns).toEqual([{ name: 'Grade', type: 'float', nullCount: 1 }]);
    expect(dataset?.bbox).toEqual({
      min: [500000.5, 2765000.25, 100.5],
      max: [500030.5, 2765030.25, 103.5],
    });
    expect(result.inEngine).toEqual([dataset?.id]);
  });
});
