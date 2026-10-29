import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';
import { importAndLoad } from './support/wizard.js';

function parts(page: Page) {
  const panel = page.locator('karmania-panel');
  const summary = panel.locator('karmania-dataset-summary');
  return {
    panel,
    summary,
    facts: summary.locator('dl'),
    fact: (term: string) => summary.locator(`dt:text-is("${term}") + dd`),
    columns: summary.locator('details.columns-list'),
    columnsHead: summary.locator('details.columns-list > summary'),
    columnRows: summary.locator('.column'),
    findings: summary.locator('details.findings-list'),
    findingsHead: summary.locator('details.findings-list > summary'),
    list: panel.locator('karmania-dataset-list'),
    choose: (name: string) => panel.locator(`li[data-dataset="${name}"] .choose`),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

/** A dataset, as the engine describes one, with only what a test says. */
function crafted(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    name: 'Collars',
    kind: 'points',
    elementCount: 1203,
    hasZ: true,
    crs: { kind: 'epsg', code: 32640 },
    bbox: { min: [500010.5, 2765020.25, 109.3], max: [500185.5, 2765205.25, 120.4] },
    columns: [],
    findings: [],
    ...over,
  };
}

async function setDatasets(
  page: Page,
  datasets: readonly Record<string, unknown>[],
): Promise<void> {
  await page.locator('karmania-app').evaluate(async (element, list) => {
    const app = element as unknown as {
      datasets: readonly unknown[];
      selected: number | undefined;
      updateComplete: Promise<boolean>;
    };
    app.datasets = list;
    app.selected = (list[0] as { id: number } | undefined)?.id;
    await app.updateComplete;
  }, datasets);
  await page.locator('karmania-panel k-tabs [role="tab"]').filter({ hasText: 'Data' }).click();
}

const WARNING = {
  code: 'values.points.duplicate',
  severity: 'warning',
  message: 'Some points are repeated at exactly the same position.',
  hint: 'Remove the repeated points if they are mistakes.',
  count: 12,
  examples: [{ row: 2 }, { row: 5 }, { row: 9 }, { row: 11 }],
};
const NOTE = {
  code: 'geojson.crs.assumed',
  severity: 'info',
  message: 'The file names no coordinate system, so EPSG 4326 was assumed.',
  count: 1,
  examples: [],
};

test.describe('the summary of the selected dataset', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('says what was imported: its kind, how much, its coordinate system and its box', async ({
    page,
  }) => {
    const p = parts(page);
    await importAndLoad(page, 'points.csv', 'points.prj');
    await expect(p.fact('Kind')).toHaveText('Points');
    await expect(p.fact('Size')).toHaveText('8 points');
    await expect(p.fact('Coordinates')).toHaveText('EPSG 32640');
    await expect(p.fact('Heights')).toHaveText('Yes (Z)');
    await expect(p.fact('X')).toHaveText('500010.5 to 500185.5');
    await expect(p.fact('Y')).toHaveText('2765020.25 to 2765205.25');
    await expect(p.fact('Z')).toHaveText('109.3 to 120.4');
    // A dataset that is just points has no vertices to count.
    await expect(p.summary.locator('dt:text-is("Vertices")')).toHaveCount(0);
  });

  test('says "Local" with its units for a local grid, and counts the vertices of what has them', async ({
    page,
  }) => {
    const p = parts(page);
    await setDatasets(page, [
      crafted({
        kind: 'mesh',
        name: 'Pyramid',
        elementCount: 6,
        vertexCount: 5,
        crs: { kind: 'local', units: 'us_ft' },
      }),
    ]);
    await expect(p.fact('Coordinates')).toHaveText('Local grid, US survey feet');
    await expect(p.fact('Size')).toHaveText('6 triangles');
    await expect(p.fact('Vertices')).toHaveText('5');
    await expect(p.fact('Kind')).toHaveText('Mesh');
  });

  test('leaves out the Z of a dataset with no heights, and says so', async ({ page }) => {
    const p = parts(page);
    await setDatasets(page, [crafted({ hasZ: false })]);
    await expect(p.fact('Heights')).toHaveText('No');
    await expect(p.summary.locator('.extent')).toHaveCount(2);
    await expect(p.summary.locator('.extent[data-axis="Z"]')).toHaveCount(0);
  });

  test('cuts a coordinate at six decimals, and gives it whole in a title', async ({ page }) => {
    const p = parts(page);
    await setDatasets(page, [
      crafted({ bbox: { min: [-123.456789012345, 0, 0], max: [-100.000000000001, 1, 1] } }),
    ]);
    await expect(p.fact('X')).toHaveText('-123.456789 to -100');
    await expect(p.fact('X')).toHaveAttribute('title', '-123.456789012345 to -100.000000000001');
  });

  test('lists the columns when asked, with their types and how many values are empty', async ({
    page,
  }) => {
    const p = parts(page);
    await importAndLoad(page, 'points.csv', 'points.prj');
    await expect(p.columnsHead).toContainText('Columns (3)');
    await expect(p.columns).not.toHaveAttribute('open');
    await p.columnsHead.click();
    await expect(p.columns).toHaveAttribute('open');
    await expect(p.columnRows).toHaveCount(3);
    const rows = await p.columnRows.evaluateAll((all) =>
      all.map((row) => [...row.children].map((cell) => cell.textContent.trim())),
    );
    expect(rows).toEqual([
      ['Hole', 'Category', 'none empty'],
      ['Au_ppm', 'Float', '2 empty'],
      ['Rock', 'Category', 'none empty'],
    ]);
    await p.columnsHead.click();
    await expect(p.columns).not.toHaveAttribute('open');
  });

  test('cuts the name of a column of 60 characters, and gives it whole in a title', async ({
    page,
  }) => {
    const p = parts(page);
    const name = 'A column name that is sixty characters long, or a little more';
    await setDatasets(page, [
      crafted({ columns: [{ name, type: 'float', nullCount: 1_204_000 }] }),
    ]);
    await p.columnsHead.click();
    const cell = p.columnRows.first().locator('.name');
    await expect(cell).toHaveAttribute('title', name);
    expect(await cell.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect(p.columnRows.first().locator('.empty')).toHaveText('1,204,000 empty');
    await assertNoOverflow(p.summary);
  });

  test('says there are no warnings when there are none, and no list to open', async ({ page }) => {
    const p = parts(page);
    await setDatasets(page, [crafted({})]);
    await expect(p.summary).toContainText('No warnings or notes.');
    await expect(p.findings).toHaveCount(0);
  });

  test('has the warnings and notes in a list that is shut until it is opened, grouped, with their detail', async ({
    page,
  }) => {
    const p = parts(page);
    await setDatasets(page, [crafted({ findings: [WARNING, NOTE] })]);
    await expect(p.findingsHead).toContainText('1 warning, 1 note');
    // Shut: the browser keeps what is in a list that is not open out of sight, and out of reach.
    await expect(p.findings).not.toHaveAttribute('open');
    await p.findingsHead.click();
    await expect(p.findings).toHaveAttribute('open');
    await expect(p.summary.locator('.group[data-severity="warning"] h4')).toHaveText(
      'Warnings (1)',
    );
    await expect(p.summary.locator('.group[data-severity="info"] h4')).toHaveText('Notes (1)');
    const warning = p.summary.locator('.group[data-severity="warning"] li');
    await expect(warning).toContainText('Some points are repeated at exactly the same position.');
    await expect(warning).toContainText('Remove the repeated points if they are mistakes.');
    await expect(warning).toContainText('Seen 12 times: row 3, row 6, row 10 and 9 more.');
    await expect(p.summary.locator('.group[data-severity="info"] li')).toContainText(
      'EPSG 4326 was assumed',
    );
  });

  test('opens with the keyboard, Enter or Space on its heading, and shows a focus ring', async ({
    page,
  }) => {
    const p = parts(page);
    await setDatasets(page, [crafted({ findings: [WARNING] })]);
    await page.keyboard.press('Shift');
    await p.findingsHead.focus();
    await page.keyboard.press('Enter');
    await expect(p.findings).toHaveAttribute('open');
    await page.keyboard.press('Space');
    await expect(p.findings).not.toHaveAttribute('open');
    expect(await p.findingsHead.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
      'solid',
    );
  });

  test('turns the arrow of a list that is opened, and moves nothing else', async ({ page }) => {
    const p = parts(page);
    await setDatasets(page, [crafted({ findings: [WARNING] })]);
    const facts = await rect(p.facts);
    const arrow = () =>
      p.findingsHead.locator('k-icon').evaluate((icon) => getComputedStyle(icon).rotate);
    expect(await arrow()).toBe('-90deg');
    await p.findingsHead.click();
    expect(await arrow()).toBe('0deg');
    expect(await rect(p.facts)).toEqual(facts);
  });

  test('follows the selection: another dataset, another summary', async ({ page }) => {
    const p = parts(page);
    await setDatasets(page, [
      crafted({ id: 1, name: 'Collars' }),
      crafted({
        id: 2,
        name: 'Faults',
        kind: 'lines',
        elementCount: 40,
        vertexCount: 900,
        hasZ: false,
      }),
    ]);
    await expect(p.fact('Kind')).toHaveText('Points');
    await p.choose('Faults').click();
    await expect(p.fact('Kind')).toHaveText('Lines');
    await expect(p.fact('Size')).toHaveText('40 lines');
    await expect(p.fact('Vertices')).toHaveText('900');
  });

  test('lines its text up with the list above it, 16 in from the edge of the panel', async ({
    page,
  }) => {
    const p = parts(page);
    await setDatasets(page, [
      crafted({ columns: [{ name: 'Hole', type: 'text', nullCount: 0 }], findings: [WARNING] }),
    ]);
    const panel = await rect(p.panel);
    const [term, listIcon, columns] = [
      await rect(p.summary.locator('dt').first()),
      await rect(p.list.locator('.icon').first()),
      await rect(p.columnsHead.locator('k-icon')),
    ];
    expect(term.x - panel.x - 1).toBe(16);
    expect(listIcon.x).toBe(term.x);
    expect(columns.x).toBe(term.x);
  });

  for (const theme of ['light', 'dark']) {
    test(`is readable and has no serious accessibility violations, with the lists open (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/?theme=${theme}`);
      await setDatasets(page, [
        crafted({
          columns: [{ name: 'Hole', type: 'text', nullCount: 3 }],
          findings: [WARNING, NOTE],
        }),
      ]);
      await parts(page).columnsHead.click();
      await parts(page).findingsHead.click();
      await expectNoSeriousViolations(page);
    });
  }
});
