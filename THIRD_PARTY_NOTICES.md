# Third-party notices

Karmania's own code is under the Apache License 2.0 (`LICENSE`). This file says what is in a
build of Karmania that is not Karmania's own and has terms of its own. It was begun at step 12.F2,
when the EPSG definitions went into the WebAssembly kernel; step 23.5 completes it for everything
else that is shipped (the libraries of the app, the font, the icons and the colour data). The
dependencies and their licences, as they stand, are in `docs/dependencies.md`.

## The EPSG Dataset

The WebAssembly kernel (`packages/engine/wasm`, and the builds of the app and of the engine that
contain it) holds the definitions of about 6,000 coordinate systems, by their EPSG codes: their
names, their kinds, their units and their PROJ definitions. They are those of the EPSG Dataset,
as the Rust crate `crs-definitions` 0.6.0 carries them (the crate is under CC0-1.0, and its tables
are generated from the `spatial_ref_sys` table of PostGIS, which derives from the EPSG Dataset).

**Ownership of the EPSG Dataset by IOGP (the International Association of Oil & Gas Producers)
is acknowledged.** The EPSG Dataset is published by IOGP at <https://epsg.org>, and its terms of
use (<https://epsg.org/terms-of-use.html>) apply to the definitions in this build, and to anyone
who is given them: **you are told here that they do.** Read them before you redistribute a build.

As they were read (from copies on other sites, since `epsg.org` itself refused this project's
tools with HTTP 403, so they were not read at the source and should be): the data may be used,
copied and distributed; it is published at no charge and distribution for profit is forbidden,
though it may be part of a commercial package where the commerciality rests on value added by the
provider; ownership by IOGP must be acknowledged in any publication or transmission of it; the
terms must be passed on; the data may be changed only as the terms allow, and data changed
otherwise must not be attributed to EPSG; and it is provided as is, without warranty of any kind.

What Karmania does with it: it reads the name, the kind and the unit of a system out of its
definition, and it converts positions with the PROJ definition. It changes no value of the
dataset, and it attributes to EPSG nothing that it computes itself (a converted position is
Karmania's result, not EPSG's).

This file is not yet copied into the builds of the engine and of the app: that is steps 23.5 and 23.6
(and the README, step 24.5).

Because of these terms the kernel's build is not purely Apache-2.0: Karmania's code in it is,
and the EPSG data in it is under IOGP's terms. This was decided by the owner at step 12.2
(`docs/decisions.md`), and no written confirmation was asked of IOGP.
