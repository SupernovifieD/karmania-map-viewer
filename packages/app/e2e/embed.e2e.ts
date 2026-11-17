import { expect, test, type Locator, type Page } from '@playwright/test';

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

/** Drags a file over the map of the viewer in `host` and drops it: whether the area showed the label of a drop, and whether it said files were dropped. */
const dropOnMap = (host: Locator) =>
  host.locator('karmania-map-area').evaluate(async (area) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x,y\n1,2\n'], 'wells.csv', { type: 'text/csv' }));
    let heard = false;
    area.addEventListener('karmania-files-dropped', () => {
      heard = true;
    });
    const main = area.shadowRoot?.querySelector('main');
    main?.dispatchEvent(
      new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
    await (area as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const active =
      area.shadowRoot?.querySelector('.drop-zone')?.hasAttribute('data-active') === true;
    main?.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
    return { heard, active };
  });

test.describe('a viewer made with the panel or the import left out', () => {
  /** Puts a viewer made with `options` in a host, and says what is in it. */
  const inspect = (page: Page, options: { panel?: boolean; importUi?: boolean }) =>
    page.evaluate(
      async ([style, given]) => {
        const { createViewer, points } = window.embed;
        const host = document.createElement('div');
        host.style.cssText = style;
        document.body.append(host);
        const viewer = createViewer(host, given);
        const element = host.querySelector('karmania-viewer');
        await element?.updateComplete;
        const root = element?.shadowRoot;
        const area = root?.querySelector('karmania-map-area')?.getBoundingClientRect();
        const found = {
          panel: root?.querySelector('karmania-panel') != null,
          input: root?.querySelector('input[type="file"]') != null,
          wizard: root?.querySelector('karmania-import-dialog') != null,
          mapWidth: Math.round(area?.width ?? 0),
          hostWidth: Math.round(host.getBoundingClientRect().width),
        };
        let said = '';
        try {
          viewer.openImport();
        } catch (error) {
          said = error instanceof Error ? error.message : String(error);
        }
        const loaded = await element?.load(
          points({ name: 'wells', x: [1, 2], y: [3, 4], crs: { kind: 'local', units: 'm' } }),
        );
        viewer.dispose();
        return { ...found, said, loaded: loaded?.status };
      },
      [HOST, options] as const,
    );

  test('has both, with the map beside the panel, when nothing is left out', async ({ page }) => {
    await page.goto('/embed.html');
    const seen = await inspect(page, {});
    expect(seen).toMatchObject({ panel: true, input: true, wizard: true, said: '' });
    expect(seen.mapWidth).toBeLessThan(seen.hostWidth - 200);
  });

  test('has no panel when it is left out, and the map has the whole viewer', async ({ page }) => {
    await page.goto('/embed.html');
    const seen = await inspect(page, { panel: false });
    expect(seen).toMatchObject({ panel: false, input: true, wizard: true, loaded: 'loaded' });
    expect(seen.mapWidth).toBe(seen.hostWidth);
  });

  test('has no way to bring files in when the import is left out: openImport is a mistake, and load still works', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const seen = await inspect(page, { importUi: false });
    expect(seen).toMatchObject({ panel: true, input: false, wizard: false, loaded: 'loaded' });
    expect(seen.said).toBe('This viewer has no import: it was made with importUi set to false.');
  });

  test('says there is no data, without an Import button, on the map and in the Data tab, and takes no dropped file', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    await page.evaluate((style) => {
      const host = document.createElement('div');
      host.id = 'bare';
      host.style.cssText = style;
      document.body.append(host);
      window.embed.createViewer(host, { importUi: false });
    }, HOST);
    const bare = page.locator('#bare');
    await expect(bare.locator('karmania-map-area k-empty-state')).toContainText('No data yet');
    await expect(bare.locator('karmania-map-area k-empty-state k-button')).toHaveCount(0);
    await bare.locator('karmania-panel k-tabs [role="tab"]').filter({ hasText: 'Data' }).click();
    await expect(bare.locator('karmania-data-tab k-empty-state')).toContainText('No data loaded');
    await expect(bare.locator('karmania-data-tab k-empty-state k-button')).toHaveCount(0);
    // A file dropped on the map is not taken: no wizard opens (there is none), and the area does not show the label of a drop.
    expect(await dropOnMap(bare)).toEqual({ heard: false, active: false });
  });

  test('takes a dropped file when the import is there (the control of the test above)', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    await page.evaluate((style) => {
      const host = document.createElement('div');
      host.id = 'plain';
      host.style.cssText = style;
      document.body.append(host);
      window.embed.createViewer(host);
    }, HOST);
    expect(await dropOnMap(page.locator('#plain'))).toEqual({ heard: true, active: true });
  });

  test('sends people to the Legend when nothing can be drawn only if there is a Legend', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    for (const [id, panel] of [
      ['with', true],
      ['without', false],
    ] as const) {
      await page.evaluate(
        async ([name, style, withPanel]) => {
          const host = document.createElement('div');
          host.id = name;
          host.style.cssText = style;
          document.body.append(host);
          const viewer = window.embed.createViewer(host, { panel: withPanel });
          const element = host.querySelector('karmania-viewer');
          await element?.load(
            window.embed.blocks({
              name: 'ore',
              origin: [0, 0, 0],
              spacing: [10, 10, 10],
              dims: [2, 2, 1],
              values: { grade: [1, 2, 3, 4] },
              crs: { kind: 'epsg', code: 32640 },
            }),
          );
          // The model is drawn first (the viewer chooses the map's coordinate system from the data), and then the map is made another system:
          // a block model is drawn only in the map's own, so nothing can be drawn.
          for (let turns = 0; turns < 400; turns += 1) {
            const states = element?.layerStates() ?? [];
            if (states.length > 0 && states.every(([, state]) => state.status === 'drawn')) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          viewer.dispatch({
            type: 'setFrame',
            frame: { mapCrs: { kind: 'epsg', code: 32641 }, origin: [0, 0, 0], source: 'user' },
          });
        },
        [id, HOST, panel] as const,
      );
      const area = page.locator(`#${id} karmania-map-area k-empty-state`);
      await expect(area.locator('.heading')).toHaveText('Nothing can be drawn yet');
      await expect(area.getByRole('button', { name: 'Show the Legend' })).toHaveCount(
        panel ? 1 : 0,
      );
    }
  });

  test('keeps nothing of the panel in the browser when it has none, and does when it has one', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const kept = async (options: { panel?: boolean }) => {
      await page.evaluate(() => {
        localStorage.clear();
      });
      await inspect(page, options);
      return page.evaluate(() => localStorage.length);
    };
    expect(await kept({ panel: false })).toBe(0);
    expect(await kept({})).toBeGreaterThan(0);
  });
});
