import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixturePath } from './support/picker.js';
import type { Sample } from './support/picker.js';
import { goTo, importAndLoad, startWizard, wizard } from './support/wizard.js';

/** A sample file of the repository, under the name it is to be chosen as. */
function fixture(name: string, as = name): Sample {
  return { name: as, mimeType: 'text/plain', buffer: readFileSync(fixturePath(name)) };
}

/** A projection file for a data file that has none of its own, named after it so that it is paired. */
const projectionFor = (file: string): Sample => fixture('points.prj', file);

/** A block model has to be told how big its blocks are, which the other files do not. */
async function importBlocks(page: Page): Promise<void> {
  const w = wizard(page);
  await startWizard(page, fixture('blocks.csv'), projectionFor('blocks.prj'));
  await goTo(page, 'mapping');
  const sizes = w.host.locator('karmania-mapping-step .block-size input');
  for (let axis = 0; axis < 3; axis += 1) {
    await sizes.nth(axis).fill('10');
  }
  for (const step of ['nodata', 'crs', 'review']) {
    await goTo(page, step);
  }
  await expect(w.host.locator('karmania-review-step .verdict')).toHaveText('Ready to load');
  await w.next.click();
  await expect(w.dialog).toBeHidden();
}

/** One kind of dataset: how to load it, and what its table starts with. */
interface Kind {
  readonly kind: string;
  readonly load: (page: Page) => Promise<void>;
  /** The dataset to choose in the list, for a file that made several. */
  readonly choose?: string;
  /** The columns, in order, after the row number. */
  readonly heads: readonly string[];
  /** How many of them say what the row is, which is as many as the brief lists for the kind. */
  readonly derived: number;
  readonly rows: number;
  /** The first row, after its number. */
  readonly first: readonly string[];
}

const KINDS: readonly Kind[] = [
  {
    kind: 'points',
    load: (page) => importAndLoad(page, 'points.csv', 'points.prj'),
    heads: ['X', 'Y', 'Z', 'Hole', 'Au_ppm', 'Rock'],
    derived: 3,
    rows: 8,
    first: ['500010.5', '2765020.25', '120.4', 'DH001', '0.35', 'granite'],
  },
  {
    kind: 'points without heights',
    load: (page) => importAndLoad(page, 'mixed.geojson'),
    choose: 'mixed (points)',
    heads: ['X', 'Y', 'depth', 'name'],
    derived: 2,
    rows: 2,
    first: ['55.3', '25.2', '120.5', 'Well A'],
  },
  {
    kind: 'lines',
    load: (page) => importAndLoad(page, fixture('lines.csv'), projectionFor('lines.prj')),
    heads: ['line #', 'vertex count', 'Line'],
    derived: 2,
    rows: 2,
    first: ['1', '3', 'A'],
  },
  {
    kind: 'polygons',
    load: (page) => importAndLoad(page, 'mixed.geojson'),
    choose: 'mixed (polygons)',
    heads: ['polygon #', 'ring count', 'vertex count', 'feature_id', 'area_ha', 'name'],
    derived: 3,
    rows: 1,
    first: ['1', '2', '8', '4', '40', 'Lease'],
  },
  {
    kind: 'a mesh',
    load: (page) => importAndLoad(page, fixture('mesh.obj'), projectionFor('mesh.prj')),
    heads: ['triangle #', 'v1', 'v2', 'v3'],
    derived: 4,
    rows: 6,
    first: ['1', '1', '2', '5'],
  },
  {
    kind: 'a grid',
    load: (page) => importAndLoad(page, fixture('grid.asc'), projectionFor('grid.prj')),
    heads: ['i', 'j', 'cell centre X', 'cell centre Y', 'value'],
    derived: 4,
    rows: 12,
    first: ['1', '1', '500005', '2765005', '30'],
  },
  {
    kind: 'a block model',
    load: importBlocks,
    heads: ['i', 'j', 'k', 'centre X', 'centre Y', 'centre Z', 'Density', 'Domain'],
    derived: 6,
    rows: 18,
    first: ['1', '1', '1', '500005', '2765005', '95', '2.5', 'ore'],
  },
];

test.describe('the columns of the Data tab table', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  for (const kind of KINDS) {
    test(`of ${kind.kind} start with the ones that say what each row is, then the attributes`, async ({
      page,
    }) => {
      await kind.load(page);
      if (kind.choose !== undefined) {
        await page
          .locator(`karmania-dataset-list li[data-dataset="${kind.choose}"] .choose`)
          .click();
      }
      const table = page.locator('karmania-data-tab k-table');
      await expect(table.locator('.rows [role="row"]').first()).toBeVisible();
      await expect(table.locator('.header [role="columnheader"]')).toHaveText([
        '# Row',
        ...kind.heads,
      ]);
      await expect(table.locator('.viewport')).toHaveAttribute(
        'aria-rowcount',
        String(kind.rows + 1),
      );
      const rows = await table
        .locator('.rows [role="row"]')
        .evaluateAll((all) => all.map((row) => [...row.children].map((cell) => cell.textContent)));
      expect(rows).toHaveLength(kind.rows);
      expect(rows[0]).toEqual(['1', ...kind.first]);
      // Every row has a cell for every column.
      for (const cells of rows) {
        expect(cells).toHaveLength(kind.heads.length + 1);
      }
      // The columns that say what a row is are numbers, and are set on the right like any other.
      const numeric = await table
        .locator('.header [role="columnheader"]')
        .evaluateAll((all) => all.slice(1).map((heading) => heading.classList.contains('numeric')));
      expect(numeric.slice(0, kind.derived).every(Boolean), kind.kind).toBe(true);
    });
  }
});
