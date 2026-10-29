import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';
import { importAndLoad } from './support/wizard.js';

function parts(page: Page) {
  const panel = page.locator('karmania-panel');
  const list = panel.locator('karmania-dataset-list');
  return {
    panel,
    list,
    rows: list.locator('li'),
    row: (name: string) => list.locator(`li[data-dataset="${name}"]`),
    choose: (name: string) => list.locator(`li[data-dataset="${name}"] .choose`),
    remove: (name: string) => list.locator(`li[data-dataset="${name}"] .remove k-button button`),
    scroller: list.locator('ul'),
    dialog: list.locator('dialog'),
    keep: list.locator('k-button[slot="footer-start"]'),
    confirm: list.locator('k-button[slot="footer-end"]'),
    map: page.locator('karmania-map-area k-empty-state'),
    emptyImport: panel.locator('karmania-data-tab k-empty-state k-button button'),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

interface Crafted {
  readonly id: number;
  readonly name: string;
  readonly kind: string;
  readonly elementCount: number;
  readonly warnings?: number;
}

/** Gives the app datasets that were not imported, to look at the list with: only what it shows is in them. */
async function setDatasets(page: Page, crafted: readonly Crafted[]): Promise<void> {
  await page.locator('karmania-app').evaluate(async (element, list) => {
    const app = element as unknown as {
      datasets: unknown[];
      selected: number | undefined;
      updateComplete: Promise<boolean>;
    };
    app.datasets = list.map((each) => ({
      id: each.id,
      name: each.name,
      kind: each.kind,
      elementCount: each.elementCount,
      hasZ: false,
      columns: [],
      findings: Array.from({ length: each.warnings ?? 0 }, (_, index) => ({
        code: 'values.points.duplicate',
        severity: 'warning',
        message: `Warning ${String(index + 1)}`,
        count: 1,
        examples: [],
      })),
    }));
    app.selected = list[0]?.id;
    await app.updateComplete;
  }, crafted);
  await page.locator('karmania-panel k-tabs [role="tab"]').filter({ hasText: 'Data' }).click();
}

const THREE: Crafted[] = [
  { id: 1, name: 'Collars', kind: 'points', elementCount: 1203, warnings: 3 },
  { id: 2, name: 'Faults', kind: 'lines', elementCount: 10_000_000 },
  { id: 3, name: 'Lease', kind: 'polygons', elementCount: 1 },
];

test.describe('the list of datasets', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('has a row of 40 for each dataset, with its name and how many elements it has', async ({
    page,
  }) => {
    const p = parts(page);
    await setDatasets(page, THREE);
    await expect(p.rows).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      expect((await rect(p.rows.nth(index))).height).toBe(40);
    }
    await expect(p.row('Collars').locator('.name')).toHaveText('Collars');
    await expect(p.row('Collars').locator('.count')).toHaveText('1,203');
    await expect(p.row('Faults').locator('.count')).toHaveText('10,000,000');
    await expect(p.row('Lease').locator('.count')).toHaveText('1');
  });

  test('shows the icon of each kind, 16, 16 in from the edge of the panel', async ({ page }) => {
    const p = parts(page);
    await setDatasets(page, THREE);
    const icons = await p.rows
      .locator('.icon')
      .evaluateAll((all) => all.map((icon) => icon.getAttribute('name')));
    expect(icons).toEqual(['map-pin', 'spline', 'pentagon']);
    const [panel, icon] = [await rect(p.panel), await rect(p.row('Collars').locator('.icon'))];
    expect(icon.x - panel.x - 1).toBe(16);
    expect([icon.width, icon.height]).toEqual([16, 16]);
  });

  test('shows a badge with the number of warnings, only where there are some, and keeps its room', async ({
    page,
  }) => {
    const p = parts(page);
    await setDatasets(page, THREE);
    await expect(p.row('Collars').locator('.badge')).toContainText('3');
    await expect(p.row('Collars').locator('.badge k-icon')).toHaveAttribute(
      'name',
      'triangle-alert',
    );
    await expect(p.row('Faults').locator('.badge k-icon')).toHaveCount(0);
    // The counts end at the same place whether or not there is a badge, since its room is kept.
    const ends = await Promise.all(
      ['Collars', 'Faults', 'Lease'].map(async (name) => {
        const box = await rect(p.row(name).locator('.count'));
        return Math.round(box.x + box.width);
      }),
    );
    expect(new Set(ends).size).toBe(1);
  });

  test('says what the numbers count, and the warnings, in words for those who cannot see the badge', async ({
    page,
  }) => {
    const p = parts(page);
    await setDatasets(page, THREE);
    await expect(
      p.list.getByRole('button', { name: /^Collars\s+1,203\s+points, 3 warnings$/ }),
    ).toBeVisible();
    await expect(
      p.list.getByRole('button', { name: /^Faults\s+10,000,000\s+lines$/ }),
    ).toBeVisible();
    await expect(p.list.getByRole('button', { name: /^Lease\s+1\s+polygon$/ })).toBeVisible();
  });

  test('aligns the counts to the right with the digits in line', async ({ page }) => {
    const p = parts(page);
    await setDatasets(page, THREE);
    const style = await p
      .row('Collars')
      .locator('.count')
      .evaluate((element) => {
        const computed = getComputedStyle(element);
        return [computed.textAlign, computed.fontVariantNumeric];
      });
    expect(style).toEqual(['right', 'tabular-nums']);
  });

  test('cuts a name of 120 characters with an ellipsis, gives all of it as a title, and nothing overflows', async ({
    page,
  }) => {
    const p = parts(page);
    const long = 'A dataset with a name that goes on and on, '.repeat(3).slice(0, 120);
    await setDatasets(page, [
      { id: 1, name: long, kind: 'points', elementCount: 12, warnings: 12 },
    ]);
    const name = p.rows.first().locator('.name');
    await expect(name).toHaveAttribute('title', long);
    expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await assertNoOverflow(p.list);
    // The remove button and the badge are still in the row, on the right.
    const [row, count] = [await rect(p.rows.first()), await rect(p.rows.first().locator('.count'))];
    expect(count.x + count.width).toBeLessThanOrEqual(row.x + row.width);
  });

  test('keeps the remove button out of sight until the row is pointed at or has the keyboard', async ({
    page,
  }) => {
    const p = parts(page);
    await setDatasets(page, THREE);
    // Faults is not selected, so its button is hidden until something brings it out.
    const opacity = () =>
      p
        .row('Faults')
        .locator('.remove')
        .evaluate((element) => getComputedStyle(element).opacity);
    await page.mouse.move(0, 0);
    expect(await opacity()).toBe('0');
    await p.row('Faults').hover();
    expect(await opacity()).toBe('1');
    await page.mouse.move(0, 0);
    await page.keyboard.press('Shift');
    await p.remove('Faults').focus();
    expect(await opacity()).toBe('1');
  });

  test('moves nothing when the remove button appears: its room was always there', async ({
    page,
  }) => {
    const p = parts(page);
    await setDatasets(page, THREE);
    await page.mouse.move(0, 0);
    const boxes = async () =>
      Promise.all(
        ['.icon', '.name', '.count', '.badge'].map((part) => rect(p.row('Faults').locator(part))),
      );
    const before = await boxes();
    await p.row('Faults').hover();
    expect(await boxes()).toEqual(before);
    const remove = await rect(p.row('Faults').locator('.remove k-button'));
    expect([remove.width, remove.height]).toEqual([32, 32]);
  });

  test('selects a dataset when its row is pressed, and says which is selected by more than a colour', async ({
    page,
  }) => {
    const p = parts(page);
    await setDatasets(page, THREE);
    await expect(p.choose('Collars')).toHaveAttribute('aria-current', 'true');
    await expect(p.choose('Faults')).not.toHaveAttribute('aria-current');
    await p.choose('Faults').click();
    await expect(p.choose('Faults')).toHaveAttribute('aria-current', 'true');
    await expect(p.choose('Collars')).not.toHaveAttribute('aria-current');
    expect(
      await page
        .locator('karmania-app')
        .evaluate((app) => (app as unknown as { selected: number }).selected),
    ).toBe(2);
    // A bar at the edge, a tint, and bold type.
    const style = await p.row('Faults').evaluate((row) => {
      const bar = getComputedStyle(row, '::before');
      return {
        bar: bar.content !== 'none' && bar.width !== '0px',
        weight: getComputedStyle(row.querySelector('.name') as Element).fontWeight,
      };
    });
    expect(style).toEqual({ bar: true, weight: '500' });
    const plain = await p.row('Lease').evaluate((row) => getComputedStyle(row, '::before').content);
    expect(plain).toBe('none');
  });

  test('can be gone through with the keyboard: Enter on a row selects it', async ({ page }) => {
    const p = parts(page);
    await setDatasets(page, THREE);
    await page.keyboard.press('Shift');
    await p.choose('Lease').focus();
    await page.keyboard.press('Enter');
    await expect(p.choose('Lease')).toHaveAttribute('aria-current', 'true');
    // Tab goes on to the remove button of the row, then to the next row.
    await page.keyboard.press('Tab');
    await expect(p.remove('Lease')).toBeFocused();
  });

  test('keeps five rows in view and scrolls the rest inside the list, with the selected one in sight', async ({
    page,
  }) => {
    const p = parts(page);
    const many = Array.from({ length: 9 }, (_, index) => ({
      id: index + 1,
      name: `Dataset ${String(index + 1)}`,
      kind: 'points',
      elementCount: (index + 1) * 100,
    }));
    await setDatasets(page, many);
    expect((await rect(p.scroller)).height).toBe(200);
    expect(
      await p.scroller.evaluate((element) => element.scrollHeight > element.clientHeight),
    ).toBe(true);
    await p.scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    // A dataset far down is selected from elsewhere (as a new one is, when it is loaded): it comes into view.
    await page.locator('karmania-app').evaluate(async (element) => {
      const app = element as unknown as { selected: number; updateComplete: Promise<boolean> };
      app.selected = 9;
      await app.updateComplete;
    });
    await expect.poll(() => p.scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const [view, row] = [await rect(p.scroller), await rect(p.row('Dataset 9'))];
    expect(row.y + row.height).toBeLessThanOrEqual(view.y + view.height + 1);
  });

  for (const theme of ['light', 'dark']) {
    test(`is readable and has no serious accessibility violations (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/?theme=${theme}`);
      await setDatasets(page, THREE);
      await p(page).remove('Faults').focus();
      await expectNoSeriousViolations(page);
    });
  }
});

const p = parts;

test.describe('loading and removing datasets', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('lists what an import made, a row for each dataset, the first selected', async ({
    page,
  }) => {
    const q = parts(page);
    await importAndLoad(page, 'mixed.geojson');
    await expect(q.rows).toHaveCount(3);
    const kinds = await q.rows
      .locator('.icon')
      .evaluateAll((all) => all.map((icon) => icon.getAttribute('name')).sort());
    expect(kinds).toEqual(['map-pin', 'pentagon', 'spline']);
    await expect(q.rows.first()).toHaveAttribute('data-selected', '');
  });

  test('asks before removing, and says what will be removed and that the file is left alone', async ({
    page,
  }) => {
    const q = parts(page);
    await importAndLoad(page, 'points.csv', 'points.prj');
    await q.remove('points').click();
    await expect(q.dialog).toBeVisible();
    await expect(q.dialog).toHaveAccessibleName('Remove dataset?');
    const confirm = q.list.locator('.confirm');
    await expect(confirm).toContainText('points');
    await expect(confirm).toContainText('8 points');
    await expect(confirm).toContainText('The file it came from is not changed.');
    // Keeping it removes nothing.
    await q.keep.click();
    await expect(q.dialog).toBeHidden();
    await expect(q.rows).toHaveCount(1);
    await expect(q.map).toContainText('1 dataset loaded');
  });

  test('keeps the dataset when the dialog is closed with Esc', async ({ page }) => {
    const q = parts(page);
    await importAndLoad(page, 'points.csv', 'points.prj');
    await q.remove('points').click();
    await expect(q.dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(q.dialog).toBeHidden();
    await expect(q.rows).toHaveCount(1);
  });

  test('removes it when that is confirmed, from the engine and from the list, and the map area says so', async ({
    page,
  }) => {
    const q = parts(page);
    await importAndLoad(page, 'mixed.geojson');
    await expect(q.map).toContainText('3 datasets loaded');
    const before = await page
      .locator('karmania-app')
      .evaluate((app) =>
        (app as unknown as { datasets: { id: number; name: string }[] }).datasets.map((d) => d.id),
      );
    const name = await q.rows.nth(1).getAttribute('data-dataset');
    await q.rows.nth(1).locator('.remove k-button button').click();
    await q.confirm.click();
    await expect(q.rows).toHaveCount(2);
    await expect(q.map).toContainText('2 datasets loaded');
    const state = await page.locator('karmania-app').evaluate((app) => {
      const held = app as unknown as {
        datasets: { id: number }[];
        selected: number;
        engine: { datasets: () => { id: number }[] };
      };
      return {
        shown: held.datasets.map((d) => d.id),
        engine: held.engine.datasets().map((d) => d.id),
        selected: held.selected,
      };
    });
    expect(state.shown).toEqual([before[0], before[2]]);
    expect(state.engine).toEqual(state.shown);
    expect(name).not.toBeNull();
  });

  test('selects the dataset that takes the place of the one removed, and puts the keyboard there', async ({
    page,
  }) => {
    const q = parts(page);
    await importAndLoad(page, 'mixed.geojson');
    const ids = await page
      .locator('karmania-app')
      .evaluate((app) =>
        (app as unknown as { datasets: { id: number }[] }).datasets.map((d) => d.id),
      );
    // The first is selected: removing it selects the next, which has the keyboard.
    await page.keyboard.press('Shift');
    await q.rows.first().locator('.remove k-button button').click();
    await q.confirm.click();
    await expect(q.rows).toHaveCount(2);
    const selected = await page
      .locator('karmania-app')
      .evaluate((app) => (app as unknown as { selected: number }).selected);
    expect(selected).toBe(ids[1]);
    await expect(q.rows.first().locator('.choose')).toBeFocused();
  });

  test('says nothing is loaded when the last dataset is removed, and puts the keyboard on Import', async ({
    page,
  }) => {
    const q = parts(page);
    await importAndLoad(page, 'points.csv', 'points.prj');
    await q.remove('points').click();
    await q.confirm.click();
    await expect(q.rows).toHaveCount(0);
    await expect(q.panel.locator('karmania-data-tab k-empty-state .heading')).toHaveText(
      'No data loaded',
    );
    await expect(q.map).toContainText('No data yet');
    await expect(q.emptyImport).toBeFocused();
  });
});
