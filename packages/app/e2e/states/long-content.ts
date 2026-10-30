/**
 * The long and the unexpected of section 7.3 of the brief (a name of 120 characters, a column of 60, 10
 * million as a count, a negative coordinate with 12 decimals) in the places they are shown, each with
 * what to do to the page to put it in that state. The screenshot tests photograph them
 * (`long-content.visual.ts`) and the accessibility pass checks them (`axe-states.axe.ts`).
 */
import type { Locator, Page } from '@playwright/test';
import {
  LONG_ENGINE,
  NAME,
  SPACED_NAME,
  longDataset,
  longFile,
  setDatasets,
} from '../support/long-content.js';
import type { Shot } from '../support/screenshots.js';
import { goTo, startWizard, wizard } from '../support/wizard.js';

/** The page the states are shown on. */
export const PATH = '/';

const app = (page: Page): Locator => page.locator('karmania-app');

/** Takes the keyboard and the pointer off the page, and waits for the fonts, so that nothing but the content shows. */
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
  return [app(page)];
}

/** Opens the wizard on the fake engine that previews a file of 10 million rows with the long things in it. */
async function openLongWizard(page: Page): Promise<void> {
  const w = wizard(page);
  await w.host.evaluate(
    (element, [source, name]) => {
      const target = element as unknown as { engine: unknown; show: (files: File[]) => void };
      target.engine = (0, eval)(source ?? '');
      target.show([new File(['x'], name ?? 'a.csv')]);
    },
    [LONG_ENGINE, `${NAME}.csv`],
  );
  await w.host.locator('karmania-file-step').waitFor();
}

export const SHOTS: Shot[] = [
  {
    // Three datasets, the first with every long thing in it, and both lists under the summary open.
    name: 'long-data-tab',
    show: async (page) => {
      await setDatasets(page, [
        longDataset(1, NAME),
        longDataset(2, SPACED_NAME),
        longDataset(3, 'short'),
      ]);
      for (const head of await page.locator('karmania-dataset-summary details > summary').all()) {
        await head.click();
      }
      return rest(page);
    },
  },
  {
    name: 'long-remove-question',
    show: async (page) => {
      await setDatasets(page, [longDataset(1, NAME)]);
      await page.locator('karmania-dataset-list li').first().hover();
      await page.locator('karmania-dataset-list .remove k-button button').first().click();
      await page.locator('karmania-dataset-list .confirm').waitFor();
      return rest(page);
    },
  },
  {
    name: 'long-map-area',
    show: async (page) => {
      await page.locator('karmania-map-area').evaluate(async (element) => {
        const area = element as unknown as { datasets: number; updateComplete: Promise<boolean> };
        area.datasets = 10_000_000;
        await area.updateComplete;
      });
      return rest(page);
    },
  },
  {
    name: 'long-wizard-file',
    show: async (page) => {
      await openLongWizard(page);
      return [wizard(page).dialog];
    },
  },
  {
    name: 'long-wizard-mapping',
    show: async (page) => {
      await openLongWizard(page);
      await goTo(page, 'mapping');
      return [wizard(page).dialog];
    },
  },
  {
    // The real engine, with a file named with 120 characters and nowhere to break it.
    name: 'long-wizard-crs',
    show: async (page) => {
      await startWizard(page, ...longFile());
      await goTo(page, 'mapping');
      await goTo(page, 'nodata');
      await goTo(page, 'crs');
      return [wizard(page).dialog];
    },
  },
  {
    // The import has run and loaded a dataset of 10 million points under a name of 120 characters.
    name: 'long-wizard-review',
    show: async (page) => {
      await openLongWizard(page);
      for (const step of ['mapping', 'nodata', 'crs', 'review']) {
        await goTo(page, step);
      }
      await page.evaluate(
        (summary) => {
          (window as unknown as { fake: { finish: (result: unknown) => void } }).fake.finish({
            status: 'loaded',
            summaries: [summary],
          });
        },
        longDataset(1, NAME),
      );
      await wizard(page).host.locator('karmania-review-step .verdict').waitFor();
      return [wizard(page).dialog];
    },
  },
];
