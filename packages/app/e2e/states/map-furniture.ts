/**
 * The app with a map in it and its furniture over the map (the north arrow, the scale bar, the navigation group, the status chip) in the
 * states that look different: the panel at its usual width, at its widest (the map at its narrowest), at its narrowest, folded away, the
 * pointer over the map, the map turned, the keyboard on a control; and the map coordinate system dialog open, empty, with a choice, and
 * with what would change. Each has what to do to the page to put it in that state. The screenshot tests photograph them
 * (`map-furniture.visual.ts`) and the accessibility pass checks them (`axe-states.axe.ts`).
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Shot } from '../support/screenshots.js';
import { dispatch, layerStatuses, withData } from '../support/render.js';
import { importAsLocalGrid } from '../support/wizard.js';

const KEY = 'karmania.panel';

const app = (page: Page): Locator => page.locator('karmania-app');
const canvas = (page: Page): Locator => page.locator('karmania-map-area canvas');
const chip = (page: Page): Locator => page.locator('karmania-status-chip button.crs');
const dialog = (page: Page): Locator => page.locator('karmania-map-crs-dialog dialog');

/** How the panel is kept before the data come, so that it has the width asked for. */
async function keepPanel(page: Page, width: number): Promise<void> {
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [KEY, JSON.stringify({ collapsed: false, tab: 'data', width })] as const,
  );
  await page.reload();
}

/** The map with its data drawn, the panel at the width asked for, and the pointer and the keyboard out of the way. */
async function mapWith(page: Page, width = 360): Promise<void> {
  await keepPanel(page, width);
  await withData(page);
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

/** The whole window is what is photographed. */
const whole = (page: Page): Promise<Locator[]> => Promise.resolve([app(page)]);

/** Takes the keyboard off whatever has it. */
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    (active as HTMLElement | null)?.blur();
  });
}

/** Opens the map coordinate system dialog with the chip's button, and waits for it. */
async function openDialog(page: Page): Promise<void> {
  await chip(page).click();
  await expect(dialog(page)).toBeVisible();
}

/** The points are drawn, and `faults`, a local grid in feet, is not: it is a dataset the dialog has something to say about. */
async function withALocalGrid(page: Page): Promise<void> {
  await mapWith(page);
  await importAsLocalGrid(page, 'ft', {
    name: 'faults.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('x,y\n1,2\n3,4\n'),
  });
  await expect
    .poll(async () => (await layerStatuses(page)).map(([, status]) => status))
    .toEqual(['drawn', 'not_drawn']);
  await page.mouse.move(0, 0);
}

/** The page the states are shown on. */
export const PATH = '/';

/** The states, each with what to do to the page to put it in the state. */
export const SHOTS: Shot[] = [
  {
    name: 'map-furniture',
    show: async (page) => {
      await mapWith(page);
      return whole(page);
    },
  },
  {
    // The pointer over the map: the status chip has the point of the map under it.
    name: 'map-furniture-pointer',
    show: async (page) => {
      await mapWith(page);
      const box = await canvas(page).boundingBox();
      if (box === null) {
        throw new Error('The map is not shown.');
      }
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6);
      await expect(page.locator('karmania-status-chip .value').first()).not.toHaveText('');
      return whole(page);
    },
  },
  {
    // The map turned: the needle of the north arrow with it.
    name: 'map-furniture-turned',
    show: async (page) => {
      await mapWith(page);
      await dispatch(page, { type: 'setCamera', patch: { camera2d: { heading: 30 } } });
      await expect(page.locator('karmania-north-arrow g')).toHaveAttribute('data-angle', '-30');
      return whole(page);
    },
  },
  {
    // The panel at its widest: the map is at its narrowest, and nothing in it overlaps.
    name: 'map-furniture-panel-widest',
    show: async (page) => {
      await mapWith(page, 9999);
      return whole(page);
    },
  },
  {
    name: 'map-furniture-panel-narrowest',
    show: async (page) => {
      await mapWith(page, 1);
      return whole(page);
    },
  },
  {
    // The panel folded away: the map has the whole width.
    name: 'map-furniture-panel-collapsed',
    show: async (page) => {
      await mapWith(page);
      await page.locator('karmania-panel').getByRole('button', { name: 'Collapse panel' }).click();
      await expect(page.locator('karmania-panel .rail')).toBeVisible();
      await page.mouse.move(0, 0);
      return whole(page);
    },
  },
  {
    // The keyboard on the map's coordinate system: the ring inside the button, and the tooltip with its name.
    name: 'map-furniture-crs-focus',
    show: async (page) => {
      await mapWith(page);
      await page.keyboard.press('Shift');
      await chip(page).focus();
      await page.locator('karmania-status-chip k-tooltip .tip').waitFor({ state: 'visible' });
      return whole(page);
    },
  },
  {
    // The keyboard on a button of the navigation group: its ring and its tooltip with the key.
    name: 'map-furniture-nav-focus',
    show: async (page) => {
      await mapWith(page);
      await page.keyboard.press('Shift');
      await page
        .locator('karmania-nav-group')
        .getByRole('button', { name: 'Fit to data', exact: true })
        .focus();
      await page
        .locator('karmania-nav-group k-tooltip[text="Fit to data (Home)"] .tip')
        .waitFor({ state: 'visible' });
      return whole(page);
    },
  },
  {
    name: 'map-crs-dialog',
    show: async (page) => {
      await mapWith(page);
      await openDialog(page);
      await blur(page);
      return whole(page);
    },
  },
  {
    // A search with matches, one of them chosen: Apply can be pressed, and nothing would change.
    name: 'map-crs-dialog-choice',
    show: async (page) => {
      await mapWith(page);
      await openDialog(page);
      await page.locator('karmania-map-crs-dialog k-input input').fill('utm zone 40');
      await page.locator('karmania-map-crs-dialog karmania-crs-matches .match').nth(1).click();
      await expect(page.locator('karmania-map-crs-dialog .changes')).toContainText(
        'No dataset would start or stop being drawn.',
      );
      await blur(page);
      return whole(page);
    },
  },
  {
    // A local grid is loaded, and chosen: two datasets would stop and start being drawn, with their reasons.
    name: 'map-crs-dialog-changes',
    show: async (page) => {
      await withALocalGrid(page);
      await openDialog(page);
      await page.locator('karmania-map-crs-dialog .local input').first().check();
      await page.locator('karmania-map-crs-dialog .changes li').first().waitFor();
      await blur(page);
      return whole(page);
    },
  },
];
