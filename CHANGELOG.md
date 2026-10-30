# Changelog

What changed in each release, newest first. The notes of a release on GitHub are its entry here.

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
