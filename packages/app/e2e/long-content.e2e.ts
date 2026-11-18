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
import { groupRow, layerRow, legend, loadLegendScene } from './support/legend.js';
import {
  COLUMN,
  COORDINATE,
  COUNT_TEXT,
  LONG_CRS_NAME,
  LONG_CRS_QUERY,
  LONG_ENGINE,
  LONG_REASON,
  LONG_VALUE,
  LOCAL_GRID_NAMES,
  NAME,
  SPACED_NAME,
  longDataset,
  longFile,
  openCrsDialogSearching,
  openCrsDialogWithLongChanges,
  openExportWithLongThings,
  loadLongPoints,
  openIdentifyWithLongThings,
  openLegendWithLongReason,
  openStyleWithLongColumns,
  openWizardCrsSearching,
  renameGroupLong,
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
      // Under it, what to do about it, and how often it happened and where first, in the same box, whole.
      await expect(summary.locator('.hint').first()).toContainText(`Check ${COLUMN} in the file.`);
      await expect(summary.locator('.occurrences').first()).toContainText(COUNT_TEXT);
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

    test('the map area says 10 million layers are being prepared, in its chip, inside itself', async ({
      page,
    }) => {
      await page.locator('karmania-map-area').evaluate(async (element) => {
        const area = element as unknown as {
          datasets: number;
          preparing: number;
          updateComplete: Promise<boolean>;
        };
        area.datasets = 10_000_000;
        area.preparing = 10_000_000;
        await area.updateComplete;
      });
      await expect(page.locator('karmania-map-area .chip')).toHaveText(
        `Preparing ${COUNT_TEXT} layers…`,
      );
      await assertNoOverflow(app(page));
    });

    test('the field that renames a group keeps its row, and holds a name of 120 characters that is cut with its whole in a title once it is kept', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await loadLegendScene(page);
      const row = groupRow(page, 'group-1');
      const before = await box(row);
      await renameGroupLong(page);
      const field = legend(page).locator('input.rename');
      await expect(field).toHaveValue(SPACED_NAME);
      const [after, inside] = [await box(row), await box(field)];
      expect(after.height).toBe(before.height);
      expect(inside.x).toBeGreaterThanOrEqual(after.x);
      expect(inside.x + inside.width).toBeLessThanOrEqual(after.x + after.width);
      await assertNoOverflow(app(page));
      await field.press('Enter');
      const name = row.locator('.name');
      await expect(name).toHaveAttribute('title', SPACED_NAME);
      expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true,
      );
      await assertNoOverflow(app(page));
    });

    test('the style editor and its contours part hold columns of 60 characters inside the panel, with each select as wide as its field', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await openStyleWithLongColumns(page);
      const editor = legend(page).locator('#legend-style-layer-1');
      const fields = await editor.locator('k-select').all();
      expect(fields.length).toBeGreaterThanOrEqual(2);
      const room = await box(editor);
      for (const field of fields) {
        const found = await box(field);
        expect(found.x).toBeGreaterThanOrEqual(room.x);
        expect(found.x + found.width).toBeLessThanOrEqual(room.x + room.width);
      }
      // Both selects name the column of 60 characters that colours the layer and the one that makes its lines, and the text is in the select, cut.
      await expect(editor.locator('k-select[label="Contour column"] select')).toContainText(COLUMN);
      await assertNoOverflow(app(page));
    });

    test('a reason of 400 characters in the opened row and in the tooltip of the icon stays inside the panel and the window', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await openLegendWithLongReason(page);
      const reason = legend(page).locator('#legend-reason-layer-2');
      await expect(reason).toContainText(LONG_REASON.slice(0, 80));
      const [room, found] = [await box(legend(page)), await box(reason)];
      expect(found.x).toBeGreaterThanOrEqual(room.x);
      expect(found.x + found.width).toBeLessThanOrEqual(room.x + room.width);
      await assertNoOverflow(app(page));
      await layerRow(page, 'layer-2').locator('.notice k-icon').hover();
      const tip = legend(page).locator('k-tooltip .tip').first();
      await expect(tip).toBeVisible();
      const shown = await box(tip);
      const window = page.viewportSize();
      expect(shown.x).toBeGreaterThanOrEqual(0);
      expect(shown.x + shown.width).toBeLessThanOrEqual(window?.width ?? 0);
      expect(shown.y + shown.height).toBeLessThanOrEqual(window?.height ?? 0);
    });

    test('the map coordinate system dialog cuts the longest name of the definitions with its whole in a title, and keeps 20 matches in a box that scrolls', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await openCrsDialogSearching(page, LONG_CRS_QUERY);
      const dialog = page.locator('karmania-map-crs-dialog dialog');
      const rows = page.locator('karmania-map-crs-dialog karmania-crs-matches .match');
      await expect(rows.filter({ hasText: LONG_CRS_NAME })).toHaveCount(1);
      await expect(rows.filter({ hasText: LONG_CRS_NAME })).toHaveAttribute('title', LONG_CRS_NAME);
      // The name is cut with an ellipsis, in one line, and the whole of it is the title above.
      const cut = rows.filter({ hasText: LONG_CRS_NAME }).locator('.match-name');
      await expect(cut).toHaveCSS('text-overflow', 'ellipsis');
      expect(await cut.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      await assertNoOverflow(app(page));
      const [frame, first] = [await box(dialog), await box(rows.first())];
      expect(first.x).toBeGreaterThanOrEqual(frame.x);
      expect(first.x + first.width).toBeLessThanOrEqual(frame.x + frame.width);
      await page.locator('karmania-map-crs-dialog k-input input').fill('utm zone');
      await expect(rows).toHaveCount(20);
      const matches = page.locator('karmania-map-crs-dialog karmania-crs-matches .matches');
      const room = await matches.evaluate((element) => [
        element.clientHeight,
        element.scrollHeight,
      ]);
      expect(room[1]).toBeGreaterThan(room[0] ?? 0);
      await assertNoOverflow(app(page));
      const [after, footer] = [
        await box(dialog),
        await box(page.locator('karmania-map-crs-dialog footer')),
      ];
      expect(after.y + after.height).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
      expect(footer.y + footer.height).toBeLessThanOrEqual(after.y + after.height);
    });

    test('what changes in the map coordinate system dialog keeps five names of 120 characters inside it, with Apply in reach', async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await openCrsDialogWithLongChanges(page);
      const dialog = page.locator('karmania-map-crs-dialog dialog');
      const items = page.locator('karmania-map-crs-dialog .changes li');
      const frame = await box(dialog);
      for (const item of await items.all()) {
        const found = await box(item);
        expect(found.x).toBeGreaterThanOrEqual(frame.x);
        expect(found.x + found.width).toBeLessThanOrEqual(frame.x + frame.width);
      }
      await expect(items.nth(1)).toContainText(LOCAL_GRID_NAMES[0] ?? '');
      await assertNoOverflow(app(page));
      // What is too tall for the window scrolls in the body of the dialog: the last line is reached by scrolling, and then it is inside the body.
      const body = page.locator('karmania-map-crs-dialog dialog .body');
      await items.last().scrollIntoViewIfNeeded();
      const [inside, reached] = [await box(body), await box(items.last())];
      expect(reached.y).toBeGreaterThanOrEqual(inside.y);
      expect(reached.y + reached.height).toBeLessThanOrEqual(inside.y + inside.height);
      const apply = page.locator('karmania-map-crs-dialog k-button[slot="footer-end"]');
      const reach = await box(apply);
      expect(reach.y + reach.height).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
      await expect(apply.locator('button')).toBeEnabled();
    });

    test('the export dialog holds two warnings at once and a file name of 120 characters inside it, with Export in reach', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openExportWithLongThings(page);
      const dialog = page.locator('karmania-export-dialog dialog');
      const frame = await box(dialog);
      const notes = page.locator('karmania-export-dialog .notes p');
      for (const note of await notes.all()) {
        const found = await box(note);
        expect(found.x).toBeGreaterThanOrEqual(frame.x);
        expect(found.x + found.width).toBeLessThanOrEqual(frame.x + frame.width);
      }
      await assertNoOverflow(app(page));
      // The name is in its field, which keeps its width, and ".png" is after it, inside the dialog.
      const name = page.locator('karmania-export-dialog k-input[label="File name"] input');
      await expect(name).toHaveValue(NAME);
      const [field, suffix] = [
        await box(name),
        await box(page.locator('karmania-export-dialog .suffix')),
      ];
      expect(field.x + field.width).toBeLessThanOrEqual(suffix.x);
      expect(suffix.x + suffix.width).toBeLessThanOrEqual(frame.x + frame.width);
      // The dialog is inside the window, and what is too tall for it scrolls in its body: the last warning is reached, and Export is not covered.
      expect(frame.y + frame.height).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
      const body = page.locator('karmania-export-dialog dialog .body');
      await notes.last().scrollIntoViewIfNeeded();
      const [inside, reached] = [await box(body), await box(notes.last())];
      expect(reached.y + reached.height).toBeLessThanOrEqual(inside.y + inside.height);
      const action = page.locator('karmania-export-dialog k-button[slot="footer-end"]');
      await expect(action.locator('button')).toBeEnabled();
      expect((await box(action)).y + (await box(action)).height).toBeLessThanOrEqual(
        frame.y + frame.height,
      );
    });

    test('the identify popover holds a layer named with 120 characters, attributes named with 60 and a value of 200, inside the map, each cut with its whole in a title', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await openIdentifyWithLongThings(page);
      const popover = page.locator('karmania-identify section');
      const [area, found] = [await box(page.locator('karmania-map-area')), await box(popover)];
      expect(found.x).toBeGreaterThanOrEqual(area.x);
      expect(found.x + found.width).toBeLessThanOrEqual(area.x + area.width);
      expect(found.y).toBeGreaterThanOrEqual(area.y);
      expect(found.y + found.height).toBeLessThanOrEqual(area.y + area.height);
      await assertNoOverflow(app(page));
      // The header is the name of the layer, cut, with the whole of it in a title.
      const heading = popover.locator('h2');
      await expect(heading).toHaveAttribute('title', NAME);
      expect(await heading.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true,
      );
      // A name of 60 characters does not take the row from its value: both are on it, side by side, and the value has room to be read.
      const [names, values] = [popover.locator('dt'), popover.locator('dd')];
      expect(await names.count()).toBe(2);
      for (let row = 0; row < 2; row += 1) {
        const [left, right] = [await box(names.nth(row)), await box(values.nth(row))];
        expect(left.x + left.width).toBeLessThanOrEqual(right.x);
        expect(right.width).toBeGreaterThanOrEqual(100);
      }
      // An attribute named with 60 characters and a value of 200 are each cut, with the whole in a title.
      const name = popover.locator(`dt[title="${COLUMN}"]`);
      const value = popover.locator(`dd[title="${LONG_VALUE}"]`);
      await expect(name).toHaveCount(1);
      await expect(value).toHaveCount(1);
      for (const cut of [name, value]) {
        expect(await cut.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
          true,
        );
      }
    });

    test('the status chip keeps its width and its two coordinates of 18 characters inside it, at the edge of what a coordinate can be', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.goto('/');
      await loadLongPoints(page);
      const chip = page.locator('karmania-status-chip');
      const before = await box(chip);
      const canvas = await box(page.locator('karmania-map-area canvas'));
      await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      const values = chip.locator('.value');
      await expect(values.first()).not.toHaveText('');
      expect((await values.first().textContent()) ?? '').toMatch(/^[−-]99,999,99/);
      const after = await box(chip);
      expect(after.width).toBe(before.width);
      expect(after.x).toBe(before.x);
      await assertNoOverflow(app(page));
      // Both numbers are inside the chip, and the chip is inside the map.
      const area = await box(page.locator('karmania-map-area'));
      for (const value of await values.all()) {
        const found = await box(value);
        expect(found.x + found.width).toBeLessThanOrEqual(after.x + after.width);
      }
      expect(after.x + after.width).toBeLessThanOrEqual(area.x + area.width);
    });

    test('the coordinate system step of the wizard lists the longest name of the definitions without overflow, whole in a title', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await openWizardCrsSearching(page, LONG_CRS_QUERY);
      const row = page.locator('karmania-crs-step .match').filter({ hasText: LONG_CRS_NAME });
      await expect(row).toHaveCount(1);
      await expect(row).toHaveAttribute('title', LONG_CRS_NAME);
      await assertNoOverflow(app(page));
    });
  });
}
