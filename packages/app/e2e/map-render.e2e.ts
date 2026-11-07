import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { camera, dispatch, pause, pixels, sceneFrame, stats, withData } from './support/render.js';

const area = (page: Page) => page.locator('karmania-map-area');

/** The colour of the map area as the page has it now, as bytes: what the map is to be cleared to. */
async function areaColour(page: Page): Promise<number[]> {
  const text = await area(page).evaluate((element) => getComputedStyle(element).backgroundColor);
  const numbers = text.match(/\d+(\.\d+)?/g);
  return [...(numbers ?? []).slice(0, 3).map(Number), 255];
}

/** The pixel at the bottom left corner of the map, which nothing is drawn on. */
const corner = (page: Page) => pixels(page, [0, 0, 1, 1]);

test.describe('the renderer core', () => {
  test('clears the map to the colour of the map area, which is --k-surface-map, in both themes', async ({
    page,
  }) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.goto(`/?theme=${theme}`);
      await withData(page);
      const expected = await areaColour(page);
      // Not black, not transparent: the token itself.
      expect(
        expected.slice(0, 3).some((channel) => channel > 0),
        theme,
      ).toBe(true);
      expect(await corner(page), theme).toEqual(expected);
      const now = await stats(page);
      expect(now?.background, theme).toBe(
        `#${expected
          .slice(0, 3)
          .map((channel) => channel.toString(16).padStart(2, '0'))
          .join('')}`,
      );
    }
  });

  test('has the two themes apart: the light map is light and the dark one dark', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await withData(page);
    const light = await corner(page);
    await page.goto('/?theme=dark');
    await withData(page);
    const dark = await corner(page);
    expect(Math.min(...light.slice(0, 3))).toBeGreaterThan(200);
    expect(Math.max(...dark.slice(0, 3))).toBeLessThan(40);
  });

  test('follows the theme when it changes while the map is shown, and draws once for it', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    const first = await withData(page);
    await pause(page, 300);
    const before = (await stats(page))?.frames;
    await page.evaluate(() => {
      document.documentElement.dataset['theme'] = 'dark';
    });
    await expect.poll(async () => (await stats(page))?.background).not.toBe(first.background);
    const dark = await areaColour(page);
    expect(await corner(page)).toEqual(dark);
    // Once for the change (the read of the pixels is a frame too, which is why it is counted before it).
    expect((await stats(page))?.frames).toBeGreaterThan(before ?? 0);
    await page.evaluate(() => {
      document.documentElement.dataset['theme'] = 'light';
    });
    await expect.poll(async () => (await stats(page))?.background).toBe(first.background);
  });

  test('follows the preference of the system when the page does not say which theme', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const light = await withData(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(async () => (await stats(page))?.background).not.toBe(light.background);
    expect(await corner(page)).toEqual(await areaColour(page));
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(async () => (await stats(page))?.background).toBe(light.background);
  });

  test('looks through the camera of the scene, relative to the origin of its frame', async ({
    page,
  }) => {
    await page.goto('/');
    const first = await withData(page);
    const frame = (origin: readonly number[]) => ({
      type: 'setFrame',
      frame: { mapCrs: { kind: 'epsg', code: 32640 }, origin, source: 'auto' },
    });
    // The map's system is the file's (32640), so a new origin leaves the camera where it is; the frame is the engine's kind (auto), which the
    // pipeline leaves alone, where one a person chose is a choice that it follows.
    await dispatch(page, frame([0, 0, 0]));
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [1500, 2500], unitsPerPixel: 4, heading: 30 } },
    });
    await expect.poll(async () => (await stats(page))?.frame.position[0]).toBe(1500);
    const now = await stats(page);
    expect(now?.frame.left).toBeCloseTo((-first.cssWidth * 4) / 2, 6);
    expect(now?.frame.right).toBeCloseTo((first.cssWidth * 4) / 2, 6);
    expect(now?.frame.top).toBeCloseTo((first.cssHeight * 4) / 2, 6);
    expect(now?.frame.bottom).toBeCloseTo((-first.cssHeight * 4) / 2, 6);
    expect(now?.frame.position.slice(0, 2)).toEqual([1500, 2500]);
    // One unit above the heights that are drawn, looking down at them. The file's heights are 109.3 to 120.4, and the layer was prepared
    // with an origin at z 100 (the middle of them to the nearest 100), so they are 9.3 to 20.4 from it: the camera is at 21.4, the highest is 1
    // away and the lowest 12.1.
    expect(now?.frame.position[2]).toBeCloseTo(21.4, 4);
    expect(now?.frame.near).toBe(0);
    expect(now?.frame.far).toBeCloseTo(20.4 - 9.3 + 2, 4);
    expect(now?.frame.rotation).toBeCloseTo((-30 * Math.PI) / 180, 12);
    // The origin of the frame is where the positions on the card are measured from, and a new origin in the same system
    // leaves the camera where it is on the map.
    await dispatch(page, frame([1000, 2000, 0]));
    await expect.poll(async () => (await stats(page))?.frame.position[0]).toBe(500);
    expect((await stats(page))?.frame.position.slice(0, 2)).toEqual([500, 500]);
    await dispatch(page, frame([1200, 2200, 0]));
    await expect.poll(async () => (await stats(page))?.frame.position[0]).toBe(300);
    expect((await stats(page))?.frame.position.slice(0, 2)).toEqual([300, 300]);
  });

  test('looks through the camera that the first view of the data made', async ({ page }) => {
    await page.goto('/');
    const now = await withData(page);
    const view = await camera(page);
    const frame = await sceneFrame(page);
    expect(view.unitsPerPixel).not.toBe(1);
    // The renderer was made before the fit, so it was given the camera that the fit made when the scene said so.
    expect(now.frame.position[0]).toBeCloseTo(view.centre[0] - (frame?.origin[0] ?? 0), 4);
    expect(now.frame.position[1]).toBeCloseTo(view.centre[1] - (frame?.origin[1] ?? 0), 4);
    expect(now.frame.right).toBeCloseTo((now.cssWidth * view.unitsPerPixel) / 2, 4);
  });

  test('draws one frame for any number of changes made together, and none for a change that changes nothing', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    await pause(page, 300);
    const settled = (await stats(page))?.frames ?? 0;
    const move = (x: number) => ({ type: 'setCamera', patch: { camera2d: { centre: [x, 0] } } });
    await dispatch(page, move(10), move(20), move(30));
    await expect.poll(async () => (await stats(page))?.frames).toBe(settled + 1);
    await pause(page, 300);
    expect((await stats(page))?.frames).toBe(settled + 1);
    // The same camera again is no change, and the scene says nothing, so nothing is drawn.
    await dispatch(page, move(30));
    await pause(page, 300);
    expect((await stats(page))?.frames).toBe(settled + 1);
  });

  test('refuses to read pixels that are not in the buffer', async ({ page }) => {
    await page.goto('/');
    const now = await withData(page);
    for (const rectangle of [
      [-1, 0, 1, 1],
      [0, 0, 0, 1],
      [0, 0, 1.5, 1],
      [now.width, 0, 1, 1],
      [0, 0, now.width + 1, 1],
    ] as const) {
      await expect(pixels(page, rectangle), rectangle.join()).rejects.toThrow('not in the buffer');
    }
    // A whole row is fine, and is as many bytes as it should be.
    expect(await pixels(page, [0, now.height - 1, now.width, 1])).toHaveLength(now.width * 4);
  });
});
