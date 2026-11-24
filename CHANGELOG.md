# Changelog

What changed in each release, newest first. The notes of a release on GitHub are its entry here.

## 0.2.1 - 2026-11-24

A small release on top of 0.2.0: one fix to the interface, and a README that shows the app. How data is read, checked, drawn and exported has not changed.

### What changed

- **The icon of an icon-only button is now in the middle of it.** A button that has an icon and no words (the four navigation buttons at the bottom right of the map, the button that collapses the panel, and the others like them) drew its icon 4 px to the left of the middle: the empty text of the button was hidden but still took the 8 px gap beside the icon. It is taken out of the row now. Two browser tests measure it: one over every icon-only button of the component gallery, in every variant and size, and one over the four navigation buttons. Both fail without the fix.
- **The README shows the app.** It opens with a picture of a 3D block model and four more, each saying what it shows and what it is for (block models, meshes, contour lines, and a PNG export), and it has a new section, "Try it with sample data". The sample is **Synthetic mountains**, a made-up region of 30 km by 30 km with a block model, rivers, a terrain mesh and two grids (14 MB), in a repository of its own, [karmania-map-viewer-sample-datasets](https://github.com/SupernovifieD/karmania-map-viewer-sample-datasets), with a README that says how to bring each file into Karmania. It is kept apart so that this repository stays small.

### Repository

The history of this repository was rewritten on 2026-11-24 to take out the reference pictures of the screenshot tests and the maintainer's working notes, which had been committed for a while and removed later but stayed in the history (the repository was about 62 MB; a clone is now about 5 MB, with the pictures of the README). The code did not change, but every commit has a new hash, and the tags `v0.1.0` and `v0.2.0` point at the rewritten commits. If you cloned it before, clone it again rather than pulling into the old clone.

### Formats

The same as 0.2.0.

### Checked by

903 Rust tests, 1,980 unit tests of the packages, 1,386 browser tests (two more than in 0.2.0: the two that measure the icons) and 175 accessibility checks (axe) with nothing allowed through, all passing in the continuous integration on GitHub, and `pnpm check` on this machine on the code of this release.

### Limits to know about

- The limits of 0.2.0, below, still hold.
- **The screenshot tests were not run for this release.** They need Docker, which was not running, and the continuous integration does not run them. Their reference pictures are kept on each machine, and none has been compared with the centred icons: every picture that has an icon-only button changes by 4 px, so take them again (`pnpm test:visual:update`) and look at them before relying on them.

### Running it

The same as 0.2.0: see "Setting up" in the README.

Licence: Apache 2.0. The code and data that Karmania includes have licences of their own, listed in `THIRD_PARTY_NOTICES.md`.

## 0.2.0 - 2026-11-21

This release completes Phase 2: drawing maps. You can bring in files, see them on a map in 2D or 3D, colour and order the layers, make contour lines, click a feature to see what it is, and export the map as a PNG picture with its legend. The viewer can also be put in another page. As before, Karmania never invents a value: everything on the map is a value it was given, or one converted, triangulated, contoured or sorted into classes from it.

### What it does

- **Coordinate systems.** The import wizard finds an EPSG code by its number or its name, and the Data tab shows the name and unit with the code. Coordinates that could not be longitudes and latitudes are reported. A map is drawn in one coordinate system, chosen by the first dataset that can be drawn (a geographic dataset gets the WGS 84 / UTM zone of its centre, and a note says which). You can change it from the bottom left of the map, and the dialog lists what would start or stop being drawn. Other datasets are converted to it first, where that can be done (see the limits below). Heights are never converted.
- **Maps in 2D and 3D.** Points, lines, polygons, meshes, grids (each cell drawn on its own, never blurred into its neighbours) and block models. The 2D view looks straight down: pan, zoom and turn, nothing tilts. The 3D view is a perspective view you can orbit, pan and zoom, with the heights exaggerated 2, 3, 5 or 10 times if you want (a choice in the app's toolbar). There is a north arrow that turns with the map (a click puts north up), a scale bar in 2D (not on a map in longitude and latitude), zoom buttons, and, in 2D, the place under the pointer with the map's coordinate system. The map, the legend and the dialogs can all be used with the keyboard.
- **Legend.** Layers in an order you choose (the top of the list is drawn on top), in groups, shown or hidden. A layer is one colour, or coloured by a column in classes (equal intervals, quantiles, natural breaks or categories) with a colour ramp you choose, and has its own opacity, point size or line width. A layer that cannot be drawn says why and what to do.
- **Contours.** Contour lines from a grid (by a column) or from a mesh (by its heights), at an interval you choose. They are a dataset of their own: under their source in the Data tab, and in the legend as a layer just above it, drawn over it.
- **Identify.** Click a feature to see its attributes. "Show in table" finds its row, and choosing a row of the table marks the feature on the map.
- **Export PNG.** The map with its legend beside it, the north arrow and, in 2D, the scale bar. Choose the size (as the map is on screen, A4, A3 or your own) and 96, 150 or 300 dpi, which is written into the file. The same map and options give the same file in the same browser. A picture too large for the computer is refused, with the reason.
- **Embedding.** `createViewer` puts the viewer in a page; two viewers can share a page, and `dispose` frees what the viewer made. It works under a strict content security policy. See `docs/embedding.md`.
- **Findings.** New ones for drawing, converting coordinates, classes and contours, each in plain language with a hint, a count and examples, as before. All 125 are listed in `docs/validation-codes.md`.

### Formats

The same as 0.1.0: CSV and other delimited text (points, lines, block models), GeoJSON (points, lines, polygons), ESRI ASCII grid (`.asc`), OBJ (triangle meshes), and `.prj` files for the coordinate system. The README lists the rules that hold for all of them.

### How fast

Measured in a real browser, on a Mac with Intel Iris Plus graphics, on the files made by `scripts/generate-fixtures`. Where a range is given it is over the last runs (the machine was not quiet in some of them).

| What | Time |
| --- | --- |
| 1,000,000 points: loaded to the first picture | 0.23 to 0.28 s |
| 1,000,000 points: panning, zooming and turning | median frame 16.7 ms, 95th percentile 18.6 ms |
| Grid of 4,000,000 cells: loaded to the first picture | 0.47 to 0.51 s |
| Grid of 4,000,000 cells: new classes on screen | 0.17 to 0.21 s |
| Grid of 4,000,000 cells: 20 contour levels made | 1.85 to 2.06 s |
| Model of 1,000,000 blocks: loaded to the first picture | 0.32 to 0.38 s |
| Model of 1,000,000 blocks: orbiting in 3D | 95th percentile 17.3 to 18.7 ms |
| Export at A4, 300 dpi (3,508 x 2,480) | 0.71 to 0.88 s |

The three places where a goal was missed are under "Limits to know about".

### Checked by

903 Rust tests, 1,980 unit tests of the packages (one timing test more runs only when asked for), 1,384 browser tests, 207 screenshot tests (the states of the page at three window sizes, and the map's own pictures) in light and dark, and 175 accessibility checks (axe) with nothing allowed through, all passing on the code of this release. Build sizes (compressed): the Rust part as WebAssembly about 750 kB (253 kB in 0.1.0: it now knows the EPSG coordinate systems), the app's JavaScript about 261 kB.

### Limits to know about

- Only Chromium has been tested, and the map needs a browser that gives the page WebGL 2. Without it the map area says that it cannot draw.
- Three goals of speed were missed, and were accepted for this release: the first moments of the page can hold the browser for longer than the goal of 50 ms (50 to 67 ms in the best runs, up to 109 ms when the computer was busy); making the A4 picture at 300 dpi held the page for one task of 54 ms in two of four runs (the goal is 50); and 20 contour levels on 4,000,000 cells took up to 2.06 s (the goal is 2 s). The first picture after the computer has been left for a while can also hold the page for a moment: a task of 197 ms was seen in the export, and one of 1.2 s when the first million points were drawn, each once, probably while the browser prepares the graphics card (that was not shown).
- A block model is drawn only in the map's own coordinate system. A local grid and an EPSG system cannot be drawn together, and two local grids are taken to be the same grid.
- Lines and the edges of polygons are straight between their converted corners; long edges are not divided up to follow the curve of the Earth.
- Heights are drawn as given. A local grid in feet drawn on a map in metres has its horizontal positions scaled but not its heights, and the note on the dataset says so; in 3D the heights may look stretched if they are in feet.
- The north arrow shows the north of the map's grid, not true north.
- Natural breaks are found from an evenly spaced sample of at most 10,000 values when a column has more; the counts are of every value, and the legend says so in a tooltip on its lines.
- A polygon with a very large number of corners (about 100,000) can take several seconds to prepare when its outline is a smooth curve (a circle of 100,000 corners took 4.3 s, measured outside the browser), and a fraction of a second when it is ragged like a coastline. The work is done in a worker, not on the page.
- There is no way yet to save a map or open it again, no undo, and no export other than PNG.
- Nothing is published to npm: the viewer is a folder made by the build, or an archive (a tarball) made from it (`docs/embedding.md`), and the packages are marked private.
- A viewer that shares an engine with another shows everything the engine has kept, including the other viewer's contour lines; it does not show an import that is still being reviewed.

### Running it

See "Setting up" in the README. In short: `pnpm install`, `pnpm build:wasm`, then `pnpm --filter @karmania/app dev`. `pnpm --filter @karmania/viewer build` makes the viewer as a library.

Licence: Apache 2.0. The code and data that Karmania includes have licences of their own, listed in `THIRD_PARTY_NOTICES.md`.

## 0.1.0 - 2026-10-30

This is the first release, and it completes Phase 1: getting data in and checking it. You can open the app, bring in files, see what was found in them, and look through the rows of what was loaded. **Nothing is drawn yet:** the map area says so. Drawing maps and exporting images are for later phases.

### What it does

- **Import wizard.** Choose or drop files. The wizard goes through five steps: File, Mapping (what each column is), Nodata (which values mean "no value"), CRS (the coordinate system) and Review. It previews the file first, shows progress while it imports, and says what it found before anything is loaded.
- **Findings.** Every problem, odd thing and note is reported in plain language, with a hint about what to do, a count, and where it happened. Nothing is fixed silently. All 96 are listed in `docs/validation-codes.md`.
- **Data tab.** The loaded datasets, a summary of the selected one (kind, size, coordinate system, extent, columns, warnings), and a table of its rows that stays quick with millions of rows and works with the keyboard.

### Formats

CSV and other delimited text (points, lines, block models), GeoJSON (points, lines, polygons), ESRI ASCII grid (`.asc`), OBJ (triangle meshes), and `.prj` files for the coordinate system. The README lists the rules that hold for all of them.

### How fast

Measured in a real browser on the files made by `scripts/generate-fixtures`:

| File                               | Preview     | Import (with checking) | Table ready | Scroll to the last row |
| ---------------------------------- | ----------- | ---------------------- | ----------- | ---------------------- |
| CSV, 1,000,000 points, 45 MB       | about 0.2 s | about 1.6 s            | about 0.1 s | about 0.03 s           |
| ASCII grid, 4,000,000 cells, 18 MB | about 0.09 s | about 0.4 s           | about 0.1 s | about 0.03 s           |

In the final six runs the page was never blocked for more than 50 ms (an earlier run had one pause of 51 ms in a cold browser). Details are in `docs/perf.md`.

### Checked by

590 Rust tests, 608 browser tests, 96 screenshot states at three window sizes in light and dark, and 97 accessibility checks (axe) with nothing allowed through, all passing before the version number was set.

### Limits to know about

- Only Chromium has been tested.
- A dataset carries its coordinate system as a label. Nothing is reprojected, and only EPSG:4326 is checked against what its numbers allow.
- The table sets column widths from the first 200 rows, so a longer value further down is cut, and its tooltip shows it whole.
- A very large GeoJSON file needs about twenty times its size in memory, and memory in the browser was not measured.
- Past 8 million rows the scroll bar cannot stop at every row (the keyboard can).
- A browser test of the table failed once in CI without a cause being found, and passed in 100 repeated runs; one more run failed once locally and passed when repeated. `docs/decisions.md` has the first.

### Running it

See "Setting up" in the README. In short: `pnpm install`, `pnpm build:wasm`, then `pnpm --filter @karmania/app dev`.

Licence: Apache 2.0.
