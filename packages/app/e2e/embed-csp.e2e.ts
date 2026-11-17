import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildLibrary, libraryPages } from './support/library';
import type { BuiltLibrary } from './support/library';
import { trackLeaks } from './support/leaks';
import { EMBED_POLICY, blockedBy, changed, policyHeader } from './support/policy';
import type { Policy } from './support/policy';
import { serveSite } from './support/site';
import type { Site } from './support/site';

/**
 * Two viewers on one page under the smallest Content Security Policy (brief 23.3). The page is `libraryPages`: the build's style sheet linked, its module loaded, two places for
 * viewers, no inline script and no inline style; the policy is on every answer of the site, the worker's script and the WebAssembly module included (a worker has the policy of
 * its own script's answer). `support/policy.ts` has the policy and what each of its allowances is for; the last tests here take them away one at a time and show that each is needed.
 */
let library: BuiltLibrary;

test.beforeAll(async () => {
  library = await buildLibrary();
});

test.afterAll(() => {
  library.remove();
});

/** A site that serves the library with `policy` on every answer, and the page's own files. */
function siteUnder(policy: Policy): Promise<Site> {
  return serveSite({
    pages: libraryPages('/lib/'),
    folders: { '/lib/': library.folder },
    // The policy asks the browser to report what it blocks to the site, which the page's own events do not give for a worker: a violation inside the worker
    // (the WebAssembly module that it may not make, the fetch that it may not do) is in its own global scope, not the document's. The reports are what is counted.
    headers: { 'content-security-policy': `${policyHeader(policy)}; report-uri ${REPORTS}` },
  });
}

/** Where the browser reports what the policy blocks, from the page and from the worker alike. */
const REPORTS = '/csp-report';

/** How many reports of a violation the site has had. */
const reportsOf = (site: Site): number =>
  site.requests.filter((request) => request.path === REPORTS).length;

/** What goes wrong, as the page and the browser say it: the errors of the page and the violations of the policy. */
interface Trouble {
  /** The errors that the page threw or logged. */
  readonly errors: string[];
  /** What the browser blocked, each as the directive and what. */
  readonly violations: () => Promise<string[]>;
  /** How many reports of a violation the browser has sent to the site, a worker's included. */
  readonly reports: () => number;
}

/** Opens the page of `site` in a window that has room for both viewers. */
async function open(page: Page, site: Site): Promise<Trouble> {
  await page.setViewportSize({ width: 1000, height: 1100 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // A script that is blocked is said by the console as well as by the event: the event is the one that is counted.
    if (message.type() === 'error' && !/Content Security Policy|Refused to/.test(message.text())) {
      errors.push(message.text());
    }
  });
  const violations = await blockedBy(page);
  await page.goto(`${site.origin}/`);
  return { errors, violations, reports: () => reportsOf(site) };
}

/** Makes the two viewers of the page, each with an engine of its own, and puts a dataset or two in each. */
async function makeViewers(page: Page): Promise<void> {
  await page.waitForFunction(() => 'library' in window);
  await page.evaluate(async () => {
    const { createViewer, points, grid } = window.library;
    const place = (id: string): HTMLElement => {
      const element = document.querySelector<HTMLElement>(id);
      if (element === null) {
        throw new Error(`The page has no ${id}.`);
      }
      return element;
    };
    const first = createViewer(place('#first'), {});
    const second = createViewer(place('#second'), {});
    window.first = first;
    window.second = second;
    const x = Array.from({ length: 30 }, (_, i) => 100 + 30 * i);
    const y = Array.from({ length: 30 }, (_, i) => 100 + 20 * ((i * 7) % 11));
    const crs = { kind: 'local', units: 'm' } as const;
    await first.load(
      points({ name: 'Wells', x, y, attributes: { depth: x.map((_, i) => i) }, crs }),
    );
    await first.load(
      grid({
        name: 'Topography',
        origin: [0, 0, 0],
        spacing: [50, 50, 1],
        dims: [6, 6, 1],
        values: { elevation: Array.from({ length: 36 }, (_, i) => i) },
        crs,
      }),
    );
    await second.load(points({ name: 'Collars', x: [1, 2, 3], y: [3, 1, 2], crs }));
  });
}

test.describe('two viewers on a page under the smallest policy', () => {
  test('load, draw, answer the pointer, show their tabs, tell their tooltips, make a picture, take files and are taken out, and nothing is blocked', async ({
    page,
  }) => {
    const site = await siteUnder(EMBED_POLICY);
    try {
      const trouble = await open(page, site);
      await makeViewers(page);
      await expect
        .poll(() => page.evaluate(() => [window.first?.exportable(), window.second?.exportable()]))
        .toEqual([true, true]);

      const first = page.locator('#first');
      // The Legend tab: its rows with their swatches, and the classes of a layer (the dots).
      await first.getByRole('tab', { name: 'Legend' }).click();
      await first.locator('karmania-legend-tab .open').first().click();
      await expect(first.locator('karmania-legend-tab .entry .dot').first()).toBeVisible();
      // The Data tab: the table of a dataset.
      await first.getByRole('tab', { name: 'Data' }).click();
      await expect(first.locator('k-table').first()).toBeVisible();
      // The pointer over the map: the readout of the position.
      const canvas = first.locator('karmania-map-area canvas');
      const box = await canvas.boundingBox();
      if (box === null) {
        throw new Error('The map has no canvas.');
      }
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // A tooltip.
      await first.getByRole('button', { name: 'Zoom in' }).hover();
      // The export dialog with its preview, and the file that Export gives.
      await page.evaluate(() => window.first?.openExport());
      await expect(first.locator('karmania-export-dialog .frame canvas')).toBeVisible();
      const download = page.waitForEvent('download');
      await first.locator('karmania-export-dialog k-button[slot="footer-end"]').click();
      expect((await download).suggestedFilename()).toMatch(/\.png$/);
      await page.keyboard.press('Escape');
      // The import wizard, as far as the step that has a table of the file's columns.
      await page.evaluate(() =>
        window.first?.openImport([
          new File(['x,y,z\n1,2,3\n4,5,6\n'], 'a.csv', { type: 'text/csv' }),
        ]),
      );
      const wizard = first.locator('karmania-import-dialog');
      await expect(wizard.locator('karmania-file-step')).toBeVisible();
      await wizard.locator('k-button[slot="footer-end"]').nth(1).click();
      await expect(wizard.locator('.step')).toHaveAttribute('data-step', 'mapping');
      await expect(wizard.locator('karmania-mapping-step table')).toBeVisible();
      await wizard.locator('k-button[slot="footer-start"]').click();
      await expect(wizard.locator('dialog')).toBeHidden();

      // One viewer is taken out, and the other still works.
      await page.evaluate(() => window.second?.dispose());
      await page.evaluate(() =>
        window.first?.load(
          window.library.points({
            name: 'After',
            x: [1, 2],
            y: [1, 2],
            crs: { kind: 'local', units: 'm' },
          }),
        ),
      );
      // The fonts that the interface is set in were loaded.
      expect(await page.evaluate(() => document.fonts.check('14px Inter'))).toBe(true);

      // The reports of the browser come a moment after what they report.
      await page.waitForTimeout(300);
      expect(await trouble.violations()).toEqual([]);
      expect(trouble.reports(), "reports of a violation, the worker's too").toBe(0);
      expect(trouble.errors).toEqual([]);
    } finally {
      await site.close();
    }
  });

  test('are independent: what one holds, listens to and shows is not what the other does', async ({
    page,
  }) => {
    const site = await siteUnder(EMBED_POLICY);
    try {
      const read = await trackLeaks(page);
      const trouble = await open(page, site);
      await makeViewers(page);
      // Two engines, two workers, and what each holds is its own.
      expect((await read()).workers.started).toBe(2);
      const held = await page.evaluate(() => ({
        sameEngine: window.first?.engine === window.second?.engine,
        first: window.first?.engine.datasets().map((dataset) => dataset.name),
        second: window.second?.engine.datasets().map((dataset) => dataset.name),
        firstLayers: Object.keys(window.first?.scene().layers ?? {}).length,
        secondLayers: Object.keys(window.second?.scene().layers ?? {}).length,
      }));
      expect(held).toEqual({
        sameEngine: false,
        first: ['Wells', 'Topography'],
        second: ['Collars'],
        firstLayers: 2,
        secondLayers: 1,
      });

      // What happens to one is heard by its own listeners and by no others, and does not change the other's scene.
      const heard = await page.evaluate(() => {
        const { first, second } = window;
        if (first === undefined || second === undefined) {
          throw new Error('The page has no viewers.');
        }
        const heardBy = { first: 0, second: 0 };
        first.on('scene', () => (heardBy.first += 1));
        second.on('scene', () => (heardBy.second += 1));
        const secondBefore = second.scene();
        const [layerId] = Object.keys(first.scene().layers);
        if (layerId === undefined) {
          throw new Error('The first viewer has no layers.');
        }
        first.dispatch({ type: 'setVisible', layerId, visible: false });
        first.setViewMode('3d');
        return {
          heardBy,
          // The other's document is the very one it had.
          secondUnchanged: second.scene() === secondBefore,
          firstMode: first.scene().viewMode,
          secondMode: second.scene().viewMode,
        };
      });
      expect(heard.heardBy.first).toBeGreaterThan(0);
      expect(heard.heardBy.second).toBe(0);
      expect(heard).toMatchObject({ secondUnchanged: true, firstMode: '3d', secondMode: '2d' });

      // One is taken out: its worker ends, the other's goes on, and the other still takes data and draws.
      await page.evaluate(() => window.first?.dispose());
      expect((await read()).workers).toEqual({ started: 2, terminated: 1 });
      await page.evaluate(() =>
        window.second?.load(
          window.library.points({
            name: 'More',
            x: [5, 6],
            y: [5, 6],
            crs: { kind: 'local', units: 'm' },
          }),
        ),
      );
      expect(await page.evaluate(() => window.second?.engine.datasets().length)).toBe(2);
      await expect.poll(() => page.evaluate(() => window.second?.exportable())).toBe(true);
      // The reports of the browser come a moment after what they report.
      await page.waitForTimeout(300);
      expect(await trouble.violations()).toEqual([]);
      expect(trouble.reports(), "reports of a violation, the worker's too").toBe(0);
      expect(trouble.errors).toEqual([]);
    } finally {
      await site.close();
    }
  });
});

/** What a page does under a policy, as far as the page can tell: whether its module started, what loading and exporting ended in, and what the browser blocked. */
interface Outcome {
  /** Whether the page's module ran (the library is in the page). */
  readonly scripted: boolean;
  /** The error of loading a dataset into a viewer, as `Name: message`, or `null`. */
  readonly loadError: string | null;
  /** The error of making a picture, as `Name: message`, or `null` (not tried when nothing loaded). */
  readonly pictureError: string | null;
  /** What the browser blocked in the document. */
  readonly violations: readonly string[];
  /** How many reports of a violation the site had, which is how a violation inside the worker is seen. */
  readonly reports: number;
}

/** Does what a page does with the viewer first of all, under `policy`: loads a dataset into a viewer, and makes a picture of it. */
async function outcomeUnder(page: Page, policy: Policy): Promise<Outcome> {
  const site = await siteUnder(policy);
  try {
    const trouble = await open(page, site);
    let scripted = true;
    try {
      await page.waitForFunction(() => 'library' in window, undefined, { timeout: 3000 });
    } catch {
      scripted = false;
    }
    let loadError: string | null = null;
    let pictureError: string | null = null;
    if (scripted) {
      const result = await page.evaluate(async () => {
        const place = document.querySelector<HTMLElement>('#first');
        if (place === null) {
          throw new Error('The page has no place for a viewer.');
        }
        const viewer = window.library.createViewer(place, {});
        const said = (error: unknown): string =>
          `${(error as Error).name}: ${(error as Error).message}`;
        try {
          await viewer.load(
            window.library.points({
              name: 'p',
              x: [1, 2],
              y: [2, 1],
              crs: { kind: 'local', units: 'm' },
            }),
          );
        } catch (error) {
          return { loadError: said(error), pictureError: null };
        }
        for (let tries = 0; tries < 100 && !viewer.exportable(); tries += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        try {
          await viewer.exportPng({ widthPx: 400, heightPx: 300, dpi: 96, legend: true });
          return { loadError: null, pictureError: null };
        } catch (error) {
          return { loadError: null, pictureError: said(error) };
        }
      });
      loadError = result.loadError;
      pictureError = result.pictureError;
    }
    // The events of the browser are queued: what a blocked font or script says comes a moment after.
    await page.waitForTimeout(300);
    return {
      scripted,
      loadError,
      pictureError,
      violations: await trouble.violations(),
      reports: trouble.reports(),
    };
  } finally {
    await site.close();
  }
}

/** Every allowance of a policy, as the directive and the one source that it would be without. */
const ALLOWANCES = Object.entries(EMBED_POLICY).flatMap(([directive, sources]) =>
  directive === 'default-src' ? [] : sources.map((source) => [directive, source] as const),
);

/** The policy with one source taken from a directive (the directive too, if it had no other). */
function without(policy: Policy, directive: string, source: string): Policy {
  const rest = (policy[directive] ?? []).filter((one) => one !== source);
  return rest.length === 0 ? changed(policy, directive) : changed(policy, directive, rest);
}

/** What goes wrong, in the words of what the page and the browser say, for each allowance that is taken away: why it is in the policy. */
const SYMPTOM: Readonly<Record<string, (outcome: Outcome) => boolean>> = {
  // The module of the page is blocked, and nothing starts.
  "script-src 'self'": (o) =>
    !o.scripted && o.violations.some((entry) => /^script-src-elem .*\/page\.js$/.test(entry)),
  // The worker cannot make the engine's WebAssembly module.
  // (A violation inside the worker is not an event of the document: the browser's report of it to the site is what shows it.)
  "script-src 'wasm-unsafe-eval'": (o) =>
    /^EngineError: .*WebAssembly/.test(o.loadError ?? '') && o.reports > 0,
  // The worker cannot fetch it.
  "connect-src 'self'": (o) =>
    /^EngineError: Failed to fetch/.test(o.loadError ?? '') && o.reports > 0,
  // Neither style sheet (the library's and the page's) is applied.
  "style-src 'self'": (o) =>
    o.violations.filter((entry) => /^style-src-elem .*\.css$/.test(entry)).length === 2,
  // Inter is blocked, and a picture, which waits for the fonts, cannot be made.
  "font-src 'self'": (o) =>
    o.pictureError !== null &&
    o.violations.length > 0 &&
    o.violations.every((entry) => /^font-src .*\.woff2$/.test(entry)),
};

test.describe('the policy has in it only what the viewer needs: take any allowance away and the viewer fails', () => {
  test('is a policy under which a viewer loads a dataset and makes a picture, with nothing blocked (the control)', async ({
    page,
  }) => {
    expect(await outcomeUnder(page, EMBED_POLICY)).toEqual({
      scripted: true,
      loadError: null,
      pictureError: null,
      violations: [],
      reports: 0,
    });
  });

  test('has a reason written for every allowance of it, and no reason for one that it has not', () => {
    expect(Object.keys(SYMPTOM).sort()).toEqual(
      ALLOWANCES.map(([directive, source]) => `${directive} ${source}`).sort(),
    );
  });

  for (const [directive, source] of ALLOWANCES) {
    test(`without ${source} for ${directive}, the viewer fails`, async ({ page }) => {
      const outcome = await outcomeUnder(page, without(EMBED_POLICY, directive, source));
      // Something is wrong...
      expect(
        !outcome.scripted ||
          outcome.loadError !== null ||
          outcome.pictureError !== null ||
          outcome.violations.length > 0,
        'nothing is wrong without it',
      ).toBe(true);
      // ... and it is what the allowance is for.
      expect(SYMPTOM[`${directive} ${source}`]?.(outcome), JSON.stringify(outcome)).toBe(true);
    });
  }

  test('a policy that names worker-src has to give it self: it is what governs the worker, and the engine does not start without it', async ({
    page,
  }) => {
    const outcome = await outcomeUnder(page, changed(EMBED_POLICY, 'worker-src', ["'none'"]));
    expect(outcome.loadError).not.toBeNull();
  });
});
