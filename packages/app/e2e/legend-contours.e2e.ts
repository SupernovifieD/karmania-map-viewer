import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { boxOf } from './support/layout.js';
import { layerRow, legend, showLegend } from './support/legend.js';
import { dispatch, expectLayersDrawn, loadLattice } from './support/render.js';
import { fixture, projectionFor } from './support/fixtures.js';
import { importAndLoad } from './support/wizard.js';

/**
 * The Contours part of the style editor of a layer (step 20.6, brief 10.3): for a grid or a mesh, **Show contours**, and once they are on the column of a grid, the
 * interval, the base and how often there is an index line, with the lines made in the worker and listed in the Data tab, and a layer of their own under the layer.
 */

const editor = (page: Page, id: string): Locator =>
  legend(page).locator(`#legend-style-${id} karmania-style-editor`);
const section = (page: Page, id: string): Locator =>
  editor(page, id).locator('[role="group"][aria-label="Contours"]');
const show = (page: Page, id: string): Locator => section(page, id).locator('k-checkbox');
const showBox = (page: Page, id: string): Locator => show(page, id).locator('input');
const input = (page: Page, id: string, label: string): Locator =>
  section(page, id).locator(`k-input[label="${label}"] input`);
const column = (page: Page, id: string): Locator =>
  section(page, id).locator('k-select[label="Contour column"]');
const status = (page: Page, id: string): Locator => section(page, id).locator('.status');

/** A grid of 12 by 8 cells of 10 m whose `height` rises with the column and the row, and a second column of numbers and a column of text. */
const SURFACE = {
  name: 'Surface',
  crs: { kind: 'epsg', code: 32640 },
  origin: [500_000, 4_000_000, 0],
  spacing: [10, 10, 1],
  dims: [12, 8, 1],
  values: Array.from({ length: 96 }, (_, k) => (k % 12) + Math.floor(k / 12)),
} as const;

/** What the scene has for the contours of a layer, and the names of the datasets the engine has. */
async function held(page: Page): Promise<{
  contours: Record<string, unknown> | undefined;
  names: string[];
  layers: string[];
}> {
  return page.locator('karmania-viewer').evaluate((element) => {
    const viewer = element as unknown as {
      scene: () => {
        layers: Record<
          string,
          { name: string; contours?: Record<string, unknown>; derived?: unknown }
        >;
        legend: { id: string }[];
      };
      engine: { datasets: () => { name: string }[] };
    };
    const scene = viewer.scene();
    return {
      contours: scene.layers['layer-1']?.contours,
      names: viewer.engine.datasets().map((dataset) => dataset.name),
      layers: scene.legend.map(
        (node) => `${node.id}${scene.layers[node.id]?.derived === undefined ? '' : '*'}`,
      ),
    };
  });
}

async function open(page: Page, id = 'layer-1'): Promise<void> {
  await page.goto('/?theme=light');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadLattice(page, 'grid', SURFACE);
  await expectLayersDrawn(page, 1);
  await showLegend(page);
  await layerRow(page, id).locator('.open').click();
  await expect(editor(page, id)).toBeVisible();
}

test.describe('the contours of a layer in the style editor', () => {
  test('are a part of the style of a grid, under its other fields: a caption, Show contours, off, and nothing more until it is on', async ({
    page,
  }) => {
    await open(page);
    await expect(section(page, 'layer-1')).toBeVisible();
    await expect(section(page, 'layer-1').locator('.caption')).toHaveText('Contours');
    await expect(show(page, 'layer-1')).toContainText('Show contours');
    await expect(showBox(page, 'layer-1')).not.toBeChecked();
    for (const label of ['Interval', 'Base', 'Index line every']) {
      await expect(section(page, 'layer-1').locator(`k-input[label="${label}"]`)).toHaveCount(0);
    }
    await expect(column(page, 'layer-1')).toHaveCount(0);
    // It is the last of the fields, under the opacity.
    const [opacity, contours] = [
      await boxOf(
        editor(page, 'layer-1').locator('k-input[label="Opacity (%)"]'),
        'the opacity field',
      ),
      await boxOf(section(page, 'layer-1'), 'the contours'),
    ];
    expect(contours.y).toBeGreaterThan(opacity.y + opacity.height);
  });

  test('turn on at the settings the engine says for the data: a nice interval for the range, a base of 0, an index line every 5, the first column of numbers', async ({
    page,
  }) => {
    await open(page);
    await showBox(page, 'layer-1').check();
    await expect(input(page, 'layer-1', 'Interval')).toBeVisible();
    // The heights go from 0 to 18: the largest nice number that gives ten levels is 1.
    await expect(input(page, 'layer-1', 'Interval')).toHaveValue('1');
    await expect(input(page, 'layer-1', 'Base')).toHaveValue('0');
    await expect(input(page, 'layer-1', 'Index line every')).toHaveValue('5');
    await expect(column(page, 'layer-1').locator('select')).toHaveValue('value');
    await expect(showBox(page, 'layer-1')).toBeChecked();
    expect((await held(page)).contours).toEqual({
      column: 'value',
      interval: 1,
      base: 0,
      indexEvery: 5,
      visible: true,
    });
    // The lines are made: in the engine's datasets, with a layer of their own directly under the layer in the legend, drawn.
    await expect
      .poll(async () => (await held(page)).names)
      .toEqual(['Surface', 'Contours of Surface (every 1)']);
    expect((await held(page)).layers).toEqual(['layer-1', 'layer-2*']);
    await expectLayersDrawn(page, 2);
    await expect(layerRow(page, 'layer-2')).toBeVisible();
    await expect(layerRow(page, 'layer-2').locator('.name')).toHaveText(
      'Contours of Surface (every 1)',
    );
  });

  test('have settings that are changed by typing a number and pressing Enter, or leaving the field: the lines are made again', async ({
    page,
  }) => {
    await open(page);
    await showBox(page, 'layer-1').check();
    await expect(input(page, 'layer-1', 'Interval')).toHaveValue('1');
    await expect.poll(async () => (await held(page)).names.length).toBe(2);
    await input(page, 'layer-1', 'Interval').fill('2');
    await input(page, 'layer-1', 'Interval').press('Enter');
    await expect
      .poll(async () => (await held(page)).names)
      .toEqual(['Surface', 'Contours of Surface (every 2)']);
    // Leaving the field takes the number too.
    await input(page, 'layer-1', 'Index line every').fill('3');
    await input(page, 'layer-1', 'Base').focus();
    await expect.poll(async () => (await held(page)).contours?.['indexEvery']).toBe(3);
    await input(page, 'layer-1', 'Base').fill('-1.5');
    await input(page, 'layer-1', 'Base').press('Enter');
    await expect.poll(async () => (await held(page)).contours?.['base']).toBe(-1.5);
    expect((await held(page)).contours).toEqual({
      column: 'value',
      interval: 2,
      base: -1.5,
      indexEvery: 3,
      visible: true,
    });
    await expectLayersDrawn(page, 2);
    expect((await held(page)).layers).toEqual(['layer-1', 'layer-2*']);
  });

  test('say what is wrong with a number that is not usable, in words, and leave the contours as they are; Escape puts back the number they have', async ({
    page,
  }) => {
    await open(page);
    await showBox(page, 'layer-1').check();
    await expect(input(page, 'layer-1', 'Interval')).toHaveValue('1');
    const error = (label: string): Locator =>
      section(page, 'layer-1')
        .locator(`k-input[label="${label}"]`)
        .locator('[role="alert"], .error');
    for (const [label, text, words] of [
      ['Interval', '0', 'Enter a number above 0.'],
      ['Interval', 'abc', 'Enter a number above 0.'],
      ['Base', 'x', 'Enter a number.'],
      ['Index line every', '2.5', 'Enter a whole number, 1 or more.'],
      ['Index line every', '0', 'Enter a whole number, 1 or more.'],
    ] as const) {
      await input(page, 'layer-1', label).fill(text);
      await input(page, 'layer-1', label).press('Enter');
      await expect(error(label), `${label} ${text}`).toContainText(words);
      await input(page, 'layer-1', label).press('Escape');
      await expect(error(label)).toHaveCount(0);
    }
    expect((await held(page)).contours).toEqual({
      column: 'value',
      interval: 1,
      base: 0,
      indexEvery: 5,
      visible: true,
    });
    await expect(input(page, 'layer-1', 'Index line every')).toHaveValue('5');
  });

  test('hide the lines when Show contours is turned off, and show them when it is turned on again, with the settings kept', async ({
    page,
  }) => {
    await open(page);
    await showBox(page, 'layer-1').check();
    await expect(input(page, 'layer-1', 'Interval')).toHaveValue('1');
    await expectLayersDrawn(page, 2);
    await input(page, 'layer-1', 'Interval').fill('3');
    await input(page, 'layer-1', 'Interval').press('Enter');
    await expect
      .poll(async () => (await held(page)).names)
      .toEqual(['Surface', 'Contours of Surface (every 3)']);
    await showBox(page, 'layer-1').uncheck();
    await expect(showBox(page, 'layer-1')).not.toBeChecked();
    await expect(layerRow(page, 'layer-2')).toHaveAttribute('aria-checked', 'false');
    // The settings stay: the fields are there with their numbers, and the lines are not made again.
    await expect(input(page, 'layer-1', 'Interval')).toHaveValue('3');
    expect((await held(page)).names).toEqual(['Surface', 'Contours of Surface (every 3)']);
    await showBox(page, 'layer-1').check();
    await expect(layerRow(page, 'layer-2')).toHaveAttribute('aria-checked', 'true');
    expect((await held(page)).contours?.['interval']).toBe(3);
  });

  test('say why they were not made when the engine cannot: more than 1,000 levels, in the engine’s words, in a line that is an alert', async ({
    page,
  }) => {
    await open(page);
    await showBox(page, 'layer-1').check();
    await expect(input(page, 'layer-1', 'Interval')).toHaveValue('1');
    await input(page, 'layer-1', 'Interval').fill('0.001');
    await input(page, 'layer-1', 'Interval').press('Enter');
    await expect(status(page, 'layer-1')).toContainText('the most is 1,000');
    await expect(status(page, 'layer-1')).toContainText('Use a larger interval.');
    await expect(status(page, 'layer-1')).toHaveAttribute('role', 'alert');
    expect((await held(page)).names).toEqual(['Surface']);
    expect((await held(page)).layers).toEqual(['layer-1']);
    // Settings that make lines take the words away.
    await input(page, 'layer-1', 'Interval').fill('2');
    await input(page, 'layer-1', 'Interval').press('Enter');
    await expect(status(page, 'layer-1')).toHaveCount(0);
    await expect.poll(async () => (await held(page)).layers).toEqual(['layer-1', 'layer-2*']);
  });

  test('are not a part of the style of the layers that have no such lines: points, lines, and the layer of the contours of a layer; a mesh has them, without a column', async ({
    page,
  }) => {
    await open(page);
    await showBox(page, 'layer-1').check();
    await expectLayersDrawn(page, 2);
    await layerRow(page, 'layer-2').locator('.open').click();
    await expect(editor(page, 'layer-2')).toBeVisible();
    await expect(section(page, 'layer-2')).toHaveCount(0);
    // It has the fields of lines: its colour, opacity and line width.
    await expect(editor(page, 'layer-2').locator('k-input[label="Line width (px)"]')).toBeVisible();
    await expect(editor(page, 'layer-2').locator('k-input[label="Hex code"]')).toBeVisible();
    // Points and lines imported from files have none.
    await importAndLoad(page, 'points.csv', 'points.prj');
    await importAndLoad(page, fixture('lines.csv'), projectionFor('lines.prj'));
    await showLegend(page);
    await expect(layerRow(page, 'layer-4')).toBeVisible();
    for (const id of ['layer-3', 'layer-4']) {
      await layerRow(page, id).locator('.open').click();
      await expect(editor(page, id)).toBeVisible();
      await expect(section(page, id)).toHaveCount(0);
    }
    // A mesh has them, with the interval, the base and the index lines, and no column: its one height is that of its vertices.
    await importAndLoad(page, fixture('mesh.obj'), projectionFor('mesh.prj'));
    await showLegend(page);
    await expect(layerRow(page, 'layer-5')).toBeVisible();
    await layerRow(page, 'layer-5').locator('.open').click();
    await expect(section(page, 'layer-5')).toBeVisible();
    await expect(show(page, 'layer-5')).toContainText('Show contours');
    await showBox(page, 'layer-5').check();
    await expect(input(page, 'layer-5', 'Interval')).toBeVisible();
    // (The pyramid is 8 high: the largest nice interval that gives ten levels is 0.5.)
    await expect(input(page, 'layer-5', 'Interval')).toHaveValue('0.5');
    await expect(column(page, 'layer-5')).toHaveCount(0);
  });

  test('keep the layer of the lines’ own style when they are made again, and its width and colour change what is drawn', async ({
    page,
  }) => {
    await open(page);
    await showBox(page, 'layer-1').check();
    await expectLayersDrawn(page, 2);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-2',
      patch: { lineWidth: 4, colour: { mode: 'single', value: '#112233' } },
    });
    await input(page, 'layer-1', 'Interval').fill('2');
    await input(page, 'layer-1', 'Interval').press('Enter');
    await expect
      .poll(async () => (await held(page)).names)
      .toEqual(['Surface', 'Contours of Surface (every 2)']);
    await expectLayersDrawn(page, 2);
    const style = await page.locator('karmania-viewer').evaluate((element) => {
      const viewer = element as unknown as {
        scene: () => { layers: Record<string, { style: unknown }> };
      };
      return viewer.scene().layers['layer-2']?.style;
    });
    expect(style).toEqual({
      colour: { mode: 'single', value: '#112233' },
      opacity: 1,
      lineWidth: 4,
    });
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`is readable and has no serious accessibility violations, with the contours on and a reason shown (${theme} theme)`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await page.goto(`/?theme=${theme}`);
      await loadLattice(page, 'grid', SURFACE);
      await expectLayersDrawn(page, 1);
      await showLegend(page);
      await layerRow(page, 'layer-1').locator('.open').click();
      await showBox(page, 'layer-1').check();
      await expect(input(page, 'layer-1', 'Interval')).toHaveValue('1');
      await input(page, 'layer-1', 'Interval').fill('0.001');
      await input(page, 'layer-1', 'Interval').press('Enter');
      await expect(status(page, 'layer-1')).toBeVisible();
      await expectNoSeriousViolations(page);
    });
  }
});
