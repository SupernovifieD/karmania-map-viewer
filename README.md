# karmania-map-viewer

Karmania is an open-source engine for geoscience map data: a reusable core that other software can embed. It takes data in six standard shapes (points, lines, polygons, meshes, regular grids and block models), checks it, does a small amount of deterministic processing, and will draw 2D and 3D maps with map furniture and export PNG images. It never invents values: every number it shows is either one it was given or a deterministic restatement of one.

## Where it stands

The work is in phases. **Phase 1, getting data in and checking it, is built.** You can open the app, bring in files, see what was found in them, and look through the rows of what was loaded. **Nothing is drawn yet:** the map area says so. Drawing maps and exporting images are for later phases.

What works today:

- **Import wizard.** Choose or drop files, and the wizard goes through five steps: File, Mapping (what each column is), Nodata (which values mean "no value"), CRS (the coordinate system) and Review. It previews the file first, runs the import with a progress bar, and says what it found before anything is loaded.
- **Findings.** Every problem, odd thing and note is a finding with a plain-language message, a hint about what to do, a count, and where it happened. Nothing is fixed silently: a skipped row or an assumed value is always reported. The full list is in [`docs/validation-codes.md`](docs/validation-codes.md).
- **Data tab.** The loaded datasets in a list, a summary of the selected one (kind, size, coordinate system, extent, columns, warnings), and a table of its rows that stays quick with millions of rows and can be used with the keyboard.

## Supported formats and their conventions

| What | Becomes | Notes |
| --- | --- | --- |
| CSV or other delimited text (comma, semicolon, tab or spaces) | Points, lines, or a block model | You say which column is X, Y and Z (the wizard suggests them from the header), and for lines which column says which line a row belongs to. |
| GeoJSON | Points, lines or polygons | A file with several kinds becomes one dataset for each. Properties become attribute columns. Polygon holes are kept. |
| ESRI ASCII grid (`.asc`) | A regular grid | The file lists the northern row first; the rows are turned so that the first is the southern one. A grid placed by its cell centres is moved to its corner. |
| OBJ | A triangle mesh | Faces with more than three corners are split into triangles. Normals and texture coordinates are ignored. |
| `.prj` (a projection file beside a data file with the same name) | The coordinate system | Read for an EPSG code. |

The rules that hold for all of them:

- **Text.** UTF-8 (with or without a byte order mark) and UTF-16 are read. Text that is neither is read as Windows-1252, with a warning. A semicolon-separated file may use a decimal comma.
- **No data.** Empty cells, `NA`, `N/A`, `null`, `NaN`, `-`, `*` and numbers such as `-999` or `-9999` can be marked as "no value" in the Nodata step. They become empty values, and are counted.
- **Coordinates are numbers in the file's own units.** Rows with an empty or unreadable coordinate either stop the import or are skipped with a count, as you choose.
- **Coordinate system.** A dataset carries a coordinate system as a label: an EPSG code, or a local grid with its units. Phase 1 does not know what a code means and never reprojects; it keeps what was given or chosen and says so. The one exception is EPSG:4326 (WGS 84, longitude and latitude), for which it checks that the coordinates could be longitudes and latitudes, and says when X and Y look swapped.
- **Numbering.** Anything shown to a person that numbers things starts at 1: lines of a file (the header is line 1), and the rows, lines, polygons, triangles and cells in the data table. Inside the engine everything starts at 0.
- **Limits.** A dataset can hold up to 134,217,728 elements. Very large GeoJSON files need a lot of memory, about twenty times their size.

The columns that say what each row is (X, Y and Z for points, `line #` for lines, `i` and `j` for grids, and so on) come first in the data table, then the columns from the file.

## Setting up

You need [Rust](https://rustup.rs) (the version is pinned in `rust-toolchain.toml`, and `rustup` installs it), Node (pinned in `.nvmrc`), pnpm (the version is in `package.json`), and [wasm-pack](https://github.com/drager/wasm-pack) (`cargo install wasm-pack`).

```
pnpm install
pnpm build:wasm                    # builds the Rust code for the browser into packages/engine/wasm (not committed)
pnpm --filter @karmania/app dev    # runs the app; open the address it prints
```

The component gallery, every component in every state, is at `/gallery.html` on the same address.

`scripts/build-wasm --dev` is a faster, unoptimised build for when you are changing Rust code. Use the default one for the browser tests and for anything you time: some of the tests import very large files, which the unoptimised build is too slow for.

## Testing

```
pnpm check        # formatting, lints, type checks, and every Rust and TypeScript unit test
pnpm test:e2e     # the browser tests; needs a browser: pnpm --filter @karmania/engine exec playwright install chromium
pnpm test:visual  # the screenshot tests, which need Docker running (see below)
pnpm test:axe     # an accessibility check of every screenshot state, in both themes
pnpm perf         # how long the large files take, in a browser (writes them first)
```

- `pnpm check` is what runs before every commit, and in the continuous integration on GitHub, which also runs the browser, screenshot and accessibility tests.
- The screenshot tests use the browser in the official Playwright Docker image, so the pictures are the same on every machine. `pnpm test:visual:update` takes them again; look at the new pictures before committing them.
- `pnpm perf` needs a quiet machine. It uses two large files that `scripts/generate-fixtures` writes into `fixtures/generated/` (not committed). The results are in [`docs/perf.md`](docs/perf.md).
- A few timing tests for the Rust code only run when asked for; `docs/perf.md` says how.

## How it is built

```
files ──► @karmania/app        the page: import wizard, Data tab (Lit web components)
              │  uses            @karmania/ui has the components: tabs, dialog, table, ...
              ▼
          @karmania/engine     a TypeScript API that runs the Rust code in a Web Worker
              │  messages
              ▼
          karmania-wasm        the Rust code compiled to WebAssembly
              │
        ┌─────┴──────┐
        ▼            ▼
   karmania-io    karmania-core
   readers: CSV,  datasets, tables, the coordinate system label,
   GeoJSON, ASCII validation, and the findings
   grid, OBJ, .prj
```

- **`karmania-core`** is the heart: the six kinds of dataset, their tables of attributes, validation, and findings. It knows nothing about files.
- **`karmania-io`** reads files into datasets, and turns what is wrong with them into findings. Large files are read in steps so the page stays alive.
- **`karmania-wasm`** is the thin layer that lets the browser call the two.
- **`@karmania/engine`** starts a worker, sends it files and asks, and hands back datasets, summaries and pages of rows. A file never blocks the page, and a table asks only for the rows in view.
- **`@karmania/ui`** is the set of components and the design tokens (colours, sizes, light and dark themes). The app is built from them.
- **`@karmania/app`** is the page itself.

A few principles run through all of it: data problems are findings and never crashes; output is the same every time for the same input; and the interface is checked by tests that look at the page, at three window sizes from 1024 x 640 up, in both the light and the dark theme.

## Where to look next

| | |
| --- | --- |
| [`docs/roadmap/phase-1.md`](docs/roadmap/phase-1.md) | The steps of Phase 1. |
| [`docs/decisions.md`](docs/decisions.md) | Every decision made along the way, and why. |
| [`docs/validation-codes.md`](docs/validation-codes.md) | Every finding: its message, its hint, and an example. |
| [`docs/perf.md`](docs/perf.md) | How fast it is, measured. |
| [`docs/conventions.md`](docs/conventions.md) | The rules for changing the code. |
| [`docs/design-tokens.md`](docs/design-tokens.md) | The colours, sizes and spacing the interface is made from. |
| [`docs/dependencies.md`](docs/dependencies.md) | What it depends on, and the licence of each. |

## Licence

Apache 2.0. See `LICENSE`.
