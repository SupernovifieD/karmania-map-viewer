/**
 * A photograph of the whole app in each of its states that look different, at three window sizes
 * in both themes. Run with `pnpm test:visual` (it needs Docker); `pnpm test:visual:update` takes
 * them again, and the new pictures have to be looked at before they are committed.
 */
import { test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { photograph } from './support/screenshots.js';
import type { Shot } from './support/screenshots.js';

test.use({ reducedMotion: 'reduce' });

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

const SHOTS: Shot[] = [
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

for (const shot of SHOTS) {
  test(`the shell state "${shot.name}", at every window size in both themes`, async ({ page }) => {
    await page.goto('/');
    await photograph(page, '/', shot);
  });
}
