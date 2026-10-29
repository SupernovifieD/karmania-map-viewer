import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';
import { pickFiles } from './support/picker.js';
import type { Pick } from './support/picker.js';

/** The parts of the Mapping step. */
function parts(page: Page) {
  const host = page.locator('karmania-import-dialog');
  const step = host.locator('karmania-mapping-step');
  return {
    host,
    dialog: host.locator('dialog'),
    body: host.locator('dialog .body'),
    step,
    heads: step.locator('thead th'),
    names: step.locator('thead .column-name'),
    selects: step.locator('thead select'),
    suggested: step.locator('thead .suggested'),
    rows: step.locator('tbody tr'),
    viewport: step.locator('.viewport'),
    count: step.locator('.count'),
    note: step.locator('.note'),
    next: host.locator('k-button[slot="footer-end"]').nth(1),
    back: host.locator('k-button[slot="footer-end"]').nth(0),
    kind: host.locator('karmania-file-step k-select select'),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

/** Imports files, and goes on to the Mapping step. */
async function mappingOf(page: Page, ...picks: Pick[]): Promise<void> {
  await pickFiles(
    page,
    async () => {
      await page.locator('karmania-app header.toolbar k-button button').click();
    },
    picks,
  );
  await expect(parts(page).step.or(parts(page).host.locator('karmania-file-step'))).toBeVisible();
  await parts(page).next.click();
  await expect(parts(page).host.locator('.step[data-step="mapping"]')).toBeVisible();
}

/** The value of each of a set of selects. */
const valuesOf = (selects: Locator): Promise<string[]> =>
  selects.evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value));

const textsOf = (locator: Locator): Promise<string[]> =>
  locator.evaluateAll((all) => all.map((element) => element.textContent.trim()));

/** A CSV file with `columns` columns and `rows` rows: a text column, then numbers. */
function bigCsv(columns: number, rows: number, firstName = 'Name'): Pick {
  const header = [
    firstName,
    ...Array.from({ length: columns - 1 }, (_, c) => `Column ${String(c + 2)}`),
  ];
  const lines = [header.join(',')];
  for (let row = 0; row < rows; row += 1) {
    lines.push(
      [
        `row ${String(row + 1)}`,
        ...Array.from({ length: columns - 1 }, (_, c) => String(row * 10 + c + 0.25)),
      ].join(','),
    );
  }
  return { name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from(`${lines.join('\n')}\n`) };
}

test.describe('the Mapping step', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('shows the file as a table with a selector of the role over each column', async ({
    page,
  }) => {
    const p = parts(page);
    await mappingOf(page, 'points.csv');
    expect(await textsOf(p.names)).toEqual(['Easting', 'Northing', 'RL', 'Hole', 'Au_ppm', 'Rock']);
    await expect(p.rows).toHaveCount(8);
    expect(await textsOf(p.rows.first().locator('td'))).toEqual([
      '500010.5',
      '2765020.25',
      '120.4',
      'DH001',
      '0.35',
      'granite',
    ]);
    await expect(p.count).toHaveText('All 8 rows.');
  });

  test('fills in the roles the kernel suggests, and marks them as suggested', async ({ page }) => {
    const p = parts(page);
    await mappingOf(page, 'points.csv');
    expect(await valuesOf(p.selects)).toEqual([
      'x',
      'y',
      'z',
      'attribute',
      'attribute',
      'attribute',
    ]);
    // Only the coordinates were suggested: an attribute is what a column is unless said otherwise.
    await expect(p.suggested).toHaveCount(3);
    for (const index of [0, 1, 2]) {
      await expect(p.heads.nth(index).locator('.suggested')).toHaveText('suggested');
    }
    await expect(p.heads.nth(3).locator('.suggested')).toHaveCount(0);
  });

  test('names each selector for the column it belongs to, and offers roles in their short names', async ({
    page,
  }) => {
    const p = parts(page);
    await mappingOf(page, 'points.csv');
    const selector = p.step.getByRole('combobox', { name: 'What the column "Easting" is for' });
    await expect(selector).toBeVisible();
    await expect(selector.locator('option')).toHaveText(['X', 'Y', 'Z', 'Attribute', 'Ignore']);
  });

  test('keeps the role a person chooses, which is then no longer a suggestion', async ({
    page,
  }) => {
    const p = parts(page);
    await mappingOf(page, 'points.csv');
    await p.selects.nth(5).selectOption('ignore');
    await p.selects.nth(0).selectOption('attribute');
    expect(await valuesOf(p.selects)).toEqual([
      'attribute',
      'y',
      'z',
      'attribute',
      'attribute',
      'ignore',
    ]);
    await expect(p.suggested).toHaveCount(2);
    await expect(p.heads.nth(0).locator('.suggested')).toHaveCount(0);
    expect(
      await p.host.evaluate((element) =>
        (
          element as unknown as { draft: { columns: { role: string; suggested: boolean }[] } }
        ).draft.columns.map((column) => `${column.role}${column.suggested ? '*' : ''}`),
      ),
    ).toEqual(['attribute', 'y*', 'z*', 'attribute', 'attribute', 'ignore']);
    // The choice is kept when the step is left and come back to.
    await p.back.click();
    await p.next.click();
    expect(await valuesOf(p.selects)).toEqual([
      'attribute',
      'y',
      'z',
      'attribute',
      'attribute',
      'ignore',
    ]);
  });

  test('moves nothing when a role is changed and its mark goes', async ({ page }) => {
    const p = parts(page);
    await mappingOf(page, 'points.csv');
    const boxes = async () => [
      await rect(p.viewport),
      ...(await Promise.all([0, 1, 2, 3].map((index) => rect(p.heads.nth(index))))),
      await rect(p.selects.first()),
      await rect(p.rows.first()),
    ];
    const before = await boxes();
    await p.selects.nth(0).selectOption('attribute');
    await expect(p.suggested).toHaveCount(2);
    expect(await boxes()).toEqual(before);
  });

  test('sets a column that is ignored apart in the table', async ({ page }) => {
    const p = parts(page);
    await mappingOf(page, 'points.csv');
    const cell = p.rows.first().locator('td').nth(5);
    const before = await cell.evaluate((element) => getComputedStyle(element).color);
    await p.selects.nth(5).selectOption('ignore');
    const after = await cell.evaluate((element) => getComputedStyle(element).color);
    expect(after).not.toBe(before);
  });

  test('offers a line identifier for lines, and not for points', async ({ page }) => {
    const p = parts(page);
    await mappingOf(page, 'lines.csv');
    expect(await valuesOf(p.selects)).toContain('line_id');
    await expect(p.selects.first().locator('option')).toHaveText([
      'X',
      'Y',
      'Z',
      'Line ID',
      'Attribute',
      'Ignore',
    ]);
    expect(await p.suggested.count()).toBeGreaterThanOrEqual(3);

    // Imported as points instead, the line identifier is just an attribute, and it says so.
    await p.back.click();
    await p.kind.selectOption('points');
    await p.next.click();
    expect(await valuesOf(p.selects)).not.toContain('line_id');
    await expect(p.selects.first().locator('option')).toHaveText([
      'X',
      'Y',
      'Z',
      'Attribute',
      'Ignore',
    ]);
  });

  test('shows the first 100 rows of a longer file, and says how many there are', async ({
    page,
  }) => {
    const p = parts(page);
    await mappingOf(page, bigCsv(4, 150));
    await expect(p.rows).toHaveCount(100);
    await expect(p.count).toHaveText('The first 100 of about 150 rows.');
  });

  test('scrolls the table inside itself, with its header in view, and the step stays where it is', async ({
    page,
  }) => {
    const p = parts(page);
    await page.setViewportSize({ width: 1024, height: 640 });
    await mappingOf(page, bigCsv(30, 150));
    const scrolls = await p.viewport.evaluate((element) => ({
      across: element.scrollWidth > element.clientWidth,
      down: element.scrollHeight > element.clientHeight,
    }));
    expect(scrolls).toEqual({ across: true, down: true });
    // The dialog's own body has nothing to scroll: the table has the room of the step.
    expect(
      await p.body.evaluate((element) => element.scrollHeight - element.clientHeight),
    ).toBeLessThanOrEqual(1);

    const header = await rect(p.heads.first());
    const viewport = await rect(p.viewport);
    await p.viewport.evaluate((element) => {
      element.scrollTop = 600;
      element.scrollLeft = 0;
    });
    const scrolled = await rect(p.heads.first());
    expect(scrolled.y).toBe(header.y);
    expect(scrolled.y).toBeGreaterThanOrEqual(viewport.y);
    // And a column far to the right can be reached, selector and all.
    await p.selects.last().scrollIntoViewIfNeeded();
    const last = await rect(p.selects.last());
    expect(last.x + last.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
    await assertNoOverflow(p.dialog);
  });

  test('sets the columns 160 wide and the rows 28 high, numbers to the right, text to the left', async ({
    page,
  }) => {
    const p = parts(page);
    await mappingOf(page, 'points.csv');
    expect((await rect(p.heads.first())).width).toBe(160);
    expect((await rect(p.rows.first().locator('td').first())).height).toBe(28);
    const aligns = await p.rows
      .first()
      .locator('td')
      .evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).textAlign));
    expect(aligns).toEqual(['right', 'right', 'right', 'left', 'right', 'left']);
  });

  test('cuts a long column name and a long value with an ellipsis, and gives the whole of it as a title', async ({
    page,
  }) => {
    const p = parts(page);
    const longName = 'A column name that is sixty characters long, or a little over, so it is cut';
    const longValue =
      'a very long value that does not fit in a column of 160 pixels, not by a long way';
    await mappingOf(page, {
      name: 'long.csv',
      mimeType: 'text/csv',
      // Quoted, since the name and the value have commas in them.
      buffer: Buffer.from(`"${longName}",y\n"${longValue}",2\n`),
    });
    await expect(p.names.first()).toHaveAttribute('title', longName);
    expect(
      await p.names.first().evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(true);
    const cell = p.rows.first().locator('td').first();
    expect(await cell.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect(cell).toHaveAttribute('title', /a very long value that does not fit/);
    await assertNoOverflow(p.dialog);
  });

  test('says that a file without columns has nothing to map', async ({ page }) => {
    const p = parts(page);
    for (const [file, text] of [
      ['mixed.geojson', /A GeoJSON file has no columns/],
      ['grid.asc', /An ESRI ASCII grid has no columns/],
      ['mesh.obj', /An OBJ file has no columns/],
    ] as const) {
      await page.goto('/');
      await mappingOf(page, file);
      await expect(p.note, file).toContainText(text);
      await expect(p.step.locator('table'), file).toHaveCount(0);
      await expect(p.next.locator('button'), file).toBeEnabled();
    }
  });

  test('has the keyboard go from one selector to the next, in the order of the columns', async ({
    page,
  }) => {
    const p = parts(page);
    await mappingOf(page, 'points.csv');
    await page.keyboard.press('Shift');
    await p.selects.first().focus();
    for (let index = 1; index < 6; index += 1) {
      await page.keyboard.press('Tab');
      await expect(p.selects.nth(index)).toBeFocused();
    }
  });

  for (const theme of ['light', 'dark']) {
    test(`is readable and has no serious accessibility violations (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/?theme=${theme}`);
      await mappingOf(page, 'points.csv');
      await expectNoSeriousViolations(page);
    });
  }
});
