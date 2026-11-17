# Embedding the viewer

Karmania's viewer is a map of geoscience data (points, lines, polygons, grids, meshes and block models) in 2D and 3D, with a legend, a table of the data, an import
wizard and PNG export. It runs in the page, in the browser: nothing is sent anywhere. This guide is for the developer of a page that puts it in.

- [What you get](#what-you-get)
- [A page](#a-page)
- [Where the files go](#where-the-files-go)
- [createViewer and its options](#createviewer-and-its-options)
- [Putting data in](#putting-data-in)
- [The scene, the view and the events](#the-scene-the-view-and-the-events)
- [Exporting a PNG](#exporting-a-png)
- [More than one viewer](#more-than-one-viewer)
- [Content Security Policy](#content-security-policy)
- [Taking a viewer out of the page](#taking-a-viewer-out-of-the-page)
- [TypeScript](#typescript)
- [Licences, and the EPSG data](#licences-and-the-epsg-data)
- [What does not work](#what-does-not-work)

## What you get

`pnpm --filter @karmania/viewer build` makes the folder `packages/viewer/dist`, and `pnpm pack` in `packages/viewer` makes a tarball of it (about 2.3 MB). Nothing is published to a
registry: you take the folder, or the tarball, and serve it with your page.

| File                                | What it is                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `karmania-viewer.js`                | The viewer, as one ES module (about 1 MB; Lit and three.js are in it, so the page needs no bundler).                            |
| `style.css`                         | The colours, spacing and type of the interface (light and dark), and the font Inter. It styles nothing of your page.            |
| `assets/worker-entry-*.js`          | The engine's worker, which reads files and prepares data off the page's thread.                                                 |
| `assets/karmania_wasm_bg-*.wasm`    | The engine's WebAssembly module (5.7 MB; the file readers, the coordinate systems, the contours).                               |
| `assets/inter-*.woff2`, `OFL.txt`   | The font, and its licence.                                                                                                      |
| `karmania-viewer.d.ts`, `types/`    | The TypeScript declarations.                                                                                                    |
| `THIRD_PARTY_NOTICES.md`            | The licences of what is in the files above. Keep it with them.                                                                  |
| `LICENSE`                         | Karmania's own licence (Apache-2.0).                                                                                             |

## A page

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>My page</title>
    <link rel="stylesheet" href="/vendor/karmania/style.css" />
    <link rel="stylesheet" href="/page.css" />
  </head>
  <body>
    <div id="map"></div>
    <script type="module" src="/page.js"></script>
  </body>
</html>
```

```css
/* page.css: the viewer is as big as the element it is put in, so the element has a size. */
#map {
  width: 100%;
  height: 600px;
}
```

```ts
// page.js
import { createViewer, points } from '/vendor/karmania/karmania-viewer.js';

const container = document.querySelector<HTMLElement>('#map');
if (container === null) {
  throw new Error('The page has no #map.');
}
const viewer = createViewer(container);
await viewer.load(
  points({
    name: 'Wells',
    x: [100, 250, 400],
    y: [100, 300, 200],
    attributes: { depth: [10, 20, 30] },
    crs: { kind: 'local', units: 'm' },
  }),
);
```

The viewer shows the data as it arrives: it is listed in the Data tab, drawn on the map and in the Legend tab, and the camera goes to it.

## Where the files go

Anywhere on your site, in the folder structure they have (the module, `style.css` and `assets/` together). Every URL inside the files is found from where the file that has it is
(`import.meta.url`, and relative URLs in the style sheet), never from the root of the site, so `/vendor/karmania/`, `/static/viewer/1.2/` and `/` all work.

Two things the files need from the server:

- **`.wasm` as `application/wasm`.** A browser compiles WebAssembly as it arrives only if it is served with that type.
- **The same origin as the page.** The engine's worker is started from `assets/worker-entry-*.js`, and a browser does not start a worker from another origin. With the files on a CDN,
  `createViewer` works and the first `load` (or anything that starts the engine) rejects with `SecurityError: Failed to construct 'Worker'`. Serve the folder from your own origin,
  or from a path that your server proxies.

## createViewer and its options

```ts
import { createEngine, createViewer } from './karmania-viewer.js';

const container = document.createElement('div');
container.style.cssText = 'width: 800px; height: 500px';
document.body.append(container);

const viewer = createViewer(container, {
  // An engine of your own, so that several viewers (or your page) can have the same data. Without it the viewer makes one when `viewer.engine` is first read or data first arrives.
  engine: createEngine(),
  // false: no right panel; the map has the whole viewer, and your page changes layers with `dispatch`. Default true.
  panel: true,
  // false: no Import buttons, no drop of files on the map, no wizard (`openImport` then throws); data comes in with `load`, `importFiles` or the engine. Default true.
  importUi: true,
});
viewer.dispose();
```

- **The container has a size.** The viewer fills it: a container that is 0 high shows nothing. The panel's width is limited by the viewer's own width (at most half of it, up to 640 pixels, and at least 280, or all of the viewer where that is less: a viewer in so narrow a box has no room left for the map, so give it `panel: false`), not by the window's.
- **Theme.** The colours are tokens on `:root` (`style.css`). The viewer follows the system's light or dark setting; a page that wants one of them sets `data-theme="light"` or
  `data-theme="dark"` on `<html>`. The viewer has its own font, colour and background (Inter, from the tokens), so it looks the same on a page that has none of these.
- **The element.** `createViewer` puts a `<karmania-viewer>` element in the container; the function is the supported way to use it.

## Putting data in

Three ways, each giving the dataset the same life (listed in the Data tab, selected, drawn):

```ts
import { createViewer, grid, points } from './karmania-viewer.js';

declare const container: HTMLElement;
declare const files: readonly File[];
const viewer = createViewer(container);
const crs = { kind: 'epsg', code: 32631 } as const;

// 1. A dataset made with a builder (points, lines, polygons, grid, mesh, blocks). The arrays are taken, so an input is loaded once.
const result = await viewer.load(points({ name: 'Wells', x: [1, 2, 3], y: [4, 5, 6], crs }));
if (result.status === 'blocked') {
  console.warn(result.findings); // a problem with the data is a result, not a rejection
}
await viewer.load(
  grid({ name: 'Topography', origin: [0, 0, 0], spacing: [50, 50, 1], dims: [6, 6, 1], values: { elevation: Array.from({ length: 36 }, (_, i) => i) }, crs }),
);

// 2. The import wizard, on files (or the file picker if there are none): the person chooses what the columns mean.
viewer.openImport(files);
```

3. `importFiles(files, mapping)` imports a file with a mapping that the page gives, without the wizard (a data file and its sidecars, such as a `.prj`).

Files it reads: delimited text (`.csv`, `.tsv`, `.tab`, `.txt`), GeoJSON (`.geojson`, `.json`), ESRI ASCII grids (`.asc`) and OBJ meshes (`.obj`), and a `.prj` beside a data file for its coordinate system.

`viewer.engine` is the engine of the viewer. Read it to ask what is loaded (`viewer.engine.datasets()`), for the rows of a dataset, or to give it to another viewer.

## The scene, the view and the events

```ts
import { createViewer } from './karmania-viewer.js';

declare const container: HTMLElement;
const viewer = createViewer(container);

// The scene: a layer for each dataset, the camera, the legend, the selection.
const scene = viewer.scene();
console.log(scene.viewMode, Object.keys(scene.layers).length);

viewer.setViewMode('3d'); // keeps the centre and the heading
viewer.fit(); // the camera goes to the data
const [layerId] = Object.keys(scene.layers);
if (layerId !== undefined) {
  viewer.dispatch({ type: 'setVisible', layerId, visible: false });
}

// Events, by name. Each gives the function that stops listening.
const stop = viewer.on('scene', (next) => {
  console.log('the scene changed', next.viewMode);
});
viewer.on('datasets', (datasets) => {
  console.log(datasets.map((dataset) => dataset.name));
});
viewer.on('selection', (selection) => {
  console.log(selection); // the layer and element selected on the map, or null
});
stop();
```

`on` calls nothing for what was so before it: read `scene()`, `engine.datasets()` or `scene().selection` for that. An event that is not `scene`, `datasets` or `selection` throws a
`RangeError`. `exportable()` and `onExportable(listener)` say whether there is something drawn that can be exported.

## Exporting a PNG

```ts
import { createViewer } from './karmania-viewer.js';

declare const container: HTMLElement;
const viewer = createViewer(container);

const controller = new AbortController();
const blob = await viewer.exportPng(
  { widthPx: 3508, heightPx: 2480, dpi: 300, legend: true }, // A4 landscape at 300 dpi
  { signal: controller.signal, onProgress: (done) => console.log(`${Math.round(done * 100)} %`) },
);
const link = document.createElement('a');
link.href = URL.createObjectURL(blob);
link.download = 'map.png';
link.click();
URL.revokeObjectURL(link.href);
```

The errors that `exportPng` rejects with are exported, so that a page can tell one from another:

```ts
import { ComposeError, ExportError, ExportFontError, PngError, createViewer } from './karmania-viewer.js';

declare const container: HTMLElement;
const viewer = createViewer(container);

try {
  await viewer.exportPng({ widthPx: 20_000, heightPx: 100, dpi: 96, legend: false });
} catch (error) {
  if (error instanceof ExportError) {
    // `error.code` is an `ExportErrorCode`: 'busy', 'interrupted', 'context_lost', 'disposed', 'not_ready', 'too_large', 'point_size' or 'out_of_memory'.
    console.warn('The picture cannot be made:', error.code);
  } else if (error instanceof ComposeError || error instanceof ExportFontError || error instanceof PngError) {
    console.warn(error.message);
  } else {
    throw error; // the signal's reason, or a mistake of the page
  }
}
```

The picture is the map as it is on screen (the same centre, heading and view, and at least what is visible), in the light theme, with the north arrow, the scale bar in 2D and, with
`legend`, the legend to the right. The `dpi` is written into the file and is the scale the map's points, lines and furniture are drawn at (`dpi / 96`). The same scene and options give
the same bytes twice in a row in one browser. `viewer.openExport()` opens the dialog instead, with a preview.

Ask for a picture when `exportable()` says that there is something to export, or from `onExportable`. Asked in the very frame in which the map is first drawn, a picture waits for the map to have a size (two seconds at the most) and rejects with `not_ready` if it has none, which is a map that is not shown.

It rejects with an `Error` named `ExportError` (its `code`: `busy`, `interrupted` when the map was changed meanwhile, `context_lost`, `too_large` (the browser and the card allow up to 8,192
pixels a side), `point_size`, `out_of_memory`, `not_ready`, `disposed` when the viewer is taken out of the page during the export), `ComposeError`, `ExportFontError` (the font could not be loaded: see the policy below) or `PngError`, or with the signal's reason
if it is aborted. Nothing is exported before something is drawn.

## More than one viewer

Viewers on one page are independent: each has its own engine (and so its own worker and its own copy of the data) unless you give them one (below), and its own camera, styles, selection and listeners; what one does is not heard
by another's `on`, and taking one out leaves the others as they were.

To have the same data in two viewers, give both an engine:

```ts
import { createEngine, createViewer, points } from './karmania-viewer.js';

declare const left: HTMLElement;
declare const right: HTMLElement;
const engine = createEngine();
const a = createViewer(left, { engine });
const b = createViewer(right, { engine });
await a.load(points({ name: 'Wells', x: [1, 2], y: [3, 4], crs: { kind: 'local', units: 'm' } }));
// `b` shows it too: a viewer shows everything its engine holds, and each keeps its own camera, styling and selection.
console.log(b.engine === a.engine); // true
a.dispose();
b.dispose();
engine.dispose(); // the engine is the page's: a viewer does not end it
```

What is shared, and what you may not expect:

- **The panel's state** (its width, whether it is folded and the tab it is on) is kept in the browser's `localStorage` under `karmania.panel`: one preference of the page's origin, which
  every viewer reads when it starts and writes when it changes. Two viewers do not follow each other live; the last to write wins at the next start. A viewer made with `panel: false`
  neither reads nor writes it.
- **Contour lines are the engine's.** The lines that one viewer makes for a layer are datasets of the shared engine, and every viewer on it shows them, with the same settings: when one
  viewer turns the contours on, changes their interval or turns them off, the others follow. Each viewer keeps its own choice of whether they are shown, and the style of their layer.
- **A dialog is modal to the whole page.** The import wizard, the export dialog and the coordinate-system dialog are `<dialog>` elements shown with `showModal()`: while one is open,
  everything else on the page is inert (the other viewer too).
- **Dropping files** on a viewer's map imports them. A file dropped elsewhere in the viewer, where nothing takes it, is refused (the browser would otherwise open it in place of the page).
  What a drop does outside the viewer is your page's business: the viewer does not touch it.

## Content Security Policy

The viewer works under this policy, which is the smallest that it works under:

```
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; connect-src 'self'
```

(Your page adds what it needs itself: images, frames, forms. `default-src 'none'` above is a starting point, not a request.) Each part is needed, and a test takes each away in turn and
shows the viewer fail:

| Part                      | Why                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src 'self'`       | The page's module and the viewer's. It governs the engine's worker as well (`worker-src` falls back to it): a page that names `worker-src` has to give it `'self'`. |
| `'wasm-unsafe-eval'`      | The engine's WebAssembly module is compiled in the worker. It is not `'unsafe-eval'`: nothing is evaluated from text.                                    |
| `connect-src 'self'`      | The worker fetches the WebAssembly module (`fetch` is governed by `connect-src`).                                                                        |
| `style-src 'self'`        | The style sheets (`style.css` and yours). **No `'unsafe-inline'`**: the viewer writes no style as text; it sets styles through the element's CSSOM, which the policy does not govern. |
| `font-src 'self'`         | Inter, which the interface is set in and the export waits for (without it a picture cannot be made).                                                     |

Nothing is needed for images (the picture of an export is made on a canvas and given as a `blob:` download), frames, forms or the base of the page.

Send the policy on **every** answer of the site, the worker's script and the WebAssembly module included: a worker has the policy of the answer that gave its script, not the page's.

## Taking a viewer out of the page

```ts
import { createViewer } from './karmania-viewer.js';

declare const container: HTMLElement;
const viewer = createViewer(container);
viewer.dispose();
viewer.dispose(); // nothing happens the second time
```

`dispose()` takes the viewer out of the page and frees what it made: its engine and the engine's worker (not an engine that you gave it), its WebGL context, its observers and
listeners and its frames. Nothing else may be called after it, except `dispose` again and the function that `on` gave for stopping a listener. A test makes and disposes a viewer twice
and counts the workers, the WebGL contexts, the animation frames, the observers and the listeners that the page has before and after.

Two things that follow from it:

- **Moving a viewer's container in the document takes the viewer out of the page and puts it back**, and it then starts again: its layers are made again from what its engine holds, in their
  default styles, and a person's styling and selection are not kept (the contours come back, since the engine has the lines). Do not move the container of a viewer that is in use; make a new viewer in the new place instead.
- **A `load` or `importFiles` that is still running when the viewer is taken out shows nothing**: with an engine that you gave, the dataset is in the engine all the same; with the viewer's own,
  the call rejects, since the engine has been let go.

## TypeScript

`karmania-viewer.d.ts` has the types of everything that the module exports: `createViewer`, `Viewer`, `ViewerOptions`, `ViewerEvents`, the engine (`createEngine`, `Engine`), the builders
(`points`, `lines`, `polygons`, `grid`, `mesh`, `blocks`) and the types of what goes in and out (`SceneDocument`, `Command`, `Summary`, `LoadResult`, and others), and the errors (`EngineError`, `EngineDisposedError`, `ExportError` with its `ExportErrorCode`, `ComposeError`, `ExportFontError`, `PngError`). It needs the DOM library, and
the types of `lit` (a dependency of the package, which your installer brings). The examples in this guide are checked against these declarations by a test, so that they do not drift.

## Licences, and the EPSG data

Karmania's own code is under the Apache License 2.0 (`LICENSE`). **`THIRD_PARTY_NOTICES.md` goes with the files**: it has the licences of three.js (MIT), Lit (BSD-3-Clause), the
Lucide icons (ISC), Inter (SIL OFL 1.1, also as `assets/OFL.txt`), the Rust crates in the WebAssembly module, and the colour data. Keep it, and the licence comments at the top of the
JavaScript, where they are.

**The WebAssembly module holds the definitions of about 6,000 coordinate systems, by their EPSG codes, which are those of the EPSG Dataset. Ownership of the EPSG Dataset by IOGP (the
International Association of Oil & Gas Producers) is acknowledged.** The EPSG Dataset is published by IOGP at <https://epsg.org>, and its terms of use
(<https://epsg.org/terms-of-use.html>) apply to the definitions in this build, and to anyone who is given them: you are told here that they do. Read them before you redistribute a
build. Karmania does not change a value of the dataset, and attributes to EPSG nothing that it computes itself. The wording and what it rests on are in `THIRD_PARTY_NOTICES.md`.

## What does not work

- **Files on another origin than the page's**: the worker cannot start (see above).
- **A browser without WebGL 2**: the map area says that it cannot draw, and nothing is drawn.
- **A container with no height**: the viewer is as tall as the container.
- **Nothing is published to npm**: a registry package is a decision that has not been made. You get the folder or the tarball from the build.
