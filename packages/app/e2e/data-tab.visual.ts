/**
 * A photograph of the whole app with the Data tab open, in each of the states that look different:
 * nothing loaded, one dataset, so many that the list scrolls, names too long for their rows, and a
 * dataset with warnings, at three window sizes in both themes. Run with `pnpm test:visual` (it needs
 * Docker); `pnpm test:visual:update` takes them again, and the new pictures have to be looked at before
 * they are committed.
 */
import { readFileSync } from 'node:fs';
import { test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { fixturePath } from './support/picker.js';
import type { Pick } from './support/picker.js';
import { photograph } from './support/screenshots.js';
import type { Shot } from './support/screenshots.js';
import { importAndLoad } from './support/wizard.js';

test.use({ reducedMotion: 'reduce' });

const KEY = 'karmania.panel';

const app = (page: Page): Locator => page.locator('karmania-app');
const table = (page: Page): Locator => page.locator('karmania-data-tab k-table');

/** A sample file of the repository, under the name it is to be chosen as. */
function fixture(name: string, as = name): Pick {
  return { name: as, mimeType: 'text/plain', buffer: readFileSync(fixturePath(name)) };
}

/** A projection file that says the coordinate system, for a file that has none of its own. */
const projectionFor = (file: string): Pick => fixture('points.prj', file);

const csv = (name: string, text: string): Pick => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(text),
});

/** Opens the app with the panel on the Data tab, as a person who left it there would find it. */
async function openOnData(page: Page): Promise<void> {
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [KEY, JSON.stringify({ collapsed: false, tab: 'data', width: 360 })] as const,
  );
  await page.reload();
}

/** Takes the keyboard off whatever has it, and the pointer off the page, and waits for the fonts. */
async function rest(page: Page): Promise<Locator[]> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    (active as HTMLElement | null)?.blur();
  });
  await page.mouse.move(0, 0);
  return [app(page)];
}

/** Loads files, and waits for the table to have its first rows. */
async function load(page: Page, ...picks: Pick[]): Promise<void> {
  await importAndLoad(page, ...picks);
  await table(page).locator('.rows [role="row"]').first().waitFor();
}

/** Points with a point twice: loaded, with a warning. */
const TWICE = [csv('twice.csv', 'x,y\n1,2\n1,2\n3,4\n'), projectionFor('twice.prj')];

/** A name that no row of the list is wide enough for, and a column, and words, to match. */
const LONG = 'a_remarkably_long_dataset_name_that_cannot_fit_in_a_row_of_the_list_beside_its_count';
const LONG_ROWS = [
  'Easting,Northing,RL,a_column_whose_name_is_longer_than_any_column_can_be,Notes',
  ...Array.from({ length: 12 }, (_, index) => {
    const row = String(index + 1);
    return `${String(500_000 + index * 25)},${String(2_765_000 + index * 40)},${String(100 + index)},${row},"A description of row ${row} that goes on and on, a good deal further than three hundred and twenty pixels allow"`;
  }),
].join('\n');

const SHOTS: Shot[] = [
  {
    name: 'data-tab-empty',
    show: async (page) => {
      await openOnData(page);
      return rest(page);
    },
  },
  {
    name: 'data-tab-one',
    show: async (page) => {
      await load(page, 'points.csv', 'points.prj');
      return rest(page);
    },
  },
  {
    // Six datasets, one more than the list shows: it scrolls, and the one that was loaded last, which
    // is selected, is in it.
    name: 'data-tab-many',
    show: async (page) => {
      await load(page, 'mixed.geojson');
      await load(page, 'points.csv', 'points.prj');
      await load(page, fixture('lines.csv'), projectionFor('lines.prj'));
      await load(page, fixture('grid.asc'), projectionFor('grid.prj'));
      return rest(page);
    },
  },
  {
    name: 'data-tab-long-names',
    show: async (page) => {
      await load(page, 'points.csv', 'points.prj');
      await load(page, csv(`${LONG}.csv`, LONG_ROWS), projectionFor(`${LONG}.prj`));
      return rest(page);
    },
  },
  {
    name: 'data-tab-warnings',
    show: async (page) => {
      await load(page, ...TWICE);
      await page
        .locator('karmania-dataset-summary summary')
        .filter({ hasText: /warning/ })
        .click();
      await page.locator('karmania-dataset-summary details[open]').first().waitFor();
      return rest(page);
    },
  },
  {
    // The keyboard in the table, in the app: the ring is on a cell, and the list and summary above
    // have none.
    name: 'data-tab-table-focus',
    show: async (page) => {
      await load(page, 'points.csv', 'points.prj');
      await page.keyboard.press('Shift');
      await table(page).locator('.viewport').focus();
      for (const key of ['ArrowDown', 'ArrowRight', 'ArrowRight']) {
        await page.keyboard.press(key);
      }
      await table(page).locator('.cell.active').waitFor();
      await page.mouse.move(0, 0);
      return [app(page)];
    },
  },
];

for (const each of SHOTS) {
  test(`the state "${each.name}", at every window size in both themes`, async ({ page }) => {
    await photograph(page, '/', each);
  });
}
