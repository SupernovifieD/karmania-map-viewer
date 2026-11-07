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
Subsets may be taken, but the terms advise that the description of a system is incomplete unless it
has the essential elements of IOGP Guidance Note 7-1 (the copies name the annex A in one and F in
the other). What is in this build is such a subset, a name, a kind, a unit and a PROJ definition
for each code, so it is not a complete EPSG description of any system. The reading was repeated on
2026-11-06 with the same result at the source (403) and the same terms in two copies (the
licensing manual of MySQL 8.0 and the licence file of a GeoServer site).

What Karmania does with it: it reads the name, the kind and the unit of a system out of its
definition, and it converts positions with the PROJ definition. It changes no value of the
dataset, and it attributes to EPSG nothing that it computes itself (a converted position is
Karmania's result, not EPSG's).

This file is not yet copied into the builds of the engine and of the app: that is steps 23.5 and 23.6
(and the README, step 24.5).

Because of these terms the kernel's build is not purely Apache-2.0: Karmania's code in it is,
and the EPSG data in it is under IOGP's terms. This was decided by the owner at step 12.2
(`docs/decisions.md`), and no written confirmation was asked of IOGP.

## earcut

The polygon triangulation of the WebAssembly kernel is done by the Rust crate `earcut` 0.4.11
(MIT OR Apache-2.0), a port of Mapbox's `earcut`, and it contains portions derived from Mapbox's
code, which is under the ISC License. Its notice, which the license asks to be kept in all copies:

> ISC License
>
> Copyright (c) 2016, Mapbox
>
> Permission to use, copy, modify, and/or distribute this software for any purpose with or
> without fee is hereby granted, provided that the above copyright notice and this permission
> notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
> SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
> AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
> WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
> NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
> OF THIS SOFTWARE.

The text is that of the file `LICENSE-ISC` of the crate. It is not yet in the builds (the
earcut crate is not called until step 13.8): steps 23.5, 23.6 and 24.5 put this file in them.

## Colour ramps

The colour ramps of `@karmania/scene` (`packages/scene/src/ramp-data.ts`) are data copied from three sources:

- **viridis and magma**, from matplotlib 3.10.0, which has the numbers of the original `colormaps.py` of
  github.com/BIDS/colormap by Nathaniel J. Smith, Stefan van der Walt and Eric Firing. They are released under the
  CC0 license / public domain dedication, and ask for credit, which is given here.
- **cividis**, from matplotlib 3.10.0, which has the colormap of github.com/pnnl/cmaputil, Copyright (c) 2017, Battelle
  Memorial Institute (described in "Optimizing colormaps with consideration for color vision deficiency to enable
  accurate interpretation of scientific data", doi:10.1371/journal.pone.0199239). It is not CC0: it is under the licence
  of that repository, which is a text of its own and is reproduced whole here, as it asks. The name of Battelle is used
  here to say where the colormap comes from and for nothing else.

    Copyright (c) 2017, Battelle Memorial Institute

    1.  Battelle Memorial Institute (hereinafter Battelle) hereby grants
    permission to any person or entity lawfully obtaining a copy of this software
    and associated documentation files (hereinafter “the Software”) to
    redistribute and use the Software in source and binary forms, with or without
    modification. Such person or entity may use, copy, modify, merge, publish,
    distribute, sublicense, and/or sell copies of the Software, and may permit
    others to do so, subject to the following conditions:

    + Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimers.

    + Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation
    and/or other materials provided with the distribution.

    + Other than as used herein, neither the name Battelle Memorial Institute or
    Battelle may be used in any form whatsoever without the express written
    consent of Battelle.

    2.  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
    "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
    THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL BATTELLE OR CONTRIBUTORS BE LIABLE FOR ANY
    DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
    ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
    SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

- **ColorBrewer** colour schemes: this product includes color specifications and designs developed by Cynthia
  Brewer (<http://colorbrewer.org/>), under the Apache License, Version 2.0
  (<http://www.apache.org/licenses/LICENSE-2.0>), as packaged at github.com/axismaps/colorbrewer.

- The **Okabe-Ito** palette of eight colours that people with the common kinds of colour blindness can tell apart,
  published by Masataka Okabe and Kei Ito (Color Universal Design, jfly.uni-koeln.de/color) and by Bang Wong
  (Nature Methods 8, 441, 2011): a published list of colour values, with no licence stated, credited here.

This file is not yet copied into the builds of the engine and of the app: that is steps 23.5 and 23.6.
