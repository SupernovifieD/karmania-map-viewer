import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { layoutOf } from './support/layout-snapshot.js';
import { inEveryLayout } from './support/layouts.js';
import {
  assertAdjacent,
  assertAligned,
  assertNoOverflow,
  assertNoOverlap,
  boxOf,
  textStartOf,
} from './support/layout.js';

const KEY = 'karmania.panel';

const app = (page: Page) => page.locator('karmania-app');
const map = (page: Page) => page.locator('karmania-map-area');
const panel = (page: Page) => page.locator('karmania-panel');
const host = (page: Page) => page.locator('karmania-resize-handle');
const handle = (page: Page) => host(page).getByRole('separator', { name: 'Resize panel' });
const line = (page: Page) => host(page).locator('.line');
const tab = (page: Page, name: string) => panel(page).getByRole('tab', { name });

/** The most a panel can be wide in a window of this width: half of it, up to 640. */
const widest = (viewport: number): number => Math.min(viewport / 2, 640);

/** How wide the panel is, as the layout has it. */
async function panelWidth(page: Page): Promise<number> {
  return (await boxOf(panel(page), 'the panel')).width;
}

/** What is kept for the panel, as an object, or null. */
async function kept(page: Page): Promise<Record<string, unknown> | null> {
  const text = await page.evaluate((key) => localStorage.getItem(key), KEY);
  return text === null ? null : (JSON.parse(text) as Record<string, unknown>);
}

/** Drags the edge of the panel to `x`, in the window, with the mouse, in small steps. */
async function dragTo(page: Page, x: number): Promise<void> {
  const edge = await boxOf(handle(page), 'the handle');
  const y = edge.y + edge.height / 2;
  await page.mouse.move(edge.x + edge.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
}

/** A few computed style values of an element. */
function styleOf(locator: Locator, ...properties: string[]): Promise<string[]> {
  return locator.evaluate((element, names) => {
    const style = getComputedStyle(element);
    return names.map((name) => style.getPropertyValue(name));
  }, properties);
}

test.describe('the panel resize handle', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('is a strip of 6 across the edge of the panel, centred on it, as high as the workspace', async ({
    page,
  }) => {
    await inEveryLayout(page, '/', async ({ viewport }) => {
      const strip = await boxOf(host(page), 'the handle');
      const edge = await boxOf(panel(page), 'the panel');
      expect([strip.width, strip.y, strip.height]).toEqual([6, 48, viewport.height - 48]);
      // Centred on the edge of the panel (its border is the first pixel), to within a pixel.
      expect(Math.abs(strip.x + strip.width / 2 - edge.x)).toBeLessThanOrEqual(0.5);
      expect(strip.x).toBe(edge.x - 3);
      await assertNoOverflow(app(page));
    });
  });

  test('is a separator that can be focused, called Resize panel, with the width as its value', async ({
    page,
  }) => {
    await inEveryLayout(page, '/', async ({ viewport }) => {
      await expect(handle(page)).toHaveAttribute('aria-orientation', 'vertical');
      await expect(handle(page)).toHaveAttribute('tabindex', '0');
      await expect(handle(page)).toHaveAttribute('aria-valuenow', '360');
      await expect(handle(page)).toHaveAttribute('aria-valuemin', '280');
      await expect(handle(page)).toHaveAttribute('aria-valuemax', String(widest(viewport.width)));
      await expect(handle(page)).toHaveAttribute('aria-valuetext', '360 pixels wide');
      await expect(page.getByRole('separator', { name: 'Resize panel' })).toHaveCount(1);
    });
  });

  test('starts at the width the stylesheets call usual', async ({ page }) => {
    await page.goto('/');
    const token = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--k-panel-width-default').trim(),
    );
    expect(token).toBe('360px');
    expect(await panelWidth(page)).toBe(360);
  });

  test('shows nothing at rest, a line of 2 in the accent color on the edge under the pointer, and shifts nothing', async ({
    page,
  }) => {
    for (const [theme, accent] of [
      ['light', 'rgb(26, 86, 196)'],
      ['dark', 'rgb(122, 167, 255)'],
    ] as const) {
      await page.goto(`/?theme=${theme}`);
      expect(await styleOf(handle(page), 'cursor')).toEqual(['col-resize']);
      expect(await styleOf(line(page), 'opacity')).toEqual(['0']);

      const quiet = await layoutOf(page, '.line');
      await handle(page).hover();
      await expect.poll(() => styleOf(line(page), 'opacity')).toEqual(['1']);
      expect(await styleOf(line(page), 'background-color')).toEqual([accent]);
      const edge = await boxOf(panel(page), 'the panel');
      const drawn = await boxOf(line(page), 'the line');
      // 2 wide, over the edge: one pixel on either side of it.
      expect([drawn.x, drawn.width]).toEqual([edge.x - 1, 2]);
      expect(await layoutOf(page, '.line')).toEqual(quiet);

      await page.mouse.move(100, 300);
      await expect.poll(() => styleOf(line(page), 'opacity')).toEqual(['0']);
    }
  });

  test('follows the mouse when it is dragged, wider to the left and narrower to the right', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const edge = await boxOf(panel(page), 'the panel');
    await dragTo(page, edge.x - 100);
    expect(await panelWidth(page)).toBe(460);
    // The edge is where the pointer was let go.
    expect((await boxOf(panel(page), 'the panel')).x).toBe(edge.x - 100);
    expect((await boxOf(map(page), 'the map area')).width).toBe(1440 - 460);
    await assertAdjacent(map(page), panel(page), 'horizontal');
    await assertNoOverlap(map(page), panel(page));
    await assertNoOverflow(app(page));
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '460');

    await dragTo(page, (await boxOf(panel(page), 'the panel')).x + 50);
    expect(await panelWidth(page)).toBe(410);
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '410');
  });

  test('shows the line for as long as it is dragged, wherever the pointer goes, and stops when it is let go', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const edge = await boxOf(handle(page), 'the handle');
    await page.mouse.move(edge.x + 3, 400);
    await page.mouse.down();
    await page.mouse.move(200, 700, { steps: 5 });
    await expect(handle(page)).toHaveAttribute('data-dragging', '');
    expect(await styleOf(line(page), 'opacity')).toEqual(['1']);
    // Dragging over the page's text selects none of it. (This holds in Chromium without any help;
    // the handle's `user-select: none` is for the browsers that are not tested.)
    expect(await page.evaluate(() => window.getSelection()?.type)).not.toBe('Range');
    await page.mouse.up();
    await expect(handle(page)).not.toHaveAttribute('data-dragging');
    // The pointer is far from the handle now, so it is not shown.
    await expect.poll(() => styleOf(line(page), 'opacity')).toEqual(['0']);
    // Moving without a button does not drag.
    const settled = await panelWidth(page);
    await page.mouse.move(100, 300, { steps: 4 });
    expect(await panelWidth(page)).toBe(settled);
  });

  test('keeps within the limits however far the pointer goes', async ({ page }) => {
    for (const [width, limit] of [
      [1024, 512],
      [1440, 640],
      [1920, 640],
    ] as const) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');
      await dragTo(page, 0);
      expect(await panelWidth(page), `widest at ${String(width)}`).toBe(limit);
      await dragTo(page, width - 1);
      expect(await panelWidth(page), `narrowest at ${String(width)}`).toBe(280);
      await page.evaluate(() => {
        localStorage.clear();
      });
    }
  });

  test('is not started by another button, or by the pointer let go and moved again', async ({
    page,
  }) => {
    await page.goto('/');
    const edge = await boxOf(handle(page), 'the handle');
    await page.mouse.move(edge.x + 3, 400);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(edge.x - 150, 400, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    expect(await panelWidth(page)).toBe(360);
  });

  test('moves 16 with Left and Right, and goes to the narrowest and widest with Home and End', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    // Tab to it as a person does: after the two Import buttons.
    for (let presses = 0; presses < 5; presses += 1) {
      if (await handle(page).evaluate((element) => element.matches(':focus'))) {
        break;
      }
      await page.keyboard.press('Tab');
    }
    await expect(handle(page)).toBeFocused();

    const widths: number[] = [];
    for (const key of [
      'ArrowLeft',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'ArrowRight',
      'End',
      'ArrowLeft',
    ]) {
      await page.keyboard.press(key);
      widths.push(await panelWidth(page));
    }
    // 360 -> 376 -> 392 -> 376; Home 280; Right stays at 280; End 640; Left stays at 640.
    expect(widths).toEqual([376, 392, 376, 280, 280, 640, 640]);
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '640');
    await page.keyboard.press('ArrowRight');
    expect(await panelWidth(page)).toBe(624);
    // Keys that are not the handle's leave the page to them.
    expect(
      await handle(page).evaluate((element) => {
        const event = new KeyboardEvent('keydown', { key: 'a', cancelable: true, bubbles: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(false);
  });

  test('has a line when the keyboard is on it, and not when it was clicked', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(handle(page)).toBeFocused();
    expect(await styleOf(line(page), 'opacity')).toEqual(['1']);
    // The order: toolbar Import, the map's Import, the handle, and then the panel's own tabs.
    await page.keyboard.press('Tab');
    await expect(tab(page, 'Legend')).toBeFocused();
    await page.mouse.move(100, 300);
    await expect.poll(() => styleOf(line(page), 'opacity')).toEqual(['0']);
    // A click gives it the keyboard, but the line is for the pointer over it or the keys.
    await handle(page).click();
    await page.mouse.move(100, 300);
    await expect(handle(page)).toBeFocused();
    await expect.poll(() => styleOf(line(page), 'opacity')).toEqual(['0']);
  });

  test('goes back to 360 on a double click, from any width', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    for (const start of ['ArrowLeft', 'Home', 'End']) {
      await handle(page).focus();
      await page.keyboard.press(start);
      expect(await panelWidth(page)).not.toBe(360);
      await handle(page).dblclick();
      expect(await panelWidth(page), `after ${start}`).toBe(360);
      await expect(handle(page)).toHaveAttribute('aria-valuenow', '360');
    }
  });

  test('limits the width the way the window allows, at every size', async ({ page }) => {
    await inEveryLayout(page, '/', async ({ viewport }) => {
      await page.evaluate(() => {
        localStorage.clear();
      });
      await page.reload();
      await handle(page).focus();
      await page.keyboard.press('End');
      expect(await panelWidth(page)).toBe(widest(viewport.width));
      await assertAdjacent(map(page), panel(page), 'horizontal');
      await assertNoOverflow(app(page));
      await page.keyboard.press('Home');
      expect(await panelWidth(page)).toBe(280);
      await assertNoOverflow(app(page));
      // The text of the panel starts 16 inside it at any width.
      const outer = await boxOf(panel(page), 'the panel');
      expect((await textStartOf(tab(page, 'Legend'))) - (outer.x + 1)).toBe(16);
      // The message of the Legend is in the middle of the body, whatever the width.
      const group = await boxOf(panel(page).locator('.group'), 'the message');
      const body = await boxOf(panel(page).locator('.body[slot="legend"]'), 'the body');
      expect(Math.abs(group.x + group.width / 2 - (body.x + body.width / 2))).toBeLessThanOrEqual(
        0.5,
      );
      await page.keyboard.press('End');
    });
  });

  test('follows the window: a wide panel gives way to a narrower window, and comes back with it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto('/');
    await handle(page).focus();
    await page.keyboard.press('End');
    expect(await panelWidth(page)).toBe(640);

    await page.setViewportSize({ width: 1024, height: 900 });
    await expect.poll(() => panelWidth(page)).toBe(512);
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '512');
    await expect(handle(page)).toHaveAttribute('aria-valuemax', '512');
    await assertNoOverflow(app(page));
    // What was asked for is what is kept, not what the small window allowed.
    expect((await kept(page))?.['width']).toBe(640);

    await page.setViewportSize({ width: 1920, height: 900 });
    await expect.poll(() => panelWidth(page)).toBe(640);
  });

  test('is kept between visits, and is read back as it was left', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await handle(page).focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await panelWidth(page)).toBe(408);
    expect(await kept(page)).toEqual({ collapsed: false, tab: 'legend', width: 408 });

    await page.reload();
    expect(await panelWidth(page)).toBe(408);
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '408');
    // After a drag too.
    await dragTo(page, 900);
    const dragged = await panelWidth(page);
    expect(dragged).toBe(540);
    await page.reload();
    expect(await panelWidth(page)).toBe(540);
  });

  test('is read carefully: a width that is not a width is the usual one, one that is too big or small is limited', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [kept, expected] of [
      ['"wide"', 360],
      ['null', 360],
      ['[500]', 360],
      ['-40', 280],
      ['100', 280],
      ['99999', 640],
      ['412.6', 413],
    ] as const) {
      await page.addInitScript(
        ([key, text]) => {
          localStorage.setItem(key, text);
        },
        [KEY, `{"collapsed":false,"tab":"legend","width":${kept}}`] as const,
      );
      await page.goto('/');
      expect(await panelWidth(page), `kept ${kept}`).toBe(expected);
    }
  });

  test('is not there when the panel is folded away, and is where it was when the panel is open again', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await handle(page).focus();
    await page.keyboard.press('ArrowLeft');
    expect(await panelWidth(page)).toBe(376);

    await panel(page).getByRole('button', { name: 'Collapse panel' }).click();
    await expect(host(page)).toHaveCount(0);
    expect(await panelWidth(page)).toBe(40);
    // The rail has nothing to resize.
    await expect(page.getByRole('separator')).toHaveCount(0);

    await panel(page).getByRole('button', { name: 'Expand panel' }).click();
    expect(await panelWidth(page)).toBe(376);
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '376');
    await page.reload();
    expect(await panelWidth(page)).toBe(376);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious accessibility violations in the ${theme} theme, with the keyboard on it`, async ({
      page,
    }) => {
      await page.goto(`/?theme=${theme}`);
      await handle(page).focus();
      await page.keyboard.press('ArrowLeft');
      await expectNoSeriousViolations(page);
    });
  }

  test('keeps the tabs and the collapse button aligned as the panel changes width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await handle(page).focus();
    for (const key of ['Home', 'End', 'ArrowRight']) {
      await page.keyboard.press(key);
      await assertAligned([tab(page, 'Legend'), tab(page, 'Data')], 'baseline');
      const button = await boxOf(
        panel(page).locator('k-button[label="Collapse panel"]'),
        'the collapse button',
      );
      const outer = await boxOf(panel(page), 'the panel');
      expect(outer.x + outer.width - (button.x + button.width), key).toBe(8);
    }
  });
});
