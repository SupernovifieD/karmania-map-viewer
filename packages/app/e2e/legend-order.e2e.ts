import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { groupRow, layerRow, legend, loadLegendScene } from './support/legend.js';
import { around, bytes, distance, drawn, dispatch } from './support/render.js';

/**
 * Moving rows of the Legend tab (step 19.4): with Alt and Up or Down by one place of the row's list, with what is said in a polite live region and the
 * keyboard kept on the row, and dragging with the pointer, with a line where the row will land. The legend is the draw order, and the map follows it.
 */

/** The names of the five layers of `loadLegendScene`, by id. */
const NAME: Record<string, string> = {
  'layer-1': 'Topography',
  'layer-2': 'Assays',
  'layer-3': 'Geology',
  'layer-4': 'Drillholes',
  'layer-5': 'Seismic lines',
  'group-1': 'Samples',
  'group-2': 'Surveys',
};

/**
 * The legend of the scene as the ids of its top, with a group's layers after a colon: from the top, `group-2:layer-5`, `group-1:layer-3,layer-4`,
 * `layer-2`, `layer-1` to begin with.
 */
const order = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      scene(): {
        legend: (
          { type: 'layer'; id: string } | { type: 'group'; id: string; children: string[] }
        )[];
      };
    };
    return viewer
      .scene()
      .legend.map((node) =>
        node.type === 'layer' ? node.id : `${node.id}:${node.children.join(',')}`,
      );
  });

const START = ['group-2:layer-5', 'group-1:layer-3,layer-4', 'layer-2', 'layer-1'];

/** What the live region says now. */
const said = (page: Page): Promise<string> =>
  legend(page)
    .locator('[role="status"]')
    .evaluate((region) => region.textContent.replace(/\s+/g, ' ').trim());

async function open(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await loadLegendScene(page);
  await expect(layerRow(page, 'layer-5')).toBeVisible();
  expect(await order(page)).toEqual(START);
}

/** The row of a node, a layer or a group. */
const rowOf = (page: Page, id: string): Locator =>
  id.startsWith('group') ? groupRow(page, id) : layerRow(page, id);

test.describe('moving rows of the Legend tab with the keyboard', () => {
  test('moves a layer up and down in the top of the legend with Alt and an arrow, says where it went, and keeps the keyboard on it', async ({
    page,
  }) => {
    await open(page);
    await rowOf(page, 'layer-2').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'layer-2', 'group-1:layer-3,layer-4', 'layer-1']);
    await expect(rowOf(page, 'layer-2')).toBeFocused();
    expect(await said(page)).toBe(`Moved ${NAME['layer-2'] ?? ''} above Samples`);
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => order(page)).toEqual(START);
    await expect(rowOf(page, 'layer-2')).toBeFocused();
    expect(await said(page)).toBe('Moved Assays above Topography');
    await page.keyboard.press('Alt+ArrowDown');
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'group-1:layer-3,layer-4', 'layer-1', 'layer-2']);
    await expect(rowOf(page, 'layer-2')).toBeFocused();
    expect(await said(page)).toBe('Moved Assays below Topography');
    // The row that has the keyboard is the one with the stop for Tab, wherever it went.
    await expect(rowOf(page, 'layer-2')).toHaveAttribute('tabindex', '0');
  });

  test('moves a layer within its group and not out of it, and a group among the rows of the top', async ({
    page,
  }) => {
    await open(page);
    await rowOf(page, 'layer-3').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'group-1:layer-4,layer-3', 'layer-2', 'layer-1']);
    expect(await said(page)).toBe('Moved Geology below Drillholes');
    await expect(rowOf(page, 'layer-3')).toBeFocused();
    // At the end of its group it goes no further, and says so.
    await page.keyboard.press('Alt+ArrowDown');
    expect(await said(page)).toBe('Geology is already at the bottom of Samples');
    expect(await order(page)).toEqual([
      'group-2:layer-5',
      'group-1:layer-4,layer-3',
      'layer-2',
      'layer-1',
    ]);
    await rowOf(page, 'group-1').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'layer-2', 'group-1:layer-4,layer-3', 'layer-1']);
    expect(await said(page)).toBe('Moved Samples above Topography');
    await expect(rowOf(page, 'group-1')).toBeFocused();
  });

  test('does not move the first row up or the last down, says why, and says it again when it is asked again', async ({
    page,
  }) => {
    await open(page);
    await rowOf(page, 'group-2').focus();
    await page.keyboard.press('Alt+ArrowUp');
    expect(await said(page)).toBe('Surveys is already at the top of the legend');
    const first = await legend(page)
      .locator('[role="status"]')
      .evaluate((region) => region.textContent);
    await page.keyboard.press('Alt+ArrowUp');
    const second = await legend(page)
      .locator('[role="status"]')
      .evaluate((region) => region.textContent);
    // The same words twice would not be read twice; a space that is not a break is at the end of one of them.
    expect(second).not.toBe(first);
    expect(await said(page)).toBe('Surveys is already at the top of the legend');
    expect(await order(page)).toEqual(START);
    await rowOf(page, 'layer-1').focus();
    await page.keyboard.press('Alt+ArrowDown');
    expect(await said(page)).toBe('Topography is already at the bottom of the legend');
    await expect(rowOf(page, 'layer-1')).toBeFocused();
  });

  test('leaves Alt with Shift and an arrow alone, and the arrows without Alt move the keyboard as before', async ({
    page,
  }) => {
    await open(page);
    await rowOf(page, 'layer-2').focus();
    const outcome = await rowOf(page, 'layer-2').evaluate((row) =>
      [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }].map((modifiers) => {
        const event = new KeyboardEvent('keydown', {
          key: 'ArrowUp',
          altKey: true,
          ...modifiers,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        row.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    );
    expect(outcome).toEqual([false, false, false]);
    expect(await order(page)).toEqual(START);
    await page.keyboard.press('ArrowUp');
    // The row above `layer-2` is the last layer of the group above it.
    await expect(rowOf(page, 'layer-4')).toBeFocused();
    expect(await order(page)).toEqual(START);
  });

  test('has the map follow the legend: the layer that is higher is drawn over the one under it, and swaps when they are moved', async ({
    page,
  }) => {
    await open(page);
    // Only the two layers at the top level are shown: `layer-2` (by classes) over `layer-1` (in orange), on the same cells.
    await dispatch(
      page,
      { type: 'setGroupVisible', groupId: 'group-1', visible: false },
      { type: 'setGroupVisible', groupId: 'group-2', visible: false },
    );
    const orange = bytes('#e69f00');
    const middle = async (): Promise<number[]> => {
      const now = await drawn(page);
      return (await around(page, Math.floor(now.width / 2), Math.floor(now.height / 2), 0)).at(
        0,
        0,
      );
    };
    await expect.poll(async () => distance(await middle(), orange)).toBeGreaterThan(40);
    await rowOf(page, 'layer-2').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'group-1:layer-3,layer-4', 'layer-1', 'layer-2']);
    await expect.poll(async () => distance(await middle(), orange)).toBeLessThanOrEqual(2);
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(async () => distance(await middle(), orange)).toBeGreaterThan(40);
  });
});
