import { expect, test, type Locator, type Page } from '@playwright/test';
import { trackLeaks } from './support/leaks';

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
  test('does not adopt what finishes loading after it was taken out: the engine has the dataset, and the saved state of the panel is left alone', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const outcome = await page.evaluate(async (style) => {
      localStorage.removeItem('karmania.panel');
      const { createEngine, createViewer, points } = window.embed;
      const engine = createEngine();
      const host = document.createElement('div');
      host.style.cssText = style;
      document.body.append(host);
      const viewer = createViewer(host, { engine });
      const pending = viewer.load(
        points({ name: 'wells', x: [1, 2], y: [3, 4], crs: { kind: 'local', units: 'm' } }),
      );
      // The page takes the viewer out while the engine is still reading.
      viewer.dispose();
      const result = await pending;
      const outcome = {
        status: result.status,
        saved: localStorage.getItem('karmania.panel'),
        held: engine.datasets().length,
      };
      engine.dispose();
      return outcome;
    }, HOST);
    expect(outcome).toEqual({ status: 'loaded', saved: null, held: 1 });
  });

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

test.describe('the API of a viewer', () => {
  /** A CSV of two points and the mapping that makes them a dataset, which a page that has no wizard gives to `importFiles`. */
  const WELLS = {
    name: 'wells.csv',
    text: 'X,Y\n1,2\n3,4\n',
  } as const;

  test('loads a dataset made by a builder, lists it in the engine and the scene, and gives the engine it is loaded into', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const seen = await page.evaluate(async (style) => {
      const host = document.createElement('div');
      host.style.cssText = style;
      document.body.append(host);
      const viewer = window.embed.createViewer(host);
      const result = await viewer.load(
        window.embed.points({
          name: 'wells',
          x: [1, 2],
          y: [3, 4],
          crs: { kind: 'local', units: 'm' },
        }),
      );
      const engine = viewer.engine;
      const same = engine === viewer.engine;
      const listed = engine.datasets().map((dataset) => dataset.name);
      const layers = Object.keys(viewer.scene().layers).length;
      // What a load does besides: the panel shows the Data tab, with the new dataset.
      const tab = host
        .querySelector('karmania-viewer')
        ?.shadowRoot?.querySelector('karmania-panel')?.tab;
      viewer.dispose();
      return { status: result.status, same, listed, layers, tab };
    }, HOST);
    expect(seen).toEqual({
      status: 'loaded',
      same: true,
      listed: ['wells'],
      layers: 1,
      tab: 'data',
    });
  });

  test('has the engine it was given as its engine', async ({ page }) => {
    await page.goto('/embed.html');
    const same = await page.evaluate((style) => {
      const host = document.createElement('div');
      host.style.cssText = style;
      document.body.append(host);
      const engine = window.embed.createEngine();
      const viewer = window.embed.createViewer(host, { engine });
      const answer = viewer.engine === engine;
      viewer.dispose();
      engine.dispose();
      return answer;
    }, HOST);
    expect(same).toBe(true);
  });

  test('starts a worker only when its engine is first asked for, and stops it with the viewer', async ({
    page,
  }) => {
    const read = await trackLeaks(page);
    await page.goto('/embed.html');
    const make = () =>
      page.evaluate((style) => {
        const host = document.createElement('div');
        host.style.cssText = style;
        host.id = 'own';
        document.body.append(host);
        (window as unknown as { own: unknown }).own = window.embed.createViewer(host);
      }, HOST);
    await make();
    expect((await read()).workers).toEqual({ started: 0, terminated: 0 });
    await page.evaluate(() => {
      return (window as unknown as { own: { engine: unknown } }).own.engine !== undefined;
    });
    expect((await read()).workers).toEqual({ started: 1, terminated: 0 });
    await page.evaluate(() => {
      (window as unknown as { own: { dispose(): void } }).own.dispose();
    });
    expect((await read()).workers).toEqual({ started: 1, terminated: 1 });
  });

  test('imports a file with a mapping, with no wizard, and shows the dataset', async ({ page }) => {
    await page.goto('/embed.html');
    const seen = await page.evaluate(
      async ([style, file]) => {
        const host = document.createElement('div');
        host.style.cssText = style;
        document.body.append(host);
        const viewer = window.embed.createViewer(host, { importUi: false });
        const result = await viewer.importFiles([new File([file.text], file.name)], {
          datasetName: 'wells',
          kind: 'points',
          columns: [
            { source: 'X', role: 'x' },
            { source: 'Y', role: 'y' },
          ],
          nodata: { tokens: [], numbers: [] },
          emptyCoordinates: 'error',
          decimalSeparator: '.',
          crs: { kind: 'local', units: 'm' },
        });
        const listed = viewer.engine.datasets().map((dataset) => dataset.name);
        const layers = Object.keys(viewer.scene().layers).length;
        // The panel shows the Data tab, as it does for a file that the wizard imported.
        const tab = host
          .querySelector('karmania-viewer')
          ?.shadowRoot?.querySelector('karmania-panel')?.tab;
        viewer.dispose();
        return { status: result.status, listed, layers, tab };
      },
      [HOST, WELLS] as const,
    );
    expect(seen).toEqual({ status: 'loaded', listed: ['wells'], layers: 1, tab: 'data' });
  });

  test('opens the dialog of the map’s coordinate system once there is data, and not before', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const asked = async (loadFirst: boolean) =>
      page.evaluate(
        async ([style, load]) => {
          const host = document.createElement('div');
          host.style.cssText = style;
          document.body.append(host);
          const viewer = window.embed.createViewer(host);
          // The dialog is in the viewer once it has been drawn: before that, there is nothing to open, whatever the viewer holds.
          const element = host.querySelector('karmania-viewer');
          await element?.updateComplete;
          if (load) {
            await viewer.load(
              window.embed.points({
                name: 'wells',
                x: [1, 2],
                y: [3, 4],
                crs: { kind: 'local', units: 'm' },
              }),
            );
          }
          viewer.openMapCrs();
          await element?.updateComplete;
          const dialog = element?.shadowRoot?.querySelector('karmania-map-crs-dialog');
          await dialog?.updateComplete;
          const open = dialog?.open;
          viewer.dispose();
          return open;
        },
        [HOST, loadFirst] as const,
      );
    expect(await asked(false)).toBe(false);
    expect(await asked(true)).toBe(true);
  });

  test('refuses what needs a page when it is not in one: its engine, a load and an import', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const said = await page.evaluate(async () => {
      const element = document.createElement('karmania-viewer');
      const messages: string[] = [];
      const note = (error: unknown): void => {
        messages.push(error instanceof Error ? error.message : String(error));
      };
      try {
        element.getEngine();
      } catch (error) {
        note(error);
      }
      await element
        .load(
          window.embed.points({ name: 'p', x: [1], y: [2], crs: { kind: 'local', units: 'm' } }),
        )
        .catch(note);
      await element
        .importFiles([new File(['X,Y\n1,2\n'], 'p.csv')], {
          datasetName: 'p',
          kind: 'points',
          columns: [],
          nodata: { tokens: [], numbers: [] },
          emptyCoordinates: 'error',
          decimalSeparator: '.',
          crs: null,
        })
        .catch(note);
      return messages;
    });
    expect(said).toEqual([
      'The viewer is not in a page: put it in one before asking for its engine.',
      'The viewer is not in a page: put it in one before loading a dataset.',
      'The viewer is not in a page: put it in one before importing files.',
    ]);
  });
});

test.describe('the events of a viewer', () => {
  test('tells of the datasets each time they change, whoever changed them, and not of other changes', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const heard = await page.evaluate(async (style) => {
      const { createEngine, createViewer, points } = window.embed;
      const wells = (name: string) =>
        points({ name, x: [1, 2], y: [3, 4], crs: { kind: 'local', units: 'm' } });
      const make = () => {
        const host = document.createElement('div');
        host.style.cssText = style;
        document.body.append(host);
        return { host, viewer: createViewer(host, { engine }) };
      };
      const engine = createEngine();
      const here = make();
      const there = make();
      const element = here.host.querySelector('karmania-viewer');
      // The viewer tells from the update that follows a change: wait for it.
      const settle = async () => {
        await element?.updateComplete;
      };
      await settle();
      const events: string[][] = [];
      const stop = here.viewer.on('datasets', (datasets) => {
        events.push(datasets.map((dataset) => dataset.name));
      });
      await here.viewer.load(wells('first'));
      await settle();
      await there.viewer.load(wells('second'));
      await settle();
      // A change of the scene, which is not one of the datasets.
      here.viewer.dispatch({ type: 'setVerticalExaggeration', factor: 5 });
      await settle();
      const second = engine.datasets().find((dataset) => dataset.name === 'second');
      await engine.remove(second?.id ?? -1);
      await settle();
      stop();
      await here.viewer.load(wells('third'));
      await settle();
      here.viewer.dispose();
      there.viewer.dispose();
      engine.dispose();
      return events;
    }, HOST);
    expect(heard).toEqual([['first'], ['first', 'second'], ['first']]);
  });

  test('does not tell of the datasets when nothing changed: the engine that is made for it holds none', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const heard = await page.evaluate(async (style) => {
      const host = document.createElement('div');
      host.style.cssText = style;
      document.body.append(host);
      const viewer = window.embed.createViewer(host);
      const element = host.querySelector('karmania-viewer');
      await element?.updateComplete;
      let events = 0;
      viewer.on('datasets', () => {
        events += 1;
      });
      // The viewer's own engine is made when it is first asked for, and the viewer looks at what it holds: nothing, as before.
      viewer.engine.datasets();
      await element?.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 20));
      viewer.dispose();
      return events;
    }, HOST);
    expect(heard).toBe(0);
  });

  test('tells of the selection when it changes: a layer and an element, or none; not of other changes or of the same selection again', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const heard = await page.evaluate(async (style) => {
      const host = document.createElement('div');
      host.style.cssText = style;
      document.body.append(host);
      const viewer = window.embed.createViewer(host);
      await viewer.load(
        window.embed.points({
          name: 'wells',
          x: [1, 2],
          y: [3, 4],
          crs: { kind: 'local', units: 'm' },
        }),
      );
      const [layerId = ''] = Object.keys(viewer.scene().layers);
      const events: ({ layerId: string; element: number } | null)[] = [];
      viewer.on('selection', (selection) => {
        events.push(
          selection === null ? null : { layerId: selection.layerId, element: selection.element },
        );
      });
      viewer.dispatch({ type: 'setSelection', selection: { layerId, element: 1 } });
      viewer.dispatch({ type: 'setSelection', selection: { layerId, element: 1 } });
      viewer.setViewMode('3d');
      viewer.dispatch({ type: 'setVerticalExaggeration', factor: 5 });
      viewer.dispatch({ type: 'setSelection', selection: { layerId, element: 0 } });
      viewer.dispatch({ type: 'setSelection', selection: null });
      viewer.dispatch({ type: 'setSelection', selection: null });
      viewer.dispose();
      return { layerId, events };
    }, HOST);
    expect(heard.events).toEqual([
      { layerId: heard.layerId, element: 1 },
      { layerId: heard.layerId, element: 0 },
      null,
    ]);
  });

  test('tells of the scene as it did, and nothing after the viewer was disposed; an event it does not have is a mistake', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const seen = await page.evaluate(async (style) => {
      const { createEngine, createViewer, points } = window.embed;
      const engine = createEngine();
      const host = document.createElement('div');
      host.style.cssText = style;
      document.body.append(host);
      const viewer = createViewer(host, { engine });
      let scenes = 0;
      let datasets = 0;
      viewer.on('scene', () => {
        scenes += 1;
      });
      viewer.on('datasets', () => {
        datasets += 1;
      });
      viewer.dispatch({ type: 'setVerticalExaggeration', factor: 5 });
      const during = scenes;
      viewer.dispose();
      // What happens to the engine after the viewer is gone is not told to it.
      await engine.load(
        points({ name: 'late', x: [1], y: [2], crs: { kind: 'local', units: 'm' } }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      engine.dispose();
      let refused = '';
      const other = createViewer(host);
      try {
        (other.on as (event: string, listener: () => void) => unknown)('pointer', () => undefined);
      } catch (error) {
        refused = error instanceof RangeError ? error.message : String(error);
      }
      other.dispose();
      return { during, scenes, datasets, refused };
    }, HOST);
    expect(seen).toEqual({
      during: 1,
      scenes: 1,
      datasets: 0,
      refused: 'The viewer has no event "pointer": it has "scene", "datasets" and "selection".',
    });
  });
});

test.describe('a viewer in a box of a page', () => {
  test('makes a picture when it is asked for in the very frame that exportable() says it can, and does not fail for a map that has no size yet', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    // `onExportable` is called as the viewer's update ends, in the frame in which its renderer is made: the browser has not told the renderer the size of the map yet.
    const outcome = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const box = document.createElement('div');
          box.style.cssText = 'width: 600px; height: 400px';
          document.body.append(box);
          const viewer = window.embed.createViewer(box);
          let asked = false;
          viewer.onExportable((available) => {
            if (!available || asked) {
              return;
            }
            asked = true;
            viewer.exportPng({ widthPx: 300, heightPx: 200, dpi: 96, legend: false }).then(
              (blob) => {
                resolve(`made ${String(blob.size > 0)}`);
              },
              (error: unknown) => {
                resolve(`${(error as Error).name}: ${(error as Error).message}`);
              },
            );
          });
          void viewer.load(
            window.embed.points({
              name: 'wells',
              x: [1, 2, 3],
              y: [4, 5, 6],
              crs: { kind: 'local', units: 'm' },
            }),
          );
        }),
    );
    expect(outcome).toBe('made true');
  });

  test('says it is not ready, after a wait, for a picture of a map that was shown and is not now, and has no size', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    await page.evaluate(async () => {
      const box = document.createElement('div');
      box.id = 'box';
      box.style.cssText = 'width: 600px; height: 400px';
      document.body.append(box);
      const viewer = window.embed.createViewer(box);
      await viewer.load(
        window.embed.points({
          name: 'wells',
          x: [1, 2, 3],
          y: [4, 5, 6],
          crs: { kind: 'local', units: 'm' },
        }),
      );
    });
    // Drawn at a size: then the box is hidden, and the renderer is told that the map has none.
    await expect.poll(() => page.locator('#box canvas').boundingBox()).not.toBeNull();
    await page.locator('#box').evaluate((box) => {
      box.style.display = 'none';
    });
    await expect.poll(() => page.locator('#box canvas').boundingBox()).toBeNull();
    const outcome = await page.evaluate(async () => {
      const viewer = document.querySelector('#box karmania-viewer') as unknown as {
        exportPng: (options: object) => Promise<Blob>;
      };
      const started = performance.now();
      try {
        await viewer.exportPng({ widthPx: 300, heightPx: 200, dpi: 96, legend: false });
        return { result: 'made', waited: 0 };
      } catch (error) {
        const code = (error as { code?: string }).code;
        return {
          result: code === undefined ? (error as Error).name : `${(error as Error).name} ${code}`,
          waited: performance.now() - started,
        };
      }
    });
    expect(outcome.result).toBe('ExportError not_ready');
    // It waited for the map (about two seconds), and did not fail at once.
    expect(outcome.waited).toBeGreaterThan(1500);
  });

  test('opens its export dialog in the very frame that exportable() says it can, and has the preview of it, with no error', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/embed.html');
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.id = 'box';
      box.style.cssText = 'width: 800px; height: 600px';
      document.body.append(box);
      const viewer = window.embed.createViewer(box);
      let asked = false;
      viewer.onExportable((available) => {
        if (available && !asked) {
          asked = true;
          viewer.openExport();
        }
      });
      void viewer.load(
        window.embed.points({
          name: 'wells',
          x: [1, 2, 3],
          y: [4, 5, 6],
          crs: { kind: 'local', units: 'm' },
        }),
      );
    });
    await expect(page.locator('#box karmania-export-dialog .frame canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('says the map was taken away, for a picture that waited for the map and the viewer was taken out meanwhile', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    const outcome = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const box = document.createElement('div');
          box.style.cssText = 'width: 600px; height: 400px';
          document.body.append(box);
          const viewer = window.embed.createViewer(box);
          let asked = false;
          viewer.onExportable((available) => {
            if (!available || asked) {
              return;
            }
            asked = true;
            // Asked in the frame in which the renderer is made, so it waits for the map's size; the viewer is taken out before the wait is over.
            viewer.exportPng({ widthPx: 300, heightPx: 200, dpi: 96, legend: false }).then(
              () => {
                resolve('made');
              },
              (error: unknown) => {
                resolve(
                  `${(error as Error).name} ${(error as { code?: string }).code ?? (error as Error).message}`,
                );
              },
            );
            viewer.dispose();
          });
          void viewer.load(
            window.embed.points({
              name: 'wells',
              x: [1, 2, 3],
              y: [4, 5, 6],
              crs: { kind: 'local', units: 'm' },
            }),
          );
        }),
    );
    expect(outcome).toBe('ExportError interrupted');
  });

  test('keeps its panel to what its own box allows, and follows the box and not the window', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    // The widest panel was kept from an earlier visit; the window is 1280 wide, which would allow it (half of the window, up to 640).
    const first = await page.evaluate(async () => {
      localStorage.setItem(
        'karmania.panel',
        JSON.stringify({ collapsed: false, tab: 'legend', width: 640 }),
      );
      const box = document.createElement('div');
      box.id = 'box';
      box.style.cssText = 'width: 600px; height: 400px';
      document.body.append(box);
      window.embed.createViewer(box);
      const element = box.querySelector('karmania-viewer');
      await (element as InstanceType<typeof window.embed.KarmaniaViewer>).updateComplete;
      return element?.shadowRoot?.querySelector('karmania-panel')?.getBoundingClientRect().width;
    });
    // At the viewer's first render already: it is not made for the window's width and then corrected.
    expect(first).toBe(300);
    const panel = page.locator('#box karmania-panel');
    const width = async (): Promise<number | undefined> => (await panel.boundingBox())?.width;
    // Half of the box.
    await expect.poll(width).toBe(300);
    // The box grows and the window does not: the panel may be wider, up to half of the box.
    await page.locator('#box').evaluate((box) => {
      box.style.width = '1000px';
    });
    await expect.poll(width).toBe(500);
    // The box is narrower than the panel's least: the least wins.
    await page.locator('#box').evaluate((box) => {
      box.style.width = '400px';
    });
    await expect.poll(width).toBe(280);
  });

  test('refuses files dropped in its own box, where nothing takes them, and leaves the page outside it alone', async ({
    page,
  }) => {
    await page.goto('/embed.html');
    await page.evaluate(() => {
      const outside = document.createElement('div');
      outside.id = 'outside';
      outside.style.cssText = 'width: 100px; height: 40px';
      const box = document.createElement('div');
      box.id = 'box';
      box.style.cssText = 'width: 800px; height: 500px';
      document.body.append(outside, box);
      window.embed.createViewer(box);
    });
    /** Whether a drag of a file over `selector` was taken (its default prevented), and what it said would happen. */
    const fire = (selector: string, type: 'dragover' | 'drop') =>
      page.locator(selector).evaluate((element, eventType) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File(['x,y\n1,2\n'], 'points.csv', { type: 'text/csv' }));
        const event = new DragEvent(eventType, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer,
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }, type);
    // In the box, off the map: refused.
    for (const type of ['dragover', 'drop'] as const) {
      expect(await fire('#box karmania-panel', type), `${type} on the panel`).toBe(true);
    }
    // Outside the box, the page's business: the viewer does not touch it.
    for (const type of ['dragover', 'drop'] as const) {
      expect(await fire('#outside', type), `${type} outside`).toBe(false);
      expect(await fire('body', type), `${type} on the body`).toBe(false);
    }
  });
});
