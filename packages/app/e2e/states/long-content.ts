/**
 * The long and the unexpected of section 7.3 of the brief (a name of 120 characters, a column of 60, 10
 * million as a count, a negative coordinate with 12 decimals) in the places they are shown, each with
 * what to do to the page to put it in that state. The screenshot tests photograph them
 * (`long-content.visual.ts`) and the accessibility pass checks them (`axe-states.axe.ts`).
 */
import type { Locator, Page } from '@playwright/test';
import { loadLegendScene } from '../support/legend.js';
import {
  LONG_CRS_QUERY,
  LONG_ENGINE,
  NAME,
  SPACED_NAME,
  longDataset,
  longFile,
  openCrsDialogSearching,
  openCrsDialogWithLongChanges,
  openExportWithLongThings,
  openIdentifyWithLongThings,
  openLegendWithLongReason,
  openStyleWithLongColumns,
  openWizardCrsSearching,
  renameGroupLong,
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
      // The only text the map area has over a map that is there is the chip that counts the layers being prepared.
      await page.locator('karmania-map-area').evaluate(async (element) => {
        const area = element as unknown as {
          datasets: number;
          preparing: number;
          updateComplete: Promise<boolean>;
        };
        area.datasets = 10_000_000;
        area.preparing = 10_000_000;
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
  {
    // A group renamed with a name of 120 characters: the field keeps the row and the end of the name is in view.
    name: 'long-legend-rename',
    show: async (page) => {
      await loadLegendScene(page);
      await renameGroupLong(page);
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      return [app(page)];
    },
  },
  {
    // A grid whose two columns have names of 60 characters: Colour by and the Contour column, with the contours on.
    name: 'long-legend-columns',
    show: async (page) => {
      await openStyleWithLongColumns(page);
      return rest(page);
    },
  },
  {
    // A layer that could not be made ready, for a reason of 400 characters: the opened row says it, wrapped.
    name: 'long-legend-reason',
    show: async (page) => {
      await openLegendWithLongReason(page);
      return rest(page);
    },
  },
  {
    // The map coordinate system dialog with a search that finds the longest names of the definitions (73 characters): each is cut, with its whole in a title.
    name: 'long-crs-dialog-names',
    show: async (page) => {
      await openCrsDialogSearching(page, LONG_CRS_QUERY);
      return rest(page);
    },
  },
  {
    // A search that has more than 20 matches: the first 20, in a box that scrolls, and the help that says so.
    name: 'long-crs-dialog-many',
    show: async (page) => {
      await openCrsDialogSearching(page, 'utm zone');
      return rest(page);
    },
  },
  {
    // The local grid chosen while the points are drawn and four local grids with names of 120 characters are not: five lines of what changes.
    name: 'long-crs-dialog-changes',
    show: async (page) => {
      await openCrsDialogWithLongChanges(page);
      return rest(page);
    },
  },
  {
    // The wizard's coordinate system step with the same search: the longest names in its list.
    name: 'long-wizard-crs-search',
    show: async (page) => {
      await openWizardCrsSearching(page, LONG_CRS_QUERY);
      return [wizard(page).dialog];
    },
  },
  {
    // The export dialog with a custom size at which two warnings are made at once, and a file name of 120 characters in its field.
    name: 'long-export-dialog',
    show: async (page) => {
      await openExportWithLongThings(page);
      return rest(page);
    },
  },
  {
    // A click on a point of a layer named with 120 characters, with attributes named with 60 and a value of 200: the popover cuts each, inside the map.
    name: 'long-identify',
    show: async (page) => {
      await openIdentifyWithLongThings(page);
      return rest(page);
    },
  },
];
