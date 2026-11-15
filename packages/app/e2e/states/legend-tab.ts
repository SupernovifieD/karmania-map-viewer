/**
 * The app with the Legend tab open and layers in it, in each of the states that look different (layers and groups with their swatches, a folded group,
 * names too long for their rows), each with what to do to the page to put it in that state. The screenshot tests photograph the panel
 * (`legend-tab.visual.ts`) and the accessibility pass checks the whole page (`axe-states.axe.ts`).
 */
import type { Locator, Page } from '@playwright/test';
import { dispatch } from '../support/render.js';
import { loadGrid, loadLegendScene, showLegend } from '../support/legend.js';
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
