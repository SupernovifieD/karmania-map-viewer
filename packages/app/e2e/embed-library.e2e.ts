import { expect, test } from '@playwright/test';
import type { Viewer } from '@karmania/viewer';
import { buildLibrary, libraryPages, type BuiltLibrary } from './support/library';
import { trackLeaks } from './support/leaks';
import { serveSite } from './support/site';

declare global {
  interface Window {
    /** The viewer a test made in the page of `libraryPages`. */
    first?: Viewer;
  }
}

/**
 * The library build of the viewer (brief 23.2), loaded as a page that is not the app's would load it: the files of the build on a server of their own, under a path
 * the embedder chose, a page that links the style sheet and loads the module, and nothing else of this repository. The worker, the WebAssembly module and the fonts
 * are found from where the module and the style sheet are, which is what a path that is not `/` shows. The page under a strict policy is in `embed-csp.e2e.ts`.
 */
let library: BuiltLibrary;

test.beforeAll(async () => {
  library = await buildLibrary();
});

test.afterAll(() => {
  library.remove();
});

/** The first eight bytes of every PNG file. */
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

for (const mount of ['/lib/', '/vendor/karmania/1.2/']) {
  test(`the build served from ${mount} draws a dataset and makes a picture, and every file it asks for is there`, async ({
    page,
  }) => {
    const site = await serveSite({
      pages: libraryPages(mount),
      folders: { [mount]: library.folder },
    });
    try {
      const problems: string[] = [];
      page.on('pageerror', (error) => problems.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') {
          problems.push(message.text());
        }
      });
      const read = await trackLeaks(page);
      await page.goto(`${site.origin}/`);
      await page.waitForFunction(() => 'library' in window);

      await page.evaluate(async () => {
        const { createViewer, points } = window.library;
        const slot = document.querySelector<HTMLElement>('#first');
        if (slot === null) {
          throw new Error('The page has no place for a viewer.');
        }
        const viewer = createViewer(slot, {});
        window.first = viewer;
        await viewer.load(
          points({
            name: 'wells',
            x: [100, 200, 300, 400, 500],
            y: [100, 350, 200, 500, 300],
            attributes: { depth: [10, 20, 30, 40, 50] },
            crs: { kind: 'local', units: 'm' },
          }),
        );
      });
      // Something is drawn when a picture can be made.
      await expect.poll(() => page.evaluate(() => window.first?.exportable())).toBe(true);

      const picture = await page.evaluate(async () => {
        if (window.first === undefined) {
          throw new Error('The page has no viewer.');
        }
        const blob = await window.first.exportPng({
          widthPx: 400,
          heightPx: 300,
          dpi: 96,
          legend: true,
        });
        const head = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
        return { size: blob.size, head: [...head] };
      });
      expect(picture.head.slice(0, 8)).toEqual(SIGNATURE);
      // The IHDR chunk: the width and the height, four bytes each, from the sixteenth.
      expect(picture.head.slice(16, 24)).toEqual([0, 0, 1, 144, 0, 0, 1, 44]);
      expect(picture.size).toBeGreaterThan(1000);

      // The engine's worker was started, from the file of the build.
      expect((await read()).workers.started).toBeGreaterThanOrEqual(1);
      const asked = site.requests.filter((request) => request.path.startsWith(mount));
      const found = (pattern: RegExp, type: RegExp): boolean =>
        asked.some(
          (request) =>
            pattern.test(request.path.slice(mount.length)) &&
            request.status === 200 &&
            type.test(request.type),
        );
      expect(found(/^karmania-viewer\.js$/, /javascript/), 'the module').toBe(true);
      expect(found(/^style\.css$/, /css/), 'the style sheet').toBe(true);
      expect(found(/^assets\/worker-entry-[\w-]+\.js$/, /javascript/), 'the worker').toBe(true);
      expect(
        found(/^assets\/karmania_wasm_bg-[\w-]+\.wasm$/, /^application\/wasm$/),
        'the WebAssembly module',
      ).toBe(true);
      expect(found(/^assets\/inter-[\w-]+\.woff2$/, /woff2/), 'a font').toBe(true);
      // Nothing was asked for that is not there (a browser may ask for the icon of the site, which no test is about).
      expect(
        site.requests.filter((request) => request.status >= 400 && request.path !== '/favicon.ico'),
      ).toEqual([]);
      expect(problems).toEqual([]);
    } finally {
      await site.close();
    }
  });
}

test('is in the font and the colours of the app on a page that has only its style sheet, whatever the font of the page', async ({
  page,
}) => {
  const site = await serveSite({
    pages: libraryPages('/lib/'),
    folders: { '/lib/': library.folder },
  });
  try {
    await page.goto(`${site.origin}/`);
    await page.waitForFunction(() => 'library' in window);
    const look = await page.evaluate(() => {
      const slot = document.querySelector<HTMLElement>('#first');
      if (slot === null) {
        throw new Error('The page has no place for a viewer.');
      }
      window.library.createViewer(slot, {});
      const host = slot.querySelector('karmania-viewer');
      if (host === null) {
        throw new Error('The viewer is not in the page.');
      }
      // What the tokens give, on an element of the page that nothing else styles.
      const probe = document.createElement('div');
      document.body.append(probe);
      const given = [
        ['font-family', '--k-font-sans'],
        ['font-size', '--k-font-size-body'],
        ['font-weight', '--k-weight-regular'],
        ['line-height', '--k-line-height-body'],
        ['color', '--k-text'],
        ['background-color', '--k-surface'],
      ] as const;
      for (const [property, token] of given) {
        probe.style.setProperty(property, `var(${token})`);
      }
      const read = (element: Element): Record<string, string> =>
        Object.fromEntries(
          [...given.map(([property]) => property), 'font-variant-numeric'].map((property) => [
            property,
            getComputedStyle(element).getPropertyValue(property),
          ]),
        );
      return { host: read(host), probe: read(probe), page: read(document.body) };
    });
    // The page's own font is not Inter (so that the viewer is in it because it says so, and not because the page does).
    expect(look.page['font-family']).not.toContain('Inter');
    expect(look.host['font-family']).toContain('Inter');
    for (const property of [
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'color',
      'background-color',
    ]) {
      expect(look.host[property], property).toBe(look.probe[property]);
    }
    expect(look.host['font-variant-numeric']).toBe('tabular-nums');
    // The text inside it is in that font too (it inherits it into the shadow root).
    const tab = page.locator('#first').getByRole('tab', { name: 'Data' });
    expect(await tab.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
      'Inter',
    );
  } finally {
    await site.close();
  }
});
