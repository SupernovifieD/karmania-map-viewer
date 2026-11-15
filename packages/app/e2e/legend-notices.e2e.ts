import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { boxOf } from './support/layout.js';
import { layerRow, legend, loadGrid, showLegend } from './support/legend.js';
import { dispatch, layerStatuses, withData } from './support/render.js';
import { importAsLocalGrid } from './support/wizard.js';

/**
 * The notices of the Legend tab (step 19.9): a layer that is not drawn has a warning icon in the room of 16 that every layer keeps for it, whose tooltip says
 * why, in the engine's words, and its opened part says why first. Here `layer-1` (points, in UTM 40, the map's system) is drawn, and `layer-2` (a local grid, in
 * feet) is not.
 */

const MESSAGE =
  'Not drawn: A local grid has no known place on the Earth, so its positions cannot be converted to or from EPSG:32640.';
const HINT = "Change the map's coordinate system to the one this dataset is in.";

const statuses = async (page: Page): Promise<string[]> =>
  (await layerStatuses(page)).map(([, status]) => status);

async function open(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await withData(page);
  await importAsLocalGrid(page, 'ft', {
    name: 'faults.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('x,y\n1,2\n3,4\n'),
  });
  await expect.poll(() => statuses(page)).toEqual(['drawn', 'not_drawn']);
  await showLegend(page);
  await expect(layerRow(page, 'layer-2')).toBeVisible();
}

const notice = (page: Page, id: string): Locator => layerRow(page, id).locator('.notice');
const icon = (page: Page, id: string): Locator => notice(page, id).locator('k-icon');
const reason = (page: Page, id: string): Locator => legend(page).locator(`#legend-reason-${id}`);
const tip = (page: Page): Locator => legend(page).locator('k-tooltip .tip');

/** Applies the first local grid that the dialog of the map's system offers, as a person does. */
async function applyLocalGrid(page: Page): Promise<void> {
  await page.locator('karmania-status-chip button.crs').click();
  const dialog = page.locator('karmania-map-crs-dialog dialog');
  await expect(dialog).toBeVisible();
  await page.locator('karmania-map-crs-dialog .local input').first().check();
  await page.locator('karmania-map-crs-dialog k-button[slot="footer-end"] button').click();
  await expect(dialog).toBeHidden();
}

test.describe('the notice of a layer that is not drawn in the Legend tab', () => {
  test('has a warning icon in the room of the notice, in the colour of warnings, on a layer that is not drawn and none on a layer that is', async ({
    page,
  }) => {
    await open(page);
    await expect(icon(page, 'layer-2')).toHaveCount(1);
    await expect(icon(page, 'layer-1')).toHaveCount(0);
    await expect(icon(page, 'layer-2')).toHaveAttribute('name', 'triangle-alert');
    await expect(notice(page, 'layer-2')).toHaveCSS('color', 'rgb(138, 83, 0)');
  });

  test('keeps the room: it is 16 wide with the icon or without, and the name and the button that opens are in the same places on both layers', async ({
    page,
  }) => {
    await open(page);
    for (const id of ['layer-1', 'layer-2']) {
      expect((await notice(page, id).boundingBox())?.width, id).toBe(16);
    }
    const left = async (id: string, part: string): Promise<number | undefined> =>
      (await layerRow(page, id).locator(part).boundingBox())?.x;
    expect(await left('layer-2', '.notice')).toBe(await left('layer-1', '.notice'));
    expect(await left('layer-2', '.name')).toBe(await left('layer-1', '.name'));
    expect(await left('layer-2', '.open')).toBe(await left('layer-1', '.open'));
    const icons = await icon(page, 'layer-2').boundingBox();
    const room = await notice(page, 'layer-2').boundingBox();
    expect([icons?.width, icons?.height]).toEqual([16, 16]);
    expect(icons?.x).toBe(room?.x);
  });

  test('says why in a tooltip when the icon is pointed at, in the words of the engine with what to do, and puts it away when the pointer leaves', async ({
    page,
  }) => {
    await open(page);
    await expect(tip(page).first()).toBeHidden();
    await icon(page, 'layer-2').hover();
    await expect(tip(page).first()).toBeVisible();
    await expect(tip(page).first()).toHaveText(`${MESSAGE} ${HINT}`);
    await page.mouse.move(0, 0);
    await expect(tip(page).first()).toBeHidden();
  });

  test('has no tooltip on a layer that is drawn', async ({ page }) => {
    await open(page);
    await expect(layerRow(page, 'layer-1').locator('k-tooltip')).toHaveCount(0);
    await expect(layerRow(page, 'layer-2').locator('k-tooltip')).toHaveCount(1);
  });

  test('says "not drawn" in the name of the row for those who cannot see the icon, and not on a row that is drawn', async ({
    page,
  }) => {
    await open(page);
    await expect(layerRow(page, 'layer-2')).toHaveAccessibleName(/not drawn/i);
    await expect(layerRow(page, 'layer-1')).not.toHaveAccessibleName(/not drawn/i);
  });

  test('says why in the opened layer, first: the engine’s message, and under it what to do, one level in, above the fields of its style', async ({
    page,
  }) => {
    await open(page);
    await expect(reason(page, 'layer-2')).toHaveCount(0);
    await layerRow(page, 'layer-2').locator('.open').click();
    await expect(reason(page, 'layer-2')).toBeVisible();
    await expect(reason(page, 'layer-2').locator('.said')).toHaveText(MESSAGE);
    await expect(reason(page, 'layer-2').locator('.hint')).toHaveText(HINT);
    await expect(reason(page, 'layer-2')).toHaveAttribute('role', 'treeitem');
    await expect(reason(page, 'layer-2')).toHaveAttribute('aria-level', '2');
    // The message is above what to do, and both are above the fields, which are still there: a layer that is not drawn keeps its style.
    const said = await boxOf(reason(page, 'layer-2').locator('.said'), 'the message');
    const hint = await boxOf(reason(page, 'layer-2').locator('.hint'), 'what to do');
    const style = await boxOf(legend(page).locator('#legend-style-layer-2'), 'the style fields');
    expect(said.y + said.height).toBeLessThanOrEqual(hint.y);
    expect(hint.y + hint.height).toBeLessThanOrEqual(style.y);
    // And the icon is at the left of the lines, under the swatch of the layer.
    await expect(reason(page, 'layer-2').locator('k-icon')).toHaveAttribute(
      'name',
      'triangle-alert',
    );
    // A layer that is drawn has no such part.
    await layerRow(page, 'layer-1').locator('.open').click();
    await expect(legend(page).locator('#legend-style-layer-1')).toBeVisible();
    await expect(reason(page, 'layer-1')).toHaveCount(0);
  });

  test('follows the map: when the map’s system changes so that the layer is drawn, its notice goes, and the layer that stops being drawn has one', async ({
    page,
  }) => {
    await open(page);
    await layerRow(page, 'layer-2').locator('.open').click();
    await layerRow(page, 'layer-1').locator('.open').click();
    await expect(reason(page, 'layer-2')).toBeVisible();
    await applyLocalGrid(page);
    await expect.poll(() => statuses(page)).toEqual(['not_drawn', 'drawn']);
    await expect(icon(page, 'layer-2')).toHaveCount(0);
    await expect(reason(page, 'layer-2')).toHaveCount(0);
    await expect(icon(page, 'layer-1')).toHaveCount(1);
    await expect(reason(page, 'layer-1')).toBeVisible();
    await expect(reason(page, 'layer-1').locator('.said')).toContainText('Not drawn:');
    // The room is as it was on both: nothing moved.
    for (const id of ['layer-1', 'layer-2']) {
      expect((await notice(page, id).boundingBox())?.width, id).toBe(16);
    }
  });

  test('has no serious accessibility violation with a layer that is not drawn, closed and open', async ({
    page,
  }) => {
    await open(page);
    await expectNoSeriousViolations(page);
    await layerRow(page, 'layer-2').locator('.open').click();
    await expect(reason(page, 'layer-2')).toBeVisible();
    await expectNoSeriousViolations(page);
  });
});

test.describe('the notice of a layer whose classes cannot be worked out', () => {
  const COLUMN_MISSING =
    'Not drawn: The dataset has no column named nope, so nothing can be coloured by it.';
  const HINT_MISSING = 'Colour by a column the dataset has, or draw the layer in a single colour.';

  test('has the icon, the tooltip and the reason for a layer coloured by a column that the dataset does not have, in the engine’s words, and loses them when the layer is coloured by one it has', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await loadGrid(page, 'Assays', 1);
    await showLegend(page);
    await expect(icon(page, 'layer-1')).toHaveCount(0);
    // A style from an embedder's document, or one made before the dataset changed: the column is not there.
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: {
        colour: {
          mode: 'classes',
          column: 'nope',
          method: 'equal',
          classes: 5,
          ramp: 'viridis',
          reverse: false,
        },
      },
    });
    await expect.poll(() => statuses(page)).toEqual(['not_drawn']);
    await expect(icon(page, 'layer-1')).toHaveCount(1);
    await expect(layerRow(page, 'layer-1')).toHaveAccessibleName(/not drawn/i);
    await icon(page, 'layer-1').hover();
    await expect(tip(page).first()).toHaveText(`${COLUMN_MISSING} ${HINT_MISSING}`);
    await page.mouse.move(0, 0);
    await layerRow(page, 'layer-1').locator('.open').click();
    await expect(reason(page, 'layer-1').locator('.said')).toHaveText(COLUMN_MISSING);
    await expect(reason(page, 'layer-1').locator('.hint')).toHaveText(HINT_MISSING);
    // It has no class lines (it is not drawn) and keeps its style fields, so that the person can mend it.
    await expect(legend(page).locator('#legend-classes-layer-1')).toHaveCount(0);
    await expect(legend(page).locator('#legend-style-layer-1')).toBeVisible();
    // Coloured by a column that it has, it is drawn, and the notice goes.
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#e69f00' } },
    });
    await expect.poll(() => statuses(page)).toEqual(['drawn']);
    await expect(icon(page, 'layer-1')).toHaveCount(0);
    await expect(reason(page, 'layer-1')).toHaveCount(0);
  });

  test('has no serious accessibility violation with such a layer open', async ({ page }) => {
    await page.goto('/?theme=light');
    await loadGrid(page, 'Assays', 1);
    await showLegend(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: {
        colour: {
          mode: 'classes',
          column: 'nope',
          method: 'equal',
          classes: 5,
          ramp: 'viridis',
          reverse: false,
        },
      },
    });
    await expect(icon(page, 'layer-1')).toHaveCount(1);
    await layerRow(page, 'layer-1').locator('.open').click();
    await expect(reason(page, 'layer-1')).toBeVisible();
    await expectNoSeriousViolations(page);
  });
});
