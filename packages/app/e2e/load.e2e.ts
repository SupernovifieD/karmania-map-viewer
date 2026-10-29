import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { pickFiles } from './support/picker.js';
import type { Pick } from './support/picker.js';

function parts(page: Page) {
  const host = page.locator('karmania-import-dialog');
  return {
    host,
    dialog: host.locator('dialog'),
    body: host.locator('.step'),
    verdict: host.locator('karmania-review-step .verdict'),
    rows: host.locator('karmania-file-step .file'),
    row: (name: string) => host.locator(`karmania-file-step .file[data-file="${name}"]`),
    map: page.locator('karmania-map-area k-empty-state'),
    tabs: page.locator('karmania-panel k-tabs [role="tab"]'),
    next: host.locator('k-button[slot="footer-end"]').nth(1),
    cancel: host.locator('k-button[slot="footer-start"]'),
    importButton: page.locator('karmania-app header.toolbar k-button button'),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

const PRJ = (name: string): Pick => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from('PROJCS["x",AUTHORITY["EPSG","32640"]]'),
});

const csv = (name: string, text: string): Pick => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(text),
});

/** Two data files, each with its projection file. */
const TWO: Pick[] = [
  csv('a.csv', 'x,y\n1,2\n3,4\n'),
  PRJ('a.prj'),
  csv('b.csv', 'x,y\n5,6\n7,8\n9,10\n'),
  PRJ('b.prj'),
];

/** What the app holds: the datasets, the one that is selected. */
const appState = (page: Page) =>
  page.evaluate(() => {
    const app = document.querySelector('karmania-app') as unknown as {
      datasets: { id: number; name: string; elementCount: number }[];
      selected: number | undefined;
      engine: { datasets: () => { id: number }[] } | undefined;
    };
    return {
      datasets: app.datasets.map((each) => [each.id, each.name, each.elementCount]),
      selected: app.selected,
      inEngine: app.engine?.datasets().map((each) => each.id) ?? [],
    };
  });

/** Goes through the steps of the file now being imported, to the Review step, and waits for it to be done. */
async function goToReview(page: Page): Promise<void> {
  const p = parts(page);
  for (const step of ['mapping', 'nodata', 'crs', 'review']) {
    await p.next.click();
    await expect(p.host.locator(`.step[data-step="${step}"]`)).toBeVisible();
  }
  await expect(p.verdict).toHaveText('Ready to load');
}

async function start(page: Page, ...picks: Pick[]): Promise<void> {
  const p = parts(page);
  await pickFiles(
    page,
    async () => {
      await p.importButton.click();
    },
    picks,
  );
  await expect(p.host.locator('karmania-file-step')).toBeVisible();
}

test.describe('loading what was imported', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('closes the dialog, and the map area says how many datasets there are', async ({ page }) => {
    const p = parts(page);
    await expect(p.map).toContainText('No data yet');
    await start(page, 'points.csv', 'points.prj');
    await goToReview(page);
    await p.next.click();
    await expect(p.dialog).toBeHidden();
    await expect(p.map).toContainText('Map rendering arrives in phase 2');
    await expect(p.map).toContainText('1 dataset loaded');
  });

  test('selects the new dataset, and keeps what the engine holds', async ({ page }) => {
    const p = parts(page);
    await start(page, 'points.csv', 'points.prj');
    await goToReview(page);
    await p.next.click();
    await expect(p.dialog).toBeHidden();
    const state = await appState(page);
    expect(state.datasets).toHaveLength(1);
    expect(state.datasets[0]?.slice(1)).toEqual(['points', 8]);
    expect(state.selected).toBe(state.datasets[0]?.[0]);
    expect(state.inEngine).toEqual([state.datasets[0]?.[0]]);
  });

  test('opens the Data tab', async ({ page }) => {
    const p = parts(page);
    await expect(p.tabs.filter({ hasText: 'Legend' })).toHaveAttribute('aria-selected', 'true');
    await start(page, 'points.csv', 'points.prj');
    await goToReview(page);
    await p.next.click();
    await expect(p.dialog).toBeHidden();
    await expect(p.tabs.filter({ hasText: 'Data' })).toHaveAttribute('aria-selected', 'true');
    // And it is kept, as the tab a person chose is.
    expect(await page.evaluate(() => localStorage.getItem('karmania.panel'))).toContain(
      '"tab":"data"',
    );
  });

  test('opens a panel that was folded away, on the Data tab', async ({ page }) => {
    const p = parts(page);
    await page.evaluate(() => {
      localStorage.setItem(
        'karmania.panel',
        JSON.stringify({ collapsed: true, tab: 'legend', width: 360 }),
      );
    });
    await page.reload();
    await expect(page.locator('karmania-panel')).toHaveAttribute('collapsed', '');
    await start(page, 'points.csv', 'points.prj');
    await goToReview(page);
    await p.next.click();
    await expect(p.dialog).toBeHidden();
    await expect(page.locator('karmania-panel')).not.toHaveAttribute('collapsed');
    await expect(p.tabs.filter({ hasText: 'Data' })).toHaveAttribute('aria-selected', 'true');
    expect((await rect(page.locator('karmania-panel'))).width).toBe(360);
  });

  test('gives the keyboard back to the Import button', async ({ page }) => {
    const p = parts(page);
    await page.keyboard.press('Shift');
    await p.importButton.focus();
    await pickFiles(page, async () => {
      await page.keyboard.press('Enter');
    }, ['points.csv', 'points.prj']);
    await expect(p.host.locator('karmania-file-step')).toBeVisible();
    await goToReview(page);
    await p.next.click();
    await expect(p.dialog).toBeHidden();
    await expect(p.importButton).toBeFocused();
  });

  test('loads every dataset a file with several kinds of shape gives, and selects the first', async ({
    page,
  }) => {
    const p = parts(page);
    await start(page, 'mixed.geojson');
    await goToReview(page);
    await p.next.click();
    await expect(p.dialog).toBeHidden();
    const state = await appState(page);
    expect(state.datasets.length).toBeGreaterThan(1);
    expect(state.selected).toBe(state.datasets[0]?.[0]);
    await expect(p.map).toContainText(`${String(state.datasets.length)} datasets loaded`);
  });

  test('goes on to the next file when several were given, and the first is loaded by then', async ({
    page,
  }) => {
    const p = parts(page);
    await start(page, ...TWO);
    await expect(p.rows).toHaveCount(2);
    await expect(p.row('a.csv').locator('.status')).toHaveText('Importing now');
    await expect(p.row('b.csv').locator('.status')).toHaveText('Waiting');
    await goToReview(page);
    await p.next.click();
    // The dialog stays, at the start, for the second file.
    await expect(p.dialog).toBeVisible();
    await expect(p.body).toHaveAttribute('data-step', 'file');
    await expect(p.row('a.csv').locator('.status')).toHaveText('Loaded');
    await expect(p.row('b.csv').locator('.status')).toHaveText('Importing now');
    await expect(p.host.locator('karmania-file-step .about h3')).toHaveText('Settings for b.csv');
    await expect(p.host.locator('karmania-file-step k-input input')).toHaveValue('b');
    // What the first made is loaded and selected, and the map area has been told.
    await expect(p.map).toContainText('1 dataset loaded');
    const first = await appState(page);
    expect(first.datasets.map((each) => each.slice(1))).toEqual([['a', 2]]);
    expect(first.selected).toBe(first.datasets[0]?.[0]);

    await goToReview(page);
    await p.next.click();
    await expect(p.dialog).toBeHidden();
    const second = await appState(page);
    expect(second.datasets.map((each) => each.slice(1))).toEqual([
      ['a', 2],
      ['b', 3],
    ]);
    // The one loaded last is the one selected.
    expect(second.selected).toBe(second.datasets[1]?.[0]);
    await expect(p.map).toContainText('2 datasets loaded');
  });

  test('passes by a file that cannot be imported when it goes on to the next', async ({ page }) => {
    const p = parts(page);
    await start(
      page,
      csv('a.csv', 'x,y\n1,2\n'),
      PRJ('a.prj'),
      'esri.prj',
      csv('c.csv', 'x,y\n3,4\n'),
      PRJ('c.prj'),
    );
    await expect(p.row('esri.prj').locator('.status')).toHaveText('Cannot be imported');
    await goToReview(page);
    await p.next.click();
    await expect(p.host.locator('karmania-file-step .about h3')).toHaveText('Settings for c.csv');
    await expect(p.row('esri.prj').locator('.status')).toHaveText('Cannot be imported');
  });

  test('keeps the first file when the second is cancelled, and loses only the second', async ({
    page,
  }) => {
    const p = parts(page);
    await start(page, ...TWO);
    await goToReview(page);
    await p.next.click();
    await expect(p.row('b.csv').locator('.status')).toHaveText('Importing now');
    await goToReview(page);
    expect((await appState(page)).inEngine).toHaveLength(2);
    await p.cancel.click();
    await expect(p.dialog).toBeHidden();
    await expect.poll(async () => (await appState(page)).inEngine.length).toBe(1);
    const state = await appState(page);
    expect(state.datasets.map((each) => each.slice(1))).toEqual([['a', 2]]);
    await expect(p.map).toContainText('1 dataset loaded');
  });

  test('says nothing is loaded when the wizard is cancelled before anything was', async ({
    page,
  }) => {
    const p = parts(page);
    await start(page, 'points.csv', 'points.prj');
    await goToReview(page);
    await p.cancel.click();
    await expect(p.dialog).toBeHidden();
    await expect(p.map).toContainText('No data yet');
    expect((await appState(page)).datasets).toEqual([]);
    await expect(
      page.locator('karmania-panel k-tabs [role="tab"]').filter({ hasText: 'Legend' }),
    ).toHaveAttribute('aria-selected', 'true');
  });
});
