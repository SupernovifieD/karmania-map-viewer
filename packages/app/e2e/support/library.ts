import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as Viewer from '@karmania/viewer';
import { build } from 'vite';

declare global {
  interface Window {
    /** `@karmania/viewer` as the page of `libraryPages` loaded it: from the files of the build, not from the sources. */
    library: typeof Viewer;
    /** The viewers that a test made in the two places of the page (`#first`, `#second`). */
    first?: Viewer.Viewer;
    second?: Viewer.Viewer;
  }
}

const viewer = fileURLToPath(new URL('../../../viewer/', import.meta.url));

/** The library build of the viewer, made into a folder of its own. */
export interface BuiltLibrary {
  /** The folder: `karmania-viewer.js`, `style.css` and `assets/`. */
  readonly folder: string;
  remove(): void;
}

/** Builds the library as `pnpm --filter @karmania/viewer build` does (the declarations aside, which no browser reads), so that a test does not depend on a build that was made earlier. */
export async function buildLibrary(): Promise<BuiltLibrary> {
  const folder = mkdtempSync(join(tmpdir(), 'karmania-site-'));
  await build({
    root: viewer,
    configFile: join(viewer, 'vite.config.ts'),
    logLevel: 'silent',
    build: { outDir: folder, emptyOutDir: true },
  });
  return {
    folder,
    remove: () => {
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

/** What the page of an embedder is made of: how big the places are that the viewers go in, and nothing else of how it looks. */
const PAGE_CSS = `
body { margin: 0; padding: 16px; }
.slot { width: 720px; height: 480px; margin-bottom: 16px; }
`;

/**
 * The files of a page that embeds the viewer from the build at `mount` (the folder of the build is served there: `/lib/`, or `/vendor/karmania/1.2/`), as an
 * embedder would write them: the style sheet linked, the module loaded, and two places for viewers. It has no inline script and no inline style, which a strict
 * policy would refuse; `window.library` is the module's exports.
 */
export function libraryPages(mount: string): Record<string, string> {
  return {
    '/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>A page that embeds the viewer</title>
    <link rel="stylesheet" href="${mount}style.css" />
    <link rel="stylesheet" href="/page.css" />
  </head>
  <body>
    <div id="first" class="slot"></div>
    <div id="second" class="slot"></div>
    <script type="module" src="/page.js"></script>
  </body>
</html>
`,
    '/page.css': PAGE_CSS,
    '/page.js': `import * as library from '${mount}karmania-viewer.js';\nwindow.library = library;\n`,
  };
}
