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

From phase 2 this project runs in the full Chromium (`channel: 'chromium'`), not in the headless shell, because the map is drawn as soon as the data is
loaded and the shell has only the software driver (see the section on the 2D view below); the numbers above were taken in the shell, before there was a map,
and the same limits hold in the full Chromium after the changes of steps 16.F1 to 16.F3 (both tests pass), with a context made and used before the first
measurement so that the start of the browser's graphics process is not counted.

## The size of the build (phase 2)

The Phase 2 brief asks for the gzipped size of the WebAssembly module and of the app's JavaScript at
the start of the phase, after M12, after M16 and at the end, and says to stop and propose options if
adding the EPSG definitions grows the gzipped kernel by more than 1 MB.

How it is measured: `pnpm build:wasm` and then `pnpm --filter @karmania/app build`, and for each file
`wc -c < file` (raw) and `gzip -9 < file | wc -c` (gzipped). The survey of step 11.0 used
`gzip -9 -c file`, which writes the file's name into the header, so its gzipped numbers are about 20
bytes larger than the same file measured this way; at these sizes that does not matter.

| When | WebAssembly raw | WebAssembly gzipped | App `index` + `theme` gzipped | Worker gzipped |
| --- | ---: | ---: | ---: | ---: |
| Start of phase 2 (step 11.0, `main` at `0bbdf04`) | 630,782 | 252,742 | 46,678 | 7,956 |
| Step 12.11b, before the definitions are linked in | 632,213 | 253,200 | not measured | not measured |
| Step 12.11c, with the definitions and `proj4rs` | 5,762,604 | 742,732 | not measured | not measured |
| Step 12.12, with `crsInfo` and `searchCrs` | 5,774,943 | 757,177 | 46,642 | 8,425 |
| After M12 (step 12.F4, the wizard and the summary done) | 5,774,943 | 757,177 | 48,430 | 8,831 |
| Step 12.F7, the definitions as a table | 5,451,076 | 647,422 | 48,461 | 8,830 |
| Head of M12 (step 12.F14) | 5,451,087 | 647,419 | 48,678 | 8,831 |
| After M16 (step 16.G1, `main` plus the 2D renderer) | 5,640,378 | 723,989 | 200,764 | 11,098 |

Step 12.F7 held the definitions as a table of the crate's constants, found by binary search, and not as
its one match of 6,184 arms, so that Node does not abort (see `docs/decisions.md`): the module is 323,867
bytes smaller raw and 109,755 smaller gzipped than at step 12.12, so that it has grown by 394,680 bytes
gzipped since the start of the phase (the figures below are those of step 12.12, before that). No JavaScript of the
app was changed by it: its `index` and `theme` are 31 bytes gzipped larger than at step 12.F4, which are
the wording of step 12.F5. A search in Node takes a median of 1.75 ms (50 searches, maximum
8.9 ms) and one `crsInfo` 0.007 ms, and compiling the module takes about as long as before (2.0 ms and
3.8 ms, see below).

Against the rule, as it stood at step 12.12: the definitions and the reprojection added 489,532 bytes
gzipped (step 12.11c), the two exports 14,445 more, and the changes to the core of steps 12.9 to 12.11b
458, so the module had grown by 504,435 bytes gzipped since the start of the phase (394,680 after step
12.F7, as above), which is under the 1 MB at which the brief says to stop. The raw module was 5.8 MB at
step 12.12 and is 5.45 MB (5,451,076 bytes) after step 12.F7; that is what a browser compiles. Up to step 12.12 the app's own JavaScript had not changed in size, apart from the worker, which
grew by 2.8 KB (469 bytes gzipped) to carry the two new calls. The wizard's search and the summary's
name (steps 12.14 and 12.15) then grew `index` and `theme` together from 46,642 to 48,430 bytes
gzipped (1,788 more, 25,320 and 23,110) and the worker to 8,831; the module did not change. At the head
of the milestone (the last row of the table: `index` 25,568 and `theme` 23,110 gzipped) the app's JavaScript
has grown by 2,000 bytes gzipped since the start of the phase (46,678 to 48,678), of which 217 came after
the 48,461 of step 12.F7, from the changes of steps 12.F8 and 12.F13 to the CRS step, and the worker by
875 (7,956 to 8,831); the module, with the check of grads of 12.F12, is 11 bytes larger raw and 3 smaller
gzipped than at 12.F7.

What the larger module costs when it starts, measured in Node's V8 (so only an indication of a
browser's), compiling the module with `new WebAssembly.Module` and `WebAssembly.compile`, median of 9
runs: 632,213 bytes took 0.3 ms and 2.0 ms; 5,762,604 bytes took 1.8 ms and 5.0 ms; 5,774,943 bytes took
1.9 ms and 4.3 ms; 5,451,076 bytes (step 12.F7) took 2.0 ms and 3.8 ms. Time from loading the page to a ready engine in Chromium is not measured here; the
browser tests of M11 and M12 did not get slower with it (the end-to-end suite took 5.3 to 7.5 minutes
before and after).

After M16 the module is 5,640,378 bytes raw and 723,989 gzipped (189,291 raw and 76,570 gzipped more than at the head of M12, which are the preparing of buffers, the class breaks and the class index of M13); it has grown by 471,247 gzipped since the start of the phase, which is under the 1 MB at which the brief says to stop. The app's JavaScript is 200,764 bytes gzipped (`index` 177,654 and `theme` 23,110), 152,086 more than at the head of M12: that is three.js (the part of it that the renderer uses, which is most of it), the renderer, the layers, and the viewer's pipeline. The worker is 11,098 gzipped (2,267 more, for the calls of M13). The rule of the brief concerns the kernel, and the JavaScript's growth is the cost of drawing a map in WebGL.

If the size matters later, two options are open and neither is taken: build the release profile for
size (`opt-level = "z"`, link-time optimisation), or load the definitions as a separate module, as
step 12.2 offered.

Searching the registry, natively in a release build: 2.5 ms per query by the name read from the first
quoted string of each definition, against about 50 ms if every definition were read in full (step
12.4). In WebAssembly in Node (step 12.F7, the definitions as a table, going through 6,184 definitions
and not trying 65,536 codes): a median of 1.75 ms per search over 50 searches; in a browser it is not
measured here.

## Preparing for drawing (step 13.21)

Section 9.6 of the Phase 2 brief sets the targets for loading a file and drawing its first frame: under
1.5 s for 1,000,000 points, 1.5 s for a grid of 4,000,000 cells, 3 s for 1,000,000 blocks, and new classes
visible under 300 ms for the grid. Preparing the data for the renderer is a part of each. These are the
timings of that part alone, natively in a release build (not WebAssembly, which is slower, and not reading
the file, uploading to the graphics card or drawing, which the browser measurements of milestone M16 will add):

```
scripts/generate-fixtures
cargo test -p karmania-prep --release --test timing -- --ignored --nocapture --test-threads=1
```

`scripts/generate-fixtures` now also writes `fixtures/generated/blocks-1m.csv` (a dense model of 100 x 100 x
100 blocks of 10 m, 30.4 MB, from a fixed seed, not committed). The timing tests make their data in memory
from fixed seeds, like those of the readers, so making it is not timed, and prepare a dataset as the worker
does, a job stepped 100,000 positions, vertices or blocks at a time (a tile of a warped grid is a step); the
longest step is the longest the worker cannot hear a request to stop. Three runs, on the machine named at the
top of this file (1.1 GHz, so a slow one):

| What | Run 1 | Run 2 | Run 3 | Longest step | Brief's target |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000,000 points in the map's system | 19 ms | 15 ms | 14 ms | 5 to 7 ms | 1.5 s (all of loading) |
| 1,000,000 points converted from longitude and latitude | 281 ms | 253 ms | 297 ms | 31 to 53 ms | 1.5 s |
| 4,000,000 cells as an image (placed) | 0 ms | 0 ms | 0 ms | 0 ms | 1.5 s |
| 4,000,000 cells warped from degrees (4 by 4 degrees) | 1 ms | 1 ms | 1 ms | 1 ms | 1.5 s |
| 4,000,000 cells as a surface (a vertex and two triangles for each) | 366 ms | 433 ms | 370 ms | 164 to 194 ms | 1.5 s |
| 1,000,000 blocks | 29 ms | 32 ms | 41 ms | 3 to 5 ms | 3 s |

An image of cells has almost nothing to prepare (its placement and its tiles), so the time of a grid is in
what is done to it afterwards: the class of every cell. New classes for the same 4,000,000 cells (a value
for all but one in 97), the classification and then the class of every cell, in milliseconds:

| Method | Run 1 | Run 2 | Run 3 |
| --- | ---: | ---: | ---: |
| Equal intervals | 58 + 69 | 65 + 66 | 102 + 56 |
| Quantiles | 117 + 73 | 125 + 66 | 109 + 68 |
| Natural breaks (a sample of 10,000) | 96 + 66 | 87 + 62 | 78 + 70 |
| Categories (about 2,000 different values) | 321 + 75 | 286 + 65 | 275 + 62 |

**The restyle target was missed for categories**, in the first three runs above: 0.34 to 0.40 s for the
classification and the class of every cell, against 0.3 s for the whole restyle, in native code, before the transfer
to the page, the upload of a texture and the drawing, and before WebAssembly's slowdown. The brief says to stop
and report a target that is missed after reasonable effort, and not to relax it; the first effort was step 13.21a,
which counts the distinct values in a hash map with a fast hash and sorts them once at the end (the ordered map it
replaces cost about 11 comparisons a row, and the order is only needed at the end). The same test, three runs after it:

| Method | Run 1 | Run 2 | Run 3 |
| --- | ---: | ---: | ---: |
| Equal intervals | 83 + 69 | 72 + 74 | 74 + 57 |
| Quantiles | 118 + 65 | 127 + 66 | 145 + 62 |
| Natural breaks (a sample of 10,000) | 84 + 70 | 74 + 59 | 63 + 63 |
| Categories (about 2,000 different values) | 71 + 83 | 59 + 67 | 67 + 91 |

Categories now take 0.13 to 0.16 s (the classification 4.5 times faster), and the slowest method is quantiles, at
0.18 to 0.21 s (it sorts 4,000,000 numbers), which is inside the 0.3 s natively and leaves about 0.1 s for everything
else; the test passes. **That margin is thin**: WebAssembly is usually 1.5 to 2 times slower than native code, and the
transfer and the upload come on top, so whether a restyle by quantiles meets 0.3 s in the browser is for the
measurement of milestone M16 to say, and if it does not, the quantiles are the place to look (a selection of the
bounds by partitioning the values, which needs no full sort). Not measured here and left to M16: the same in WebAssembly,
the page's side, and a column of integer codes (the usual case for categories, with a few distinct values, which a
column of 2,000 is not).

What the numbers say about the steps (corrected twice at the gate, steps 13.F3 and 13.F11: the first version said that the longest step
of any kind was the surface's, 180 ms, and the second that the limit of 100,000 vertices bounds the step of a polygon; neither was so).
The worker hears a request to stop only between steps, so the longest step is the longest it hears nothing. A conversion of positions
is stepped 100,000 at a time and its longest step is 30 to 50 ms natively and 83 ms in WebAssembly. Some steps cannot be cut:
the triangles of a surface (one step for 4,000,000 cells: 180 ms natively, 445 ms in WebAssembly in Node), a rough warp tile (about 235 ms for
256 x 256 parts), and **the triangulation of one polygon, whose time depends on its shape and not on its size alone**. Natively, in one step
(`the_longest_step_for_one_large_polygon` and `the_longest_step_for_polygons_that_are_hard_to_fill`; two runs, the second on a busier machine):

| One polygon | Vertices | Longest step, natively |
| --- | ---: | ---: |
| A ragged ring (random noise of 4 % in its radius), like a coastline | 25,000 / 50,000 / 100,000 | 20 / 50 to 60 / 140 to 215 ms |
| A plain circle | 25,000 / 50,000 / 100,000 | 0.43 to 0.47 s / 0.88 s / 4.3 to 4.6 s |
| An ellipse (50 by 10 km) | 50,000 / 100,000 | 1.5 to 1.7 s / 6.2 to 7.9 s |
| A jagged star (the radius of each vertex uncorrelated, 25 to 75 km) | 25,000 / 50,000 / 100,000 | 130 to 150 ms / 0.6 to 0.75 s / 3.3 to 4.6 s |
| A comb (teeth that go in and out) | 15,000 / 37,500 / 75,000 | 0.3 to 0.38 s / 1.8 to 2.2 s / 6.6 to 9.7 s |
| A ring that crosses itself (points in random order); then only outlined | 50,000 / 100,000 | 3.2 to 3.3 s / 10.7 to 12.8 s |
| A square with holes (four vertices each) | 10,000 (2,500 holes) / 20,000 (5,000) / 24,000 (6,000) | 85 to 140 ms / 0.37 to 0.5 s / 0.5 to 0.7 s |

The first version of this table called the ragged ring "smooth", and the text said that the limit of 100,000 vertices is the size at which
"a smooth polygon, which is nearly every polygon of a map" fills in about a third of a second. That was wrong (found by the third review of the
milestone): a ring that is smooth in the sense of a densely sampled curve, a plain circle, an ellipse, a buffer or a densified outline, is the slow
case, 4 to 8 s at 100,000 vertices, while a ragged natural boundary is quick. The crate limits two things, and neither bounds the step for every shape. A
polygon of more than 100,000 vertices is outlined and not filled (`display.polygons.too_detailed`), and so is one whose vertices times its rings is over
150,000,000 (6,000 holes of four vertices: holes cost about 4 ns for each unit of that product, so the limit is about half a second for one polygon of holes, and the
reviewer's polygon of 96,000 vertices and 24,000 holes, which took 18.7 s, is now outlined at once). The limit on vertices keeps a ragged natural boundary
filled and the nodes of `earcut` far from the size at which it panics; **it is not a bound for a plain curve, a jagged ring or a comb**, which at 100,000
vertices take several seconds in which the worker hears no request to stop. The number of concave vertices does not predict the time, and the time itself cannot decide
what is drawn (brief section 8). **The owner's options**: (1) leave it as it is, the limit disclosed; (2) lower the limit of vertices: 50,000 would bring a jagged star
to 0.6 to 0.75 s but not a plain circle (0.9 s) or an ellipse (1.5 s), and would outline the ragged boundaries of 50,000 to 100,000 vertices that fill in a fraction of a second; (3) count the
work inside `earcut` and give up when a budget is spent. The third review did that in a scratch copy of the crate, with a counter that ticks once for each step of its main loop, each
node of the z-order hash visited, each edge tested and each cut tried, so that it depends on the data and not on a clock: about 200 million ticks was about half a second natively for the circle, the
ellipse, the star and the comb, and ordinary rings were far below it (a ragged ring of 100,000 vertices 33 million, a random walk 3 to 16 million). It is a few
lines in `earcut`'s own source, which would have to be copied into the repository or forked, a decision about a dependency that is the owner's. A polygon of 100,000 vertices in WebAssembly in Node: 373 ms for the ragged circle of the first timing. The
conversion of 1,000,000 positions from longitude and latitude (about 270 ms natively, 650 ms in WebAssembly) is the one preparing cost that
is more than a few tens of milliseconds as a whole, and it is a part of drawing data that is not in the map's system. The warp of a grid of
4,000,000 cells is 1 ms because it is a mesh of about 64 parts, not a picture of cells: the cells are in the texture the renderer is given.
WebAssembly in Node, one run each, this machine. Not measured: the cost of yielding between steps in a browser, where `setTimeout(0)` is held to about 4 ms after a few nested
calls, so that a prepare of many steps (the 40 of a surface of 4,000,000 cells, or one for each tile of a very large warped grid) takes that
much longer than its work.

## The 2D view with the large files (phase 2, step 16.G1)

Section 9.6 of the Phase 2 brief sets the targets for drawing the map, and says that a target that is missed after reasonable effort is
reported with its numbers and not relaxed. For the 2D view they are: 1,000,000 points, from loading to the first frame under 1.5 s and,
in a scripted pan, zoom and rotation, a median frame time under 16.7 ms and a 95th percentile under 33 ms; a grid of 4,000,000 cells, from
loading to the first frame under 1.5 s and new classes visible under 300 ms; a model of 1,000,000 blocks, from loading to the first frame under
3 s (its 3D orbit is M18's); and no task of the main thread over 50 ms in any of them.

`pnpm perf` now runs two projects, both in the full Chromium (`channel: 'chromium'`) and not in the headless shell that the other tests use. The
shell has only the software driver (SwiftShader), with which one frame of 1,000,000 points took 2.0 s (a median of 2,041 ms over 300 frames of
a pan, a zoom and a rotation, a first frame at 2.4 s and a task of 3.6 s): drawing is only measured on a card. The full Chromium uses the machine's own, here an
Intel Iris Plus Graphics (the browser reports `ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Plus Graphics)`; the number is printed with the
results). The brief's figures are for "the real GPU" of the development machine, and this one is an integrated card of a laptop with a 1.1 GHz
CPU; a faster machine will do better, and Firefox and Safari are not measured. The files are the ones of `scripts/generate-fixtures`, put
into the page and taken through the wizard as a person would; the time starts at the click on Load. The frames are the times between two
animation frames while a script gives the camera a new place at each of 300 (100 of pan, 100 of zoom in and out, 100 of rotation); new classes are
timed from the command to the first frame in which 64 pixels across the middle of the picture are not what they were.

What it takes to repeat: `pnpm perf` (it needs the files, a quiet machine and a card; about 4 minutes), and `KARMANIA_PROFILE=1` traces the browser
from the click and prints the longest things that ran, which is how the tasks below were found.

Three runs, after the changes of steps 16.F1 to 16.F3 below (the same machine, the card as above, the graphics process of the browser started by a
context that is made and used before the first measurement):

| | 1,000,000 points | 4,000,000 cells | 1,000,000 blocks | Target |
| --- | ---: | ---: | ---: | --- |
| Loading to the first frame, ms | 262, 263, 288 | 447, 473, 474 | 359, 361, 419 | 1,500; 1,500; 3,000 |
| Median frame time of the pan, zoom and rotation, ms | 16.6, 16.7, 16.7 | | | under 16.7 (met by the 16.6 only) |
| 95th percentile of the same, ms | 17.6, 18.0, 18.2 | | | under 33 |
| New classes to the picture, ms | | 177, 188, 194 | | 300 |
| Longest task of the main thread, ms | none over 50 | none over 50 | none over 50 | 50 |

The median is the period of the display: 60 Hz is 16.67 ms and the browser's clock reads 0.1 ms, so the best a frame can be is the 16.6 or
16.7 that it reads, which is a frame at every beat with none dropped (the 95th percentile, 18 ms, says how far the others are). **The brief says "under
16.7 ms", which at 60 Hz is not something a display can show; the owner's reading (2026-11-08) is that it means keeping up with the display**, and the test
asserts that: the median gap between the frames of the scripted camera is at the beat of the display, which the same page measures with nothing happening in it, to
within 5% (decision 16.F13). (An earlier version of this section read "under" as "at or under" on my own and said every target was met; that was a relaxation, which the
brief forbids, and it was undone before the owner decided.)

**The long tasks, and step 16.F13.** After steps 16.F1 to 16.F3 the three runs above had no task over 50 ms. Runs made at the end of the review round did (tasks of 51 to 60 ms
in some 10 to 30 percent of the measurements, 84 and 107 ms in two scrolls of the table; the same on the head before the review round, which is how it was known not to come from
it, and in the Phase 1 tests of the same `pnpm perf`, which M16 does not touch). The harness now records the frames over 50 ms (where the Long Animation Frames API starts to report) with the scripts in them (printed as `SLOW`), which a trace of the browser cannot do (it adds tasks of its own), and the product code was timed with probes for a day. What was in the tasks, all of it the
page's own work and none of it the browser's: **(1)** the pass over the positions for the extent of a layer, 32 to 70 ms for 1,000,000 points or blocks in the browser (an array made for each
position, six indexed calls); **(2)** the making of the renderer, in one task with the rest of the layer's arrival: 14 to 34 ms for the browser's context and 10 to 15 for three's own state, and up to
76 ms for three's when the worker was preparing a big dataset at the same moment, since the card's process and the worker compete for the machine; **(3)** the first frame that draws a part of a
layer, 33 to 45 ms for a part of 250,000 points or blocks (20 ms for 50,000), the card's work, part of it in proportion to the size. Step 16.F13 changed each: the extent is looked at 200,000
positions at a time with a turn for the page between, in a loop that allocates nothing (10 to 12 ms cold in Node for a million instead of 17 or 18); the renderer is made when the first
buffers are ready, and not when the layer is first asked for (three's own state then takes 9 to 36 ms, mostly 14 to 18, and the page waits for the card to finish the context with a fence, a
turn at a time, instead of being held by the first question that three asks it); and the parts are of 100,000 (the tiles of a grid of at most 4,096 cells a side, so that the first prepare does not
need the card). **Six runs of `pnpm perf` after it** (the same machine and card; all six green):

| | 1,000,000 points | 4,000,000 cells | 1,000,000 blocks | Target |
| --- | ---: | ---: | ---: | --- |
| Loading to the first frame, ms | 231 to 352 | 467 to 542 | 319 to 447 | 1,500; 1,500; 3,000 |
| Median frame time of the pan, zoom and rotation, ms | 16.7 in all six (the display's beat, measured in the same page: 16.5 to 16.7) | | | at the beat of the display |
| 95th percentile of the same, ms | 17.2 to 18.7 | | | under 33 |
| Frames the renderer drew for the 300 changes of the camera | 299 in every run | | | (the test asks for 290) |
| New classes to the picture, ms | | 176 to 240 | | 300 |
| Longest task of the main thread, ms | none over 50 | none over 50 | none over 50 | 50 |

The tests of Phase 1 in the same runs (a CSV of 1,000,000 points and a grid of 4,000,000 cells, through the preview, the import, the load and the scroll of the table) had no task over 50 ms in any
of their 36 measurements, where before they had them in some (a load of 51 to 60 ms, scrolls of 84 and 107): the same causes. For comparison, with the two heads run in turn before the fix, tasks over 50 ms
were in 8 of 27 measurements on each. **What is not changed**: the first frame that draws a layer is still the card's own work in a task of its own (20 ms was measured with parts of 50,000 and 33 to 45 with 250,000; with the 100,000 now it was not timed apart, and no task over 50 ms was seen), and the frames over 50 ms that `SLOW` shows outside the windows that the targets name (the start-up of the page, 45 to 90 ms to evaluate its script, and in the import wizard the frame after a click on Next with the
1,000,000-row file, 110 to 226 ms) are not held by any target: **the owner asked what they are, and the next section says (step 17.10)**.

### The frames over 50 ms outside the targets' windows (step 17.10)

The owner asked, after M16, what the two kinds of long frame that `SLOW` still shows are, and how they could be fixed. **Nothing was changed for this: it is a finding.** Found with the Long Animation Frames API,
a trace of the browser (`devtools.timeline`, `v8`, `blink`), a CPU profile of the page (the `Profiler` of the protocol, at 100 to 200 microseconds), and, for the native side, macOS's `sample` on the renderer's process at 1 ms (the probes are
throwaway scripts; the method is in this section). The machine is the one of the rest of this file (a laptop with a 1.1 GHz CPU, the full Chromium).

**1. The frame after the first click, 110 to 226 ms (in the probes 111 to 139 ms): half or more of it the operating system's, and not mainly the page's.** It is the frame after the first press of Next in the wizard, with any file, and it is the first mouse event
that a page gets. The page's own part is 35 to 55 ms by the sum of these parts (not small: about 15 to 50 per cent of the frame): the click's script is 15 to 29 ms (`K-BUTTON.onclick`, with a forced layout of 1 ms), the layout of the new step 13 to 19 ms (2,700 boxes), the rest of the JavaScript a few milliseconds
and the garbage collector 4. **The rest is the browser's main thread waiting inside macOS**: the trace has a `BeginMainFrame` of 72 to 86 ms in which nothing at all runs on any thread of the process until its last millisecond (and it is a long task),
and the `sample` of the renderer shows why: the first thing a renderer does with a mouse event on macOS is to ask for the state of the keyboard's modifier keys (`GetCurrentKeyModifiers`), which makes the system start its connection to the window server for
the process, once: **a check of the process's permission over XPC to the `tccd` daemon (30 ms in the sample) and the setting up of the display (26 ms)**, 56 ms of the 138 that the thread was busy in the sample, with the page's own code in a small part of the rest.
**Evidence that it is that and not the step (from the probes; not a proof)**: with a mouse move over the page before the wizard is used (`page.mouse.move`), the click's frame is 52 to 57 ms and the long frame, 92 to 136 ms, is the one of the move; the other steps of the wizard
(Next to the third, fourth and fifth step) never have one; and **it does not depend on the file** (the same frame is 99 to 126 ms for a file of two rows, 110 and 111 ms for the grid of 4,000,000 cells, the script of the click being 13 to 22 ms or under the 5 ms that the API lists, and 111 to 139 ms for the 1,000,000 points). **It cannot, as far as the probes show, be fixed in the page**: it is the browser's, in the process's first mouse event, and a person on a Mac would pay it
once for each tab's process (a generalisation from the probes: it was not measured in a window with a person at it; the probes drive the page with the protocol's mouse events, which are assumed to take the same path in the renderer). **If the harness's lines are to be clean**, a mouse move after `goto` in `measure()`
(`performance.perf.ts`) and in `render.perf.ts` moves the cost out of the windows that are timed; nothing asserts the frames over 50 ms, so it is not needed for the tests, and it was not done.

**2. The start-up of the page, 53 to 69 ms (45 to 90 over the runs): it is the page's own first render, and (by a prototype that was not kept) not the size of the bundle.** One task: the parser runs the module script, which is 18 ms of evaluating the modules (`v8.evaluateModule`: three.js's top level
is 5 ms of it, the colour ramps 1.5, the components' classes the rest) and then **42 ms of microtasks, which are Lit rendering the shell**: 212 elements in 40 shadow roots (14 kinds of component), run cold (the JavaScript engine has not yet compiled
any of it), and 8 ms of the page's first style and layout after it. **A prototype that split three.js and the renderer out of the first script into a chunk that is loaded when the first layer is ready (the main chunk went from 704 kB to 148 kB, with 558 kB loaded later)
did not change it: 54 to 64 ms against 48 to 64**, so the size of the script is not what the time is. (The first frame of all, 35 to 134 ms with no script and no long task, is the browser's own first render; and a task of 150 ms at 290 to 380 ms in the `SLOW` lines is
the harness's own, which blocks the page on purpose to see that its watch works.)

**How the start-up could be brought under 50 ms, if the owner wants no task over 50 ms anywhere (none of this is done):** (a) **do not render what is not seen at the start**: the import dialog with its steps, the tooltips and the panel's tabs that are hidden are about a third of the 40 roots, and
Lit can render them when they are first opened (a change of the viewer, with the tests of the dialog and the panel to follow it; the saving is not measured); (b) **give the page a turn between the parts of the first render** (the map area and the panel in one task, the dialog and what is
hidden in the next), which should split one task of 60 into two of 30 and is the smallest change (neither the split nor what it costs what is on screen, a frame of the shell later, was measured: it is an expectation); (c) leave it: the targets of 9.6 name loading data, the frames of a camera and the like, and not the start of the page, and 53 to 69 ms on a 1.1 GHz laptop is
expected to be about a third of that on a desktop (not measured). **My recommendation is (b) if it is to be done, and (c) otherwise**; (a) is more work for a saving that is not known.

**The evidence for this section, and what it does not show.** The figures are from probe runs of 2026-11-08, as ranges over the runs of each probe (the number of runs of each was not kept). The breakdown of the first click's frame into 30 ms for the permission check and 26 ms for the display is **one sample** of one run (`sample`, at 1 ms), and the "never have one" for the other steps of the wizard and the independence of the file are what the probes saw, not a proof. The probes are throwaway scripts that were not kept, and the prototype that split three.js out of the first script was reverted and is not in the repository, so none of this can be repeated from the repository: the method above is what there is. Options (a) and (b) and the third of the time on a desktop are not measured, as each says.

How it got there. The first measurement on the card, before any change, met the times and missed the last target in all three: a first frame of 630 to 862 ms
and a median of 16.6 ms (p95 18.5), but a longest task of 186 ms for the points, 292 for the grid and 210 for the blocks, and, in later runs, of 51 to 58
ms with an outlier of 118. A trace of the browser from the click (`KARMANIA_PROFILE=1`) showed three things on the main thread, and each has a step:

1. **The first animation frame that draws a layer took 83 ms for 1,000,000 points** (step 16.F1). three worked out the bounding sphere of every geometry, a pass over
   every vertex, to sort the objects by how far they are. Objects are now drawn in the order they were put, which took the frame to 55 to 60 ms and
   corrected the order in which the fill and the outline of polygons by class were drawn.
2. **What was left of that frame was the driver linking the shader programs of the layer** (step 16.F2): the programs of a layer are now compiled off the main
   thread (`compileAsync`, with `KHR_parallel_shader_compile`) before it is first drawn, and the layer appears a frame or two later.
3. **The click on Load held the page for 52 to 56 ms, of which the creation of the WebGL context and the renderer was a part** (step 16.F3): the renderer is
   made in a task of its own.

The first WebGL context of a browser also starts its graphics process, which held that page for 118 to 292 ms in the first run of every measurement (and
58 and 60 ms in the load of the first of each of the large files in the Phase 1 timings above). That is the browser's start, once, and not the page's work, so
the timings make a context and use it before they measure; the cost to a page that is the first of its browser is what it was in the first runs. The Phase 1
timings of the previous section, which did not draw a map, are in the full Chromium too from this step, and have the same start.

## The 3D view with a model of 1,000,000 blocks (phase 2, steps 18.9b and 18.9c)

Section 9.6 of the Phase 2 brief: a model of 1,000,000 blocks, loaded to the first frame under 3 s and, in a scripted 3D orbit, the 95th percentile of the frame time
under 50 ms; no task of the main thread over 50 ms; and "if this is missed, a step may draw only the exposed faces of dense models; measure first". `pnpm perf`
(the `render-performance` project, `render.perf.ts`) now does the orbit after the load: the view is switched to 3D with `viewer.setViewMode('3d')` and fitted (the time to the first
frame that has the layer in it is printed as `switchMs`), and the camera is given a new place at each of 300 frames, going round a turn and a quarter (1.5 degrees a frame, 450 degrees in the 300) while it rises
and falls between 25 and 65 degrees above the horizon; the time between two animation frames is what is measured, as in 2D, with the display's own beat measured in the same page. The
file is `blocks-1m.csv` (a dense model of 100 by 100 by 100 blocks of 10 m, from `scripts/generate-fixtures`), the card the same as above (Intel Iris Plus Graphics, in the full Chromium).

**First measurement, every face of every block drawn (the layer as it was after 18.4b):** the target was **missed**.

| | Run 1 | Run 2 | Run 3 | Target |
| --- | ---: | ---: | ---: | --- |
| Loading to the first frame, ms | 2,181 (cold: the first run after the machine had been left) | 417 | 448 | 3,000 |
| Median frame time of the orbit, ms | 86.3 | 81.1 | 83.7 | (not a target) |
| 95th percentile of the same, ms | 126.7 | 101.1 | 108.2 | under 50 |
| Switch to 3D and fit, to the first frame, ms | 28 | 22 | 28 | |
| Longest task of the main thread, ms | none over 50 | none over 50 | none over 50 | 50 |

At a median of 80 to 86 ms the page drew 12 frames a second. A solid model of 100 by 100 by 100 blocks has 6,000,000 faces, of which 60,000 (6 x 100 x 100) are on its outside; the rest are inside it and
show from no side. **The cost is most likely the faces inside the model being drawn and then thrown away by the depth test, which I did not profile to confirm**; what is known is that drawing only the exposed faces, which does
not change a pixel, took the frame from 81 to 86 ms to the display's beat. **So 18.9c draws only the exposed faces of a dense model** (the decision of 18.9c2 says how: when the
classes arrive the layer makes instances for the blocks that are drawn and have a face that shows, with a mask of which, and the vertex shader leaves out the others; the kernel says the
size of the lattice for it, 18.9c1). The picture is the same to the pixel (the 23 render golden images, at threshold 0).

**After it, five runs** (the same machine and card; the cold first run of the table above was not seen again, and the instances are made 25,000 blocks a frame):

| | Runs 1 to 5 | Target |
| --- | ---: | --- |
| Loading to the first frame, ms | 400, 456, 497, 453, 502 | 3,000 |
| Median frame time of the orbit, ms | 16.7, 16.7, 16.7, 16.6, 16.7 (the display's beat, measured in the same page: 16.5 to 16.9) | (at the display's beat) |
| 95th percentile of the same, ms | 17.3, 18.5, 19.0, 18.7, 18.3 | under 50 |
| Frames the renderer drew for the 300 changes of the camera | 299 in every run | (the test asks for 290) |
| Switch to 3D and fit, to the first frame, ms | 26, 23, 24, 25, 25 | |
| Longest task of the main thread, ms | none over 50 in any | 50 |

**All the targets of the block model are met, with a wide margin for the frames** (the median is the beat of the display and the 95th percentile 3 ms over it). Three things to say
plainly. **(1)** Before the instances were made 25,000 blocks at a time (when a whole part of 100,000 was made in one go), three runs gave a median of 16.6 ms and a 95th percentile of 18.4 to 18.6 ms, and **one of the three had a
task of 76 ms and a first frame of 1,338 ms**: the first part's loop running cold, in the first run after a pause. That is why the work is bounded in a frame (2 to 6 ms of it), and no task over 50 ms was seen in the
five runs after, which does not prove there never is one on a slower machine. **(2)** The harness prints the frames that took over 50 ms (the Long Animation Frames API, `SLOW`): in each of the five runs there was one, of 50 to 67 ms, with a callback of a timer of 29 to 40 ms and
one of a frame of 10 to 12 ms in it, early in the run (4.2 to 4.9 s after the page started); **it was not a task over 50 ms** (the long-task observer saw none) **and its cause was not looked into**, as the frames of the orbit are all at the display's beat. **(3)** The numbers are for this
machine's integrated card; the software driver of the Docker image is not measured here (it took 2 s for a frame of a million points in 2D) and a model with many holes (a topography with air blocks, for instance) has more exposed faces than a solid one, so more instances: the cost goes with the surface of
what is drawn, which a solid cube has the least of.

**After step 18.F4b** (the geometry of a part of a dense model is replaced and the old one disposed, so that no buffer is left on the card): one run, started right after the golden images of the Docker image, on a busy machine (load average 11), **failed the longest-task target: 51 ms against 50**, its cause not looked into. Three runs with the change and three on the commit before it, on a quiet machine (load 2.2 at the start), saw no task over 50 ms in any: first frame 302 to 351 ms (354 to 426 before), 95th percentile 18.4 to 18.5 (18.5 to 18.7), switch to 3D and fit 24 to 29 ms (23 to 32), 299 frames of 300 in every run. So the figures above hold on a quiet machine, and **a busy one can miss the 50 ms by a millisecond**, as the first measurement said it could (51 to 58 ms).

What it takes to repeat: `pnpm perf` (about 5 minutes; it needs `scripts/generate-fixtures`, a quiet machine and a card), or `KARMANIA_PERF=1 pnpm --filter @karmania/app exec playwright test --project render-performance --workers=1 -g "1,000,000 blocks"` for this one.
