# Performance

Measurements for the performance targets in the Phase 1 brief. Each entry says
what was measured, on what, and how to repeat it. Numbers are from one
development laptop, not a benchmark lab, so read them as an order of magnitude.

Machine used so far: MacBook Air, Intel Core i5-1030NG7 at 1.1 GHz, macOS 15.8,
rustc 1.99.1, release build.

## Validating one million points (step 2.22)

The brief's target is import plus validation of a 1,000,000-row CSV in under 5 s.
This entry covers validation alone; import is measured in step 10.3.

What was validated: 1,000,000 points with X, Y and Z, five numeric attribute
columns, in EPSG:32640 (so the plausibility check ran). The coordinates are
pseudo-random inside one UTM zone from a fixed seed, so the data are the same on
every run. Building the dataset is not timed.

Three runs of `validate()` on a release build:

| Run | Total |
| --- | --- |
| 1 | 277 ms |
| 2 | 315 ms |
| 3 | 338 ms |

By group (range over the three runs, each group timed on its own):

| Group | Time | What dominates |
| --- | --- | --- |
| structure | under 0.1 ms | Constant-time checks on a points dataset |
| values | 255 to 333 ms | Finding duplicate points by ordering all points |
| crs | 6 to 7 ms | Converting 1,004 sample coordinates with proj4rs |

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
