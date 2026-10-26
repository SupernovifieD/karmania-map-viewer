# Performance

Measurements for the performance targets in the Phase 1 brief. Each entry says
what was measured, on what, and how to repeat it. Numbers are from one
development laptop, not a benchmark lab, so read them as an order of magnitude.

Machine used so far: MacBook Air, Intel Core i5-1030NG7 at 1.1 GHz, macOS 15.8,
rustc 1.99.1, release build.

## Validating one million points (step 2.22)

The brief's target is import plus validation of a 1,000,000-row CSV in under 5 s.
This entry covers validation alone; import is measured in step 10.3.

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
native code; WebAssembly (milestone M4) will be slower and is measured in step
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
