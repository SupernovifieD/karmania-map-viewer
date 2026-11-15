import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
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

/** The middle of an element's box, in the window. */
async function middle(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('Not shown.');
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const dropLine = (page: Page): Locator => legend(page).locator('.drop-line');
const handleOf = (page: Page, id: string): Locator => layerRow(page, id).locator('.handle');

/** The tops of the rows of the legend, from the top, to see that none moves while a row is dragged. */
const tops = (page: Page): Promise<number[]> =>
  legend(page)
    .locator('.row')
    .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().top));

/** Presses the handle of a layer, and takes the pointer to (`x`, `y`) in steps, without letting go. */
async function dragTo(page: Page, from: Locator, x: number, y: number): Promise<void> {
  const start = await middle(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
}

test.describe('dragging rows of the Legend tab with the pointer', () => {
  test('has a handle on every layer in a room of 16, seen when the row is pointed at or has the keyboard, and not before', async ({
    page,
  }) => {
    await open(page);
    for (const id of ['layer-1', 'layer-2', 'layer-3', 'layer-4', 'layer-5']) {
      expect((await handleOf(page, id).boundingBox())?.width, id).toBe(16);
    }
    await page.mouse.move(0, 0);
    await expect(handleOf(page, 'layer-2')).toHaveCSS('opacity', '0');
    await layerRow(page, 'layer-2').hover();
    await expect(handleOf(page, 'layer-2')).toHaveCSS('opacity', '1');
    await expect(handleOf(page, 'layer-1')).toHaveCSS('opacity', '0');
    await page.mouse.move(0, 0);
    await layerRow(page, 'layer-1').focus();
    await expect(handleOf(page, 'layer-1')).toHaveCSS('opacity', '1');
    // A group is not dragged by a handle, so its room has the chevron and no handle.
    await expect(groupRow(page, 'group-1').locator('.handle')).toHaveCount(0);
  });

  test('drags a layer by its handle with a line of 2 where it will land, and moves it when it is let go, saying so', async ({
    page,
  }) => {
    await open(page);
    const target = await layerRow(page, 'layer-2').boundingBox();
    // Topography (the last) is taken to the top edge of Assays: it will land above it. (Where the group above ends and Assays begins is one height, and the
    // pointer is left of where the layers of the group are, so it is the top of the legend.)
    await dragTo(page, handleOf(page, 'layer-1'), (target?.x ?? 0) + 4, (target?.y ?? 0) + 2);
    const line = dropLine(page);
    await expect(line).toBeVisible();
    const box = await line.boundingBox();
    expect(box?.height).toBe(2);
    expect(Math.abs((box?.y ?? 0) + 1 - (target?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(box?.x).toBe(target?.x);
    // The line is in the accent, and the dragged row says it is dragged.
    expect(await line.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
    await expect(layerRow(page, 'layer-1')).toHaveAttribute('data-dragging', '');
    expect(await order(page)).toEqual(START);
    await page.mouse.up();
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'group-1:layer-3,layer-4', 'layer-1', 'layer-2']);
    expect(await said(page)).toBe('Moved Topography above Assays');
    await expect(line).toHaveCount(0);
    await expect(layerRow(page, 'layer-1')).not.toHaveAttribute('data-dragging', '');
    await expect(layerRow(page, 'layer-1')).toBeFocused();
  });

  test('puts a layer into a group when the pointer is where its layers are, and takes it out where they are not', async ({
    page,
  }) => {
    await open(page);
    // Assays is taken between Geology and Drillholes, in the indent of the group.
    const drill = await layerRow(page, 'layer-4').boundingBox();
    await dragTo(page, handleOf(page, 'layer-2'), (drill?.x ?? 0) + 60, (drill?.y ?? 0) + 2);
    await page.mouse.up();
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'group-1:layer-3,layer-2,layer-4', 'layer-1']);
    expect(await said(page)).toBe('Moved Assays into Samples');
    // And Drillholes is taken out of it, to the gap under the group at the level of the groups.
    const bottom = await layerRow(page, 'layer-1').boundingBox();
    const base = await groupRow(page, 'group-1').boundingBox();
    await dragTo(page, handleOf(page, 'layer-4'), (base?.x ?? 0) + 4, (bottom?.y ?? 0) + 1);
    await page.mouse.up();
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'group-1:layer-3,layer-2', 'layer-4', 'layer-1']);
    expect(await said(page)).toBe('Moved Drillholes out of Samples');
  });

  test('drags a group by its row and not by its switch, and a group only among the rows of the top', async ({
    page,
  }) => {
    await open(page);
    // A press on the switch that goes on is not a drag.
    const room = await middle(groupRow(page, 'group-1').locator('.switch'));
    await page.mouse.move(room.x, room.y);
    await page.mouse.down();
    await page.mouse.move(room.x, room.y + 90, { steps: 6 });
    await expect(dropLine(page)).toHaveCount(0);
    await page.mouse.up();
    expect(await order(page)).toEqual(START);
    // A press on its name that goes on is: the group is taken under the last row.
    const bottom = await layerRow(page, 'layer-1').boundingBox();
    const name = await middle(groupRow(page, 'group-1').locator('.name'));
    await page.mouse.move(name.x, name.y);
    await page.mouse.down();
    await page.mouse.move(name.x + 30, (bottom?.y ?? 0) + (bottom?.height ?? 0) + 6, { steps: 8 });
    // The line is at the level of the rows of the top, whatever the pointer's place across: a group does not go into a group.
    const line = await dropLine(page).boundingBox();
    expect(line?.x).toBe((await groupRow(page, 'group-2').boundingBox())?.x);
    await page.mouse.up();
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'layer-2', 'layer-1', 'group-1:layer-3,layer-4']);
    expect(await said(page)).toBe('Moved Samples below Topography');
  });

  test('puts the row back with Escape, and a press that goes less than 4 pixels is a click that moves nothing', async ({
    page,
  }) => {
    await open(page);
    const target = await layerRow(page, 'layer-2').boundingBox();
    await dragTo(page, handleOf(page, 'layer-1'), (target?.x ?? 0) + 60, (target?.y ?? 0) + 2);
    await expect(dropLine(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dropLine(page)).toHaveCount(0);
    await expect(layerRow(page, 'layer-1')).not.toHaveAttribute('data-dragging', '');
    await page.mouse.up();
    expect(await order(page)).toEqual(START);
    expect(await said(page)).toBe('');
    // Three pixels is a click.
    const handle = await middle(handleOf(page, 'layer-1'));
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x, handle.y + 3);
    await expect(dropLine(page)).toHaveCount(0);
    await page.mouse.up();
    expect(await order(page)).toEqual(START);
  });

  test('moves nothing while a row is dragged: the rows stay where they are, the line is over them, and axe finds nothing serious with it there', async ({
    page,
  }) => {
    await open(page);
    const before = await tops(page);
    const target = await layerRow(page, 'layer-4').boundingBox();
    await dragTo(page, handleOf(page, 'layer-2'), (target?.x ?? 0) + 60, (target?.y ?? 0) + 2);
    await expect(dropLine(page)).toBeVisible();
    expect(await tops(page)).toEqual(before);
    // Only the row that is dragged has its handle seen, and not every row's.
    await expect(handleOf(page, 'layer-2')).toHaveCSS('opacity', '1');
    await expect(handleOf(page, 'layer-3')).toHaveCSS('opacity', '0');
    await expect(handleOf(page, 'layer-1')).toHaveCSS('opacity', '0');
    await expectNoSeriousViolations(page);
    await page.mouse.up();
  });

  test('has the map follow a drag: the layer that is dragged under the other is drawn under it', async ({
    page,
  }) => {
    await open(page);
    await dispatch(
      page,
      { type: 'setGroupVisible', groupId: 'group-1', visible: false },
      { type: 'setGroupVisible', groupId: 'group-2', visible: false },
    );
    const orange = bytes('#e69f00');
    const centre = async (): Promise<number[]> => {
      const now = await drawn(page);
      return (await around(page, Math.floor(now.width / 2), Math.floor(now.height / 2), 0)).at(
        0,
        0,
      );
    };
    await expect.poll(async () => distance(await centre(), orange)).toBeGreaterThan(40);
    const under = await layerRow(page, 'layer-1').boundingBox();
    await dragTo(
      page,
      handleOf(page, 'layer-2'),
      (under?.x ?? 0) + 60,
      (under?.y ?? 0) + (under?.height ?? 0) + 6,
    );
    await page.mouse.up();
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'group-1:layer-3,layer-4', 'layer-1', 'layer-2']);
    await expect.poll(async () => distance(await centre(), orange)).toBeLessThanOrEqual(2);
    // The row that was dragged has the keyboard where it went (the page took it from it when the row was moved down past another).
    await expect(layerRow(page, 'layer-2')).toBeFocused();
  });
});
