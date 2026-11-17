# Third-party notices

Karmania's own code is under the Apache License 2.0 (`LICENSE`). This file says what is in a build of Karmania that is not Karmania's own and has terms of its own: the
JavaScript libraries, the icons, the font, the Rust crates and the data in the WebAssembly module, and the colour data. It is the file that those licences ask to go with the
builds, and it does:

- **the library build of the viewer** has it as `THIRD_PARTY_NOTICES.md` next to `karmania-viewer.js`, with the licence of Inter as `assets/OFL.txt` next to the font files, and
  so does the package made from it (`pnpm pack`);
- **the build of the app** has the same two files;
- **the JavaScript keeps the licence comments** of three.js and Lit (`output.comments.legal` of both Vite configurations), and the icons keep their own.

The dependencies, with their versions and why they are there, are in `docs/dependencies.md`.

## What is in a build

| Part                      | What it is                                                                                     | Licence                    | Below                        |
| ------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------- |
| JavaScript                | three.js 0.187.0                                                                               | MIT                        | three.js                     |
| JavaScript                | Lit 3.3.3 (`lit-html` 3.3.3, `lit-element` 4.2.2, `@lit/reactive-element` 2.1.2)               | BSD-3-Clause               | Lit                          |
| JavaScript (as SVG text)  | Lucide icons (`lucide-static` 1.61.0)                                                          | ISC                        | Lucide                       |
| Font files                | Inter v20, two files of a variable font                                                        | OFL-1.1                    | Inter                        |
| WebAssembly module        | 28 Rust crates, and the EPSG definitions, which a crate carries                          | MIT, Apache-2.0, others    | Rust crates; The EPSG Dataset |
| WebAssembly module        | the triangulation of polygons (earcut, from Mapbox's)                                          | ISC, MIT OR Apache-2.0     | earcut                       |
| JavaScript (data)         | the colour ramps and palettes                                                                  | CC0, Battelle, Apache-2.0  | Colour ramps                 |

## three.js

three.js 0.187.0 (<https://threejs.org>), by the three.js authors, under the MIT licence. Its copyright and licence notice is kept in the JavaScript, as the licence comment of
its code, and is reproduced here from the package:

```text
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Lit

Lit 3.3.3 (<https://lit.dev>), by Google LLC, under the BSD 3-Clause licence: the packages `lit`, `lit-html` 3.3.3, `lit-element` 4.2.2 and `@lit/reactive-element` 2.1.2, which have
the one text. Their copyright lines are kept in the JavaScript, and the text is reproduced here from the package:

```text
BSD 3-Clause License

Copyright (c) 2017 Google LLC. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Lucide

The icons of the interface are those of Lucide (<https://lucide.dev>, `lucide-static` 1.61.0), under the ISC licence. Each is in the JavaScript as SVG text with its own comment
that names the licence. The licence file of the package, whole (it has the notice of Feather's MIT licence, for the parts that come from it):

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Inter

The interface is set in Inter, v20, by The Inter Project Authors (<https://rsms.me/inter/>), as `@fontsource-variable/inter` 5.3.0 packages it, under the SIL Open Font License
1.1: two files of a variable font (`inter-latin-wght-normal.woff2`, `inter-latin-ext-wght-normal.woff2`), as they are, with nothing changed. The licence goes with the files as
`assets/OFL.txt`, and is reproduced here:

```text
Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) Inter-Italic[opsz,wght].ttf: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Rust crates in the WebAssembly module

The WebAssembly module (`karmania_wasm_bg.wasm`) is made of Karmania's own crates (`karmania-core`, `karmania-crs`, `karmania-io`, `karmania-prep` and `karmania-wasm`, under the Apache
License 2.0, `LICENSE`) and of the crates below, which are the ones that `cargo tree -p karmania-wasm --target wasm32-unknown-unknown -e normal,no-proc-macro` lists (the crates
that only the compiler uses, such as `syn` and `serde_derive`, are not in the module). The copyright lines are those of the licence files of the crates, as they were read at step 23.5
(a crate whose licence file has no copyright line is shown with its authors, or with "see the crate").

| Crate | Version | Licence | Copyright |
| ----- | ------- | ------- | --------- |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 | 2014 Alex Crichton |
| console_log | 1.1.0 | MIT/Apache-2.0 | 2018 Matthew Nicholson |
| crs-definitions | 0.6.0 | CC0-1.0 | see the crate |
| earcut | 0.4.11 | MIT OR Apache-2.0 | 2016, Mapbox; 2026 The GeoRust Project Developers |
| futures-core | 0.3.34 | MIT OR Apache-2.0 | 2016 Alex Crichton; 2017 The Tokio Authors |
| futures-task | 0.3.34 | MIT OR Apache-2.0 | 2016 Alex Crichton; 2017 The Tokio Authors |
| futures-util | 0.3.34 | MIT OR Apache-2.0 | 2016 Alex Crichton; 2017 The Tokio Authors |
| itoa | 1.0.18 | MIT OR Apache-2.0 | David Tolnay |
| js-sys | 0.3.106 | MIT OR Apache-2.0 | 2014 Alex Crichton |
| libm | 0.2.16 | MIT | 2018 Jorge Aparicio, and the holders named in the notices of libm below |
| log | 0.4.35 | MIT OR Apache-2.0 | 2014 The Rust Project Developers |
| memchr | 2.8.3 | Unlicense OR MIT | 2015 Andrew Gallant |
| num-traits | 0.2.19 | MIT OR Apache-2.0 | 2014 The Rust Project Developers |
| once_cell | 1.21.4 | MIT OR Apache-2.0 | Aleksey Kladov |
| pin-project-lite | 0.2.17 | Apache-2.0 OR MIT | see the crate |
| proj4rs | 0.3.0 | MIT OR Apache-2.0 | David Marteau |
| proj4rs-geodesic | 0.2.0 | MIT OR Apache-2.0 | David Marteau |
| serde | 1.0.229 | MIT OR Apache-2.0 | Erick Tryzelaar; David Tolnay |
| serde-wasm-bindgen | 0.6.5 | MIT | 2019 Cloudflare, Inc. |
| serde_core | 1.0.229 | MIT OR Apache-2.0 | Erick Tryzelaar; David Tolnay |
| serde_json | 1.0.154 | MIT OR Apache-2.0 | see the crate |
| slab | 0.4.12 | MIT | 2019 Carl Lerche |
| thiserror | 2.0.21 | MIT OR Apache-2.0 | David Tolnay |
| unicode-ident | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 | 1991-2023 Unicode, Inc. |
| wasm-bindgen | 0.2.129 | MIT OR Apache-2.0 | 2014 Alex Crichton |
| wasm-bindgen-shared | 0.2.129 | MIT OR Apache-2.0 | 2014 Alex Crichton |
| web-sys | 0.3.106 | MIT OR Apache-2.0 | 2014 Alex Crichton |
| zmij | 1.0.23 | MIT | David Tolnay |

Karmania uses the crates that are `MIT OR Apache-2.0` (and `Unlicense OR MIT`) **under the MIT licence**, whose text follows, with the copyright lines of the table; `crs-definitions`
is under CC0-1.0 (see The EPSG Dataset); `unicode-ident` is also under the Unicode licence, which follows.

```text
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

`libm` has notices of its own, for the parts that it takes from musl libc and others, which it asks to be kept (its licence file, from the point where they begin):

```text
------------------------------------------------------------------------------

This Rust library contains the following copyrights:

    Copyright (c) 2018 Jorge Aparicio

Portions of this software are derived from third-party works licensed under
terms compatible with the above MIT license:

* musl libc https://www.musl-libc.org/. This library contains the following
  copyright:

      Copyright © 2005-2020 Rich Felker, et al.

* The CORE-MATH project https://core-math.gitlabpages.inria.fr/. CORE-MATH
  routines are available under the MIT license on a per-file basis.

The musl libc COPYRIGHT file also includes the following notice relevant to
math portions of the library:

------------------------------------------------------------------------------
Much of the math library code (src/math/* and src/complex/*) is
Copyright © 1993,2004 Sun Microsystems or
Copyright © 2003-2011 David Schultz or
Copyright © 2003-2009 Steven G. Kargl or
Copyright © 2003-2009 Bruce D. Evans or
Copyright © 2008 Stephen L. Moshier or
Copyright © 2017-2018 Arm Limited
and labelled as such in comments in the individual source files. All
have been licensed under extremely permissive terms.
------------------------------------------------------------------------------

Copyright notices are retained in src/* files where relevant.
```

`unicode-ident`, the licence of the Unicode data in it:

```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2023 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```

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

This file travels with the builds (see the top of it).

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

The text is that of the file `LICENSE-ISC` of the crate. The crate is in the WebAssembly module (it triangulates the polygons), so this notice travels with the builds, in this file.

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
