/**
 * The long and the unexpected, from section 7.3 of the brief, put in everywhere they can be shown: a
 * dataset name of 120 characters, a column name of 60, 10 million as a count, and a negative coordinate
 * with 12 decimals. In none of them may anything overflow, and what is cut off has its whole in a
 * title or in the page. Each is tried at the smallest window, where there is the least room, and at
 * a usual one.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertNoOverflow } from './support/layout.js';
import {
  COLUMN,
  COORDINATE,
  COUNT_TEXT,
  LONG_ENGINE,
  NAME,
  SPACED_NAME,
  longDataset,
  longFile,
  setDatasets,
} from './support/long-content.js';
import { goTo, startWizard, wizard } from './support/wizard.js';

const SIZES = [
  { width: 1024, height: 640 },
  { width: 1440, height: 900 },
] as const;

const app = (page: Page): Locator => page.locator('karmania-app');

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (found === null) {
    throw new Error('not shown');
  }
  return found;
}

for (const size of SIZES) {
  const label = `${String(size.width)}x${String(size.height)}`;

  test.describe(`at ${label}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize(size);
      await page.goto('/');
    });

    test('the Data tab holds a dataset with a name of 120 characters, a count of 10 million, a column of 60 and a long coordinate', async ({
      page,
    }) => {
      await setDatasets(page, [
        longDataset(1, NAME),
        longDataset(2, SPACED_NAME),
        longDataset(3, 'short'),
      ]);
      const list = page.locator('karmania-dataset-list');
      const summary = page.locator('karmania-dataset-summary');
      // Both open: the columns, and the warnings and notes.
      for (const head of await summary.locator('details > summary').all()) {
        await head.click();
      }
      await assertNoOverflow(app(page));

      // The name is cut with an ellipsis and has its whole in a title; the count is whole, beside it.
      const row = list.locator('li').first();
      const name = row.locator('.name');
      expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true,
      );
      await expect(name).toHaveAttribute('title', NAME);
      await expect(row.locator('.count')).toHaveText(COUNT_TEXT);
      const [nameBox, countBox, rowBox] = [
        await box(name),
        await box(row.locator('.count')),
        await box(row),
      ];
      expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(countBox.x);
      expect(countBox.x + countBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);

      // The summary says the size whole, and a coordinate to six decimals with all of it in a title.
      await expect(summary).toContainText(`${COUNT_TEXT} points`);
      const extents = summary.locator('dd.extent');
      expect(await extents.count()).toBeGreaterThan(0);
      const titles = await extents.evaluateAll((all) =>
        all.map((element) => element.getAttribute('title')),
      );
      expect(titles.join(' ')).toContain('123.456789012345');
      // A column of 60 characters is cut, with its whole in a title, and how many are empty is whole.
      const column = summary.locator('.column').first();
      await expect(column).toContainText(COUNT_TEXT);
      await expect(column.locator('.name')).toHaveAttribute('title', COLUMN);
      // The warning says what it says, and wraps.
      await expect(summary).toContainText(COLUMN);
    });

    test('asking to remove a dataset with a long name keeps the question in its box, with the name whole in it', async ({
      page,
    }) => {
      await setDatasets(page, [longDataset(1, NAME)]);
      const list = page.locator('karmania-dataset-list');
      await list.locator('li').first().hover();
      await list.locator('.remove k-button button').first().click();
      const confirm = list.locator('.confirm');
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText(NAME);
      await expect(confirm).toContainText(COUNT_TEXT);
      await assertNoOverflow(app(page));
      const dialog = await box(list.locator('dialog'));
      const text = await box(confirm);
      expect(text.x).toBeGreaterThanOrEqual(dialog.x);
      expect(text.x + text.width).toBeLessThanOrEqual(dialog.x + dialog.width);
    });

    test('the wizard takes a file named with 120 characters, with a column of 60 and long coordinates, through every step', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const w = wizard(page);
      await startWizard(page, ...longFile());
      for (const step of ['file', 'mapping', 'nodata', 'crs', 'review']) {
        if (step !== 'file') {
          await goTo(page, step);
        }
        await assertNoOverflow(app(page));
      }
      await expect(w.host.locator('karmania-review-step .verdict')).toHaveText('Ready to load');
      // What is loaded is named, whole or cut with the whole in a title, and counted.
      await expect(w.host.locator('karmania-review-step .dataset')).toContainText('12 points');
      const dataset = w.host.locator('karmania-review-step .dataset').first();
      const shown = await dataset.evaluate((element) => {
        const range = element.getBoundingClientRect();
        return { right: range.right, scroll: element.scrollWidth - element.clientWidth };
      });
      expect(shown.scroll).toBeLessThanOrEqual(1);
      expect(shown.right).toBeLessThanOrEqual(
        (await box(w.dialog)).x + (await box(w.dialog)).width,
      );
      await w.next.click();
      await expect(w.dialog).toBeHidden();
      // In the Data tab: the name is cut and whole in its title, the column is cut and whole in its
      // title, and the coordinate is there in full.
      const table = page.locator('karmania-data-tab k-table');
      await expect(table.locator('.rows [role="row"]').first()).toBeVisible();
      await expect(
        page.locator('karmania-dataset-list li').first().locator('.name'),
      ).toHaveAttribute('title', NAME);
      const headings = await table
        .locator('.header [role="columnheader"]')
        .evaluateAll((all) =>
          all.map((element) => [element.textContent, element.getAttribute('title')]),
        );
      expect(headings.find(([text]) => text === COLUMN)).toBeDefined();
      await expect(table.locator('.rows [role="row"]').first()).toContainText(COORDINATE);
      await assertNoOverflow(app(page));
    });

    test('the wizard says 10 million rows and shows a coordinate of 12 decimals, in every step, with nothing out of its box', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const w = wizard(page);
      await w.host.evaluate(
        (element, [source, name]) => {
          const target = element as unknown as { engine: unknown; show: (files: File[]) => void };
          target.engine = (0, eval)(source ?? '');
          target.show([new File(['x'], name ?? 'a.csv')]);
        },
        [LONG_ENGINE, `${NAME}.csv`],
      );
      await expect(w.host.locator('karmania-file-step')).toBeVisible();
      await expect(w.host.locator('karmania-file-step')).toContainText(COUNT_TEXT);
      await assertNoOverflow(app(page));
      for (const step of ['mapping', 'nodata', 'crs', 'review']) {
        await goTo(page, step);
        await assertNoOverflow(app(page));
      }
      // The import runs, and finishes with a dataset of 10 million points under a name of 120.
      await page.evaluate(
        (summary) => {
          (window as unknown as { fake: { finish: (result: unknown) => void } }).fake.finish({
            status: 'loaded',
            summaries: [summary],
          });
        },
        longDataset(1, NAME),
      );
      await expect(w.host.locator('karmania-review-step .verdict')).toHaveText('Ready to load');
      await expect(w.host.locator('karmania-review-step .dataset')).toContainText(
        `${COUNT_TEXT} points`,
      );
      await assertNoOverflow(app(page));
    });

    test('the map area says 10 million datasets are loaded, on one or more lines, inside itself', async ({
      page,
    }) => {
      await page.locator('karmania-map-area').evaluate(async (element) => {
        const area = element as unknown as { datasets: number; updateComplete: Promise<boolean> };
        area.datasets = 10_000_000;
        await area.updateComplete;
      });
      await expect(page.locator('karmania-map-area k-empty-state')).toContainText(
        `${COUNT_TEXT} datasets loaded`,
      );
      await assertNoOverflow(app(page));
    });
  });
}
