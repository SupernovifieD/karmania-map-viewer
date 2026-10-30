/**
 * The states of the whole app that look different (the panel open, folded away, a file being
 * dragged over, and so on), each with what to do to the page to put it in that state. The
 * screenshot tests photograph them (`shell.visual.ts`) and the accessibility pass checks them
 * (`axe-states.axe.ts`).
 */
import type { Locator, Page } from '@playwright/test';
import type { Shot } from '../support/screenshots.js';

const KEY = 'karmania.panel';

const app = (page: Page): Locator => page.locator('karmania-app');
const panel = (page: Page): Locator => page.locator('karmania-panel');

/** How the panel is kept, for a visit that starts a certain way. */
interface Kept {
  readonly collapsed?: boolean;
  readonly tab?: 'legend' | 'data';
  readonly width?: number;
}

/** Starts the app afresh with the panel kept as `kept` says, and the pointer out of the way. */
async function startWith(page: Page, kept: Kept = {}): Promise<void> {
  const state = { collapsed: false, tab: 'legend', width: 360, ...kept };
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [KEY, JSON.stringify(state)] as const,
  );
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

/** The whole window is what is photographed. */
const wholeApp = (page: Page): Promise<Locator[]> => Promise.resolve([app(page)]);

/** Fires the drag events that the browser fires when files are dragged over the map area. */
function dragFilesOverTheMap(page: Page): Promise<void> {
  return page.locator('karmania-map-area main').evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['x,y\n1,2\n'], 'points.csv', { type: 'text/csv' }));
    element.dispatchEvent(
      new DragEvent('dragenter', { bubbles: true, cancelable: true, composed: true, dataTransfer }),
    );
  });
}

/** The page the states are shown on. */
export const PATH = '/';

/** The states, each with what to do to the page to put it in the state. */
export const SHOTS: Shot[] = [
  {
    name: 'shell-expanded',
    show: async (page) => {
      await startWith(page);
      return wholeApp(page);
    },
  },
  {
    name: 'shell-collapsed',
    show: async (page) => {
      await startWith(page, { collapsed: true });
      return wholeApp(page);
    },
  },
  {
    name: 'shell-loaded',
    show: async (page) => {
      await startWith(page);
      await page.locator('karmania-map-area').evaluate(async (element) => {
        const area = element as unknown as { datasets: number; updateComplete: Promise<boolean> };
        area.datasets = 3;
        await area.updateComplete;
      });
      return wholeApp(page);
    },
  },
  {
    name: 'shell-drop',
    show: async (page) => {
      await startWith(page);
      await dragFilesOverTheMap(page);
      return wholeApp(page);
    },
  },
  {
    name: 'shell-rail-tooltip',
    show: async (page) => {
      await startWith(page, { collapsed: true });
      await panel(page).locator('.rail').getByRole('button', { name: 'Data' }).hover();
      await panel(page).locator('k-tooltip[text="Data"] .tip').waitFor({ state: 'visible' });
      return wholeApp(page);
    },
  },
  {
    name: 'shell-handle-hover',
    show: async (page) => {
      await startWith(page);
      await page.locator('karmania-resize-handle').hover();
      return wholeApp(page);
    },
  },
  {
    name: 'shell-handle-focus',
    show: async (page) => {
      await startWith(page);
      // Tab: the toolbar's Import, the map's Import, and the handle.
      for (let presses = 0; presses < 3; presses += 1) {
        await page.keyboard.press('Tab');
      }
      return wholeApp(page);
    },
  },
  {
    name: 'shell-panel-widest',
    show: async (page) => {
      await startWith(page, { width: 9999 });
      return wholeApp(page);
    },
  },
  {
    name: 'shell-panel-narrowest',
    show: async (page) => {
      await startWith(page, { width: 0 });
      return wholeApp(page);
    },
  },
];
