import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { layerRow, legend, loadLegendScene } from './support/legend.js';
import { around, bytes, distance, dispatch, drawn } from './support/render.js';

/**
 * The style editor of a layer in the Legend tab (steps 19.6 to 19.8): the fields behind a layer's row, stacked, a label above each, 12 between them. Here: Colour by
 * (a single colour or a column), and, for a single colour, twelve swatches and a hex code.
 */

/** The twelve swatches: the colours of the ramp Paired. */
const PAIRED = [
  '#a6cee3',
  '#1f78b4',
  '#b2df8a',
  '#33a02c',
  '#fb9a99',
  '#e31a1c',
  '#fdbf6f',
  '#ff7f00',
  '#cab2d6',
  '#6a3d9a',
  '#ffff99',
  '#b15928',
];

const editor = (page: Page, id: string): Locator =>
  legend(page).locator(`#legend-style-${id} karmania-style-editor`);
const colourBy = (page: Page, id: string): Locator => editor(page, id).locator('k-select');
const swatches = (page: Page, id: string): Locator => editor(page, id).locator('.swatch');
const hex = (page: Page, id: string): Locator => editor(page, id).locator('k-input');
const hexInput = (page: Page, id: string): Locator => hex(page, id).locator('input');

/** The style of a layer in the scene. */
const styleOf = (page: Page, id: string): Promise<Record<string, unknown> | undefined> =>
  page.evaluate((layerId) => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      scene(): {
        layers: Record<string, { style: { colour: Record<string, unknown> } } | undefined>;
      };
    };
    return viewer.scene().layers[layerId]?.style.colour;
  }, id);

async function open(page: Page, ...ids: string[]): Promise<void> {
  await page.goto('/?theme=light');
  await loadLegendScene(page);
  await expect(layerRow(page, 'layer-5')).toBeVisible();
  for (const id of ids) {
    await layerRow(page, id).locator('.open').click();
    await expect(editor(page, id)).toBeVisible();
  }
}

test.describe('the style editor: colour by, and a single colour', () => {
  test('has a Colour by field, named, with a single colour and each column of the dataset, and which one the layer has', async ({
    page,
  }) => {
    await open(page, 'layer-1', 'layer-2');
    for (const id of ['layer-1', 'layer-2']) {
      await expect(colourBy(page, id).locator('label')).toHaveText('Colour by');
      expect(
        await colourBy(page, id)
          .locator('option')
          .evaluateAll((options) =>
            options.map((option) => [option.getAttribute('value'), option.textContent.trim()]),
          ),
      ).toEqual([
        ['single', 'Single colour'],
        ['column:value', 'value'],
      ]);
    }
    // `layer-1` is in one colour and `layer-2` by classes of its column.
    await expect(colourBy(page, 'layer-1').locator('select')).toHaveValue('single');
    await expect(colourBy(page, 'layer-2').locator('select')).toHaveValue('column:value');
    // Only a single colour has the swatches and the hex code.
    await expect(swatches(page, 'layer-1')).toHaveCount(12);
    await expect(swatches(page, 'layer-2')).toHaveCount(0);
    await expect(hex(page, 'layer-2')).toHaveCount(0);
  });

  test('turns a single colour into classes of a column with the defaults of a column, and a layer by classes into a single colour, the first swatch', async ({
    page,
  }) => {
    await open(page, 'layer-1');
    await colourBy(page, 'layer-1').locator('select').selectOption('column:value');
    await expect
      .poll(() => styleOf(page, 'layer-1'))
      .toEqual({
        mode: 'classes',
        column: 'value',
        method: 'equal',
        classes: 7,
        ramp: 'viridis',
        reverse: false,
      });
    await expect(swatches(page, 'layer-1')).toHaveCount(0);
    // The classes are worked out, and the lines of them are listed.
    await expect(legend(page).locator('#legend-classes-layer-1 .entry').first()).toBeVisible();
    await colourBy(page, 'layer-1').locator('select').selectOption('single');
    await expect.poll(() => styleOf(page, 'layer-1')).toEqual({ mode: 'single', value: PAIRED[0] });
    await expect(swatches(page, 'layer-1')).toHaveCount(12);
    await expect(legend(page).locator('#legend-classes-layer-1')).toHaveCount(0);
  });

  test('has twelve swatches in a group of radio buttons named Colour, each named by its colour, the colour of the layer checked if it is one of them', async ({
    page,
  }) => {
    await open(page, 'layer-1');
    await expect(editor(page, 'layer-1').getByRole('radiogroup', { name: 'Colour' })).toHaveCount(
      1,
    );
    expect(
      await swatches(page, 'layer-1').evaluateAll((all) =>
        all.map((swatch) => swatch.getAttribute('aria-label')),
      ),
    ).toEqual(PAIRED);
    // Orange is not among them: none is checked, and the first has the stop for Tab.
    for (const swatch of await swatches(page, 'layer-1').all()) {
      await expect(swatch).toHaveAttribute('aria-checked', 'false');
    }
    expect(
      await swatches(page, 'layer-1').evaluateAll((all) =>
        all.map((swatch) => swatch.getAttribute('tabindex')),
      ),
    ).toEqual(['0', ...Array<string>(11).fill('-1')]);
    // A swatch is 16 by 16 in its own colour, in a row with 4 between.
    const first = await swatches(page, 'layer-1').nth(0).boundingBox();
    const second = await swatches(page, 'layer-1').nth(1).boundingBox();
    expect([first?.width, first?.height]).toEqual([16, 16]);
    expect((second?.x ?? 0) - ((first?.x ?? 0) + (first?.width ?? 0))).toBe(4);
    await expect(swatches(page, 'layer-1').nth(2)).toHaveCSS(
      'background-color',
      'rgb(178, 223, 138)',
    );
  });

  test('chooses a swatch with the pointer: the scene has the colour, the swatch is checked, the hex code shows it, and the map is drawn in it', async ({
    page,
  }) => {
    await open(page, 'layer-1');
    // Only `layer-1` is shown: the other layers are on the same cells.
    await dispatch(
      page,
      { type: 'setVisible', layerId: 'layer-2', visible: false },
      { type: 'setGroupVisible', groupId: 'group-1', visible: false },
      { type: 'setGroupVisible', groupId: 'group-2', visible: false },
    );
    await swatches(page, 'layer-1').nth(2).click();
    await expect.poll(() => styleOf(page, 'layer-1')).toEqual({ mode: 'single', value: '#b2df8a' });
    await expect(swatches(page, 'layer-1').nth(2)).toHaveAttribute('aria-checked', 'true');
    await expect(hexInput(page, 'layer-1')).toHaveValue('#b2df8a');
    const wanted = bytes('#b2df8a');
    const centre = async (): Promise<number[]> => {
      const now = await drawn(page);
      return (await around(page, Math.floor(now.width / 2), Math.floor(now.height / 2), 0)).at(
        0,
        0,
      );
    };
    await expect.poll(async () => distance(await centre(), wanted)).toBeLessThanOrEqual(2);
  });

  test('moves between the swatches with the arrows, choosing as it goes, wrapping round, with Home and End, and one stop for Tab', async ({
    page,
  }) => {
    await open(page, 'layer-1');
    await swatches(page, 'layer-1').nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(swatches(page, 'layer-1').nth(1)).toBeFocused();
    await expect.poll(() => styleOf(page, 'layer-1')).toEqual({ mode: 'single', value: PAIRED[1] });
    // The stop for Tab is the one that is chosen.
    expect(
      await swatches(page, 'layer-1').evaluateAll((all) =>
        all.map((swatch) => swatch.getAttribute('tabindex')),
      ),
    ).toEqual(['-1', '0', ...Array<string>(10).fill('-1')]);
    await page.keyboard.press('End');
    await expect(swatches(page, 'layer-1').nth(11)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(swatches(page, 'layer-1').nth(0)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(swatches(page, 'layer-1').nth(11)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(swatches(page, 'layer-1').nth(0)).toBeFocused();
    await expect.poll(() => styleOf(page, 'layer-1')).toEqual({ mode: 'single', value: PAIRED[0] });
  });

  test('takes a hex code with Enter or when the field is left: six digits or three, with or without the #, in any case', async ({
    page,
  }) => {
    await open(page, 'layer-1');
    await hexInput(page, 'layer-1').fill('f80');
    await hexInput(page, 'layer-1').press('Enter');
    await expect.poll(() => styleOf(page, 'layer-1')).toEqual({ mode: 'single', value: '#ff8800' });
    await expect(hexInput(page, 'layer-1')).toHaveValue('#ff8800');
    await hexInput(page, 'layer-1').fill('0072B2');
    await legend(page).locator('.top span').first().click();
    await expect.poll(() => styleOf(page, 'layer-1')).toEqual({ mode: 'single', value: '#0072b2' });
    await expect(hexInput(page, 'layer-1')).toHaveValue('#0072b2');
  });

  test('says in words that a text is not a colour, keeps the style and the text, and puts the colour back with Escape', async ({
    page,
  }) => {
    await open(page, 'layer-1');
    await hexInput(page, 'layer-1').fill('red');
    await hexInput(page, 'layer-1').press('Enter');
    await expect(hex(page, 'layer-1').locator('.error')).toHaveText(
      'Use a colour such as #e69f00.',
    );
    await expect(hexInput(page, 'layer-1')).toHaveAttribute('aria-invalid', 'true');
    await expect(hexInput(page, 'layer-1')).toHaveValue('red');
    expect(await styleOf(page, 'layer-1')).toEqual({ mode: 'single', value: '#e69f00' });
    await hexInput(page, 'layer-1').press('Escape');
    await expect(hexInput(page, 'layer-1')).toHaveValue('#e69f00');
    await expect(hex(page, 'layer-1').locator('.error')).toHaveCount(0);
  });

  test('stacks the fields with their labels above and 12 between them, each the width of the editor', async ({
    page,
  }) => {
    await open(page, 'layer-1');
    const whole = await editor(page, 'layer-1').boundingBox();
    const select = await colourBy(page, 'layer-1').boundingBox();
    const swatchRow = await editor(page, 'layer-1').locator('.swatches').boundingBox();
    const field = await hex(page, 'layer-1').boundingBox();
    expect(select?.width).toBe(whole?.width);
    expect(field?.width).toBe(whole?.width);
    // Label above the control: the select's label is over its box.
    const label = await colourBy(page, 'layer-1').locator('label').boundingBox();
    const box = await colourBy(page, 'layer-1').locator('select').boundingBox();
    expect((label?.y ?? 0) + (label?.height ?? 0)).toBeLessThanOrEqual(box?.y ?? 0);
    // 12 between the fields: from the select to the Colour label, and from the swatches to the hex code's label.
    const colourLabel = await editor(page, 'layer-1').locator('.group-label').boundingBox();
    expect((colourLabel?.y ?? 0) - ((select?.y ?? 0) + (select?.height ?? 0))).toBe(12);
    const hexLabel = await hex(page, 'layer-1').locator('label').boundingBox();
    expect((hexLabel?.y ?? 0) - ((swatchRow?.y ?? 0) + (swatchRow?.height ?? 0))).toBe(12);
  });

  test('has an error appear in room that was kept: the rows under the editor stay where they are', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await loadLegendScene(page);
    // `layer-2` is over `layer-1`: it is put in one colour and opened, so that `layer-1` is under its editor.
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-2',
      patch: { colour: { mode: 'single', value: '#e69f00' } },
    });
    await layerRow(page, 'layer-2').locator('.open').click();
    await expect(hex(page, 'layer-2')).toBeVisible();
    const under = await layerRow(page, 'layer-1').boundingBox();
    await hexInput(page, 'layer-2').fill('nope');
    await hexInput(page, 'layer-2').press('Enter');
    await expect(hex(page, 'layer-2').locator('.error')).toBeVisible();
    expect((await layerRow(page, 'layer-1').boundingBox())?.y).toBe(under?.y);
  });

  test('has no serious accessibility violation with the editor open on a single colour and on classes, with an error in the hex code', async ({
    page,
  }) => {
    await open(page, 'layer-1', 'layer-2');
    await hexInput(page, 'layer-1').fill('x');
    await hexInput(page, 'layer-1').press('Enter');
    await expectNoSeriousViolations(page);
  });
});
