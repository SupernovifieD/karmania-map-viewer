import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { inEveryLayout } from './support/layouts.js';
import { assertNoOverflow, assertNoOverlap, boxOf } from './support/layout.js';
import { dispatch, withData } from './support/render.js';

/**
 * The furniture over the map is laid out so that no two pieces overlap (section 10.2 of the brief), for every pair, at every window size in
 * both themes, with the panel at its widest (the map at its narrowest, 512 wide at 1024), at its narrowest, and folded away; and with what
 * makes the pieces widest: the status chip with the longest coordinates the map can have, the scale bar at its widest, and the notice at
 * the top in the middle.
 */

const KEY = 'karmania.panel';

const PIECES = {
  'the north arrow': 'karmania-north-arrow',
  'the navigation group': 'karmania-nav-group .group',
  'the scale bar': 'karmania-scale-bar .scale',
  'the status chip': 'karmania-status-chip .status',
} as const;

const piece = (page: Page, name: keyof typeof PIECES): Locator => page.locator(PIECES[name]);
const area = (page: Page): Locator => page.locator('karmania-map-area main');

/** Every pair of the pieces, once. */
function pairs(): [keyof typeof PIECES, keyof typeof PIECES][] {
  const names = Object.keys(PIECES) as (keyof typeof PIECES)[];
  return names.flatMap((first, index) =>
    names
      .slice(index + 1)
      .map((second): [keyof typeof PIECES, keyof typeof PIECES] => [first, second]),
  );
}

/** Starts the app with the panel kept as asked, and the data drawn. */
async function mapWith(page: Page, kept: { width: number; collapsed?: boolean }): Promise<void> {
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
  await page.evaluate(() => document.fonts.ready);
}

/** Moves the pointer over the map, so that the chip has numbers in it, and waits for them. */
async function pointerOnTheMap(page: Page): Promise<void> {
  const box = await boxOf(page.locator('karmania-map-area canvas'), 'the map');
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await expect(page.locator('karmania-status-chip .value').first()).not.toHaveText('');
}

/** What is asked of the furniture: none overlap, each is 16 inside the edges of the map, and nothing sticks out of its place. */
async function expectLaidOut(page: Page, what: string): Promise<void> {
  for (const [first, second] of pairs()) {
    await expect(piece(page, first), `${first} in ${what}`).toBeVisible();
    await assertNoOverlap(piece(page, first), piece(page, second));
  }
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

/** The worst case for the chip: the biggest numbers with the most decimals, which is a map a millionth of a unit a pixel, far from the origin. */
async function theLongestCoordinates(page: Page): Promise<void> {
  await dispatch(page, {
    type: 'setCamera',
    patch: {
      camera2d: { centre: [9_999_999.123456, 19_999_999.123456], unitsPerPixel: 1e-7, heading: 0 },
    },
  });
  await pointerOnTheMap(page);
  await expect(page.locator('karmania-status-chip .value').first()).toContainText('9,999,999.');
}

test.describe('the furniture of the map', () => {
  test('does not overlap at the narrowest the map gets: the panel at its widest, at every window size in both themes', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await inEveryLayout(page, '/', async (layout) => {
      await mapWith(page, { width: 9999 });
      await expectLaidOut(page, `${layout.name}, the panel widest, the pointer off the map`);
      await pointerOnTheMap(page);
      await expectLaidOut(page, `${layout.name}, the panel widest, the pointer on the map`);
      await theLongestCoordinates(page);
      await expectLaidOut(page, `${layout.name}, the panel widest, the longest coordinates`);
    });
  });

  test('does not overlap with the panel at its usual width, at every window size in both themes', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await inEveryLayout(page, '/', async (layout) => {
      await mapWith(page, { width: 360 });
      await expectLaidOut(page, `${layout.name}, the usual panel`);
      await theLongestCoordinates(page);
      await expectLaidOut(page, `${layout.name}, the usual panel, the longest coordinates`);
    });
  });

  test('does not overlap with the panel at its narrowest, or folded away, at every window size in both themes', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.goto('/');
    await inEveryLayout(page, '/', async (layout) => {
      await mapWith(page, { width: 1 });
      await pointerOnTheMap(page);
      await expectLaidOut(page, `${layout.name}, the panel narrowest`);
      await mapWith(page, { width: 360, collapsed: true });
      await pointerOnTheMap(page);
      await expectLaidOut(page, `${layout.name}, the panel folded away`);
    });
  });

  test('does not overlap when the map is turned, and the scale bar is at its widest', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto('/');
    await mapWith(page, { width: 9999 });
    // A scale at which the nice length is the one that is nearly the whole 160 pixels: the bar and its label at their widest.
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { unitsPerPixel: 0.01, heading: 123 } },
    });
    await expect(page.locator('karmania-scale-bar .scale')).toContainText('1 m');
    const bar = await boxOf(page.locator('karmania-scale-bar .bar'), 'the bar');
    expect(bar.width).toBeLessThanOrEqual(160);
    await expectLaidOut(page, 'a turned map and a wide scale bar');
  });

  test('keeps the notice at the top in the middle clear of the north arrow, with the longest count of layers, at the narrowest map', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto('/');
    await mapWith(page, { width: 9999 });
    // What the map area says while layers are being prepared, with a count that is as long as the area allows.
    await area(page).evaluate((element) => {
      const host = element.getRootNode() as ShadowRoot;
      const mapArea = host.host as unknown as { preparing: number; progress: number };
      mapArea.preparing = 10_000_000;
      mapArea.progress = 0.5;
    });
    const notice = page.locator('karmania-map-area .notice');
    await expect(notice).toContainText('Preparing 10,000,000 layers');
    await assertNoOverlap(notice, piece(page, 'the north arrow'));
    const [map, box] = [await boxOf(area(page), 'the map'), await boxOf(notice, 'the notice')];
    expect(box.x).toBeGreaterThanOrEqual(map.x + 16);
    expect(box.x + box.width).toBeLessThanOrEqual(map.x + map.width - 16);
    expect(box.y - map.y).toBe(16);
  });
});
