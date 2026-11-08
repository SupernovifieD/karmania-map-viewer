import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';
import { layerStatuses, withData } from './support/render.js';
import { importAsLocalGrid } from './support/wizard.js';

const summary = (page: Page): Locator => page.locator('karmania-panel karmania-dataset-summary');
const notice = (page: Page): Locator => summary(page).locator('.notice');
const row = (page: Page, name: string): Locator =>
  page.locator(`karmania-dataset-list li[data-dataset="${name}"] .choose`);

/** The points are drawn, in UTM 40; `faults` is a local grid in feet, which cannot be, and is the dataset that is selected. */
async function withANotDrawnDataset(page: Page): Promise<void> {
  await page.goto('/');
  await withData(page);
  await importAsLocalGrid(page, 'ft', {
    name: 'faults.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('x,y\n1,2\n3,4\n'),
  });
  await expect
    .poll(async () => (await layerStatuses(page)).map(([, status]) => status))
    .toEqual(['drawn', 'not_drawn']);
}

test.describe('a dataset that is not drawn, in the Data tab', () => {
  test('says so in its summary, with the reason and what to do', async ({ page }) => {
    await withANotDrawnDataset(page);
    await expect(notice(page)).toBeVisible();
    await expect(notice(page).locator('strong')).toHaveText('Not drawn on the map');
    await expect(notice(page).locator('p')).toContainText(
      'A local grid has no known place on the Earth',
    );
    // The engine's words begin with "Not drawn: ", which the line above says already.
    await expect(notice(page).locator('p')).not.toContainText('Not drawn:');
    await expect(notice(page).locator('p')).toContainText(
      "Change the map's coordinate system to the one this dataset is in.",
    );
    await expect(notice(page)).toHaveAttribute('role', 'note');
  });

  test('is at the top of the summary, above its facts, with the dataset’s own facts under it', async ({
    page,
  }) => {
    await withANotDrawnDataset(page);
    const [notes, facts] = [
      await notice(page).boundingBox(),
      await summary(page).locator('dl').boundingBox(),
    ];
    expect(notes && facts && notes.y + notes.height <= facts.y).toBe(true);
    await expect(summary(page).locator('dl')).toContainText('Local grid, feet');
  });

  test('is not said of a dataset that is drawn', async ({ page }) => {
    await withANotDrawnDataset(page);
    await row(page, 'points').click();
    await expect(summary(page).locator('dl')).toContainText('EPSG 32640');
    await expect(notice(page)).toHaveCount(0);
    await row(page, 'faults').click();
    await expect(notice(page)).toBeVisible();
  });

  test('is not said when the only dataset is drawn and nothing is the matter', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await expect(notice(page)).toHaveCount(0);
  });

  test('goes when the map’s coordinate system is changed to one the dataset can be drawn in, and comes for the other', async ({
    page,
  }) => {
    await withANotDrawnDataset(page);
    await expect(notice(page)).toBeVisible();
    // The map goes to the local grid: the grid is drawn, and the points, which are in UTM 40, are not.
    await page.locator('karmania-status-chip button.crs').click();
    await page.locator('karmania-map-crs-dialog .local input').first().check();
    await page.locator('karmania-map-crs-dialog k-button[slot="footer-end"] button').click();
    await expect
      .poll(async () => (await layerStatuses(page)).map(([, status]) => status))
      .toEqual(['not_drawn', 'drawn']);
    await expect(notice(page)).toHaveCount(0);
    await row(page, 'points').click();
    await expect(notice(page)).toBeVisible();
    await expect(notice(page).locator('p')).toContainText('EPSG');
  });

  test('stays inside the panel, at its narrowest and its widest, and its words wrap', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await withANotDrawnDataset(page);
    for (const width of [280, 512]) {
      await page.evaluate((value) => {
        localStorage.setItem(
          'karmania.panel',
          JSON.stringify({ collapsed: false, tab: 'data', width: value }),
        );
      }, width);
      await page.reload();
      // After a reload the data are gone: they are put back, and the panel has the width that was kept.
      await withANotDrawnDataset(page);
      await assertNoOverflow(summary(page));
      const clipped = await notice(page)
        .locator('p')
        .evaluate((element) => element.scrollWidth > element.clientWidth);
      expect(clipped).toBe(false);
    }
  });

  test('has no serious accessibility violations, in either theme', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await withANotDrawnDataset(page);
      await expectNoSeriousViolations(page, ['karmania-app', 'karmania-viewer', 'karmania-panel']);
    }
  });
});
