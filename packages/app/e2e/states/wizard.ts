/**
 * The import wizard in each of its steps, and in the states that look different (an error, a
 * warning, nothing found, a failure), each with what to do to the page to put it in that state. The
 * screenshot tests photograph them (`wizard.visual.ts`) and the accessibility pass checks them
 * (`axe-states.axe.ts`).
 */
import type { Locator, Page } from '@playwright/test';
import { pickFiles } from '../support/picker.js';
import type { Pick } from '../support/picker.js';
import type { Shot } from '../support/screenshots.js';
import { goTo, openWithFakeEngine, wizard } from '../support/wizard.js';

/** A projection file that names a coordinate system by its code. */
const PRJ = (name: string): Pick => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from('PROJCS["x",AUTHORITY["EPSG","32640"]]'),
});

const csv = (name: string, text: string): Pick => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(text),
});

/** Points with a point twice: loaded, with a warning. */
const TWICE = [csv('twice.csv', 'x,y\n1,2\n1,2\n3,4\n'), PRJ('twice.prj')];
/** Points with a coordinate missing: stopped, with an error that the Nodata step can fix. */
const GAP = [csv('gap.csv', 'x,y\n1,2\n,3\n4,5\n'), PRJ('gap.prj')];
/** A file in Windows-1252, which the kernel reads and says so: "cafe" with the e acute as one byte. */
const CAFE: Pick = {
  name: 'cafe.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from([0x78, 0x2c, 0x79, 0x0a, 0x63, 0x61, 0x66, 0xe9, 0x2c, 0x31, 0x0a]),
};
const UNREADABLE = {
  name: 'data.shp',
  mimeType: 'application/octet-stream',
  buffer: Buffer.from([0, 0, 1]),
};

/** What to show is the dialog, with a little of the dimmed page round it. */
const dialogOf = (page: Page): Locator => wizard(page).dialog;

/** Takes the keyboard off whatever has it, so that no ring or caret is in the picture. */
async function rest(page: Page): Promise<Locator[]> {
  await page.evaluate(() => {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    (active as HTMLElement | null)?.blur();
  });
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  // The app behind is hidden (the dialog is made visible again), so that what shows round the dialog,
  // under the dimming, does not change with what else the app shows.
  await page.locator('karmania-app').evaluate((app) => {
    app.style.visibility = 'hidden';
  });
  await dialogOf(page).evaluate((dialog) => {
    dialog.style.visibility = 'visible';
  });
  return [dialogOf(page)];
}

/** Opens the wizard on files and goes on to a step (by pressing Next), waiting for it each time. */
async function at(page: Page, step: string, ...picks: Pick[]): Promise<void> {
  const w = wizard(page);
  await pickFiles(
    page,
    async () => {
      await w.importButton.click();
    },
    picks,
  );
  await w.host.locator('karmania-file-step').waitFor();
  for (const next of ['mapping', 'nodata', 'crs', 'review']) {
    if (step === 'file') {
      break;
    }
    await goTo(page, next);
    if (next === step) {
      break;
    }
  }
}

/** Makes a change in the wizard's draft, which a step shows, as a person's edit would. */
function edit(page: Page, change: string): Promise<void> {
  return wizard(page).host.evaluate((element, source) => {
    const target = element as unknown as { draft: Record<string, unknown> };
    const make = (0, eval)(`(draft) => (${source})`) as (
      draft: Record<string, unknown>,
    ) => Record<string, unknown>;
    target.draft = make(target.draft);
  }, change);
}

const shot = (name: string, show: (page: Page) => Promise<unknown>): Shot => ({
  name: `wizard-${name}`,
  padding: 16,
  show: async (page) => {
    await show(page);
    return rest(page);
  },
});

/** The page the states are shown on. */
export const PATH = '/';

/** The states, each with what to do to the page to put it in the state. */
export const SHOTS: Shot[] = [
  shot('file', (page) => at(page, 'file', 'points.csv', 'points.prj')),
  shot('file-many', (page) => at(page, 'file', 'esri.prj', 'points.csv', 'lines.csv', UNREADABLE)),
  shot('file-warning', (page) => at(page, 'file', CAFE)),
  shot('file-failed', async (page) => {
    const w = wizard(page);
    await w.host.evaluate((element) => {
      const target = element as unknown as { engine: unknown; show: (files: File[]) => void };
      target.engine = { preview: () => Promise.reject(new Error('The module did not start.')) };
      target.show([new File(['x'], 'a.csv')]);
    });
    await w.host.locator('karmania-findings').waitFor();
  }),
  shot('mapping', async (page) => {
    await at(page, 'mapping', 'points.csv', 'points.prj');
    await wizard(page).host.locator('karmania-mapping-step thead .column-name').nth(3).click();
  }),
  shot('mapping-problem', async (page) => {
    await at(page, 'mapping', 'points.csv', 'points.prj');
    await edit(
      page,
      "({ ...draft, columns: draft.columns.map((c, i) => (i === 0 ? { ...c, role: 'attribute', suggested: false } : c)) })",
    );
  }),
  shot('mapping-blocks', async (page) => {
    await at(page, 'mapping', 'blocks.csv');
    await edit(page, "({ ...draft, blockSize: { x: '10', y: 'ten', z: '' } })");
  }),
  shot('nodata', (page) => at(page, 'nodata', 'points.csv', 'points.prj')),
  shot('crs-found', (page) => at(page, 'crs', 'points.csv', 'points.prj')),
  shot('crs-missing', async (page) => {
    await at(page, 'crs', 'points.csv');
    await edit(page, "({ ...draft, crs: { ...draft.crs, mode: 'epsg', epsg: 'WGS84' } })");
  }),
  shot('crs-local', async (page) => {
    await at(page, 'crs', 'points.csv');
    await edit(page, "({ ...draft, crs: { ...draft.crs, mode: 'local', units: 'us_ft' } })");
  }),
  shot('review-running', async (page) => {
    await openWithFakeEngine(page);
    for (const next of ['mapping', 'nodata', 'crs', 'review']) {
      await goTo(page, next);
    }
    await page.evaluate("window.fake.report({ phase: 'parsing', fraction: 0.42 })");
    await wizard(page).host.locator('karmania-review-step k-progress').waitFor();
  }),
  shot('review-cancelled', async (page) => {
    await openWithFakeEngine(page);
    for (const next of ['mapping', 'nodata', 'crs', 'review']) {
      await goTo(page, next);
    }
    await wizard(page)
      .host.locator('karmania-review-step')
      .getByRole('button', { name: 'Cancel import' })
      .click();
    await wizard(page).host.getByText('The import was cancelled.').waitFor();
  }),
  shot('review-loaded', async (page) => {
    await at(page, 'review', 'points.csv', 'points.prj');
    await wizard(page).host.locator('karmania-review-step .verdict').waitFor();
  }),
  shot('review-warning', async (page) => {
    await at(page, 'review', ...TWICE);
    await wizard(page).host.locator('karmania-review-step .verdict').waitFor();
  }),
  shot('review-error', async (page) => {
    await at(page, 'review', ...GAP);
    await wizard(page).host.locator('karmania-review-step .verdict').waitFor();
  }),
  shot('queue', async (page) => {
    const w = wizard(page);
    await at(
      page,
      'review',
      csv('a.csv', 'x,y\n1,2\n3,4\n'),
      PRJ('a.prj'),
      csv('b.csv', 'x,y\n5,6\n'),
      PRJ('b.prj'),
    );
    await w.host.locator('karmania-review-step .verdict').waitFor();
    await w.next.click();
    await w.host.locator('karmania-file-step .file[data-state="done"]').waitFor();
  }),
];
