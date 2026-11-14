import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { inEveryLayout } from './support/layouts.js';
import { assertNoOverflow, assertNoOverlap, boxOf } from './support/layout.js';
import { drawn, setViewMode, stats, withData } from './support/render.js';

/**
 * The furniture over the map in 3D (step 18.8c): the north arrow, the navigation group and the status chip are laid out as they are in 2D, at every
 * window size in both themes, with the panel at its widest, usual, narrowest and folded away, with no two overlapping and each 16 inside the edges of
 * the map; the scale bar is not there, as the brief says for 3D; and the status chip has a dash for the pointer's place, because there is none on a
 * map that is seen at an angle, and its button for the map's coordinate system.
 */

const KEY = 'karmania.panel';

const PIECES = {
  'the north arrow': 'karmania-north-arrow',
  'the navigation group': 'karmania-nav-group .group',
  'the status chip': 'karmania-status-chip .status',
} as const;

const piece = (page: Page, name: keyof typeof PIECES): Locator => page.locator(PIECES[name]);
const area = (page: Page): Locator => page.locator('karmania-map-area main');

function pairs(): [keyof typeof PIECES, keyof typeof PIECES][] {
  const names = Object.keys(PIECES) as (keyof typeof PIECES)[];
  return names.flatMap((first, index) =>
    names
      .slice(index + 1)
      .map((second): [keyof typeof PIECES, keyof typeof PIECES] => [first, second]),
  );
}

/** Starts the app with the panel kept as asked, the data drawn, and the view in 3D. */
async function mapIn3d(page: Page, kept: { width: number; collapsed?: boolean }): Promise<void> {
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [KEY, JSON.stringify({ collapsed: false, tab: 'data', ...kept })] as const,
  );
  await page.reload();
  await withData(page);
  if (kept.collapsed === true) {
    await page.locator('karmania-panel').getByRole('button', { name: 'Collapse panel' }).click();
    await expect(page.locator('karmania-panel .rail')).toBeVisible();
  }
  await setViewMode(page, '3d');
  await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
  await drawn(page);
  await page.evaluate(() => document.fonts.ready);
}

async function expectLaidOut(page: Page, what: string): Promise<void> {
  for (const [first, second] of pairs()) {
    await expect(piece(page, first), `${first} in ${what}`).toBeVisible();
    await assertNoOverlap(piece(page, first), piece(page, second));
  }
  // There is no scale bar in 3D.
  await expect(page.locator('karmania-scale-bar .scale'), `no scale bar in ${what}`).toHaveCount(0);
  const map = await boxOf(area(page), 'the map');
  for (const name of Object.keys(PIECES) as (keyof typeof PIECES)[]) {
    const box = await boxOf(piece(page, name), name);
    expect(box.x - map.x, `${name} from the left of the map, ${what}`).toBeGreaterThanOrEqual(16);
    expect(box.y - map.y, `${name} from the top of the map, ${what}`).toBeGreaterThanOrEqual(16);
    expect(
      map.x + map.width - (box.x + box.width),
      `${name} from the right, ${what}`,
    ).toBeGreaterThanOrEqual(16);
    expect(
      map.y + map.height - (box.y + box.height),
      `${name} from the bottom, ${what}`,
    ).toBeGreaterThanOrEqual(16);
  }
  await assertNoOverflow(page.locator('karmania-map-area'));
}

test.describe('the furniture of the map in 3D', () => {
  test('does not overlap at the narrowest the map gets, with the panel at its widest, at every window size in both themes', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await inEveryLayout(page, '/', async (layout) => {
      await mapIn3d(page, { width: 9999 });
      await expectLaidOut(page, `${layout.name}, the panel widest`);
    });
  });

  test('does not overlap with the panel at its usual width, narrowest or folded away, at every window size in both themes', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.goto('/');
    await inEveryLayout(page, '/', async (layout) => {
      await mapIn3d(page, { width: 360 });
      await expectLaidOut(page, `${layout.name}, the usual panel`);
      await mapIn3d(page, { width: 1 });
      await expectLaidOut(page, `${layout.name}, the panel narrowest`);
      await mapIn3d(page, { width: 360, collapsed: true });
      await expectLaidOut(page, `${layout.name}, the panel folded away`);
    });
  });

  test('has no scale bar, and a dash where the pointer’s place would be, with the pointer on the map, and the button of the map’s coordinate system', async ({
    page,
  }) => {
    await page.goto('/');
    await mapIn3d(page, { width: 360 });
    await expect(page.locator('karmania-scale-bar')).toHaveCount(0);
    const box = await boxOf(page.locator('karmania-map-area canvas'), 'the map');
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await page.waitForTimeout(200);
    // The chip says there is no reading: the numbers are empty and the dash is shown.
    const values = await page.locator('karmania-status-chip .value').allTextContents();
    expect(values.map((text) => text.trim())).toEqual(['', '']);
    await expect(page.locator('karmania-status-chip .coordinates')).toHaveAttribute('data-off', '');
    await expect(page.locator('karmania-status-chip .off')).toHaveText('—');
    await expect(page.locator('karmania-status-chip button.crs')).toHaveText('EPSG:32640');
    // And the scale bar is back in 2D, with the same furniture.
    await setViewMode(page, '2d');
    await expect(page.locator('karmania-scale-bar .scale')).toBeVisible();
  });
});
