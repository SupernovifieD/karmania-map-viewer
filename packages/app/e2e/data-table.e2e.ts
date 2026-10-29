import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';
import { fixturePath } from './support/picker.js';
import type { Sample } from './support/picker.js';
import { importAndLoad } from './support/wizard.js';

const ROW = 28;

/** The parts of the Data tab that have to do with the table. */
function parts(page: Page) {
  const panel = page.locator('karmania-panel');
  const table = panel.locator('karmania-data-tab k-table');
  return {
    panel,
    body: panel.locator('[slot="data"]'),
    data: panel.locator('karmania-data-tab'),
    summary: panel.locator('karmania-dataset-summary'),
    list: panel.locator('karmania-dataset-list'),
    table,
    viewport: table.locator('.viewport'),
    headings: table.locator('.header [role="columnheader"]'),
    rows: table.locator('.rows [role="row"]'),
    numbers: table.locator('.rows [role="rowheader"]'),
    row: (name: string) => panel.locator(`karmania-dataset-list li[data-dataset="${name}"]`),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

/** A points file of `count` rows, whose values are worked out from the row's number. */
function pointsFile(name: string, count: number): [Sample, Sample] {
  const lines = ['Easting,Northing,RL,Hole,Au_ppm,Rock'];
  for (let row = 0; row < count; row += 1) {
    lines.push(
      [
        500_000 + row * 0.5,
        2_765_000 + row * 0.25,
        100 + (row % 40) * 0.25,
        `DH${String(row + 1)}`,
        row % 7 === 0 ? -999 : (row % 10) / 4,
        ['granite', 'basalt', 'schist'][row % 3],
      ].join(','),
    );
  }
  return [
    { name: `${name}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`${lines.join('\n')}\n`) },
    {
      name: `${name}.prj`,
      mimeType: 'text/plain',
      buffer: readFileSync(fixturePath('points.prj')),
    },
  ];
}

/** What row `row` (from 0) of `pointsFile` shows in the table. */
function shownRow(row: number): string[] {
  const au = row % 7 === 0 ? 'null' : String((row % 10) / 4);
  return [
    String(row + 1),
    String(500_000 + row * 0.5),
    String(2_765_000 + row * 0.25),
    String(100 + (row % 40) * 0.25),
    `DH${String(row + 1)}`,
    au,
    ['granite', 'basalt', 'schist'][row % 3] ?? '',
  ];
}

/** The texts of the rows drawn, a list for each row, row number first. */
function drawn(rows: Locator): Promise<string[][]> {
  return rows.evaluateAll((all) =>
    all.map((row) => [...row.children].map((cell) => cell.textContent)),
  );
}

async function scrollTo(viewport: Locator, top: number): Promise<void> {
  await viewport.evaluate((element, y) => {
    element.scrollTo(0, y);
  }, top);
}

test.describe('the table of the Data tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('shows the rows of the selected dataset, the columns that place each row first', async ({
    page,
  }) => {
    const p = parts(page);
    await importAndLoad(page, 'points.csv', 'points.prj');
    await expect(p.rows).toHaveCount(8);
    await expect(p.headings).toHaveText(['# Row', 'X', 'Y', 'Z', 'Hole', 'Au_ppm', 'Rock']);
    const rows = await drawn(p.rows);
    expect(rows[0]).toEqual(['1', '500010.5', '2765020.25', '120.4', 'DH001', '0.35', 'granite']);
    // A nodata value is a null, and a number is not given zeros that were in the file.
    expect(rows[2]).toEqual(['3', '500060.5', '2765071', '117.2', 'DH002', 'null', 'basalt']);
    expect(rows[1]?.[5]).toBe('1.2');
    await expect(p.viewport).toHaveAccessibleName('points, rows');
    await expect(p.viewport).toHaveAttribute('aria-rowcount', '9');
  });

  test('is under the summary, as wide as the panel, and takes the height that is left', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const p = parts(page);
    await importAndLoad(page, 'points.csv', 'points.prj');
    await expect(p.rows.first()).toBeVisible();
    const [body, summary, table] = [await rect(p.body), await rect(p.summary), await rect(p.table)];
    // No padding at the sides: the table is as wide as the panel's body.
    expect([table.x, table.width]).toEqual([body.x, body.width]);
    expect(table.y).toBe(summary.y + summary.height);
    // And to the bottom of it, with nothing under.
    expect(table.y + table.height).toBe(body.y + body.height);
  });

  test('keeps room for at least five rows, and the panel scrolls when there is no more', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    const p = parts(page);
    // Three datasets, so that the list is taller, and a summary that has vertices to count.
    await importAndLoad(page, 'mixed.geojson');
    await expect(p.rows.first()).toBeVisible();
    const table = await rect(p.table);
    expect(table.height).toBeGreaterThanOrEqual(240);
    const scrolls = await p.body.evaluate((element) => element.scrollHeight - element.clientHeight);
    expect(scrolls).toBeGreaterThan(0);
    await assertNoOverflow(p.data);
  });

  test('asks the engine for rows as they come into view, and shows every one of thousands', async ({
    page,
  }) => {
    const p = parts(page);
    await importAndLoad(page, ...pointsFile('big', 20_000));
    await expect(p.viewport).toHaveAttribute('aria-rowcount', '20001');
    await expect(p.rows.first()).toBeVisible();
    // Only the rows in view are drawn, and a few beyond.
    expect(await p.rows.count()).toBeLessThan(40);
    expect((await drawn(p.rows))[0]).toEqual(shownRow(0));
    for (const row of [255, 256, 5000, 12_345, 19_000]) {
      await scrollTo(p.viewport, row * ROW);
      await expect
        .poll(async () => (await drawn(p.rows)).some((cells) => cells[0] === String(row + 1)))
        .toBe(true);
      for (const cells of await drawn(p.rows)) {
        expect(cells, `row ${cells[0] ?? '?'}`).toEqual(shownRow(Number(cells[0]) - 1));
      }
    }
    // To the end: the last row is the last that is there, at the bottom.
    await scrollTo(p.viewport, 1e9);
    await expect.poll(async () => (await drawn(p.rows)).at(-1)?.[0]).toBe('20000');
    expect((await drawn(p.rows)).at(-1)).toEqual(shownRow(19_999));
    const bottom = await p.viewport.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.y + element.clientHeight;
    });
    const last = await rect(p.rows.last());
    expect(last.y + last.height).toBe(bottom);
  });

  test('is the rows of the dataset that is selected, from the top, when another is chosen', async ({
    page,
  }) => {
    const p = parts(page);
    await importAndLoad(page, ...pointsFile('alpha', 300));
    await importAndLoad(page, ...pointsFile('beta', 500));
    // The one that was loaded last is selected.
    await expect(p.viewport).toHaveAccessibleName('beta, rows');
    await expect(p.viewport).toHaveAttribute('aria-rowcount', '501');
    await scrollTo(p.viewport, 200 * ROW);
    await expect
      .poll(async () => (await drawn(p.rows)).some((cells) => cells[0] === '201'))
      .toBe(true);
    await p.row('alpha').locator('.choose').click();
    await expect(p.viewport).toHaveAccessibleName('alpha, rows');
    await expect(p.viewport).toHaveAttribute('aria-rowcount', '301');
    await expect.poll(async () => (await drawn(p.rows))[0]).toEqual(shownRow(0));
    expect(await p.viewport.evaluate((element) => element.scrollTop)).toBe(0);
  });

  test('stays where it is when a dataset that is not selected is removed', async ({ page }) => {
    const p = parts(page);
    await importAndLoad(page, ...pointsFile('alpha', 300));
    await importAndLoad(page, ...pointsFile('beta', 500));
    await scrollTo(p.viewport, 200 * ROW);
    await expect
      .poll(async () => (await drawn(p.rows)).some((cells) => cells[0] === '201'))
      .toBe(true);
    await p.row('alpha').locator('.remove k-button button').click();
    await p.list.locator('k-button[slot="footer-end"]').click();
    await expect(p.row('alpha')).toHaveCount(0);
    await expect(p.viewport).toHaveAccessibleName('beta, rows');
    expect(await p.viewport.evaluate((element) => element.scrollTop)).toBe(200 * ROW);
    expect((await drawn(p.rows)).some((cells) => cells[0] === '201')).toBe(true);
  });

  test('goes with the dataset that is removed, and the empty state comes back with the last', async ({
    page,
  }) => {
    const p = parts(page);
    await importAndLoad(page, 'points.csv', 'points.prj');
    await expect(p.table).toHaveCount(1);
    await p.row('points').locator('.remove k-button button').click();
    await p.list.locator('k-button[slot="footer-end"]').click();
    await expect(p.table).toHaveCount(0);
    await expect(p.data.locator('k-empty-state .heading')).toHaveText('No data loaded');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious accessibility violations (${theme} theme)`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await importAndLoad(page, 'points.csv', 'points.prj');
      await expect(parts(page).rows.first()).toBeVisible();
      await expectNoSeriousViolations(page);
    });
  }
});
