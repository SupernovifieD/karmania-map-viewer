/**
 * The identify popover (step 21.3c): a click on an element of the map opens a popover next to it that says what the element is and up to 8 of its
 * attributes, inside the map and clear of the column of the north arrow and the navigation group; the button closes it and keeps the selection, Escape closes
 * it, clears the selection and gives the focus back to the map.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixturePath } from './support/picker.js';
import { importAndLoad } from './support/wizard.js';
import {
  camera,
  dispatch,
  drawn,
  layerStatuses,
  selection,
  watchPicks,
  withData,
} from './support/render.js';

/** The points of `points.csv`: easting and northing, in the order of the file (element 0 first). */
const POINTS = readFileSync(fixturePath('points.csv'), 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => line.split(',').slice(0, 2).map(Number) as [number, number]);

/** Puts the camera on point `index` (1 metre a pixel, `right` and `up` pixels off the middle) and gives where that point is on the page. */
async function place(
  page: Page,
  index: number,
  offset: { right?: number; up?: number } = {},
): Promise<{ x: number; y: number }> {
  const { right = 0, up = 0 } = offset;
  const at = POINTS[index] as [number, number];
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: [at[0] - right, at[1] - up], unitsPerPixel: 1, heading: 0 } },
  });
  await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - 1))
    .toBeLessThan(1e-9);
  const box = await page.locator('karmania-map-area canvas').boundingBox();
  if (box === null) throw new Error('The map is not on the page.');
  return { x: box.x + box.width / 2 + right, y: box.y + box.height / 2 - up };
}

const popover = (page: Page) => page.locator('karmania-identify');
const dialog = (page: Page) => page.locator('karmania-identify section');

/** What the popover's rows say: the name and the value of each, in order. */
async function rows(page: Page): Promise<[string, string][]> {
  return page.locator('karmania-identify dl').evaluate((list) => {
    const names = [...list.querySelectorAll('dt')].map((node) => node.textContent.trim());
    const values = [...list.querySelectorAll('dd')].map((node) => node.textContent.trim());
    return names.map((name, i): [string, string] => [name, values[i] ?? '']);
  });
}

test.describe('the identify popover', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    await withData(page);
  });

  test('opens next to a point that is clicked, and says what it is, its dataset, and its attributes', async ({
    page,
  }) => {
    await expect(popover(page)).toHaveCount(0);
    const at = await place(page, 2, { right: -150, up: 60 });
    await page.mouse.click(at.x, at.y);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAttribute('role', 'dialog');
    await expect(dialog(page)).toHaveAttribute('aria-label', 'Point 3 of points');
    await expect(page.locator('karmania-identify h2')).toHaveText('points');
    await expect(page.locator('karmania-identify .caption')).toHaveText('Point 3');
    const attributes = await rows(page);
    expect(attributes.map(([name]) => name)).toEqual(['Hole', 'Au_ppm', 'Rock']);
    expect(attributes.find(([name]) => name === 'Hole')?.[1]).toBe('DH002');
    expect(attributes.find(([name]) => name === 'Rock')?.[1]).toBe('basalt');
    // The element that was clicked is the selection, and has its outline.
    expect(await selection(page)).toEqual({ layerId: 'layer-1', element: 2 });
    await expect(page.getByRole('button', { name: 'Show in table' })).toBeVisible();
  });

  test('is inside the map, 16 or more from its edges, to the right of and below the click where there is room, and not over the right-hand column', async ({
    page,
  }) => {
    const area = await page.locator('karmania-map-area').boundingBox();
    if (area === null) throw new Error('The map is not on the page.');
    // A click in the upper left of the map: the popover is below and to the right of it.
    const near = await place(page, 2, { right: -250, up: 150 });
    await page.mouse.click(near.x, near.y);
    await expect(dialog(page)).toBeVisible();
    let box = await dialog(page).boundingBox();
    if (box === null) throw new Error('No popover.');
    expect(box.x).toBeGreaterThan(near.x);
    expect(box.y).toBeGreaterThan(near.y);
    expect(box.width).toBeGreaterThanOrEqual(240);
    expect(box.width).toBeLessThanOrEqual(320);
    // A click at the far right of the map: the popover is on the left of it, clear of the column of the north arrow and the navigation group.
    const far = await place(page, 2, { right: area.width / 2 - 20, up: 0 });
    await page.mouse.click(far.x, far.y);
    await expect.poll(async () => (await dialog(page).boundingBox())?.x ?? 1e9).toBeLessThan(far.x);
    box = await dialog(page).boundingBox();
    if (box === null) throw new Error('No popover.');
    expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width - 16 - 48 + 1);
    expect(box.x).toBeGreaterThanOrEqual(area.x + 16 - 1);
    expect(box.y).toBeGreaterThanOrEqual(area.y + 16 - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height - 16 + 1);
    // A click at the bottom: above it.
    const low = await place(page, 2, { right: -50, up: -area.height / 2 + 20 });
    await page.mouse.click(low.x, low.y);
    await expect.poll(async () => (await dialog(page).boundingBox())?.y ?? 1e9).toBeLessThan(low.y);
    box = await dialog(page).boundingBox();
    if (box === null) throw new Error('No popover.');
    expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height - 16 + 1);
  });

  test('is no wider than the map leaves it on a map that is narrower than 320 pixels: it does not reach the right-hand column', async ({
    page,
  }) => {
    // The panel is half the window (at most 640): a window of 600 leaves 300 of the map.
    await page.setViewportSize({ width: 600, height: 800 });
    const area = await page.locator('karmania-map-area').boundingBox();
    if (area === null) throw new Error('The map is not on the page.');
    expect(area.width).toBeLessThan(320);
    const at = await place(page, 2, { right: -60, up: 100 });
    await page.mouse.click(at.x, at.y);
    await expect(dialog(page)).toBeVisible();
    const box = await dialog(page).boundingBox();
    if (box === null) throw new Error('No popover.');
    expect(box.width).toBeLessThan(240);
    expect(box.x).toBeGreaterThanOrEqual(area.x + 16 - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width - 16 - 48 + 1);
  });

  test('is given the keyboard when it opens, so that a screen reader says what it is and what it says; the map’s own keys are not its keys', async ({
    page,
  }) => {
    const at = await place(page, 2, { right: -150, up: 60 });
    await page.mouse.click(at.x, at.y);
    await expect(dialog(page)).toBeFocused();
    // What is said: the name of the dialog, and as its description the attributes (what a screen reader reads after the name).
    await expect(dialog(page)).toHaveAccessibleName(/^Point 3 of /);
    const said = await rows(page);
    expect(said.length).toBeGreaterThan(0);
    const description = await dialog(page).evaluate((section) => {
      const id = section.getAttribute('aria-describedby');
      const text = id === null ? null : section.querySelector(`#${id}`)?.textContent;
      return text === null || text === undefined ? null : text.replace(/\s+/g, ' ');
    });
    expect(description).not.toBeNull();
    for (const [name, value] of said) {
      expect(description, `the description says ${name}`).toContain(name);
      expect(description, `the description says ${value}`).toContain(value);
    }
    // The arrow keys are not the map's now (they are when the map has the keyboard, which the next test shows): the camera does not move.
    const before = await camera(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    expect((await camera(page)).centre).toEqual(before.centre);
  });

  test('gives the keyboard back to the map with Escape, from where it was opened, and with its button', async ({
    page,
  }) => {
    const at = await place(page, 2, { right: -150, up: 60 });
    await page.mouse.click(at.x, at.y);
    await expect(dialog(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
    await expect(page.locator('karmania-map-area main')).toBeFocused();
    expect(await selection(page)).toBeNull();
    // And with its button: the map has the keyboard again and the element stays selected.
    const again = await place(page, 4, { right: -150, up: 60 });
    await page.mouse.click(again.x, again.y);
    await expect(dialog(page)).toBeFocused();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(popover(page)).toHaveCount(0);
    await expect(page.locator('karmania-map-area main')).toBeFocused();
    expect(await selection(page)).toEqual({ layerId: 'layer-1', element: 4 });
  });

  test('has the keyboard again for a click on the point that is already open: the click gave it to the map, and the popover is told of the click again', async ({
    page,
  }) => {
    const at = await place(page, 2, { right: -150, up: 60 });
    await page.mouse.click(at.x, at.y);
    await expect(dialog(page)).toBeFocused();
    await page.locator('karmania-map-area main').focus();
    await expect(dialog(page)).not.toBeFocused();
    await page.mouse.click(at.x, at.y);
    await expect(dialog(page)).toBeFocused();
  });

  test('is given the keyboard when it says what the click found, and not while it says Loading…', async ({
    page,
  }) => {
    // The row of the element is held back (the engine's answer is given when the test lets it): the popover is open, with nothing to say yet.
    await page.evaluate(() => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        engine: { rows: (...args: unknown[]) => Promise<unknown> };
      };
      const original = viewer.engine.rows.bind(viewer.engine);
      const held: (() => void)[] = [];
      (window as unknown as { releaseRows: () => void }).releaseRows = () => {
        held.splice(0).forEach((release) => {
          release();
        });
      };
      viewer.engine.rows = (...args) =>
        new Promise((resolve, reject) => {
          held.push(() => {
            original(...args).then(resolve, reject);
          });
        });
    });
    const at = await place(page, 2, { right: -150, up: 60 });
    await page.mouse.click(at.x, at.y);
    await expect(page.locator('karmania-identify .note')).toHaveText('Loading…');
    await expect(dialog(page)).not.toBeFocused();
    await page.evaluate(() => {
      (window as unknown as { releaseRows: () => void }).releaseRows();
    });
    await expect(page.locator('karmania-identify dl')).toBeVisible();
    await expect(dialog(page)).toBeFocused();
  });

  test('does not take the keyboard from a person who has moved on to something else before it opens', async ({
    page,
  }) => {
    // The answer of the click comes a second late, in which the keyboard is put on a button of the map.
    await watchPicks(page, 1000);
    const at = await place(page, 2, { right: -150, up: 60 });
    await page.mouse.click(at.x, at.y);
    const button = page.getByRole('button', { name: 'Zoom in' });
    await button.focus();
    await expect(button).toBeFocused();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('karmania-identify .caption')).toHaveText('Point 3');
    // It is open, with what it says, and the keyboard is where the person had put it.
    await expect(button).toBeFocused();
    await expect(dialog(page)).not.toBeFocused();
  });

  test('gives the keyboard to the map, and does not leave it nowhere, when the popover that has it is taken away', async ({
    page,
  }) => {
    const at = await place(page, 2, { right: -150, up: 60 });
    await page.mouse.click(at.x, at.y);
    await expect(dialog(page)).toBeFocused();
    // The selection is made another (as a row of the table does): the popover goes.
    await dispatch(page, { type: 'setSelection', selection: { layerId: 'layer-1', element: 5 } });
    await expect(popover(page)).toHaveCount(0);
    await expect(page.locator('karmania-map-area main')).toBeFocused();
  });

  test('closes with its button and leaves the element selected, with its outline', async ({
    page,
  }) => {
    const at = await place(page, 2, { right: -150, up: 60 });
    await page.mouse.click(at.x, at.y);
    await expect(dialog(page)).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(popover(page)).toHaveCount(0);
    expect(await selection(page)).toEqual({ layerId: 'layer-1', element: 2 });
  });

  test('closes with Escape, clears the selection, and gives the focus back to the map', async ({
    page,
  }) => {
    const at = await place(page, 2, { right: -150, up: 60 });
    await page.mouse.click(at.x, at.y);
    await expect(dialog(page)).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).focus();
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
    await expect.poll(() => selection(page)).toBeNull();
    // The map has the focus (its keys are its own again): an arrow key moves it.
    const before = await camera(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await camera(page)).centre[0]).not.toBe(before.centre[0]);
  });

  test('is gone when another point or the empty map is clicked, and is of the other point when it is', async ({
    page,
  }) => {
    const first = await place(page, 2, { right: -150, up: 60 });
    await page.mouse.click(first.x, first.y);
    await expect(page.locator('karmania-identify .caption')).toHaveText('Point 3');
    const second = await place(page, 5, { right: -150, up: 60 });
    await page.mouse.click(second.x, second.y);
    await expect(page.locator('karmania-identify .caption')).toHaveText('Point 6');
    // (Not on the popover, which is to the right of and below the click, nor on the points, which run from lower left to upper right.)
    await page.mouse.click(second.x - 100, second.y - 100);
    await expect(popover(page)).toHaveCount(0);
    expect(await selection(page)).toBeNull();
  });

  test('is not opened by a selection that was not made by a click, and is gone when the selection is another', async ({
    page,
  }) => {
    await place(page, 2);
    await dispatch(page, { type: 'setSelection', selection: { layerId: 'layer-1', element: 4 } });
    await expect.poll(() => selection(page)).toEqual({ layerId: 'layer-1', element: 4 });
    await expect(popover(page)).toHaveCount(0);
    const at = await place(page, 2, { right: -150, up: 60 });
    await page.mouse.click(at.x, at.y);
    await expect(dialog(page)).toBeVisible();
    await dispatch(page, { type: 'setSelection', selection: { layerId: 'layer-1', element: 4 } });
    await expect(popover(page)).toHaveCount(0);
  });

  test('is not a place to drag the map from: a drag that starts on it does not move the map', async ({
    page,
  }) => {
    const at = await place(page, 2, { right: -150, up: 60 });
    await page.mouse.click(at.x, at.y);
    await expect(dialog(page)).toBeVisible();
    const box = await page.locator('karmania-identify h2').boundingBox();
    if (box === null) throw new Error('No popover.');
    const before = await camera(page);
    await page.mouse.move(box.x + 10, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 40, { steps: 5 });
    await page.mouse.up();
    expect((await camera(page)).centre).toEqual(before.centre);
  });
});

test.describe('the identify popover of a dataset with many attributes', () => {
  test('shows 8 of them, in the order of the columns, and says how many more there are', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    const header = [
      'Easting',
      'Northing',
      ...Array.from({ length: 11 }, (_, i) => `attr${String(i + 1)}`),
    ];
    const row = [
      500_010,
      2_765_020,
      ...Array.from({ length: 11 }, (_, i) => `value ${String(i + 1)}`),
    ];
    await importAndLoad(
      page,
      {
        name: 'wide.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(`${header.join(',')}\n${row.join(',')}\n`),
      },
      {
        name: 'wide.prj',
        mimeType: 'text/plain',
        buffer: Buffer.from(readFileSync(fixturePath('points.prj'))),
      },
    );
    await drawn(page);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [500_010, 2_765_020], unitsPerPixel: 1, heading: 0 } },
    });
    const box = await page.locator('karmania-map-area canvas').boundingBox();
    if (box === null) throw new Error('The map is not on the page.');
    await expect
      .poll(async () => Math.abs((await camera(page)).unitsPerPixel - 1))
      .toBeLessThan(1e-9);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(dialog(page)).toBeVisible();
    const attributes = await rows(page);
    expect(attributes).toHaveLength(8);
    expect(attributes.map(([name]) => name)).toEqual(
      Array.from({ length: 8 }, (_, i) => `attr${String(i + 1)}`),
    );
    expect(attributes[0]).toEqual(['attr1', 'value 1']);
    await expect(page.locator('karmania-identify .more')).toContainText('3 more attributes');
  });
});
