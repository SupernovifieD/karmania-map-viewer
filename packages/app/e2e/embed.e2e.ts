import { expect, test } from '@playwright/test';

/**
 * The embedding page (`embed.html`) puts viewers in itself with only what `@karmania/viewer` exports, as the page of an embedder would. These
 * are the tests of what that package gives; the tests of the options and of the API are in the files that follow.
 */
test.describe('a page that embeds the viewer', () => {
  test('has what it needs of the package: the viewer, the engine and the builders', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const names = await page.evaluate(() => Object.keys(window.embed).sort());
    expect(names).toEqual([
      'EngineDisposedError',
      'EngineError',
      'KarmaniaViewer',
      'blocks',
      'createEngine',
      'createViewer',
      'grid',
      'lines',
      'mesh',
      'points',
      'polygons',
    ]);
  });

  test('loads a dataset made by a builder into an engine of its own, and lets the engine go', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const result = await page.evaluate(async () => {
      const { createEngine, points, EngineDisposedError } = window.embed;
      const engine = createEngine();
      const loaded = await engine.load(
        points({ name: 'wells', x: [1, 2, 3], y: [4, 5, 6], crs: { kind: 'local', units: 'm' } }),
      );
      const listed = engine.datasets().map((dataset) => dataset.name);
      engine.dispose();
      let refused = false;
      try {
        engine.datasets();
      } catch (error) {
        refused = error instanceof EngineDisposedError;
      }
      return { status: loaded.status, listed, refused };
    });
    expect(result).toEqual({ status: 'loaded', listed: ['wells'], refused: true });
  });

  test('puts a viewer in an element of its own, shows an empty scene, and takes it out again', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const result = await page.evaluate(() => {
      const host = document.createElement('div');
      host.style.cssText = 'width: 800px; height: 500px';
      document.body.append(host);
      const viewer = window.embed.createViewer(host);
      const inside = host.querySelectorAll('karmania-viewer').length;
      const layers = Object.keys(viewer.scene().layers).length;
      viewer.dispose();
      return { inside, layers, after: host.querySelectorAll('karmania-viewer').length };
    });
    expect(result).toEqual({ inside: 1, layers: 0, after: 0 });
  });
});
