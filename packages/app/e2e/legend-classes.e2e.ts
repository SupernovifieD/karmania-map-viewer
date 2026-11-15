import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { groupRow, layerRow, legend, loadGrid, showLegend } from './support/legend.js';
import { dispatch } from './support/render.js';

/**
 * The class lines of a layer in the Legend tab (step 19.3): a button that opens a layer that has classes, and under it a line for each class (a colour,
 * a label and how many it has) and `No value` for the cells that have none, opened with the pointer or with Right and closed with Left.
 */

/** 16 cells, the last three with no value. */
const WITH_HOLES = Array.from({ length: 16 }, (_, i) => (i < 13 ? i + 1 : Number.NaN));

/**
 * Three layers, top to bottom: `layer-3` in one colour, `layer-2` with three cells that have no value and `layer-1` with all of its 16 cells, the last
 * two by classes (the engine has given the classes of both when the Legend tab is chosen).
 */
async function open(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await loadGrid(page, 'Topography', 1);
  await loadGrid(page, 'Assays', 2, WITH_HOLES);
  await loadGrid(page, 'Geology', 3);
  await dispatch(page, {
    type: 'setStyle',
    layerId: 'layer-3',
    patch: { colour: { mode: 'single', value: '#e69f00' } },
  });
  await showLegend(page);
  // The button is there once the engine has given the classes.
  await expect(layerRow(page, 'layer-1')).toHaveAttribute('aria-expanded', 'false');
  await expect(layerRow(page, 'layer-2')).toHaveAttribute('aria-expanded', 'false');
}

const opener = (row: Locator): Locator => row.locator('.open');
/** The region of the class lines of a layer: the group that its row owns. */
const classes = (page: Page, id: string): Locator => legend(page).locator(`#legend-classes-${id}`);
const lines = (page: Page, id: string): Locator => classes(page, id).locator('.entry');

/** The numbers of the count column of a layer's lines, as written (with thousands commas). */
const counts = (page: Page, id: string): Promise<number[]> =>
  lines(page, id)
    .locator('.figure')
    .allTextContents()
    .then((texts) => texts.map((text) => Number(text.replace(/,/g, ''))));

test.describe('the class lines of a layer in the Legend tab', () => {
  test('has the button on every layer, with classes or without (its style is behind it), 28 wide, and says whether it is open', async ({
    page,
  }) => {
    await open(page);
    for (const id of ['layer-1', 'layer-2', 'layer-3']) {
      await expect(opener(layerRow(page, id)).locator('k-icon'), id).toHaveCount(1);
      await expect(layerRow(page, id), id).toHaveAttribute('aria-expanded', 'false');
      expect((await opener(layerRow(page, id)).boundingBox())?.width, id).toBe(28);
    }
    // A layer in one colour has no class lines to show when it is opened, only its style.
    await opener(layerRow(page, 'layer-3')).click();
    await expect(layerRow(page, 'layer-3')).toHaveAttribute('aria-expanded', 'true');
    await expect(classes(page, 'layer-3')).toHaveCount(0);
    await expect(legend(page).locator('#legend-style-layer-3')).toBeVisible();
  });

  test('opens a layer with the pointer, and shows a line for each class: its colour, its label with an en dash between its bounds, and its count', async ({
    page,
  }) => {
    await open(page);
    await expect(classes(page, 'layer-1')).toHaveCount(0);
    await opener(layerRow(page, 'layer-1')).click();
    await expect(layerRow(page, 'layer-1')).toHaveAttribute('aria-expanded', 'true');
    // The group of lines has a name, and is owned by the row.
    await expect(page.getByRole('group', { name: 'Classes of Topography' })).toHaveCount(1);
    await expect(layerRow(page, 'layer-1')).toHaveAttribute('aria-owns', 'legend-classes-layer-1');
    const all = lines(page, 'layer-1');
    const labels = await all.locator('.label').allTextContents();
    expect(labels.length).toBeGreaterThanOrEqual(2);
    // The classes are of the 16 cells, so their counts add up to 16, and there is no "No value" line, as every cell has one.
    expect((await counts(page, 'layer-1')).reduce((sum, n) => sum + n, 0)).toBe(16);
    expect(labels).not.toContain('No value');
    // Ranges of numbers, from the lowest value on: `lower – upper`, with an en dash.
    expect(labels[0]).toMatch(/^1\s–\s/);
    for (const label of labels.slice(0, -1)) {
      expect(label, label).toContain(' – ');
    }
    // The colours are the ramp's, from its first to its last (viridis), as the layer's own ramp preview has them.
    const colours = await all
      .locator('.dot')
      .evaluateAll((dots) => dots.map((dot) => getComputedStyle(dot).backgroundColor));
    expect(colours[0]).toBe('rgb(68, 1, 84)');
    expect(colours.at(-1)).toBe('rgb(253, 231, 37)');
    // The lines are 24 high, their swatches 12 by 12, and the counts are muted and at the right edge of the row.
    for (const line of await all.all()) {
      expect((await line.boundingBox())?.height).toBe(24);
    }
    const dot = await all.first().locator('.dot').boundingBox();
    expect([dot?.width, dot?.height]).toEqual([12, 12]);
    const row = await layerRow(page, 'layer-1').boundingBox();
    const figure = await all.first().locator('.figure').boundingBox();
    expect((figure?.x ?? 0) + (figure?.width ?? 0)).toBeCloseTo(
      (row?.x ?? 0) + (row?.width ?? 0),
      0,
    );
    // The swatch of the first line is under the layer's own swatch.
    const own = await layerRow(page, 'layer-1').locator('.swatch').boundingBox();
    expect(dot?.x).toBe(own?.x);
  });

  test('has a "No value" line, with a swatch that is only an outline, for the cells that have none, and its count', async ({
    page,
  }) => {
    await open(page);
    await opener(layerRow(page, 'layer-2')).click();
    const all = lines(page, 'layer-2');
    const last = all.last();
    await expect(last.locator('.label')).toHaveText('No value');
    await expect(last.locator('.figure')).toHaveText('3');
    // The cells that have a value are in the classes before it: 13 of them.
    const before = (await counts(page, 'layer-2')).slice(0, -1);
    expect(before.reduce((sum, n) => sum + n, 0)).toBe(13);
    // No colour: nothing fills it, and it has its outline.
    await expect(last.locator('.dot')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(last.locator('.dot')).toHaveCSS('border-top-style', 'solid');
  });

  test('opens a layer with Right and closes it with Left, keeps the keyboard on the row, on a layer in one colour as on one with classes', async ({
    page,
  }) => {
    await open(page);
    const row = layerRow(page, 'layer-1');
    await row.focus();
    await page.keyboard.press('ArrowRight');
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(row).toBeFocused();
    await expect(lines(page, 'layer-1').first()).toBeVisible();
    // Right again does nothing more, and Down goes on to the next row (the lines are not rows).
    await page.keyboard.press('ArrowRight');
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(classes(page, 'layer-1')).toHaveCount(0);
    await page.keyboard.press('ArrowLeft');
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    // A layer in one colour opens too, to its style and no class lines.
    const single = layerRow(page, 'layer-3');
    await single.focus();
    await page.keyboard.press('ArrowRight');
    await expect(single).toHaveAttribute('aria-expanded', 'true');
    await expect(classes(page, 'layer-3')).toHaveCount(0);
    await expect(single).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(single).toHaveAttribute('aria-expanded', 'false');
  });

  test('puts the lines of a layer in a group 24 in, as its row is', async ({ page }) => {
    await open(page);
    await dispatch(
      page,
      { type: 'createGroup', name: 'Samples' },
      { type: 'moveNode', id: 'layer-2', to: { parent: 'group-1', index: 0 } },
    );
    await opener(layerRow(page, 'layer-1')).click();
    await opener(layerRow(page, 'layer-2')).click();
    const top = await lines(page, 'layer-1').first().locator('.dot').boundingBox();
    const inside = await lines(page, 'layer-2').first().locator('.dot').boundingBox();
    expect((inside?.x ?? 0) - (top?.x ?? 0)).toBe(24);
    await expect(groupRow(page, 'group-1')).toBeVisible();
  });

  test('keeps a layer open while its classes are worked out again and when it has none (its style is still behind it), and has its lines again with classes', async ({
    page,
  }) => {
    await open(page);
    await opener(layerRow(page, 'layer-1')).click();
    const before = await lines(page, 'layer-1').count();
    expect(before).toBeGreaterThan(3);
    const style = (classesWanted: number) => ({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: {
        colour: {
          mode: 'classes',
          column: 'value',
          method: 'equal',
          classes: classesWanted,
          ramp: 'viridis',
          reverse: false,
        },
      },
    });
    await dispatch(page, style(3));
    await expect.poll(() => lines(page, 'layer-1').count()).toBe(3);
    await expect(layerRow(page, 'layer-1')).toHaveAttribute('aria-expanded', 'true');
    // In one colour it has no lines, and is open all the same: its style is what is behind it.
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#0072b2' } },
    });
    await expect(classes(page, 'layer-1')).toHaveCount(0);
    await expect(layerRow(page, 'layer-1')).toHaveAttribute('aria-expanded', 'true');
    await expect(legend(page).locator('#legend-style-layer-1')).toBeVisible();
    // By classes again: it is open, as it was left.
    await dispatch(page, style(5));
    await expect.poll(() => lines(page, 'layer-1').count()).toBe(5);
    await expect(layerRow(page, 'layer-1')).toHaveAttribute('aria-expanded', 'true');
  });

  test('has no serious accessibility violation with two layers open, one with a "No value" line, and a row that has the keyboard', async ({
    page,
  }) => {
    await open(page);
    await opener(layerRow(page, 'layer-1')).click();
    await opener(layerRow(page, 'layer-2')).click();
    await layerRow(page, 'layer-1').focus();
    await expectNoSeriousViolations(page);
  });
});
