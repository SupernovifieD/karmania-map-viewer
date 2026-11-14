import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { contrastBetween } from './support/color.js';
import { groupRow, layerRow, legend, loadLegendScene } from './support/legend.js';
import { around, distance, drawn, mapColour } from './support/render.js';

/**
 * Visibility in the Legend tab (step 19.2): a switch on every row, a tri-state one for a group, one stop for Tab with the arrow keys and Space, and what is
 * switched off is not drawn.
 */

/** Whether the scene has a layer on, read from the scene itself. */
const isOn = (page: Page, id: string): Promise<boolean | undefined> =>
  page.evaluate((layerId) => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      scene(): { layers: Record<string, { visible: boolean } | undefined> };
    };
    return viewer.scene().layers[layerId]?.visible;
  }, id);

const switchOf = (row: Locator): Locator => row.locator('.switch');
const boxOf = (row: Locator): Locator => row.locator('.tick');

/** The page with the five layers and two groups of `loadLegendScene`, in `theme`. */
async function open(page: Page, theme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.goto(`/?theme=${theme}`);
  await loadLegendScene(page);
  await expect(layerRow(page, 'layer-5')).toBeVisible();
}

/** The rows that are tabbable, as their keys. */
const stops = (page: Page): Promise<(string | null)[]> =>
  legend(page)
    .locator('.row[tabindex="0"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-key')));

/** Whether the keyboard is in the tree. */
const inTree = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    const root = active?.getRootNode();
    return root instanceof ShadowRoot && root.host.tagName === 'KARMANIA-LEGEND-TAB';
  });

test.describe('visibility in the Legend tab', () => {
  test('switches a layer with the pointer on its box and not on its name, and says it with the row, the box and the colour of the name', async ({
    page,
  }) => {
    await open(page);
    const row = layerRow(page, 'layer-2');
    await expect(row).toHaveAttribute('aria-checked', 'true');
    await expect(boxOf(row)).toHaveAttribute('data-state', 'checked');
    // The switch is a room of 24 by the height of the row, with the box of 16 in the middle of it.
    const room = await switchOf(row).boundingBox();
    const box = await boxOf(row).boundingBox();
    expect([room?.width, room?.height]).toEqual([24, 32]);
    expect([box?.width, box?.height]).toEqual([16, 16]);
    expect((box?.x ?? 0) - (room?.x ?? 0)).toBe(4);
    const on = await row.locator('.name').evaluate((name) => getComputedStyle(name).color);
    await row.locator('.name').click();
    expect(await isOn(page, 'layer-2')).toBe(true);
    await switchOf(row).click();
    await expect.poll(() => isOn(page, 'layer-2')).toBe(false);
    await expect(row).toHaveAttribute('aria-checked', 'false');
    await expect(boxOf(row)).toHaveAttribute('data-state', 'unchecked');
    const off = await row.locator('.name').evaluate((name) => getComputedStyle(name).color);
    expect(off).not.toBe(on);
    await switchOf(row).click();
    await expect.poll(() => isOn(page, 'layer-2')).toBe(true);
    await expect(row).toHaveAttribute('aria-checked', 'true');
  });

  test('has a group box that is neither ticked nor not when some of its layers are on, which turns all of them on, and turns all of them off when all are on', async ({
    page,
  }) => {
    await open(page);
    const group = groupRow(page, 'group-1');
    await expect(group).toHaveAttribute('aria-checked', 'true');
    await switchOf(layerRow(page, 'layer-3')).click();
    await expect.poll(() => isOn(page, 'layer-3')).toBe(false);
    await expect(group).toHaveAttribute('aria-checked', 'mixed');
    await expect(boxOf(group)).toHaveAttribute('data-state', 'mixed');
    // The mixed box is filled and has a bar in it, so it is not told from a ticked box by its colour alone.
    await expect(boxOf(group).locator('k-icon')).toHaveAttribute('name', 'minus');
    await expect(boxOf(group).locator('k-icon')).toHaveCSS('opacity', '1');
    // Pressed, a group with some of its layers on has all of them on.
    await switchOf(group).click();
    await expect.poll(() => isOn(page, 'layer-3')).toBe(true);
    await expect(group).toHaveAttribute('aria-checked', 'true');
    expect(await isOn(page, 'layer-4')).toBe(true);
    // Pressed again, with all on, all go off, and the group has none.
    await switchOf(group).click();
    await expect.poll(() => isOn(page, 'layer-4')).toBe(false);
    expect(await isOn(page, 'layer-3')).toBe(false);
    await expect(group).toHaveAttribute('aria-checked', 'false');
    await expect(boxOf(group)).toHaveAttribute('data-state', 'unchecked');
    // Other layers are not touched.
    expect(await isOn(page, 'layer-1')).toBe(true);
    expect(await isOn(page, 'layer-5')).toBe(true);
  });

  test('does not draw what is switched off: with every layer off the map is its background, and with them on it is not', async ({
    page,
  }) => {
    await open(page);
    const map = await mapColour(page);
    const middle = async (): Promise<number[]> => {
      const now = await drawn(page);
      return (await around(page, Math.floor(now.width / 2), Math.floor(now.height / 2), 0)).at(
        0,
        0,
      );
    };
    await expect.poll(async () => distance(await middle(), map)).toBeGreaterThan(30);
    for (const id of ['layer-1', 'layer-2']) {
      await switchOf(layerRow(page, id)).click();
    }
    for (const id of ['group-1', 'group-2']) {
      await switchOf(groupRow(page, id)).click();
    }
    await expect.poll(async () => distance(await middle(), map)).toBeLessThanOrEqual(2);
    await switchOf(layerRow(page, 'layer-1')).click();
    await expect.poll(async () => distance(await middle(), map)).toBeGreaterThan(30);
  });

  test('has one stop for Tab, which the arrow keys, Home and End move, and Tab goes out of the tree from', async ({
    page,
  }) => {
    await open(page);
    // Before any row has had the keyboard, the first row has the stop.
    expect(await stops(page)).toEqual(['group:group-2']);
    await groupRow(page, 'group-2').focus();
    await page.keyboard.press('ArrowDown');
    await expect(layerRow(page, 'layer-5')).toBeFocused();
    expect(await stops(page)).toEqual(['layer:layer-5']);
    await page.keyboard.press('ArrowDown');
    await expect(groupRow(page, 'group-1')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(layerRow(page, 'layer-5')).toBeFocused();
    await page.keyboard.press('End');
    await expect(layerRow(page, 'layer-1')).toBeFocused();
    // No further than the ends.
    await page.keyboard.press('ArrowDown');
    await expect(layerRow(page, 'layer-1')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(groupRow(page, 'group-2')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(groupRow(page, 'group-2')).toBeFocused();
    // The stop is where the keyboard was left; Tab leaves the tree, and Shift+Tab comes back to it, to that row.
    await page.keyboard.press('End');
    expect(await stops(page)).toEqual(['layer:layer-1']);
    await page.keyboard.press('Tab');
    expect(await inTree(page)).toBe(false);
    await page.keyboard.press('Shift+Tab');
    await expect(layerRow(page, 'layer-1')).toBeFocused();
  });

  test('switches the row that has the keyboard with Space, and keeps the keyboard on it', async ({
    page,
  }) => {
    await open(page);
    await layerRow(page, 'layer-5').focus();
    await page.keyboard.press('Space');
    await expect.poll(() => isOn(page, 'layer-5')).toBe(false);
    await expect(layerRow(page, 'layer-5')).toBeFocused();
    await expect(layerRow(page, 'layer-5')).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Space');
    await expect.poll(() => isOn(page, 'layer-5')).toBe(true);
    // On a group, it switches all its layers: the group of two layers goes off, and with one on again it is mixed.
    await groupRow(page, 'group-1').focus();
    await page.keyboard.press('Space');
    await expect.poll(() => isOn(page, 'layer-3')).toBe(false);
    expect(await isOn(page, 'layer-4')).toBe(false);
    await expect(groupRow(page, 'group-1')).toBeFocused();
    await layerRow(page, 'layer-3').focus();
    await page.keyboard.press('Space');
    await expect(groupRow(page, 'group-1')).toHaveAttribute('aria-checked', 'mixed');
  });

  test('leaves the keys with Alt, Control or Command to the browser: they do not move or switch, and are not stopped', async ({
    page,
  }) => {
    await open(page);
    await groupRow(page, 'group-2').focus();
    const outcome = await groupRow(page, 'group-2').evaluate((row) =>
      [
        { key: 'ArrowDown', altKey: true },
        { key: 'ArrowDown', ctrlKey: true },
        { key: ' ', metaKey: true },
        { key: ' ', altKey: true },
      ].map((init) => {
        const event = new KeyboardEvent('keydown', {
          ...init,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        row.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    );
    expect(outcome).toEqual([false, false, false, false]);
    await expect(groupRow(page, 'group-2')).toBeFocused();
    expect(await isOn(page, 'layer-5')).toBe(true);
    // The same key without them is the tree's.
    await page.keyboard.press('ArrowDown');
    await expect(layerRow(page, 'layer-5')).toBeFocused();
  });

  test('shows the focus ring inside the row, as a ring is shown on the page, and reads in both themes', async ({
    page,
  }) => {
    for (const theme of ['light', 'dark'] as const) {
      await open(page, theme);
      await page.keyboard.press('Shift');
      const row = layerRow(page, 'layer-2');
      await row.focus();
      const ring = await row.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          style: style.outlineStyle,
          width: style.outlineWidth,
          offset: style.outlineOffset,
          colour: style.outlineColor,
        };
      });
      // Inside the row (a negative offset), so that nothing that scrolls or clips can cut it.
      expect([ring.style, ring.width, ring.offset]).toEqual(['solid', '2px', '-2px']);
      const surface = await page
        .locator('karmania-panel')
        .evaluate((panel) => getComputedStyle(panel).backgroundColor);
      expect(
        contrastBetween(ring.colour, surface),
        `the ring in the ${theme} theme`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  test('mutes the name of a layer that is off so that it still reads: AA against the panel, in both themes', async ({
    page,
  }) => {
    for (const theme of ['light', 'dark'] as const) {
      await open(page, theme);
      await switchOf(layerRow(page, 'layer-2')).click();
      await expect(layerRow(page, 'layer-2')).toHaveAttribute('aria-checked', 'false');
      const name = await layerRow(page, 'layer-2')
        .locator('.name')
        .evaluate((element) => getComputedStyle(element).color);
      const surface = await page
        .locator('karmania-panel')
        .evaluate((panel) => getComputedStyle(panel).backgroundColor);
      expect(
        contrastBetween(name, surface),
        `the name in the ${theme} theme`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('has no serious accessibility violation with a group that is mixed, a layer that is off and a row that has the keyboard', async ({
    page,
  }) => {
    await open(page);
    await switchOf(layerRow(page, 'layer-3')).click();
    await expect(groupRow(page, 'group-1')).toHaveAttribute('aria-checked', 'mixed');
    await switchOf(layerRow(page, 'layer-1')).click();
    await layerRow(page, 'layer-2').focus();
    await expectNoSeriousViolations(page);
  });
});
