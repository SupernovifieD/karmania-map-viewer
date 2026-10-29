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
} from './support/layout.js';

const KEY = 'karmania.panel';

const app = (page: Page) => page.locator('karmania-app');
const map = (page: Page) => page.locator('karmania-map-area');
const panel = (page: Page) => page.locator('karmania-panel');
const rail = (page: Page) => panel(page).locator('.rail');
const open = (page: Page) => panel(page).locator('.open');
const collapseButton = (page: Page) => panel(page).getByRole('button', { name: 'Collapse panel' });
const expandButton = (page: Page) => panel(page).getByRole('button', { name: 'Expand panel' });
const railButton = (page: Page, name: 'Legend' | 'Data') =>
  rail(page).getByRole('button', { name });
const tab = (page: Page, name: string) => panel(page).getByRole('tab', { name });
const body = (page: Page, id: 'legend' | 'data') => panel(page).locator(`.body[slot="${id}"]`);
/** The `k-button` element that has this name, which the inner button is in the shadow root of. */
const host = (page: Page, name: string) => panel(page).locator(`k-button[label="${name}"]`);
/** The tooltip bubble of the control that has this name, whether or not it is showing. */
const tip = (page: Page, name: string) => panel(page).locator(`k-tooltip[text="${name}"] .tip`);

/** Folds the panel away, or opens it, whichever it is not, and waits for the page to have moved. */
async function setCollapsed(page: Page, collapsed: boolean): Promise<void> {
  const isOpen = await collapseButton(page).isVisible();
  if (collapsed && isOpen) {
    await collapseButton(page).click();
  } else if (!collapsed && !isOpen) {
    await expandButton(page).click();
  }
  await expect(rail(page))
    .toBeHidden({ timeout: collapsed ? 1 : 5000 })
    .catch(() => undefined);
  await expect(open(page))
    .toBeHidden({ timeout: collapsed ? 5000 : 1 })
    .catch(() => undefined);
  await expect
    .poll(async () => (await boxOf(panel(page), 'the panel')).width)
    .toBe(collapsed ? 40 : 360);
}

/** What is kept for the panel, as text, or null. */
function kept(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), KEY);
}

test.describe('collapsing the panel into a rail', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('has a button at the end of the row that folds the panel away, and says the panel is expanded', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    const button = collapseButton(page);
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: 'Collapse panel', expanded: true })).toHaveCount(
      1,
    );
    const element = host(page, 'Collapse panel');
    await expect(element).toHaveAttribute('variant', 'ghost');
    await expect(element.locator('k-icon')).toHaveAttribute('name', 'chevrons-right');

    // 8 from the edge of the panel's content, centred on the 40 of the row.
    const outer = await boxOf(panel(page), 'the panel');
    const place = await boxOf(element, 'the button');
    expect(outer.x + outer.width - (place.x + place.width)).toBe(8);
    expect([place.y - outer.y, outer.y + 40 - (place.y + place.height)]).toEqual([4, 4]);
    expect([place.width, place.height]).toEqual([32, 32]);
    await expect(rail(page)).toBeHidden();
  });

  test('folds away into a rail of 40, with the map taking the room, at every size in both themes', async ({
    page,
  }) => {
    await inEveryLayout(page, '/', async ({ viewport }) => {
      await setCollapsed(page, true);
      const { width, height } = viewport;
      expect(await boxOf(panel(page), 'the panel')).toEqual({
        x: width - 40,
        y: 48,
        width: 40,
        height: height - 48,
      });
      expect(await boxOf(map(page), 'the map area')).toEqual({
        x: 0,
        y: 48,
        width: width - 40,
        height: height - 48,
      });
      await assertAdjacent(map(page), panel(page), 'horizontal');
      await assertNoOverlap(map(page), panel(page));
      await assertNoOverflow(app(page));
      // The tabs and their bodies are not shown.
      await expect(open(page)).toBeHidden();
      await expect(panel(page).getByRole('tablist')).toHaveCount(0);
      await expect(page.getByRole('complementary', { name: 'Side panel' })).toHaveCount(1);
    });
  });

  test('puts three buttons in the rail, stacked from the top 8 down and 4 apart, 4 from the edge', async ({
    page,
  }) => {
    await inEveryLayout(page, '/', async () => {
      await setCollapsed(page, true);
      const buttons = [expandButton(page), railButton(page, 'Legend'), railButton(page, 'Data')];
      const outer = await boxOf(panel(page), 'the panel');
      const places = [
        await boxOf(buttons[0] as Locator, 'the first button'),
        await boxOf(buttons[1] as Locator, 'the second button'),
        await boxOf(buttons[2] as Locator, 'the third button'),
      ];
      for (const [index, place] of places.entries()) {
        expect([place.width, place.height], `button ${String(index)}`).toEqual([32, 32]);
        expect(place.x - outer.x, `button ${String(index)}`).toBe(4);
        expect(outer.x + outer.width - (place.x + place.width), `button ${String(index)}`).toBe(4);
        expect(place.y - (outer.y + 8 + index * 36), `button ${String(index)}`).toBe(0);
      }
      await assertAligned(buttons, 'left');
      await assertNoOverlap(buttons[0] as Locator, buttons[1] as Locator);
      await assertNoOverlap(buttons[1] as Locator, buttons[2] as Locator);
    });
  });

  test('has the buttons in order, with their icons, and says that each opens the panel', async ({
    page,
  }) => {
    await page.goto('/');
    await setCollapsed(page, true);
    const buttons = rail(page).getByRole('button');
    await expect(buttons).toHaveCount(3);
    expect(
      await buttons.evaluateAll((all) => all.map((b) => b.getAttribute('aria-label'))),
    ).toEqual(['Expand panel', 'Legend', 'Data']);
    const icons = await rail(page)
      .locator('k-button')
      .evaluateAll((all) =>
        all.map((b) => [
          b.getAttribute('variant'),
          b.shadowRoot?.querySelector('k-icon')?.getAttribute('name'),
        ]),
      );
    expect(icons).toEqual([
      ['ghost', 'chevrons-left'],
      ['ghost', 'layers'],
      ['ghost', 'table'],
    ]);
    // Each is a button that is not expanded: pressing it opens the panel.
    for (const name of ['Expand panel', 'Legend', 'Data']) {
      await expect(
        page.getByRole('button', { name, expanded: false }),
        `${name} is not expanded`,
      ).toHaveCount(1);
    }
    await expect(page.getByRole('button', { name: 'Collapse panel' })).toHaveCount(0);
  });

  test('opens again with the expand button, on the tab it was on, with what was in the bodies kept', async ({
    page,
  }) => {
    await page.goto('/');
    await tab(page, 'Data').click();
    // Something a person might have in the body: it must be there, as it was, after the round trip.
    await body(page, 'data').evaluate((element) => {
      const input = document.createElement('input');
      input.setAttribute('aria-label', 'Notes');
      input.value = 'my notes';
      element.append(input);
    });
    await setCollapsed(page, true);
    await expandButton(page).click();
    await expect(open(page)).toBeVisible();
    await expect(tab(page, 'Data')).toHaveAttribute('aria-selected', 'true');
    await expect(body(page, 'data').locator('input')).toHaveValue('my notes');
    expect((await boxOf(panel(page), 'the panel')).width).toBe(360);
  });

  test('opens the panel on the tab of the rail button that was pressed', async ({ page }) => {
    await page.goto('/');
    for (const [pressed, before] of [
      ['Data', 'Legend'],
      ['Legend', 'Data'],
      ['Legend', 'Legend'],
      ['Data', 'Data'],
    ] as const) {
      await setCollapsed(page, false);
      await tab(page, before).click();
      await setCollapsed(page, true);
      await railButton(page, pressed).click();
      await expect(open(page), `${pressed} after ${before}`).toBeVisible();
      await expect(tab(page, pressed)).toHaveAttribute('aria-selected', 'true');
      await expect(body(page, pressed === 'Legend' ? 'legend' : 'data')).toBeVisible();
      await expect(body(page, pressed === 'Legend' ? 'data' : 'legend')).toBeHidden();
      await expect(rail(page)).toBeHidden();
    }
  });

  test('gives every button a tooltip with its name, on hover and on keyboard focus, shifting nothing', async ({
    page,
  }) => {
    await page.goto('/');
    const controls = (): Locator[] => [
      collapseButton(page),
      expandButton(page),
      railButton(page, 'Legend'),
      railButton(page, 'Data'),
    ];
    const names = ['Collapse panel', 'Expand panel', 'Legend', 'Data'];
    for (const [index, name] of names.entries()) {
      // Each from a page of its own: focus that a keyboard left behind would carry over to the
      // button that takes the place of the one that is clicked, and keep its tooltip showing.
      await page.goto('/');
      await setCollapsed(page, index !== 0);
      const control = controls()[index] as Locator;
      const before = await layoutOf(page, '.tip');
      await control.hover();
      await expect(tip(page, name), `${name} on hover`).toBeVisible();
      await expect(tip(page, name)).toHaveText(name);
      expect(await layoutOf(page, '.tip'), `${name} on hover`).toEqual(before);
      await page.mouse.move(5, 300);
      await expect(tip(page, name)).toBeHidden();

      // From the keyboard, as a person gets there: Tab through a fresh page to the button.
      await page.goto('/');
      const quiet = await layoutOf(page, '.tip');
      for (let presses = 0; presses < 10; presses += 1) {
        if (await control.evaluate((element) => element.matches(':focus'))) {
          break;
        }
        await page.keyboard.press('Tab');
      }
      await expect(control).toBeFocused();
      await expect(tip(page, name), `${name} on focus`).toBeVisible();
      expect(await layoutOf(page, '.tip'), `${name} on focus`).toEqual(quiet);
      await page.keyboard.press('Escape');
      await expect(tip(page, name)).toBeHidden();
    }
  });

  test('is kept between visits: folded away or open, and the tab', async ({ page }) => {
    await page.goto('/');
    expect(await kept(page)).toBeNull();
    await tab(page, 'Data').click();
    expect(JSON.parse((await kept(page)) ?? 'null')).toEqual({
      collapsed: false,
      tab: 'data',
      width: 360,
    });
    await setCollapsed(page, true);
    expect(JSON.parse((await kept(page)) ?? 'null')).toEqual({
      collapsed: true,
      tab: 'data',
      width: 360,
    });

    await page.reload();
    await expect(rail(page)).toBeVisible();
    await expect(open(page)).toBeHidden();
    expect((await boxOf(panel(page), 'the panel')).width).toBe(40);
    await railButton(page, 'Data').click();
    await expect(tab(page, 'Data')).toHaveAttribute('aria-selected', 'true');

    // Open on Legend, kept and read back.
    await tab(page, 'Legend').click();
    await page.reload();
    await expect(open(page)).toBeVisible();
    await expect(tab(page, 'Legend')).toHaveAttribute('aria-selected', 'true');
    expect(JSON.parse((await kept(page)) ?? 'null')).toEqual({
      collapsed: false,
      tab: 'legend',
      width: 360,
    });
  });

  test('is kept for each tab chosen with the keyboard as well', async ({ page }) => {
    await page.goto('/');
    await tab(page, 'Legend').focus();
    await page.keyboard.press('ArrowRight');
    expect(JSON.parse((await kept(page)) ?? 'null')).toEqual({
      collapsed: false,
      tab: 'data',
      width: 360,
    });
  });

  test.describe('when what was kept is not usable', () => {
    /** What the panel starts as, for text that was kept. */
    interface Start {
      readonly collapsed: boolean;
      readonly tab: 'legend' | 'data';
    }
    const unusable: readonly (readonly [string, string, Start])[] = [
      ['not JSON', '{{ nope', { collapsed: false, tab: 'legend' }],
      ['not an object', '[1, 2]', { collapsed: false, tab: 'legend' }],
      ['an unknown tab', '{"collapsed":true,"tab":"map"}', { collapsed: true, tab: 'legend' }],
      ['the wrong types', '{"collapsed":"yes","tab":3}', { collapsed: false, tab: 'legend' }],
      ['partly there', '{"tab":"data"}', { collapsed: false, tab: 'data' }],
    ];
    for (const [what, text, expected] of unusable) {
      test(`starts as well as it can from ${what}`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(
          ([key, value]) => {
            localStorage.setItem(key, value);
          },
          [KEY, text] as const,
        );
        await page.goto('/');
        if (expected.collapsed) {
          await expect(rail(page)).toBeVisible();
          await railButton(page, expected.tab === 'data' ? 'Data' : 'Legend').click();
        }
        await expect(open(page)).toBeVisible();
        await expect(tab(page, expected.tab === 'data' ? 'Data' : 'Legend')).toHaveAttribute(
          'aria-selected',
          'true',
        );
        expect(errors).toEqual([]);
      });
    }

    for (const [what, script] of [
      [
        'the storage refuses to read and to write',
        () => {
          Storage.prototype.getItem = () => {
            throw new Error('blocked');
          };
          Storage.prototype.setItem = () => {
            throw new Error('blocked');
          };
        },
      ],
      [
        'the browser will not even give the storage',
        () => {
          Object.defineProperty(window, 'localStorage', {
            get() {
              throw new DOMException('denied', 'SecurityError');
            },
          });
        },
      ],
    ] as const) {
      test(`starts and works when ${what}`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') {
            errors.push(message.text());
          }
        });
        await page.addInitScript(script);
        await page.goto('/');
        await expect(open(page)).toBeVisible();
        await expect(tab(page, 'Legend')).toHaveAttribute('aria-selected', 'true');
        // It all still works, it is only not kept.
        await tab(page, 'Data').click();
        await setCollapsed(page, true);
        await railButton(page, 'Data').click();
        await expect(tab(page, 'Data')).toHaveAttribute('aria-selected', 'true');
        expect(errors).toEqual([]);
      });
    }
  });

  test('puts the keyboard through the open panel in order, and through the rail when folded away', async ({
    page,
  }) => {
    await page.goto('/');
    const focused = () =>
      page.evaluate(() => {
        let active: Element | null = document.activeElement;
        while (active?.shadowRoot?.activeElement) {
          active = active.shadowRoot.activeElement;
        }
        // The name of what has the keyboard: its label, its own words or, for a button inside a
        // `k-button`, the words of the host.
        const own = active?.textContent.trim() ?? '';
        const root = active?.getRootNode();
        const words = root instanceof ShadowRoot ? root.host.textContent.trim() : '';
        return active?.getAttribute('aria-label') ?? (own === '' ? words : own);
      });
    const stops = async (count: number): Promise<(string | null)[]> => {
      const seen: (string | null)[] = [];
      for (let index = 0; index < count; index += 1) {
        await page.keyboard.press('Tab');
        seen.push(await focused());
      }
      return seen;
    };
    // The toolbar's Import, the map's Import, the handle on the panel's edge, the chosen tab (not
    // the other) and the collapse button.
    expect(await stops(5)).toEqual([
      'Import',
      'Import',
      'Resize panel',
      'Legend',
      'Collapse panel',
    ]);

    await setCollapsed(page, true);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.locator('karmania-map-area k-button').getByRole('button').focus();
    // The rail's three buttons follow the map's Import, and nothing hidden is in the way: the
    // handle is not there, since a rail has nothing to resize.
    expect(await stops(3)).toEqual(['Expand panel', 'Legend', 'Data']);
  });

  test('keeps the keyboard where it was: the button that took the place of the one that was pressed', async ({
    page,
  }) => {
    await page.goto('/');
    await collapseButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(expandButton(page)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Expand panel', expanded: false })).toBeFocused();

    await page.keyboard.press('Space');
    await expect(collapseButton(page)).toBeFocused();
    await expect(
      page.getByRole('button', { name: 'Collapse panel', expanded: true }),
    ).toBeFocused();

    // A rail button for a tab puts the keyboard on that tab.
    await page.keyboard.press('Enter');
    await expect(expandButton(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(railButton(page, 'Legend')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(railButton(page, 'Data')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(tab(page, 'Data')).toBeFocused();
    await expect(tab(page, 'Data')).toHaveAttribute('aria-selected', 'true');
  });

  test('does not move the keyboard when the panel changes for another reason', async ({ page }) => {
    await page.goto('/');
    await page.locator('karmania-app header k-button').getByRole('button').focus();
    await panel(page).evaluate((element) => {
      (element as unknown as { collapsed: boolean }).collapsed = true;
    });
    await expect(rail(page)).toBeVisible();
    await expect(page.locator('karmania-app header k-button').getByRole('button')).toBeFocused();
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const collapsed of [false, true]) {
      test(`has no serious accessibility violations in the ${theme} theme, ${collapsed ? 'folded away' : 'open'}`, async ({
        page,
      }) => {
        await page.goto(`/?theme=${theme}`);
        await setCollapsed(page, collapsed);
        await expectNoSeriousViolations(page);
      });
    }
  }
});
