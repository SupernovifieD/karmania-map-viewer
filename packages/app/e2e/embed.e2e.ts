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

/** A host element of a size, as a page gives to a viewer. */
const HOST = 'width: 800px; height: 500px';

test.describe('a viewer that is given an engine by the page', () => {
  test('does not let the engine go when it is taken out of the page: the engine is the page’s', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const listed = await page.evaluate(async (style) => {
      const { createEngine, createViewer, points } = window.embed;
      const engine = createEngine();
      await engine.load(
        points({ name: 'wells', x: [1, 2], y: [3, 4], crs: { kind: 'local', units: 'm' } }),
      );
      const host = document.createElement('div');
      host.style.cssText = style;
      document.body.append(host);
      createViewer(host, { engine }).dispose();
      // (This would throw if the viewer had let the engine go.)
      const names = engine.datasets().map((dataset) => dataset.name);
      engine.dispose();
      return names;
    }, HOST);
    expect(listed).toEqual(['wells']);
  });

  test('shows what the engine holds from the start, and what is loaded into it and removed from it after', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const counts = await page.evaluate(async (style) => {
      const { createEngine, createViewer, points } = window.embed;
      const engine = createEngine();
      const wells = (name: string) =>
        points({ name, x: [1, 2], y: [3, 4], crs: { kind: 'local', units: 'm' } });
      await engine.load(wells('first'));
      const host = document.createElement('div');
      host.style.cssText = style;
      document.body.append(host);
      const viewer = createViewer(host, { engine });
      const layers = () => Object.keys(viewer.scene().layers).length;
      const atStart = layers();
      const second = await engine.load(wells('second'));
      const afterLoad = layers();
      if (second.status === 'loaded') {
        await engine.remove(second.summaries[0]?.id ?? -1);
      }
      const afterRemove = layers();
      viewer.dispose();
      engine.dispose();
      return { atStart, afterLoad, afterRemove };
    }, HOST);
    expect(counts).toEqual({ atStart: 1, afterLoad: 2, afterRemove: 1 });
  });

  test('is one of two that have the same engine, and each keeps its own view of the data', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const seen = await page.evaluate(async (style) => {
      const { createEngine, createViewer, points } = window.embed;
      const engine = createEngine();
      await engine.load(
        points({ name: 'wells', x: [1, 2], y: [3, 4], crs: { kind: 'local', units: 'm' } }),
      );
      const make = () => {
        const host = document.createElement('div');
        host.style.cssText = style;
        document.body.append(host);
        return createViewer(host, { engine });
      };
      const a = make();
      const b = make();
      const both = [a, b].map((viewer) => Object.keys(viewer.scene().layers).length);
      a.dispatch({ type: 'setVerticalExaggeration', factor: 5 });
      const exaggeration = [a, b].map((viewer) => viewer.scene().verticalExaggeration);
      a.setViewMode('3d');
      const modes = [a, b].map((viewer) => viewer.scene().viewMode);
      const first = (await engine.load(
        points({ name: 'more', x: [5], y: [6], crs: { kind: 'local', units: 'm' } }),
      )) as { summaries?: { id: number }[] };
      const afterLoad = [a, b].map((viewer) => Object.keys(viewer.scene().layers).length);
      await engine.remove(first.summaries?.[0]?.id ?? -1);
      const afterRemove = [a, b].map((viewer) => Object.keys(viewer.scene().layers).length);
      a.dispose();
      const left = Object.keys(b.scene().layers).length;
      b.dispose();
      engine.dispose();
      return { both, exaggeration, modes, afterLoad, afterRemove, left };
    }, HOST);
    expect(seen).toEqual({
      both: [1, 1],
      exaggeration: [5, 1],
      modes: ['3d', '2d'],
      afterLoad: [2, 2],
      afterRemove: [1, 1],
      left: 1,
    });
  });

  test('is given one engine, once: a second is a mistake', async ({ page }) => {
    await page.goto('/embed.html');
    const message = await page.evaluate((style) => {
      const { createEngine, createViewer } = window.embed;
      const host = document.createElement('div');
      host.style.cssText = style;
      document.body.append(host);
      const engine = createEngine();
      createViewer(host, { engine });
      const element = host.querySelector('karmania-viewer');
      let said = '';
      try {
        element?.useEngine(createEngine());
      } catch (error) {
        said = error instanceof Error ? error.message : String(error);
      }
      engine.dispose();
      return said;
    }, HOST);
    expect(message).toContain('has an engine already');
  });
});
