# Performance

Measurements for the performance targets in the Phase 1 brief. Each entry says
what was measured, on what, and how to repeat it. Numbers are from one
development laptop, not a benchmark lab, so read them as an order of magnitude.

Machine used so far: MacBook Air, Intel Core i5-1030NG7 at 1.1 GHz, macOS 15.8,
rustc 1.99.1, release build.

## Validating one million points (step 2.22)

The brief's target is import plus validation of a 1,000,000-row CSV in under 5 s.
This entry covers validation alone; reading and importing files are measured in the entries below.

What was validated: 1,000,000 points with X, Y and Z and five numeric attribute
columns, in EPSG:32640. The coordinates are pseudo-random inside one UTM zone from
a fixed seed, so the data are the same on every run. Building the dataset is not
timed.

Three runs of `validate()` on a release build:

| Run | Total |
| --- | --- |
| 1 | 298 ms |
| 2 | 342 ms |
| 3 | 294 ms |

By group (range over the three runs, each group timed on its own):

| Group | Time | What dominates |
| --- | --- | --- |
| structure | under 0.1 ms | Constant-time checks on a points dataset |
| values | 244 to 359 ms | Finding duplicate points by ordering all points |
| crs | 0.1 ms | Only whether a coordinate system is set |

The first measurement, in step 2.22, also converted 1,004 sample coordinates with
`proj4rs` in the `crs` group (6 to 7 ms). That check was removed in step 3.25a, so
the numbers above are the current ones.

So validation uses about 6% of the 5 s budget. Not measured yet: a dataset with
very many exact duplicate points, a dataset at the 134,217,728-element limit,
and validation inside WebAssembly (milestone M4, which will be slower than
native).

To repeat:

```
cargo test -p karmania-core --release -- --ignored --nocapture one_million_points
```

The test is ignored in normal runs. In a release build it fails if validation
takes 5 s or more.

## Reading large files (step 3.24)

The brief's target is import plus validation of a 1,000,000-row CSV in under 5 s.
Together with the validation entry above, the first row is that measurement for
native code; WebAssembly is slower and is measured in the entries for steps 4.14 and
10.3.

What was read: generated files from a fixed seed (building them is not timed), in
a release build, on the machine named at the top. "Peak memory" is the largest
resident set of the whole test process, so it includes the file text held in
memory and the dataset made from it.

| Read | Size | Time | Peak memory |
| --- | --- | --- | --- |
| CSV points, 1,000,000 rows, X Y Z and 5 attributes | 46.0 MB | 824 ms (plus 252 ms to validate: 1,076 ms in all) | 158 MB |
| The same CSV, as an `ImportJob` in 20 steps of 50,000 rows | 46.0 MB | 755 ms | 158 MB |
| CSV lines, 1,000,000 vertices in 10,000 lines | 33.1 MB | 1,285 ms | 142 MB |
| CSV block model, 1,000,000 blocks, dense, rows in random order | 27.7 MB | 789 ms | 165 MB |
| GeoJSON points, 200,000 features with 3 properties | 26.2 MB | 1,493 ms | 525 MB |
| ESRI ASCII grid, 3,000 x 3,000 cells | 33.4 MB | 382 ms | 126 MB |
| OBJ mesh, 500,000 vertices and 1,000,000 triangles | 29.7 MB | 271 ms | 81 MB |

Reading in steps costs nothing measurable over reading at once.

The preview (step 4.3) of the same 46.0 MB, 1,000,000-row CSV takes 54 ms, against
the brief's target of under 1 s: it decodes the text without copying it, reads only
the first rows and counts lines.

Things to know:

- GeoJSON is the memory-hungry format: about 20 times the size of the file, because
  the whole JSON document is held as a tree before the datasets are built. A
  100 MB GeoJSON file would need about 2 GB, and a WebAssembly module cannot go
  past 4 GB, so very large GeoJSON files will fail in the browser. If real files
  turn out to be that big, the fix is to read the features one at a time instead
  of building the tree (see the note in `docs/decisions.md`, step 3.12c).
- The CSV readers hold the whole file text, the coordinates and the attribute
  columns; the peak is about 3.4 times the file size for the points file.
- Lines are the slowest CSV kind because every row's line identifier is looked up
  in an ordered map.

Not measured yet: files at the 134,217,728-element limit, decimal-comma files,
files with many quoted fields, and the time to send a file into WebAssembly.

To repeat (one test per format; add `-- --exact <name>` to run just one):

```
cargo test -p karmania-io --release --test timing -- --ignored --nocapture
```

The tests are ignored in normal runs. In a release build each fails if its read
takes 5 s or more.

## A million rows inside WebAssembly (step 4.14)

The brief's targets are a preview in under 1 s and an import with validation in under
5 s for a 1,000,000-row CSV. This is the first measurement of both inside WebAssembly,
by loading the release module in Node (V8, the same engine as Chrome) on the machine
named at the top. The measurement in a browser, inside a worker with the wizard, is the
next entry.

What was read: a 45.4 MB CSV of 1,000,000 rows with X, Y, Z and five attributes,
generated from a fixed seed; the import runs in steps of 50,000 rows.

| Step | Time |
| --- | --- |
| Preview | 143 ms |
| Import with validation, in 22 steps | 1,736 ms |
| The longest single step | 535 ms |
| Two pages of 256 rows (the start and the end) | 2 ms |
| Building 1,000,000 points from typed arrays, with validation | 304 ms |

Process memory at the end, for Node, the file and the loaded datasets together: 530 MB.

So the import uses about a third of its 5 s budget and the preview about a seventh of
its 1 s. The longest step is the validation of the million points (the check for
duplicate points sorts them); parsing steps of 50,000 rows are much shorter. All of it
runs in a worker in the engine, so even a half-second step does not touch the main
thread; the brief's limit of 50 ms per main-thread task is about what the main thread
does with the results, not the kernel.

To repeat (the test runs only when asked for):

```
pnpm build:wasm
KARMANIA_TIMING=1 pnpm --filter @karmania/engine exec vitest run kernel-timing --reporter=verbose
```

The test fails if the preview takes 1 s or more or the import 5 s or more.

## The large files in a browser (step 10.3)

The same two targets, and what a person would feel, measured in the real app: Chromium
(headless, from Playwright 1.64.1) running the built page, the engine in its worker, the release
WebAssembly module, and the wizard taking the files through every step. Machine as above (8 GB),
Node 24.22.1.

What was read: two files from `scripts/generate-fixtures` (made from a fixed seed, not committed):

- `points-1m.csv`, 45.4 MB: 1,000,000 points with X, Y, Z and five attributes;
- `grid-4m.asc`, 18.0 MB: an ESRI ASCII grid of 2,000 x 2,000 cells, 4,000,000 in all, with a
  gap in the data at every 97th.

Each was taken through the wizard in six runs (in two sessions), each in a page of its own. Times are
the page's own clock, from the moment something is asked of the app to the moment the page shows it,
as the range over the six runs:

| | CSV, 1,000,000 points | ASCII grid, 4,000,000 cells | Limit |
| --- | --- | --- | --- |
| Preview: the files handed to the app until the file step shows what they are | 210 to 325 ms | 84 to 194 ms | 1 s |
| Import with validation: from going on to the Review step until it says what it made | 1,704 to 1,801 ms | 413 to 520 ms | 5 s |
| Load: from Load until the Data tab's table has its first rows | 94 to 117 ms | 78 to 97 ms | |
| Scroll: from asking for the end of the table until its last row is drawn, with its values | 24 to 36 ms | 21 to 39 ms | |

So the preview uses about a third of its second at the most, and the import about a third of
its five seconds. The files are in the page before any time is taken, as they are once a person
has chosen them; the time to read them from a disk is the browser's.

Where an import of the CSV spends its time, from the bar's label sampled at every frame: reading
the file into memory 290 to 390 ms, reading the values 880 to 980 ms, checking the data 420 to
450 ms. The grid is mostly reading the file (330 to 460 ms); its values are read and checked in
about 25 ms, a stage so short that the bar is often not seen in it. The import reads the file's
bytes again after the preview has read them once; keeping them would save the first of these, about
a third of a second for the CSV. That is not done: it is well inside the limit.

Long tasks (the browser's name for a task that holds the main thread for more than 50 ms, which is
what the brief limits) were watched throughout, and the watch was tried first with a deliberate
block of 150 ms. Across the import, the load and the scroll, in all twelve runs, there were none.
In the twelve previews there was one, of 51 ms, in the first page of a fresh browser; six more fresh
pages with the browser's attribution of long frames showed none. The engine works in a worker, so
what is left on the main thread is the page's own drawing, which is small: the table draws about 20
rows, whatever there are. The test holds the import, the load and the scroll to the 50 ms, and the
preview to 100.

Not measured: memory in the browser (Chromium gives only a coarse figure for the page's heap, which
says nothing of the worker's WebAssembly memory; the process memory of the native and Node entries
above is the nearest), slower machines, Firefox and Safari, files at the 134,217,728-element limit,
a CSV of more than a million rows, and GeoJSON of this size (which the entry for step 3.24 says
would not fit).

To repeat (it needs a quiet machine and takes under a minute; it is not part of `pnpm test:e2e`):

```
pnpm perf
```

which writes the files if they are not there, runs the app in a browser and prints what it
measured, and fails if a preview takes 1 s or more, an import 5 s or more, or the import, load or
scroll holds the main thread for more than 50 ms. The numbers are also in
`packages/app/test-results/performance.json`.
