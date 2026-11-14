/**
 * The app with the Legend tab open and layers in it, in each of the states that look different (layers and groups with their swatches, a folded group,
 * names too long for their rows), each with what to do to the page to put it in that state. The screenshot tests photograph the panel
 * (`legend-tab.visual.ts`) and the accessibility pass checks the whole page (`axe-states.axe.ts`).
 */
import type { Locator, Page } from '@playwright/test';
import { dispatch } from '../support/render.js';
import { loadLegendScene } from '../support/legend.js';
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

/** A name of 120 characters that begins with `start`, so that the names that are too long for their rows are told apart by their beginnings. */
const long = (start: string): string =>
  `${start} of the northern pit, drill holes and trenches, seen from the west and from the south of it all`
    .padEnd(120, '.')
    .slice(0, 120);

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
