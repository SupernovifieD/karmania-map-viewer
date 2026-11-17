import { expect, test } from '@playwright/test';
import { buildLibrary, libraryPages } from './support/library';
import type { BuiltLibrary } from './support/library';
import { serveSite } from './support/site';

/**
 * Where the files of the library may be (brief 23.6, `docs/embedding.md`): on the origin of the page. The engine's worker is a script of the library's own folder, and a browser does not
 * start a worker from another origin than the page's, whatever the headers say (the module itself loads from another origin with CORS, which is why the page here gets as far as the
 * engine). This shows what a page that puts the files on a CDN finds, so that the guide says it as it is.
 */
let library: BuiltLibrary;

test.beforeAll(async () => {
  library = await buildLibrary();
});

test.afterAll(() => {
  library.remove();
});

test('files on another origin than the page: the viewer is made, and the engine cannot start its worker', async ({
  page,
}) => {
  // The library on a site of its own, which lets any origin read it (CORS), and the page on another.
  const files = await serveSite({
    pages: {},
    folders: { '/lib/': library.folder },
    headers: { 'access-control-allow-origin': '*' },
  });
  const site = await serveSite({ pages: libraryPages(`${files.origin}/lib/`), folders: {} });
  try {
    await page.goto(`${site.origin}/`);
    await page.waitForFunction(() => 'library' in window);
    const outcome = await page.evaluate(async () => {
      const place = document.querySelector<HTMLElement>('#first');
      if (place === null) {
        throw new Error('The page has no place for a viewer.');
      }
      // Making the viewer is not what fails.
      const viewer = window.library.createViewer(place, {});
      try {
        await viewer.load(
          window.library.points({ name: 'p', x: [1], y: [2], crs: { kind: 'local', units: 'm' } }),
        );
        return 'loaded';
      } catch (error) {
        return `${(error as Error).name}: ${(error as Error).message}`;
      }
    });
    expect(outcome).toMatch(/^SecurityError: Failed to construct 'Worker'/);
    // The worker was asked for from the other origin, and was never fetched: the browser refused before it asked.
    expect(files.requests.some((request) => /worker-entry/.test(request.path))).toBe(false);
  } finally {
    await site.close();
    await files.close();
  }
});

test('the same files on the origin of the page: the engine starts (the control)', async ({
  page,
}) => {
  const site = await serveSite({
    pages: libraryPages('/lib/'),
    folders: { '/lib/': library.folder },
  });
  try {
    await page.goto(`${site.origin}/`);
    await page.waitForFunction(() => 'library' in window);
    const outcome = await page.evaluate(async () => {
      const place = document.querySelector<HTMLElement>('#first');
      if (place === null) {
        throw new Error('The page has no place for a viewer.');
      }
      const viewer = window.library.createViewer(place, {});
      const result = await viewer.load(
        window.library.points({ name: 'p', x: [1], y: [2], crs: { kind: 'local', units: 'm' } }),
      );
      return result.status;
    });
    expect(outcome).toBe('loaded');
    expect(site.requests.some((request) => /worker-entry/.test(request.path))).toBe(true);
  } finally {
    await site.close();
  }
});
