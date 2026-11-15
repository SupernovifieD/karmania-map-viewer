import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { layerRow, legend, loadLegendScene, showLegend } from './support/legend.js';
import { around, bytes, distance, dispatch, drawn, mapColour } from './support/render.js';
import { projectionFor } from './support/fixtures.js';
import { importAndLoad } from './support/wizard.js';

/**
 * The style editor of a layer in the Legend tab (steps 19.6 to 19.8): the fields behind a layer's row, stacked, a label above each, 12 between them. Here: Colour by
 * (a single colour or a column), for a single colour twelve swatches and a hex code, and for a column its method, the number of classes, the ramp and its direction.
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
const colourBy = (page: Page, id: string): Locator =>
  editor(page, id).locator('k-select[label="Colour by"]');
const swatches = (page: Page, id: string): Locator => editor(page, id).locator('.swatch');
const hex = (page: Page, id: string): Locator =>
  editor(page, id).locator('k-input[label="Hex code"]');
const hexInput = (page: Page, id: string): Locator => hex(page, id).locator('input');
/** The field of the classes of a layer that is named `label`: Method or Classes. */
const field = (page: Page, id: string, label: string): Locator =>
  editor(page, id).locator(`k-select[label="${label}"]`);
const ramp = (page: Page, id: string): Locator => editor(page, id).locator('karmania-ramp-select');
const face = (page: Page, id: string): Locator => ramp(page, id).getByRole('combobox');
const rampList = (page: Page, id: string): Locator => ramp(page, id).getByRole('listbox');
const rampChoices = (page: Page, id: string): Locator => rampList(page, id).getByRole('option');
const reverse = (page: Page, id: string): Locator => editor(page, id).locator('k-checkbox');
/** A field of numbers of a layer (`Opacity (%)`, `Point size (px)` or `Line width (px)`), and its input. */
const numberField = (page: Page, id: string, label: string): Locator =>
  editor(page, id).locator(`k-input[label="${label}"]`);
const numberInput = (page: Page, id: string, label: string): Locator =>
  numberField(page, id, label).locator('input');
/** The opacity that the style of a layer in the scene has, or its size or width. */
const numberOfStyle = (page: Page, id: string, key: string): Promise<unknown> =>
  page.evaluate(
    ([layerId, field]) => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        scene(): { layers: Record<string, { style: Record<string, unknown> } | undefined> };
      };
      return viewer.scene().layers[layerId]?.style[field];
    },
    [id, key] as const,
  );

/** How many pixels of the map are not the background of the map: what has been drawn on it. */
async function painted(page: Page): Promise<number> {
  const now = await drawn(page);
  const background = await mapColour(page);
  return page.evaluate(
    ([width, height, colour]) => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        renderPixels(x: number, y: number, w: number, h: number): Uint8Array | undefined;
      };
      const read = viewer.renderPixels(0, 0, width, height);
      let count = 0;
      for (let at = 0; read !== undefined && at < read.length; at += 4) {
        const away = Math.max(
          Math.abs((read[at] ?? 0) - (colour[0] ?? 0)),
          Math.abs((read[at + 1] ?? 0) - (colour[1] ?? 0)),
          Math.abs((read[at + 2] ?? 0) - (colour[2] ?? 0)),
        );
        count += away > 8 ? 1 : 0;
      }
      return count;
    },
    [now.width, now.height, background] as const,
  );
}
/** The colour of the first line of a layer's classes (the lowest class, or the highest if the ramp is reversed). */
const firstDot = (page: Page, id: string): Locator =>
  legend(page).locator(`#legend-classes-${id} .dot`).first();

/** The names of the ramps, in the order of the scene's list. */
const RAMP_NAMES = [
  'Viridis',
  'Magma',
  'Cividis',
  'Blues',
  'Greens',
  'Oranges',
  'Reds',
  'Purples',
  'Yellow-green-blue',
  'Yellow-orange-red',
  'Red-blue',
  'Purple-orange',
  'Brown-blue-green',
  'Okabe-Ito',
  'Paired',
];

/** How many times an event of the editor (`karmania-style-change`, or the picker's `karmania-ramp-change`) has been sent since this was called. */
async function countChanges(
  page: Page,
  name: 'karmania-style-change' | 'karmania-ramp-change' = 'karmania-style-change',
): Promise<() => Promise<number>> {
  const key = `changes:${name}`;
  await page.evaluate(
    ([event, counter]) => {
      const counted = window as unknown as Record<string, number>;
      counted[counter] = 0;
      document.addEventListener(event, () => {
        counted[counter] = (counted[counter] ?? 0) + 1;
      });
    },
    [name, key] as const,
  );
  return () =>
    page.evaluate((counter) => (window as unknown as Record<string, number>)[counter] ?? 0, key);
}

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
    // And the opacity is 12 under the hex code (with the room of its message), as wide as the editor.
    const opacity = await numberField(page, 'layer-1', 'Opacity (%)').boundingBox();
    expect((opacity?.y ?? 0) - ((field?.y ?? 0) + (field?.height ?? 0))).toBe(12);
    expect(opacity?.width).toBe(whole?.width);
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

  test('has no serious accessibility violation with the editor open on a single colour and on classes, with an error in the hex code and in an opacity', async ({
    page,
  }) => {
    await open(page, 'layer-1', 'layer-2');
    await hexInput(page, 'layer-1').fill('x');
    await hexInput(page, 'layer-1').press('Enter');
    await numberInput(page, 'layer-2', 'Opacity (%)').fill('x');
    await numberInput(page, 'layer-2', 'Opacity (%)').press('Enter');
    await expect(numberField(page, 'layer-2', 'Opacity (%)').locator('.error')).toBeVisible();
    await expectNoSeriousViolations(page);
  });
});

test.describe('the style editor: the classes of a column', () => {
  test('has Method, Classes, Ramp and Reverse ramp under Colour by, then Opacity, in that order, named, showing what the layer has, and no swatches', async ({
    page,
  }) => {
    await open(page, 'layer-2');
    expect(
      await editor(page, 'layer-2')
        .locator('.fields')
        .evaluate((fields) =>
          [...fields.children].map(
            (child) => child.getAttribute('label') ?? child.textContent.trim(),
          ),
        ),
    ).toEqual(['Colour by', 'Method', 'Classes', 'Ramp', 'Reverse ramp', 'Opacity (%)']);
    await expect(field(page, 'layer-2', 'Method').locator('select')).toHaveValue('equal');
    await expect(field(page, 'layer-2', 'Classes').locator('select')).toHaveValue('7');
    await expect(face(page, 'layer-2')).toHaveAccessibleName('Ramp Viridis');
    await expect(reverse(page, 'layer-2').locator('input')).not.toBeChecked();
    await expect(swatches(page, 'layer-2')).toHaveCount(0);
    await expect(hex(page, 'layer-2')).toHaveCount(0);
  });

  test('stacks them with 12 between the fields, each the width of the editor', async ({ page }) => {
    await open(page, 'layer-2');
    const whole = await editor(page, 'layer-2').boundingBox();
    const boxes = [
      await colourBy(page, 'layer-2').boundingBox(),
      await field(page, 'layer-2', 'Method').boundingBox(),
      await field(page, 'layer-2', 'Classes').boundingBox(),
      await ramp(page, 'layer-2').boundingBox(),
      await reverse(page, 'layer-2').boundingBox(),
      await numberField(page, 'layer-2', 'Opacity (%)').boundingBox(),
    ];
    for (const box of boxes) {
      expect(box?.width).toBe(whole?.width);
    }
    for (let at = 1; at < boxes.length; at += 1) {
      const above = boxes[at - 1];
      expect(
        (boxes[at]?.y ?? 0) - ((above?.y ?? 0) + (above?.height ?? 0)),
        `field ${String(at)}`,
      ).toBe(12);
    }
    // The ramp has its label above its face, and the face is as high as the other controls.
    const label = await ramp(page, 'layer-2').locator('.label').boundingBox();
    const box = await face(page, 'layer-2').boundingBox();
    expect(label?.y).toBeLessThan(box?.y ?? 0);
    expect(box?.height).toBe(32);
    expect(box?.width).toBe(whole?.width);
  });

  test('changes the method: the scene has it, the rest of the style is kept, and the lines are worked out again', async ({
    page,
  }) => {
    await open(page, 'layer-2');
    expect(
      await field(page, 'layer-2', 'Method')
        .locator('option')
        .evaluateAll((all) =>
          all.map((option) => [
            option.getAttribute('value'),
            option.textContent.trim(),
            (option as HTMLOptionElement).disabled,
          ]),
        ),
    ).toEqual([
      ['equal', 'Equal intervals', false],
      ['quantile', 'Quantiles', false],
      ['jenks', 'Natural breaks', false],
      ['categories', 'Categories', false],
    ]);
    await field(page, 'layer-2', 'Method').locator('select').selectOption('quantile');
    await expect
      .poll(() => styleOf(page, 'layer-2'))
      .toEqual({
        mode: 'classes',
        column: 'value',
        method: 'quantile',
        classes: 7,
        ramp: 'viridis',
        reverse: false,
      });
    await field(page, 'layer-2', 'Method').locator('select').selectOption('jenks');
    await expect.poll(() => styleOf(page, 'layer-2')).toMatchObject({ method: 'jenks' });
    await expect(field(page, 'layer-2', 'Method').locator('select')).toHaveValue('jenks');
    await expect(legend(page).locator('#legend-classes-layer-2 .entry').first()).toBeVisible();
  });

  test('changes the number of classes, 3 to 12: the scene has it and the lines are that many', async ({
    page,
  }) => {
    await open(page, 'layer-2');
    expect(
      await field(page, 'layer-2', 'Classes')
        .locator('option')
        .evaluateAll((all) => all.map((option) => option.textContent.trim())),
    ).toEqual(['3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    const lines = legend(page).locator('#legend-classes-layer-2 .entry');
    await field(page, 'layer-2', 'Classes').locator('select').selectOption('5');
    await expect.poll(() => styleOf(page, 'layer-2')).toMatchObject({ classes: 5 });
    await expect(lines).toHaveCount(5);
    await field(page, 'layer-2', 'Classes').locator('select').selectOption('12');
    await expect.poll(() => styleOf(page, 'layer-2')).toMatchObject({ classes: 12 });
    await expect(lines).toHaveCount(12);
    await field(page, 'layer-2', 'Classes').locator('select').selectOption('3');
    await expect(lines).toHaveCount(3);
  });

  test('has a ramp picker that is a combobox with a list of every ramp, a strip and a name each, the chosen one marked and ticked', async ({
    page,
  }) => {
    await open(page, 'layer-2');
    await expect(face(page, 'layer-2')).toHaveAttribute('aria-expanded', 'false');
    await expect(rampList(page, 'layer-2')).toHaveCount(0);
    // The face shows the ramp that is chosen: a strip of 48 by 12 and its name.
    const strip = face(page, 'layer-2').locator('.strip');
    expect((await strip.boundingBox())?.width).toBe(48);
    expect((await strip.boundingBox())?.height).toBe(12);
    await expect(face(page, 'layer-2').locator('.name')).toHaveText('Viridis');
    await face(page, 'layer-2').click();
    await expect(face(page, 'layer-2')).toHaveAttribute('aria-expanded', 'true');
    await expect(rampList(page, 'layer-2')).toHaveAccessibleName('Ramp');
    await expect(rampChoices(page, 'layer-2')).toHaveCount(15);
    expect(
      await rampChoices(page, 'layer-2').evaluateAll((all) =>
        all.map((option) => option.querySelector('.name')?.textContent.trim()),
      ),
    ).toEqual(RAMP_NAMES);
    // A strip in each, drawn from the colours of the ramp and not the same as another's.
    const strips = await rampChoices(page, 'layer-2')
      .locator('.strip')
      .evaluateAll((all) => all.map((one) => getComputedStyle(one).backgroundImage));
    expect(strips).toHaveLength(15);
    expect(new Set(strips).size).toBe(15);
    // The one that is chosen is marked for those who cannot see, and has a tick for those who can.
    await expect(rampChoices(page, 'layer-2').nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(rampChoices(page, 'layer-2').nth(1)).toHaveAttribute('aria-selected', 'false');
    await expect(rampChoices(page, 'layer-2').nth(0).locator('k-icon')).toHaveCount(1);
    await expect(rampList(page, 'layer-2').locator('k-icon')).toHaveCount(1);
  });

  test('has the list in the page, pushing what is under it away and not covering it, six choices high and scrolling the rest', async ({
    page,
  }) => {
    await open(page, 'layer-2');
    // Measured from the face, since opening the list can scroll the panel to show the choice that the arrows are at.
    const gap = async (): Promise<number> => {
      const above = await face(page, 'layer-2').boundingBox();
      const below = await reverse(page, 'layer-2').boundingBox();
      return (below?.y ?? 0) - ((above?.y ?? 0) + (above?.height ?? 0));
    };
    const closed = await gap();
    await face(page, 'layer-2').click();
    const list = await rampList(page, 'layer-2').boundingBox();
    const checkbox = await reverse(page, 'layer-2').boundingBox();
    // Under the list, and not over the checkbox, with the list's 4 above it and the 12 below it as they were.
    expect((checkbox?.y ?? 0) - ((list?.y ?? 0) + (list?.height ?? 0))).toBe(12);
    expect(await gap()).toBe(closed + (list?.height ?? 0) + 4);
    expect(list?.height).toBeLessThanOrEqual(6 * 32 + 2);
    expect(
      await rampList(page, 'layer-2').evaluate((one) => one.scrollHeight > one.clientHeight),
    ).toBe(true);
    await face(page, 'layer-2').click();
    await expect(rampList(page, 'layer-2')).toHaveCount(0);
    expect(await gap()).toBe(closed);
  });

  test('chooses a ramp with the pointer: the scene has it, the list closes, the face shows it, the keyboard stays on the face, and the lines have its colours', async ({
    page,
  }) => {
    await open(page, 'layer-2');
    await face(page, 'layer-2').click();
    await rampChoices(page, 'layer-2').nth(1).click();
    await expect
      .poll(() => styleOf(page, 'layer-2'))
      .toEqual({
        mode: 'classes',
        column: 'value',
        method: 'equal',
        classes: 7,
        ramp: 'magma',
        reverse: false,
      });
    await expect(rampList(page, 'layer-2')).toHaveCount(0);
    await expect(face(page, 'layer-2')).toHaveAccessibleName('Ramp Magma');
    await expect(face(page, 'layer-2')).toBeFocused();
    // The lowest class is the first stop of magma, which is black.
    await expect(firstDot(page, 'layer-2')).toHaveCSS('background-color', 'rgb(0, 0, 4)');
  });

  test('chooses a ramp with the keyboard: Enter, Space or Down opens, the arrows, Home and End move over the choices, Enter or Space chooses, Escape closes and chooses nothing', async ({
    page,
  }) => {
    await open(page, 'layer-2');
    const changes = await countChanges(page);
    await face(page, 'layer-2').focus();
    await page.keyboard.press('ArrowDown');
    await expect(face(page, 'layer-2')).toHaveAttribute('aria-expanded', 'true');
    // The choice that is chosen is the one the arrows start from.
    await expect(face(page, 'layer-2')).toHaveAttribute('aria-activedescendant', 'option-0');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(face(page, 'layer-2')).toHaveAttribute('aria-activedescendant', 'option-2');
    await page.keyboard.press('ArrowUp');
    await expect(face(page, 'layer-2')).toHaveAttribute('aria-activedescendant', 'option-1');
    await page.keyboard.press('End');
    await expect(face(page, 'layer-2')).toHaveAttribute('aria-activedescendant', 'option-14');
    // The choice the arrows are at is in sight in the list that scrolls.
    const list = await rampList(page, 'layer-2').boundingBox();
    const last = await rampChoices(page, 'layer-2').nth(14).boundingBox();
    expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(
      (list?.y ?? 0) + (list?.height ?? 0),
    );
    await page.keyboard.press('ArrowDown');
    await expect(face(page, 'layer-2')).toHaveAttribute('aria-activedescendant', 'option-14');
    await page.keyboard.press('Home');
    await expect(face(page, 'layer-2')).toHaveAttribute('aria-activedescendant', 'option-0');
    await page.keyboard.press('ArrowUp');
    await expect(face(page, 'layer-2')).toHaveAttribute('aria-activedescendant', 'option-0');
    // Escape closes it and chooses nothing, even where the arrows went.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(rampList(page, 'layer-2')).toHaveCount(0);
    await expect(face(page, 'layer-2')).toBeFocused();
    expect(await changes()).toBe(0);
    expect(await styleOf(page, 'layer-2')).toMatchObject({ ramp: 'viridis' });
    // Enter chooses.
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(() => styleOf(page, 'layer-2')).toMatchObject({ ramp: 'magma' });
    await expect(rampList(page, 'layer-2')).toHaveCount(0);
    await expect(face(page, 'layer-2')).toBeFocused();
    // Space opens and chooses too.
    await page.keyboard.press('Space');
    await expect(face(page, 'layer-2')).toHaveAttribute('aria-activedescendant', 'option-1');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect.poll(() => styleOf(page, 'layer-2')).toMatchObject({ ramp: 'cividis' });
    expect(await changes()).toBe(2);
  });

  test('says nothing when the ramp that is chosen is chosen again, and closes the list when the face is left', async ({
    page,
  }) => {
    await open(page, 'layer-2');
    const changes = await countChanges(page);
    const picked = await countChanges(page, 'karmania-ramp-change');
    await face(page, 'layer-2').click();
    await rampChoices(page, 'layer-2').nth(0).click();
    await expect(rampList(page, 'layer-2')).toHaveCount(0);
    expect(await picked()).toBe(0);
    expect(await changes()).toBe(0);
    await face(page, 'layer-2').click();
    await expect(rampList(page, 'layer-2')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(rampList(page, 'layer-2')).toHaveCount(0);
    await expect(reverse(page, 'layer-2').locator('input')).toBeFocused();
    expect(await changes()).toBe(0);
  });

  test('closes the list, and chooses nothing, when a person presses on another field or on text that is not a control', async ({
    page,
  }) => {
    await open(page, 'layer-2');
    const picked = await countChanges(page, 'karmania-ramp-change');
    for (const away of [
      field(page, 'layer-2', 'Method').locator('select'),
      legend(page).locator('.top span').first(),
    ]) {
      await face(page, 'layer-2').click();
      await expect(rampList(page, 'layer-2')).toHaveCount(1);
      await away.click();
      await expect(rampList(page, 'layer-2')).toHaveCount(0);
    }
    expect(await picked()).toBe(0);
  });

  test('has one stop each for Colour by, Method, Classes, the ramp and Reverse ramp, in that order', async ({
    page,
  }) => {
    await open(page, 'layer-2');
    await colourBy(page, 'layer-2').locator('select').focus();
    await page.keyboard.press('Tab');
    await expect(field(page, 'layer-2', 'Method').locator('select')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(field(page, 'layer-2', 'Classes').locator('select')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(face(page, 'layer-2')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(reverse(page, 'layer-2').locator('input')).toBeFocused();
  });

  test('reverses the ramp: the scene has it, the strips go the other way, the lines are coloured from the other end, and it is put back', async ({
    page,
  }) => {
    await open(page, 'layer-2');
    const strip = face(page, 'layer-2').locator('.strip');
    const forward = await strip.evaluate((one) => getComputedStyle(one).backgroundImage);
    await expect(firstDot(page, 'layer-2')).toHaveCSS('background-color', 'rgb(68, 1, 84)');
    await reverse(page, 'layer-2').getByText('Reverse ramp').click();
    await expect.poll(() => styleOf(page, 'layer-2')).toMatchObject({ reverse: true });
    await expect(reverse(page, 'layer-2').locator('input')).toBeChecked();
    expect(await strip.evaluate((one) => getComputedStyle(one).backgroundImage)).not.toBe(forward);
    // The lowest class is now the last stop of viridis, which is yellow.
    await expect(firstDot(page, 'layer-2')).toHaveCSS('background-color', 'rgb(253, 231, 37)');
    // The choices of the list are drawn the way the layer has them.
    await face(page, 'layer-2').click();
    const first = await rampChoices(page, 'layer-2')
      .nth(0)
      .locator('.strip')
      .evaluate((one) => getComputedStyle(one).backgroundImage);
    expect(first).toBe(await strip.evaluate((one) => getComputedStyle(one).backgroundImage));
    await page.keyboard.press('Escape');
    await reverse(page, 'layer-2').getByText('Reverse ramp').click();
    await expect.poll(() => styleOf(page, 'layer-2')).toMatchObject({ reverse: false });
    expect(await strip.evaluate((one) => getComputedStyle(one).backgroundImage)).toBe(forward);
    await expect(firstDot(page, 'layer-2')).toHaveCSS('background-color', 'rgb(68, 1, 84)');
  });

  test('keeps the method, the classes, the ramp and its direction when the column is changed, and offers only Categories for a column of text', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await importAndLoad(page, 'points.csv', 'points.prj');
    await showLegend(page);
    await layerRow(page, 'layer-1').locator('.open').click();
    await expect(editor(page, 'layer-1')).toBeVisible();
    await colourBy(page, 'layer-1').locator('select').selectOption('column:Rock');
    // Text is one class for each value, from the colours that tell values apart.
    await expect
      .poll(() => styleOf(page, 'layer-1'))
      .toEqual({
        mode: 'classes',
        column: 'Rock',
        method: 'categories',
        classes: 7,
        ramp: 'okabe-ito',
        reverse: false,
      });
    expect(
      await field(page, 'layer-1', 'Method')
        .locator('option')
        .evaluateAll((all) =>
          all.map((option) => [
            option.getAttribute('value'),
            (option as HTMLOptionElement).disabled,
          ]),
        ),
    ).toEqual([
      ['equal', true],
      ['quantile', true],
      ['jenks', true],
      ['categories', false],
    ]);
    await expect(field(page, 'layer-1', 'Method').locator('select')).toHaveValue('categories');
    await expect(face(page, 'layer-1')).toHaveAccessibleName('Ramp Okabe-Ito');
    // The strip of a categorical ramp is stripes of its eight colours with hard edges.
    expect(await face(page, 'layer-1').locator('.strip').getAttribute('style')).toContain('12.5%');
    // A column of numbers has all of them.
    await colourBy(page, 'layer-1').locator('select').selectOption('column:Au_ppm');
    await expect
      .poll(() => styleOf(page, 'layer-1'))
      .toMatchObject({ column: 'Au_ppm', method: 'equal' });
    expect(
      await field(page, 'layer-1', 'Method')
        .locator('option')
        .evaluateAll((all) => all.map((option) => (option as HTMLOptionElement).disabled)),
    ).toEqual([false, false, false, false]);
  });

  test('has no serious accessibility violation with the ramp list open, and with a ramp of the list focused', async ({
    page,
  }) => {
    await open(page, 'layer-2');
    await face(page, 'layer-2').click();
    await page.keyboard.press('ArrowDown');
    await expect(rampList(page, 'layer-2')).toHaveCount(1);
    await expectNoSeriousViolations(page);
  });
});

test.describe('the style editor: opacity, point size and line width', () => {
  /** Only `layer-1` is shown: the other layers are on the same cells. */
  async function alone(page: Page): Promise<void> {
    await dispatch(
      page,
      { type: 'setVisible', layerId: 'layer-2', visible: false },
      { type: 'setGroupVisible', groupId: 'group-1', visible: false },
      { type: 'setGroupVisible', groupId: 'group-2', visible: false },
    );
  }
  /** The colour at the middle of the map. */
  const centre = async (page: Page): Promise<number[]> => {
    const now = await drawn(page);
    return (await around(page, Math.floor(now.width / 2), Math.floor(now.height / 2), 0)).at(0, 0);
  };

  test('has the opacity on every layer, in percent, after the fields of the colour, and says what the layer has', async ({
    page,
  }) => {
    await open(page, 'layer-1', 'layer-2');
    for (const id of ['layer-1', 'layer-2']) {
      await expect(numberField(page, id, 'Opacity (%)').locator('label'), id).toHaveText(
        'Opacity (%)',
      );
      await expect(numberInput(page, id, 'Opacity (%)'), id).toHaveValue('100');
    }
    // A grid has no size or width of its own.
    await expect(editor(page, 'layer-1').locator('k-input')).toHaveCount(2);
    await expect(editor(page, 'layer-2').locator('k-input')).toHaveCount(1);
    // The opacity of a layer that has another is shown in percent: 0.6 is 60.
    await dispatch(page, { type: 'setStyle', layerId: 'layer-2', patch: { opacity: 0.6 } });
    await expect(numberInput(page, 'layer-2', 'Opacity (%)')).toHaveValue('60');
  });

  test('takes an opacity with Enter: the scene has a fraction, the field shows the number, and the map is drawn blended with what is under it', async ({
    page,
  }) => {
    await open(page, 'layer-1');
    await alone(page);
    const solid = await centre(page);
    await numberInput(page, 'layer-1', 'Opacity (%)').fill('50');
    await numberInput(page, 'layer-1', 'Opacity (%)').press('Enter');
    await expect.poll(() => numberOfStyle(page, 'layer-1', 'opacity')).toBe(0.5);
    await expect(numberInput(page, 'layer-1', 'Opacity (%)')).toHaveValue('50');
    const background = await mapColour(page);
    const half = solid.map((channel, i) => Math.round((channel + (background[i] ?? 0)) / 2));
    await expect.poll(async () => distance(await centre(page), half)).toBeLessThanOrEqual(3);
    // A tenth is drawn nearer the background than a half.
    await numberInput(page, 'layer-1', 'Opacity (%)').fill('10');
    await numberInput(page, 'layer-1', 'Opacity (%)').press('Enter');
    await expect
      .poll(async () => distance(await centre(page), background))
      .toBeLessThan(distance(half, background));
  });

  test('takes a number when the field is left, with its unit if it is typed, and keeps decimals to the hundredth of a percent', async ({
    page,
  }) => {
    await open(page, 'layer-1');
    await numberInput(page, 'layer-1', 'Opacity (%)').fill('25 %');
    await legend(page).locator('.top span').first().click();
    await expect.poll(() => numberOfStyle(page, 'layer-1', 'opacity')).toBe(0.25);
    await expect(numberInput(page, 'layer-1', 'Opacity (%)')).toHaveValue('25');
    await numberInput(page, 'layer-1', 'Opacity (%)').fill('33.333');
    await numberInput(page, 'layer-1', 'Opacity (%)').press('Enter');
    await expect.poll(() => numberOfStyle(page, 'layer-1', 'opacity')).toBe(0.3333);
    await expect(numberInput(page, 'layer-1', 'Opacity (%)')).toHaveValue('33.33');
    // Typed as it is shown, it is the same style: nothing is said.
    const changes = await countChanges(page);
    await numberInput(page, 'layer-1', 'Opacity (%)').fill('33.33');
    await numberInput(page, 'layer-1', 'Opacity (%)').press('Enter');
    expect(await changes()).toBe(0);
  });

  test('says the range in words for text that is not an opacity, keeps the style and the text, and puts the number back with Escape; a number outside the range is not made the nearest one', async ({
    page,
  }) => {
    await open(page, 'layer-1');
    for (const text of ['half', '150', '-5']) {
      await numberInput(page, 'layer-1', 'Opacity (%)').fill(text);
      await numberInput(page, 'layer-1', 'Opacity (%)').press('Enter');
      await expect(numberField(page, 'layer-1', 'Opacity (%)').locator('.error'), text).toHaveText(
        'Use a number from 0 to 100.',
      );
      await expect(numberInput(page, 'layer-1', 'Opacity (%)')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      await expect(numberInput(page, 'layer-1', 'Opacity (%)')).toHaveValue(text);
      expect(await numberOfStyle(page, 'layer-1', 'opacity')).toBe(1);
    }
    // Typing again takes the message away (it is about the text that was there).
    await numberInput(page, 'layer-1', 'Opacity (%)').fill('15');
    await expect(numberField(page, 'layer-1', 'Opacity (%)').locator('.error')).toHaveCount(0);
    await numberInput(page, 'layer-1', 'Opacity (%)').fill('-5');
    await numberInput(page, 'layer-1', 'Opacity (%)').press('Enter');
    await expect(numberField(page, 'layer-1', 'Opacity (%)').locator('.error')).toBeVisible();
    await numberInput(page, 'layer-1', 'Opacity (%)').press('Escape');
    await expect(numberInput(page, 'layer-1', 'Opacity (%)')).toHaveValue('100');
    await expect(numberField(page, 'layer-1', 'Opacity (%)').locator('.error')).toHaveCount(0);
    // Leaving the field with a text that is not a number says so too.
    await numberInput(page, 'layer-1', 'Opacity (%)').fill('lots');
    await legend(page).locator('.top span').first().click();
    await expect(numberField(page, 'layer-1', 'Opacity (%)').locator('.error')).toBeVisible();
    expect(await numberOfStyle(page, 'layer-1', 'opacity')).toBe(1);
  });

  test('steps the number with the up and down arrows, by 1 and by 10 with Shift, taking it at once, and stops at the ends', async ({
    page,
  }) => {
    await open(page, 'layer-1');
    const input = numberInput(page, 'layer-1', 'Opacity (%)');
    await input.focus();
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveValue('99');
    await expect.poll(() => numberOfStyle(page, 'layer-1', 'opacity')).toBe(0.99);
    await page.keyboard.press('Shift+ArrowDown');
    await expect(input).toHaveValue('89');
    await expect.poll(() => numberOfStyle(page, 'layer-1', 'opacity')).toBe(0.89);
    await page.keyboard.press('ArrowUp');
    await expect(input).toHaveValue('90');
    await page.keyboard.press('Shift+ArrowUp');
    await expect(input).toHaveValue('100');
    const changes = await countChanges(page);
    await page.keyboard.press('ArrowUp');
    await expect(input).toHaveValue('100');
    expect(await changes()).toBe(0);
    // A step goes from what is typed, and from what the layer has if that is not a number.
    await input.fill('40');
    await page.keyboard.press('ArrowUp');
    await expect(input).toHaveValue('41');
    await expect.poll(() => numberOfStyle(page, 'layer-1', 'opacity')).toBe(0.41);
    await input.fill('lots');
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveValue('40');
    await expect(numberField(page, 'layer-1', 'Opacity (%)').locator('.error')).toHaveCount(0);
    await input.fill('0');
    await page.keyboard.press('Enter');
    await expect.poll(() => numberOfStyle(page, 'layer-1', 'opacity')).toBe(0);
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveValue('0');
  });

  test('has an error appear in room that was kept: the rows under the editor stay where they are', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await loadLegendScene(page);
    await layerRow(page, 'layer-2').locator('.open').click();
    await expect(numberField(page, 'layer-2', 'Opacity (%)')).toBeVisible();
    // Typing scrolls the panel to the field, so the row is measured from the field (the scroll is not in it).
    await numberInput(page, 'layer-2', 'Opacity (%)').fill('nope');
    const from = async (): Promise<number> =>
      ((await layerRow(page, 'layer-1').boundingBox())?.y ?? 0) -
      ((await numberField(page, 'layer-2', 'Opacity (%)').boundingBox())?.y ?? 0);
    const under = await from();
    await numberInput(page, 'layer-2', 'Opacity (%)').press('Enter');
    await expect(numberField(page, 'layer-2', 'Opacity (%)').locator('.error')).toBeVisible();
    expect(await from()).toBe(under);
  });

  test('has the point size on a layer of points, 2 to 24: the scene has it, the map is drawn with bigger markers, and the layer keeps its opacity', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await importAndLoad(page, 'points.csv', 'points.prj');
    await showLegend(page);
    await layerRow(page, 'layer-1').locator('.open').click();
    await expect(editor(page, 'layer-1')).toBeVisible();
    expect(
      await editor(page, 'layer-1')
        .locator('k-input')
        .evaluateAll((all) => all.map((one) => one.getAttribute('label'))),
    ).toEqual(['Hex code', 'Opacity (%)', 'Point size (px)']);
    await expect(numberInput(page, 'layer-1', 'Point size (px)')).toHaveValue('6');
    await numberInput(page, 'layer-1', 'Point size (px)').fill('2');
    await numberInput(page, 'layer-1', 'Point size (px)').press('Enter');
    await expect.poll(() => numberOfStyle(page, 'layer-1', 'pointSize')).toBe(2);
    let small = 0;
    await expect
      .poll(async () => {
        small = await painted(page);
        return small;
      })
      .toBeGreaterThan(0);
    await numberInput(page, 'layer-1', 'Point size (px)').fill('12');
    await numberInput(page, 'layer-1', 'Point size (px)').press('Enter');
    await expect.poll(() => numberOfStyle(page, 'layer-1', 'pointSize')).toBe(12);
    await expect.poll(() => painted(page)).toBeGreaterThan(small * 4);
    // Nothing else of the style was touched.
    expect(await numberOfStyle(page, 'layer-1', 'opacity')).toBe(1);
    // Outside 2 to 24 is said, and not made 2 or 24.
    await numberInput(page, 'layer-1', 'Point size (px)').fill('30');
    await numberInput(page, 'layer-1', 'Point size (px)').press('Enter');
    await expect(numberField(page, 'layer-1', 'Point size (px)').locator('.error')).toHaveText(
      'Use a number from 2 to 24.',
    );
    expect(await numberOfStyle(page, 'layer-1', 'pointSize')).toBe(12);
  });

  test('has the line width on a layer of lines, 1 to 8, and no point size: the scene has it and the map is drawn with wider lines', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await importAndLoad(page, 'lines.csv', projectionFor('lines.prj'));
    await showLegend(page);
    await layerRow(page, 'layer-1').locator('.open').click();
    await expect(editor(page, 'layer-1')).toBeVisible();
    expect(
      await editor(page, 'layer-1')
        .locator('k-input')
        .evaluateAll((all) => all.map((one) => one.getAttribute('label'))),
    ).toEqual(['Hex code', 'Opacity (%)', 'Line width (px)']);
    await expect(numberInput(page, 'layer-1', 'Line width (px)')).toHaveValue('2');
    await numberInput(page, 'layer-1', 'Line width (px)').fill('1');
    await numberInput(page, 'layer-1', 'Line width (px)').press('Enter');
    await expect.poll(() => numberOfStyle(page, 'layer-1', 'lineWidth')).toBe(1);
    let thin = 0;
    await expect
      .poll(async () => {
        thin = await painted(page);
        return thin;
      })
      .toBeGreaterThan(0);
    await numberInput(page, 'layer-1', 'Line width (px)').fill('8');
    await numberInput(page, 'layer-1', 'Line width (px)').press('Enter');
    await expect.poll(() => numberOfStyle(page, 'layer-1', 'lineWidth')).toBe(8);
    await expect.poll(() => painted(page)).toBeGreaterThan(thin * 3);
    await numberInput(page, 'layer-1', 'Line width (px)').fill('9');
    await numberInput(page, 'layer-1', 'Line width (px)').press('Enter');
    await expect(numberField(page, 'layer-1', 'Line width (px)').locator('.error')).toHaveText(
      'Use a number from 1 to 8.',
    );
  });
});
