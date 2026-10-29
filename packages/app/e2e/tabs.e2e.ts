import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertAligned, assertNoOverflow, assertNoOverlap, boxOf } from './support/layout.js';

/** The tabs of the gallery's side-panel example. */
function panelTabs(page: Page): Locator {
  return page.locator('#panel-tabs k-tabs');
}

function tab(page: Page, id: string): Locator {
  return panelTabs(page).locator(`[role="tab"][data-id="${id}"]`);
}

/** The ids of the tabs that are chosen: there should be exactly one. */
function chosen(page: Page): Promise<string[]> {
  return panelTabs(page).evaluate((element) =>
    [...(element.shadowRoot?.querySelectorAll('[role="tab"][aria-selected="true"]') ?? [])].map(
      (node) => node.getAttribute('data-id') ?? '',
    ),
  );
}

/** Starts recording the `k-tab-change` events that reach the document. */
async function recordChanges(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const changes: string[] = [];
    (window as unknown as { changes: string[] }).changes = changes;
    document.addEventListener('k-tab-change', (event) => {
      changes.push((event as CustomEvent<{ id: string }>).detail.id);
    });
  });
  return () => page.evaluate(() => (window as unknown as { changes: string[] }).changes);
}

test.describe('the tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
  });

  test('follow the ARIA pattern: a named tablist, tabs that control panels that are labelled by them', async ({
    page,
  }) => {
    await expect(page.getByRole('tablist', { name: 'Side panel' })).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Legend' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'false');
    const wiring = await panelTabs(page).evaluate((element) => {
      const root = element.shadowRoot;
      return [...(root?.querySelectorAll('[role="tab"]') ?? [])].map((node) => {
        const panel = root?.getElementById(node.getAttribute('aria-controls') ?? '');
        return {
          panelRole: panel?.getAttribute('role'),
          labelledBy: panel?.getAttribute('aria-labelledby') === node.id,
        };
      });
    });
    expect(wiring).toEqual([
      { panelRole: 'tabpanel', labelledBy: true },
      { panelRole: 'tabpanel', labelledBy: true },
    ]);
    expect(await chosen(page)).toEqual(['legend']);
  });

  test('show only the chosen panel, and keep the others in the page', async ({ page }) => {
    await expect(page.locator('#panel-tabs').getByText('Layers will appear here')).toBeVisible();
    await expect(page.getByText('No datasets yet.')).toBeHidden();
    await expect(page.getByText('No datasets yet.')).toHaveCount(1);
    await tab(page, 'data').click();
    await expect(page.getByText('No datasets yet.')).toBeVisible();
    await expect(page.locator('#panel-tabs').getByText('Layers will appear here')).toBeHidden();
  });

  test('keep what is in a hidden panel as it was', async ({ page }) => {
    await page.locator('#legend-input').fill('my notes');
    await tab(page, 'data').click();
    await tab(page, 'legend').click();
    await expect(page.locator('#legend-input')).toHaveValue('my notes');
  });

  test('put only the chosen tab in the Tab order, so Tab goes in once and out once', async ({
    page,
  }) => {
    const order = await panelTabs(page)
      .locator('[role="tab"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('tabindex')));
    expect(order).toEqual(['0', '-1']);
    await page.evaluate(() => {
      const before = document.createElement('button');
      before.id = 'before';
      before.textContent = 'Before';
      document
        .querySelector('karmania-gallery')
        ?.shadowRoot?.querySelector('#panel-tabs')
        ?.before(before);
    });
    await page.locator('#before').focus();
    await page.keyboard.press('Tab');
    await expect(tab(page, 'legend')).toBeFocused();
    await page.keyboard.press('Tab');
    // Not the other tab: the next thing in the panel (its text box).
    await expect(page.locator('#legend-input')).toBeFocused();
  });

  test('move with Left and Right, choosing as they go and wrapping at the ends', async ({
    page,
  }) => {
    const changes = await recordChanges(page);
    await tab(page, 'legend').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'data')).toBeFocused();
    expect(await chosen(page)).toEqual(['data']);
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'legend')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 'data')).toBeFocused();
    expect(await chosen(page)).toEqual(['data']);
    expect(await changes()).toEqual(['data', 'legend', 'data']);
  });

  test('go to the first and last with Home and End', async ({ page }) => {
    const changes = await recordChanges(page);
    await tab(page, 'legend').focus();
    await page.keyboard.press('End');
    await expect(tab(page, 'data')).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('Home');
    await expect(tab(page, 'legend')).toBeFocused();
    expect(await chosen(page)).toEqual(['legend']);
    expect(await changes()).toEqual(['data', 'legend']);
  });

  test('send the event once per choice, when clicked, and none for the tab already chosen', async ({
    page,
  }) => {
    const changes = await recordChanges(page);
    await tab(page, 'legend').click();
    expect(await changes()).toEqual([]);
    await tab(page, 'data').click();
    await tab(page, 'data').click();
    expect(await changes()).toEqual(['data']);
  });

  test('follow `selected` when it is set, and use the first tab for anything else', async ({
    page,
  }) => {
    await panelTabs(page).evaluate((element) => {
      element.setAttribute('selected', 'data');
    });
    expect(await chosen(page)).toEqual(['data']);
    await panelTabs(page).evaluate((element) => {
      element.setAttribute('selected', 'nonsense');
    });
    expect(await chosen(page)).toEqual(['legend']);
    const crowded = await page
      .locator('#crowded-tabs k-tabs [role="tab"][aria-selected="true"]')
      .getAttribute('data-id');
    expect(crowded).toBe('a');
  });

  test('mark the chosen tab by more than its color, and shift nothing when the choice changes', async ({
    page,
  }) => {
    // Positions are measured from the row of tabs, not from the window: choosing a tab by
    // clicking may scroll the page, and that is not the tabs moving.
    const measure = () =>
      panelTabs(page)
        .locator('[role="tab"]')
        .evaluateAll((nodes) => {
          const list = nodes[0]?.parentElement?.getBoundingClientRect();
          return nodes.map((node) => {
            const box = node.getBoundingClientRect();
            return [
              box.x - (list?.x ?? 0),
              box.y - (list?.y ?? 0),
              box.width,
              box.height,
              getComputedStyle(node).boxShadow,
            ];
          });
        });
    const before = await measure();
    await tab(page, 'data').click();
    const after = await measure();
    expect(after.map((row) => row.slice(0, 4))).toEqual(before.map((row) => row.slice(0, 4)));
    expect(before[0]?.[4]).not.toBe('none');
    expect(before[1]?.[4]).toBe('none');
    expect(after[0]?.[4]).toBe('none');
    expect(after[1]?.[4]).not.toBe('none');
    expect(before.every((row) => row[3] === 40)).toBe(true);
  });

  test('draw the focus ring inside the tab, where it cannot be clipped', async ({ page }) => {
    await page.keyboard.press('Shift');
    await tab(page, 'legend').focus();
    const ring = await tab(page, 'legend').evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.outlineStyle, style.outlineWidth, style.outlineOffset];
    });
    expect(ring).toEqual(['solid', '2px', '-2px']);
  });

  test('cut a label with an ellipsis when there is no room, and keep it whole in the title and name', async ({
    page,
  }) => {
    const crowded = page.locator('#crowded-tabs k-tabs');
    const state = await crowded.evaluate((element) => {
      const list = element.shadowRoot?.querySelector('.tablist');
      const tabs = [...(element.shadowRoot?.querySelectorAll('[role="tab"]') ?? [])];
      return {
        listFits: (list?.scrollWidth ?? 0) <= (list?.clientWidth ?? 0),
        cut: tabs.map((node) => node.scrollWidth > node.clientWidth),
        titles: tabs.map((node) => node.getAttribute('title')),
        overflow: tabs.map((node) => getComputedStyle(node).textOverflow),
      };
    });
    expect(state.listFits).toBe(true);
    expect(state.cut).toContain(true);
    expect(state.titles).toEqual(['Collar locations', 'Assay results by hole', 'Geology']);
    expect(new Set(state.overflow)).toEqual(new Set(['ellipsis']));
    await expect(page.getByRole('tab', { name: 'Assay results by hole' })).toHaveCount(1);
  });

  test('throw, as a mistake in the page, for tabs with the same id or a row with no name', async ({
    page,
  }) => {
    const outcome = await page.evaluate(async () => {
      const attempt = async (setUp: (tabs: HTMLElementTagNameMap['k-tabs']) => void) => {
        const tabs = document.createElement('k-tabs');
        setUp(tabs);
        document.body.append(tabs);
        try {
          await tabs.updateComplete;
          return 'fine';
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      };
      return {
        same: await attempt((tabs) => {
          tabs.label = 'Same';
          tabs.tabs = [
            { id: 'x', label: 'One' },
            { id: 'x', label: 'Two' },
          ];
        }),
        unnamed: await attempt((tabs) => {
          tabs.tabs = [{ id: 'x', label: 'One' }];
        }),
        none: await attempt((tabs) => {
          tabs.label = 'No tabs';
        }),
      };
    });
    expect(outcome.same).toMatch(/must each have a different id/);
    expect(outcome.unnamed).toMatch(/needs a label/);
    expect(outcome.none).toBe('fine');
  });

  test('refuse a tab called actions, which is the slot for the actions', async ({ page }) => {
    const message = await page.evaluate(async () => {
      const tabs = document.createElement('k-tabs');
      tabs.label = 'Reserved';
      tabs.tabs = [{ id: 'actions', label: 'Actions' }];
      document.body.append(tabs);
      try {
        await tabs.updateComplete;
        return 'fine';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(message).toMatch(/can have the id actions/);
  });

  for (const theme of ['light', 'dark']) {
    test(`have no serious accessibility violations (${theme} theme)`, async ({ page }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      await expectNoSeriousViolations(page, ['karmania-gallery', '[data-section="tabs"]']);
    });
  }

  test.describe('with an action at the end of the row', () => {
    const demo = (page: Page) => page.locator('#action-tabs');
    const tabsOf = (page: Page) => demo(page).locator('k-tabs');
    const header = (page: Page) => tabsOf(page).locator('.header');
    const tablist = (page: Page) => tabsOf(page).locator('.tablist');
    const actions = (page: Page) => tabsOf(page).locator('.actions');
    const action = (page: Page) => tabsOf(page).locator('k-button');
    const body = (page: Page, id: string) => tabsOf(page).locator(`[slot="${id}"]`);

    test('puts it at the far end of the row, centred on it, clear of the tabs', async ({
      page,
    }) => {
      const row = await boxOf(header(page), 'the row');
      const button = await boxOf(action(page), 'the action');
      expect(row.height).toBe(40);
      // The row has 4 on the left and 8 on the right, as the gallery gives it with `::part`.
      expect(row.x + row.width - (button.x + button.width)).toBe(8);
      expect([button.y - row.y, row.y + row.height - (button.y + button.height)]).toEqual([4, 4]);
      await assertAligned([header(page), tablist(page), actions(page)], 'vertical-centre');
      await assertNoOverlap(tablist(page), actions(page));
      expect((await boxOf(tablist(page), 'the tabs')).x - row.x).toBe(4);
      await expect(demo(page).getByRole('button', { name: 'Collapse panel' })).toHaveCount(1);
    });

    test('lets the row be styled from outside, through its part', async ({ page }) => {
      await expect(header(page)).toHaveAttribute('part', 'header');
      expect(await header(page).evaluate((element) => getComputedStyle(element).paddingRight)).toBe(
        '8px',
      );
    });

    test('gives the chosen panel what is left of the height, and scrolls what is too long', async ({
      page,
    }) => {
      const host = await boxOf(tabsOf(page), 'the tabs');
      const row = await boxOf(header(page), 'the row');
      const panel = await boxOf(demo(page).locator('[role="tabpanel"]:not([hidden])'), 'the panel');
      expect([panel.y, panel.height]).toEqual([row.y + row.height, host.y + host.height - panel.y]);
      // 24 lines do not fit, so the body scrolls inside itself and nothing else does.
      const scrolling = await body(page, 'layers').evaluate((element) => ({
        scrolls: element.scrollHeight > element.clientHeight,
        height: element.getBoundingClientRect().height,
      }));
      expect(scrolling.scrolls).toBe(true);
      expect(scrolling.height).toBe(panel.height);
      await assertNoOverflow(demo(page), { window: 'horizontal' });

      // The same for the other panel, once it is chosen.
      await tabsOf(page).locator('[role="tab"][data-id="table"]').click();
      const [hostNow, other] = [
        await boxOf(tabsOf(page), 'the tabs'),
        await boxOf(body(page, 'table'), 'the other body'),
      ];
      // (Choosing a tab scrolled the page, so places are measured from the top of the tabs.)
      expect([other.y - hostNow.y, other.height]).toEqual([panel.y - host.y, panel.height]);
    });

    test('lets the tabs give way when the row is crowded, so the action stays whole', async ({
      page,
    }) => {
      const crowded = page.locator('#crowded-action-tabs');
      const row = await boxOf(crowded.locator('.header'), 'the row');
      const button = await boxOf(crowded.locator('k-button'), 'the action');
      expect(row.x + row.width - (button.x + button.width)).toBe(8);
      await assertNoOverlap(crowded.locator('.tablist'), crowded.locator('.actions'));
      const cut = await crowded
        .locator('[role="tab"]')
        .evaluateAll((tabs) => tabs.map((tab) => tab.scrollWidth > tab.clientWidth));
      expect(cut).toContain(true);
      await assertNoOverflow(crowded, { window: 'horizontal' });
    });
  });
});
