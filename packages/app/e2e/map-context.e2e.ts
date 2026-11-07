import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { dispatch, pause, pixels, sceneFrame, stats, withData } from './support/render.js';

const area = (page: Page) => page.locator('karmania-map-area');
const notice = (page: Page) => area(page).locator('.notice');

/**
 * What the extension of the browser that takes a context away and gives it back is asked to do, on the map's canvas. A context
 * that is lost does not hand out its extensions, so the page keeps the one it got while the context was there.
 */
function card(page: Page, what: 'lose' | 'restore'): Promise<void> {
  return page.evaluate((action) => {
    const holder = window as unknown as { loseContext?: WEBGL_lose_context };
    if (holder.loseContext === undefined) {
      const canvas = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer')
        ?.shadowRoot?.querySelector('karmania-map-area')
        ?.shadowRoot?.querySelector('canvas');
      const extension = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context');
      if (extension === null || extension === undefined) {
        throw new Error('The browser has no WEBGL_lose_context.');
      }
      holder.loseContext = extension;
    }
    if (action === 'lose') {
      holder.loseContext.loseContext();
    } else {
      holder.loseContext.restoreContext();
    }
  }, what);
}

/** The colour of the map area as the page has it now, as bytes. */
async function areaColour(page: Page): Promise<number[]> {
  const text = await area(page).evaluate((element) => getComputedStyle(element).backgroundColor);
  return [...(text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number), 255];
}

test.describe('the map when the graphics card takes the context away', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await withData(page);
  });

  test('says that it is redrawing the map, draws nothing meanwhile, and draws again when the card gives the context back', async ({
    page,
  }) => {
    await expect(notice(page)).toHaveCount(0);
    await card(page, 'lose');
    await expect.poll(async () => (await stats(page))?.contextLost).toBe(true);
    await expect(notice(page)).toHaveText('Redrawing the map…');
    await expect(notice(page)).toHaveAttribute('role', 'status');
    // A change of the scene asks for a frame, and none is drawn while the context is away.
    const frames = (await stats(page))?.frames;
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { centre: [5, 5] } } });
    await pause(page, 400);
    expect((await stats(page))?.frames).toBe(frames);
    await card(page, 'restore');
    await expect.poll(async () => (await stats(page))?.contextLost).toBe(false);
    await expect(notice(page)).toHaveCount(0);
    // And the map is drawn again, with the camera it had meanwhile.
    await expect.poll(async () => (await stats(page))?.frames ?? 0).toBeGreaterThan(frames ?? 0);
    const origin = (await sceneFrame(page))?.origin ?? [0, 0, 0];
    expect((await stats(page))?.frame.position.slice(0, 2)).toEqual([5 - origin[0], 5 - origin[1]]);
    expect(await pixels(page, [0, 0, 1, 1])).toEqual(await areaColour(page));
  });

  test('can lose the context and get it back more than once', async ({ page }) => {
    for (let round = 0; round < 3; round += 1) {
      await card(page, 'lose');
      await expect(notice(page)).toBeVisible();
      await card(page, 'restore');
      await expect(notice(page)).toHaveCount(0);
      expect(await pixels(page, [0, 0, 1, 1]), `round ${String(round)}`).toEqual(
        await areaColour(page),
      );
    }
  });

  test('puts the notice at the top, in the middle, 16 from the edge, and moves nothing', async ({
    page,
  }) => {
    // Something laid over the map to see that the notice moves: the words of the area when none of it can be drawn (told here).
    await area(page).evaluate(async (element) => {
      const held = element as unknown as { reasons: string[]; updateComplete: Promise<boolean> };
      held.reasons = ['Not drawn.'];
      await held.updateComplete;
    });
    const heading = area(page).locator('k-empty-state');
    const before = await heading.boundingBox();
    const map = await area(page).boundingBox();
    await card(page, 'lose');
    await expect(notice(page)).toBeVisible();
    const chip = await notice(page).boundingBox();
    expect(chip?.y).toBeCloseTo((map?.y ?? 0) + 16, 0);
    expect((chip?.x ?? 0) + (chip?.width ?? 0) / 2).toBeCloseTo(
      (map?.x ?? 0) + (map?.width ?? 0) / 2,
      0,
    );
    expect(chip?.height).toBe(24);
    expect(await heading.boundingBox()).toEqual(before);
    expect(await area(page).boundingBox()).toEqual(map);
  });

  test('has nothing to read while the context is away, and says so', async ({ page }) => {
    await card(page, 'lose');
    await expect.poll(async () => (await stats(page))?.contextLost).toBe(true);
    await expect(pixels(page, [0, 0, 1, 1])).rejects.toThrow('taken the context away');
    await card(page, 'restore');
    await expect.poll(async () => (await stats(page))?.contextLost).toBe(false);
    expect(await pixels(page, [0, 0, 1, 1])).toHaveLength(4);
  });

  test('is taken out of the page while the context is away without an error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await card(page, 'lose');
    await expect(notice(page)).toBeVisible();
    await page.evaluate(() => {
      document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer')
        ?.remove();
    });
    await pause(page, 300);
    expect(errors).toEqual([]);
  });

  test('has no accessibility violations with the notice shown, in both themes', async ({
    page,
  }) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.goto(`/?theme=${theme}`);
      await withData(page);
      await card(page, 'lose');
      await expect(notice(page)).toBeVisible();
      await expectNoSeriousViolations(page);
    }
  });
});
