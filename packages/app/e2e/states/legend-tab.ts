/**
 * The app with the Legend tab open and layers in it, in each of the states that look different (layers and groups with their swatches, a folded group,
 * names too long for their rows), each with what to do to the page to put it in that state. The screenshot tests photograph the panel
 * (`legend-tab.visual.ts`) and the accessibility pass checks the whole page (`axe-states.axe.ts`).
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { dispatch, layerStatuses, withData } from '../support/render.js';
import { loadGrid, loadLegendScene, loadMany, showLegend } from '../support/legend.js';
import { projectionFor } from '../support/fixtures.js';
import { importAndLoad, importAsLocalGrid } from '../support/wizard.js';
import type { Shot } from '../support/screenshots.js';

const panel = (page: Page): Locator => page.locator('karmania-panel');

/** Takes the keyboard off whatever has it, and the pointer off the page, and waits for the fonts: what is photographed is the panel. */
async function rest(page: Page): Promise<Locator[]> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    (active as HTMLElement | null)?.blur();
  });
  await page.mouse.move(0, 0);
  return [panel(page)];
}

/** The same, but the keyboard is left where it is: what is photographed is a row with its ring. */
async function restWithFocus(page: Page): Promise<Locator[]> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.mouse.move(0, 0);
  return [panel(page)];
}

/** The same, but the pointer is left where it is: what is photographed is a row that is pointed at, or a row that is dragged. */
async function restWithPointer(page: Page): Promise<Locator[]> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return [panel(page)];
}

/** The middle of an element, in the window. */
async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('Something to point at is not shown.');
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A name of 120 characters that begins with `start`, so that the names that are too long for their rows are told apart by their beginnings. */
const long = (start: string): string =>
  `${start} of the northern pit, drill holes and trenches, seen from the west and from the south of it all`
    .padEnd(120, '.')
    .slice(0, 120);

/** 16 cells of `i / 7` (bounds of 15 digits, as the classes of such numbers are), the last three with no value. */
const SEVENTHS = [
  ...Array.from({ length: 13 }, (_, i) => (i + 1) / 7),
  Number.NaN,
  Number.NaN,
  Number.NaN,
];

/** Counts as large as those of a model of ten million blocks, for the 13 lines of 12 classes and the cells with no value. */
const BIG = [
  10_000_000, 9_876_543, 8_765_432, 7_654_321, 6_543_210, 5_432_109, 4_321_098, 3_210_987,
  2_109_876, 1_098_765, 987_654, 123_456, 123_456_789,
];

/** 16 cells, the last three with no value. */
const WITH_HOLES = Array.from({ length: 16 }, (_, i) => (i < 13 ? i + 1 : Number.NaN));

/** The page the states are shown on. */
export const PATH = '/';

/** The states, each with what to do to the page to put it in the state. */
export const SHOTS: Shot[] = [
  {
    // Two layers at the top (one in a colour, one by classes) and two groups with three layers between them.
    name: 'legend-tab-rows',
    show: async (page) => {
      await loadLegendScene(page);
      return rest(page);
    },
  },
  {
    // The three states of a switch: a layer that is off has its name muted, a group with some of its layers on has a bar in its box, and a group with none has an empty one.
    name: 'legend-tab-off',
    show: async (page) => {
      await loadLegendScene(page);
      await dispatch(
        page,
        { type: 'setVisible', layerId: 'layer-2', visible: false },
        { type: 'setVisible', layerId: 'layer-3', visible: false },
        { type: 'setVisible', layerId: 'layer-5', visible: false },
      );
      return rest(page);
    },
  },
  {
    // A row that is pointed at has its handle, and the colour that a pointer gives a row.
    name: 'legend-tab-hover',
    show: async (page) => {
      await loadLegendScene(page);
      await page.locator('karmania-legend-tab .row[data-layer="layer-3"]').hover();
      return restWithPointer(page);
    },
  },
  {
    // A layer is dragged by its handle, from the bottom of the legend to between two layers of a group: the line is where it will land, in the group's indent, and the row has the colour of one that is dragged.
    name: 'legend-tab-drag',
    show: async (page) => {
      await loadLegendScene(page);
      await page.mouse.up();
      const handle = await centreOf(
        page.locator('karmania-legend-tab .row[data-layer="layer-1"] .handle'),
      );
      const into = await page
        .locator('karmania-legend-tab .row[data-layer="layer-4"]')
        .boundingBox();
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move((into?.x ?? 0) + 60, (into?.y ?? 0) + 2, { steps: 8 });
      await page.locator('karmania-legend-tab .drop-line').waitFor();
      return restWithPointer(page);
    },
  },
  {
    // A layer opened on its style, in one colour: Colour by, the twelve swatches with one chosen (a ring round it), and the hex code.
    name: 'legend-tab-style',
    show: async (page) => {
      await loadLegendScene(page);
      await dispatch(page, {
        type: 'setStyle',
        layerId: 'layer-1',
        patch: { colour: { mode: 'single', value: '#b2df8a' } },
      });
      await page.locator('karmania-legend-tab .row[data-layer="layer-1"] .open').click();
      await page.locator('karmania-legend-tab #legend-style-layer-1 .swatch').first().waitFor();
      return rest(page);
    },
  },
  {
    // A grid with its contours turned on, opened on its style: the fields under the opacity, then the Contours part (Show contours, the column, the interval,
    // the base and the index lines), and, under the grid in the list, the layer of the lines.
    name: 'legend-tab-contours',
    show: async (page) => {
      await loadLegendScene(page);
      await page.locator('karmania-legend-tab .row[data-layer="layer-2"] .open').click();
      const box = page.locator(
        'karmania-legend-tab #legend-style-layer-2 [aria-label="Contours"] k-checkbox input',
      );
      await box.check();
      await page.locator('karmania-legend-tab .row[data-layer="layer-6"]').waitFor();
      await page
        .locator('karmania-legend-tab #legend-style-layer-2 k-input[label="Interval"] input')
        .waitFor();
      await expect
        .poll(async () => (await layerStatuses(page)).every(([, status]) => status === 'drawn'))
        .toBe(true);
      // The panel scrolls: the whole of the Contours part is brought into view, to the last of its fields.
      await page
        .locator(
          'karmania-legend-tab #legend-style-layer-2 k-input[label="Index line every"] input',
        )
        .scrollIntoViewIfNeeded();
      return rest(page);
    },
  },
  {
    // The Contours part when the engine could not make the lines: more than 1,000 levels, in the engine's words, as an alert under the fields.
    name: 'legend-tab-contours-error',
    show: async (page) => {
      await loadLegendScene(page);
      await page.locator('karmania-legend-tab .row[data-layer="layer-2"] .open').click();
      await page
        .locator(
          'karmania-legend-tab #legend-style-layer-2 [aria-label="Contours"] k-checkbox input',
        )
        .check();
      const interval = page.locator(
        'karmania-legend-tab #legend-style-layer-2 k-input[label="Interval"] input',
      );
      await interval.waitFor();
      await interval.fill('0.001');
      await interval.press('Enter');
      await page
        .locator('karmania-legend-tab #legend-style-layer-2 .status[role="alert"]')
        .waitFor();
      await page
        .locator('karmania-legend-tab #legend-style-layer-2 .status[role="alert"]')
        .scrollIntoViewIfNeeded();
      return rest(page);
    },
  },
  {
    // The Contours part while the engine is still making the lines: Show contours is ticked and the status says so (the engine's answer is held back).
    name: 'legend-tab-contours-making',
    show: async (page) => {
      await loadLegendScene(page);
      await page.evaluate(() => {
        const viewer = document
          .querySelector('karmania-app')
          ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
          engine: { contours: (...args: unknown[]) => Promise<unknown> };
        };
        viewer.engine.contours = () => new Promise(() => undefined);
      });
      await page.locator('karmania-legend-tab .row[data-layer="layer-2"] .open').click();
      await page
        .locator(
          'karmania-legend-tab #legend-style-layer-2 [aria-label="Contours"] k-checkbox input',
        )
        .check();
      const status = page.locator('karmania-legend-tab #legend-style-layer-2 .status');
      await expect(status).toHaveText('Making the contour lines…');
      await status.scrollIntoViewIfNeeded();
      return rest(page);
    },
  },
  {
    // A layer of lines opened on its style: Opacity and Line width, and no Point size.
    name: 'legend-tab-lines',
    show: async (page) => {
      await importAndLoad(page, 'lines.csv', projectionFor('lines.prj'));
      await showLegend(page);
      await page.locator('karmania-legend-tab .row[data-layer="layer-1"] .open').click();
      await page
        .locator('karmania-legend-tab #legend-style-layer-1 k-input[label="Line width (px)"] input')
        .waitFor();
      return rest(page);
    },
  },
  {
    // A layer opened on its style, by the classes of a column: the class lines, then Colour by, Method, Classes, the ramp with its strip, and Reverse ramp.
    name: 'legend-tab-style-classes',
    show: async (page) => {
      await loadLegendScene(page);
      await page.locator('karmania-legend-tab .row[data-layer="layer-2"] .open').click();
      await page
        .locator('karmania-legend-tab #legend-style-layer-2 karmania-ramp-select')
        .waitFor();
      return rest(page);
    },
  },
  {
    // The list of the ramps opened with the keyboard: every ramp with its strip and name, the one the layer has ticked, and a ring on the one the arrows are at.
    name: 'legend-tab-ramps',
    show: async (page) => {
      await loadLegendScene(page);
      await page.locator('karmania-legend-tab .row[data-layer="layer-2"] .open').click();
      const face = page.locator(
        'karmania-legend-tab #legend-style-layer-2 karmania-ramp-select [role="combobox"]',
      );
      await face.focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      const list = page.locator('karmania-legend-tab #legend-style-layer-2 [role="listbox"]');
      await list.waitFor();
      // The panel is scrolled so that the whole list is in the picture, as a person who opened it near the bottom would scroll.
      await list.evaluate((one) => {
        one.scrollIntoView({ block: 'end' });
      });
      return restWithFocus(page);
    },
  },
  {
    // A layer of points opened on its style: the opacity and the size of its markers, under the colour.
    name: 'legend-tab-style-points',
    show: async (page) => {
      await importAndLoad(page, 'points.csv', 'points.prj');
      await showLegend(page);
      await page.locator('karmania-legend-tab .row[data-layer="layer-1"] .open').click();
      await page
        .locator('karmania-legend-tab #legend-style-layer-1 k-input[label="Point size (px)"]')
        .waitFor();
      return rest(page);
    },
  },
  {
    // An opacity that is not a number: the message in the room that was kept for it, with its icon, the text kept, and the ring on the field.
    name: 'legend-tab-style-error',
    show: async (page) => {
      await loadLegendScene(page);
      await page.locator('karmania-legend-tab .row[data-layer="layer-1"] .open').click();
      const field = page.locator(
        'karmania-legend-tab #legend-style-layer-1 k-input[label="Opacity (%)"]',
      );
      await field.locator('input').fill('half');
      await field.locator('input').press('Enter');
      const message = field.locator('.error');
      await message.waitFor();
      // The panel is scrolled so that the message is in the picture at the shortest window too, as a person who typed it would have the field in sight.
      await message.evaluate((one) => {
        one.scrollIntoView({ block: 'end' });
      });
      return restWithFocus(page);
    },
  },
  {
    // A layer that is not drawn: the warning icon in the room of its notice and, opened, why in the engine's words and what to do, above its fields.
    name: 'legend-tab-notice',
    show: async (page) => {
      await withData(page);
      await importAsLocalGrid(page, 'ft', {
        name: 'faults.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('x,y\n1,2\n3,4\n'),
      });
      await showLegend(page);
      await page.locator('karmania-legend-tab .row[data-layer="layer-2"] .notice k-icon').waitFor();
      await page.locator('karmania-legend-tab .row[data-layer="layer-2"] .open').click();
      await page.locator('karmania-legend-tab #legend-reason-layer-2').waitFor();
      return rest(page);
    },
  },
  {
    // 50 layers: the list scrolls inside the panel, with its caption and the rows as they are for 5.
    name: 'legend-tab-many',
    show: async (page) => {
      await loadMany(page, 50);
      await showLegend(page);
      await page.locator('karmania-legend-tab .row[data-layer="layer-1"]').waitFor();
      return rest(page);
    },
  },
  {
    // The same list at its end, reached with the keyboard: the last row with its ring, whole, and the room of the panel under it.
    name: 'legend-tab-many-end',
    show: async (page) => {
      await loadMany(page, 50);
      await showLegend(page);
      await page.locator('karmania-legend-tab .row[data-layer="layer-50"]').focus();
      await page.keyboard.press('End');
      await page.locator('karmania-legend-tab .row[data-layer="layer-1"]:focus').waitFor();
      return restWithFocus(page);
    },
  },
  {
    // 12 classes of numbers that are not rounded, with counts of ten million, under a name of 120 characters: every label is cut and every count is whole.
    name: 'legend-tab-twelve',
    show: async (page) => {
      await loadGrid(page, long('Assays'), 1, SEVENTHS);
      await dispatch(page, {
        type: 'setStyle',
        layerId: 'layer-1',
        patch: {
          colour: {
            mode: 'classes',
            column: 'value',
            method: 'equal',
            classes: 12,
            ramp: 'viridis',
            reverse: false,
          },
        },
      });
      await showLegend(page);
      await page.locator('karmania-legend-tab .row[data-layer="layer-1"] .open').click();
      await page.locator('karmania-legend-tab #legend-classes-layer-1 .entry').nth(12).waitFor();
      await page.locator('karmania-legend-tab').evaluate((tab, big) => {
        type Line = Record<string, unknown>;
        const shown = tab as unknown as {
          model: { entries: { type: string; classes?: Line[] }[] } & Record<string, unknown>;
        };
        shown.model = {
          ...shown.model,
          entries: shown.model.entries.map((entry) =>
            entry.type === 'layer' && entry.classes !== undefined
              ? {
                  ...entry,
                  classes: entry.classes.map((line, i) => ({
                    ...line,
                    count: big[i],
                    countLabel: (big[i] ?? 0).toLocaleString('en-US'),
                  })),
                }
              : entry,
          ),
        };
      }, BIG);
      await page.locator('karmania-legend-tab #legend-classes-layer-1 .figure').first().waitFor();
      return rest(page);
    },
  },
  {
    // A group is renamed in place: a field in the place of its name, with its ring, and the rest of the row as it is.
    name: 'legend-tab-rename',
    show: async (page) => {
      await loadLegendScene(page);
      await page.locator('karmania-legend-tab .row[data-group="group-1"]').focus();
      await page.keyboard.press('F2');
      await page.locator('karmania-legend-tab input.rename').waitFor();
      return restWithFocus(page);
    },
  },
  {
    // A group that is pointed at shows the button that deletes it, in the room at the end of its row.
    name: 'legend-tab-group-hover',
    show: async (page) => {
      await loadLegendScene(page);
      await page.locator('karmania-legend-tab .row[data-group="group-1"]').hover();
      return restWithPointer(page);
    },
  },
  {
    // The row that has the keyboard has its ring inside it, over its hover colour's place.
    name: 'legend-tab-focus',
    show: async (page) => {
      await loadLegendScene(page);
      await page.keyboard.press('Shift');
      await page.locator('karmania-legend-tab .row[data-layer="layer-3"]').focus();
      return restWithFocus(page);
    },
  },
  {
    // Two layers open: one at the top with the classes of its cells, and one in a group, a level in, with a line for the cells that have no value.
    name: 'legend-tab-classes',
    show: async (page) => {
      await loadGrid(page, 'Topography', 1);
      await loadGrid(page, 'Assays', 2, WITH_HOLES);
      await loadGrid(page, 'Geology', 3);
      await dispatch(
        page,
        {
          type: 'setStyle',
          layerId: 'layer-3',
          patch: { colour: { mode: 'single', value: '#e69f00' } },
        },
        { type: 'createGroup', name: 'Samples' },
        { type: 'moveNode', id: 'layer-2', to: { parent: 'group-1', index: 0 } },
      );
      await showLegend(page);
      for (const id of ['layer-1', 'layer-2']) {
        const row = page.locator(`karmania-legend-tab .row[data-layer="${id}"]`);
        await row.locator('.open').click();
        await page.locator(`karmania-legend-tab #legend-classes-${id} .entry`).first().waitFor();
      }
      return rest(page);
    },
  },
  {
    // A folded group has none of its layers in the list, and its chevron is turned.
    name: 'legend-tab-folded',
    show: async (page) => {
      await loadLegendScene(page);
      await dispatch(page, { type: 'setGroupCollapsed', groupId: 'group-1', collapsed: true });
      return rest(page);
    },
  },
  {
    // Names that no row is wide enough for: each is cut with an ellipsis, in the layers and in the groups.
    name: 'legend-tab-long-names',
    show: async (page) => {
      await loadLegendScene(
        page,
        ['Topography', 'Assays', 'Geology', 'Drillholes', 'Seismic lines'].map(long),
        [long('Samples'), long('Surveys')],
      );
      return rest(page);
    },
  },
];
