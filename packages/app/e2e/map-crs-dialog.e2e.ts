import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { dispatch, expectLayersDrawn, sceneFrame, withData } from './support/render.js';
import { importAsLocalGrid } from './support/wizard.js';

/** The parts of the map coordinate system dialog, and of the chip's button that opens it. */
function parts(page: Page) {
  const host = page.locator('karmania-map-crs-dialog');
  return {
    host,
    dialog: host.locator('dialog'),
    title: host.locator('dialog h2'),
    header: host.locator('dialog header'),
    body: host.locator('dialog .body'),
    footer: host.locator('dialog footer'),
    now: host.locator('.current'),
    search: host.locator('k-input input'),
    help: host.locator('k-input .help'),
    rows: host.locator('karmania-crs-matches .match'),
    radios: host.locator('karmania-crs-matches .match input'),
    note: host.locator('karmania-crs-matches .matches-note'),
    local: host.locator('.local'),
    localRadios: host.locator('.local input'),
    cancel: host.locator('k-button[slot="footer-start"]'),
    apply: host.locator('k-button[slot="footer-end"]'),
    footerNote: host.locator('span[slot="footer-note"]'),
    chip: page.locator('karmania-status-chip button.crs'),
  };
}

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${what} is not shown.`);
  }
  return box;
}

/** Loads the points and opens the dialog with the chip's button. */
async function open(page: Page): Promise<ReturnType<typeof parts>> {
  await page.goto('/');
  await withData(page);
  const p = parts(page);
  await p.chip.click();
  await expect(p.dialog).toBeVisible();
  return p;
}

/** Counts the times the dialog applies a system, with what each said, from now on. */
async function listenForApplies(page: Page): Promise<() => Promise<unknown[]>> {
  await page.evaluate(() => {
    const target = window as unknown as { applied: unknown[] };
    target.applied = [];
    document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer')
      ?.shadowRoot?.querySelector('karmania-map-crs-dialog')
      ?.addEventListener('karmania-map-crs-apply', (event) => {
        target.applied.push((event as CustomEvent).detail);
      });
  });
  return () => page.evaluate(() => (window as unknown as { applied: unknown[] }).applied);
}

test.describe('the map coordinate system dialog', () => {
  test('is closed until the chip’s button opens it, and is a modal dialog with a name', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    const p = parts(page);
    await expect(p.dialog).toBeHidden();
    await p.chip.click();
    await expect(p.dialog).toBeVisible();
    // A native modal dialog: what is behind it is inert, which the browser says with :modal.
    expect(await p.dialog.evaluate((element) => element.matches(':modal'))).toBe(true);
    await expect(p.title).toHaveText('Map coordinate system');
    await expect(page.getByRole('dialog', { name: 'Map coordinate system' })).toBeVisible();
  });

  test('has the frame of the wizard’s dialog: a header of 56, a body with 24 of padding, a footer of 64', async ({
    page,
  }) => {
    const p = await open(page);
    expect((await boxOf(p.header, 'the header')).height).toBe(56);
    expect((await boxOf(p.footer, 'the footer')).height).toBe(64);
    const padding = await p.body.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.paddingTop, style.paddingLeft, style.paddingRight];
    });
    expect(padding).toEqual(['24px', '24px', '24px']);
  });

  test('is 560 wide, or the window less 24 on each side when that is less', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const p = await open(page);
    expect((await boxOf(p.dialog, 'the dialog')).width).toBe(560);
    await page.setViewportSize({ width: 1024, height: 640 });
    expect((await boxOf(p.dialog, 'the dialog')).width).toBe(560);
    await page.setViewportSize({ width: 600, height: 640 });
    expect((await boxOf(p.dialog, 'the dialog')).width).toBe(552);
  });

  test('stays inside a window of 1024 by 640', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    const p = await open(page);
    const box = await boxOf(p.dialog, 'the dialog');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1024);
    expect(box.y + box.height).toBeLessThanOrEqual(640);
  });

  test('says the system the map is in, with its name and units, and where it came from', async ({
    page,
  }) => {
    const p = await open(page);
    await expect(p.now).toContainText('EPSG 32640, WGS 84 / UTM zone 40N');
    await expect(p.now).toContainText('Projected, in metres · Taken from the datasets');
  });

  test('says that a person chose it, once they have', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    await dispatch(page, {
      type: 'setFrame',
      frame: { mapCrs: { kind: 'epsg', code: 32641 }, origin: [0, 0, 0], source: 'user' },
    });
    await expect.poll(async () => (await sceneFrame(page))?.source).toBe('user');
    const p = parts(page);
    await p.chip.click();
    await expect(p.now).toContainText('EPSG 32641, WGS 84 / UTM zone 41N');
    await expect(p.now).toContainText('Chosen by you');
  });

  test('says a local grid in its units', async ({ page }) => {
    await page.goto('/');
    await importAsLocalGrid(page, 'ft', 'points.csv');
    await expectLayersDrawn(page, 1);
    const p = parts(page);
    await p.chip.click();
    await expect(p.now).toContainText('A local grid, in feet');
    await expect(p.now).toContainText('Taken from the datasets');
  });

  test('searches the definitions by name, and lists the matches to pick from', async ({ page }) => {
    const p = await open(page);
    await expect(p.note).toContainText('Type a code, or part of a name such as UTM zone 40');
    await p.search.fill('utm zone 40');
    await expect(p.rows.first()).toBeVisible();
    await expect(p.rows.filter({ hasText: 'WGS 84 / UTM zone 40N' })).toHaveCount(1);
    await expect(p.help).toHaveText(/matches?\.|The first 20 matches/);
    await p.search.fill('zzzzqq');
    await expect(p.note).toHaveText('No coordinate system matches zzzzqq.');
  });

  test('finds a system by its code, first', async ({ page }) => {
    const p = await open(page);
    await p.search.fill('32641');
    await expect(p.rows.first()).toContainText('EPSG 32641');
    await p.search.fill('EPSG:32641');
    await expect(p.rows.first()).toContainText('EPSG 32641');
  });

  test('has Apply disabled, and says why, until another system is chosen', async ({ page }) => {
    const p = await open(page);
    await expect(p.apply.locator('button')).toBeDisabled();
    await expect(p.footerNote).toHaveText('Choose a coordinate system to change to.');
    // The system the map is in is not a change.
    await p.search.fill('32640');
    await p.rows.first().click();
    await expect(p.radios.first()).toBeChecked();
    await expect(p.apply.locator('button')).toBeDisabled();
    await expect(p.footerNote).toHaveText('That is the coordinate system the map is in.');
    await p.search.fill('32641');
    await p.rows.first().click();
    await expect(p.apply.locator('button')).toBeEnabled();
    await expect(p.footerNote).toHaveCount(0);
  });

  test('offers no local grid when none is loaded', async ({ page }) => {
    const p = await open(page);
    await expect(p.local).toHaveCount(0);
  });

  test('offers the local grids that are loaded, each in its own units, once', async ({ page }) => {
    await page.goto('/');
    await importAsLocalGrid(page, 'ft', 'points.csv');
    await expectLayersDrawn(page, 1);
    await importAsLocalGrid(page, 'm', 'points.csv');
    await expectLayersDrawn(page, 2);
    await importAsLocalGrid(page, 'm', 'points.csv');
    const p = parts(page);
    await p.chip.click();
    await expect(p.local.locator('h3')).toHaveText('Local grid');
    await expect(p.localRadios).toHaveCount(2);
    await expect(p.local.locator('label')).toHaveText([
      'A local grid, in feet',
      'A local grid, in metres',
    ]);
    // Choosing one is a choice like another: Apply is enabled, and the match that was picked is let go.
    await p.search.fill('32641');
    await p.rows.first().click();
    await p.localRadios.nth(1).check();
    await expect(p.radios.first()).not.toBeChecked();
    await expect(p.apply.locator('button')).toBeEnabled();
    // And the other way round.
    await p.rows.first().click();
    await expect(p.localRadios.nth(1)).not.toBeChecked();
  });

  test('applies what was chosen, with the system, and closes', async ({ page }) => {
    const p = await open(page);
    const applied = await listenForApplies(page);
    await p.search.fill('32641');
    await p.rows.first().click();
    await p.apply.locator('button').click();
    await expect(p.dialog).toBeHidden();
    expect(await applied()).toEqual([{ crs: { kind: 'epsg', code: 32641 } }]);
  });

  test('does not apply the local grid that the map is in already: it is no change', async ({
    page,
  }) => {
    await page.goto('/');
    await importAsLocalGrid(page, 'ft', 'points.csv');
    await expectLayersDrawn(page, 1);
    const p = parts(page);
    await p.chip.click();
    const applied = await listenForApplies(page);
    await p.localRadios.first().check();
    await expect(p.apply.locator('button')).toBeDisabled();
    await expect(p.footerNote).toHaveText('That is the coordinate system the map is in.');
    await p.cancel.click();
    expect(await applied()).toEqual([]);
  });

  test('changes nothing when it is cancelled, and when Esc closes it, and starts afresh the next time', async ({
    page,
  }) => {
    const p = await open(page);
    const applied = await listenForApplies(page);
    const before = await sceneFrame(page);
    await p.search.fill('32641');
    await p.rows.first().click();
    await p.cancel.click();
    await expect(p.dialog).toBeHidden();
    await p.chip.click();
    await expect(p.dialog).toBeVisible();
    // Nothing is left of the visit before.
    await expect(p.search).toHaveValue('');
    await expect(p.apply.locator('button')).toBeDisabled();
    await p.search.fill('32641');
    await p.rows.first().click();
    await page.keyboard.press('Escape');
    await expect(p.dialog).toBeHidden();
    expect(await applied()).toEqual([]);
    expect(await sceneFrame(page)).toEqual(before);
  });

  test('gives the keyboard back to the button that opened it', async ({ page }) => {
    await page.goto('/');
    await withData(page);
    const p = parts(page);
    await p.chip.focus();
    await page.keyboard.press('Enter');
    await expect(p.dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(p.dialog).toBeHidden();
    await expect(p.chip).toBeFocused();
    await page.keyboard.press('Space');
    await expect(p.dialog).toBeVisible();
    await p.cancel.click();
    await expect(p.chip).toBeFocused();
  });

  test('can be used with the keyboard alone: Tab to the search, type, pick a match with the arrows, apply', async ({
    page,
  }) => {
    const p = await open(page);
    const applied = await listenForApplies(page);
    // The dialog has the keyboard; the first Tab goes to its close button, the next to the search field.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(p.search).toBeFocused();
    await page.keyboard.type('32641');
    await expect(p.rows.first()).toContainText('EPSG 32641');
    await page.keyboard.press('Tab');
    await expect(p.radios.first()).toBeFocused();
    await page.keyboard.press('Space');
    await expect(p.radios.first()).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(p.cancel.locator('button')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(p.apply.locator('button')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(p.dialog).toBeHidden();
    expect(await applied()).toEqual([{ crs: { kind: 'epsg', code: 32641 } }]);
  });

  test('has no serious accessibility violations, in either theme', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const p = await open(page);
      await p.search.fill('utm zone 40');
      await expect(p.rows.first()).toBeVisible();
      await expectNoSeriousViolations(page, [
        'karmania-app',
        'karmania-viewer',
        'karmania-map-crs-dialog',
      ]);
    }
  });
});
