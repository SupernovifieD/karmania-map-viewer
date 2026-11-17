/// <reference types="node" />
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * The library build of `@karmania/viewer` (brief 23.2), made into a folder of its own, and what a page that embeds it relies on: the module and the style sheet, the
 * worker, the WebAssembly module and the fonts as files that are found from where the module and the style sheet are, and nothing made into a `data:` URL.
 * The tests of the page that loads it, in a browser, are in `e2e/embed-library.e2e.ts`.
 */

const viewer = fileURLToPath(new URL('../../viewer/', import.meta.url));
let out = '';

/** The files under `folder`, as paths from it. */
function files(folder: string, from = ''): string[] {
  return readdirSync(join(folder, from)).flatMap((name) => {
    const path = join(from, name);
    return statSync(join(folder, path)).isDirectory() ? files(folder, path) : [path];
  });
}

const text = (path: string): string => readFileSync(join(out, path), 'utf8');
/**
 * Whether the file `path` has `pattern` in it, as a boolean and not as a text to match: a test that fails must not print a file of megabytes (the code
 * is 1 MB, and a build that has the WebAssembly module in it is 8).
 */
const has = (path: string, pattern: RegExp): boolean => pattern.test(text(path));
const assets = (): string[] => files(out).filter((path) => path.startsWith('assets/'));

/**
 * The names that end in `ext` in `code` (up to 80 letters, digits, `_` and `-` before it), found from the extension and not by a pattern that starts at every
 * letter: a build that has the WebAssembly module in the worker has it as base64, with runs of thousands of one letter, and such a pattern takes hours over them.
 */
function namesBefore(code: string, ext: string): string[] {
  const names: string[] = [];
  for (let at = code.indexOf(ext); at >= 0; at = code.indexOf(ext, at + 1)) {
    const name = /[\w-]{1,80}$/.exec(code.slice(Math.max(0, at - 80), at))?.[0];
    if (name !== undefined) {
      names.push(name + ext);
    }
  }
  return names;
}

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'karmania-library-'));
  await build({
    root: viewer,
    configFile: join(viewer, 'vite.config.ts'),
    logLevel: 'silent',
    build: { outDir: out, emptyOutDir: true },
  });
}, 180_000);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe('the library build of the viewer', () => {
  it('is a module, a style sheet and the assets they load, and nothing else that a page has to know of', () => {
    const names = files(out).filter((path) => !path.endsWith('.map'));
    expect(names.filter((path) => !path.startsWith('assets/'))).toEqual([
      'karmania-viewer.js',
      'style.css',
    ]);
    const kinds = assets().filter((path) => !path.endsWith('.map'));
    expect(kinds.map((path) => path.replace(/-[\w-]{8}\./, '-HASH.')).sort()).toEqual([
      'assets/inter-latin-ext-wght-normal-HASH.woff2',
      'assets/inter-latin-wght-normal-HASH.woff2',
      'assets/karmania_wasm_bg-HASH.wasm',
      'assets/worker-entry-HASH.js',
    ]);
  });

  it('exports what the package does and nothing else', () => {
    const code = text('karmania-viewer.js');
    const tail = /export\s*\{([^}]*)\}\s*;?\s*(?:\/\/#.*)?\s*$/.exec(code)?.[1] ?? '';
    const names = tail.split(',').map((part) =>
      part
        .trim()
        .split(/\s+as\s+/)
        .pop(),
    );
    expect(names.sort()).toEqual([
      'EngineDisposedError',
      'EngineError',
      'KarmaniaViewer',
      'blocks',
      'createEngine',
      'createViewer',
      'grid',
      'lines',
      'mesh',
      'points',
      'polygons',
    ]);
  });

  it('has no asset made into a data: URL, so that the WebAssembly module and the fonts are files', () => {
    const urls = /data:[a-z]+\/[\w.+-]+[;,]/;
    for (const path of [
      'karmania-viewer.js',
      'style.css',
      ...assets().filter((p) => p.endsWith('.js')),
    ]) {
      expect(has(path, urls), `${path} has a data: URL`).toBe(false);
    }
    // A WebAssembly module of 5.7 MB written into the code would make it 7.6 MB: these are the sizes of code.
    expect(statSync(join(out, 'karmania-viewer.js')).size).toBeLessThan(2_000_000);
    const worker = assets().find((path) => /worker-entry-.*\.js$/.test(path)) ?? '';
    expect(statSync(join(out, worker)).size).toBeLessThan(200_000);
  });

  it('finds the worker from the module, the WebAssembly module from the worker, and the fonts from the style sheet, by where each is', () => {
    const worker = assets().find((path) => /worker-entry-.*\.js$/.test(path)) ?? '';
    const found = /new URL\(`assets\/worker-entry-[\w-]+\.js`,import\.meta\.url\)/;
    expect(has('karmania-viewer.js', found), 'the code finds the worker from itself').toBe(true);
    // Not from the root of a site (the page puts the files where it likes).
    expect(has('karmania-viewer.js', /[`"']\/assets\//), 'the code has a path from the root').toBe(
      false,
    );
    const wasm = /new URL\(`karmania_wasm_bg-[\w-]+\.wasm`,import\.meta\.url\)/;
    expect(has(worker, wasm), 'the worker finds the WebAssembly module from itself').toBe(true);
    const sheet = text('style.css');
    expect([...sheet.matchAll(/url\(([^)]*)\)/g)].map((match) => match[1]).sort()).toEqual([
      expect.stringMatching(/^\.\/assets\/inter-latin-ext-wght-normal-[\w-]+\.woff2$/),
      expect.stringMatching(/^\.\/assets\/inter-latin-wght-normal-[\w-]+\.woff2$/),
    ]);
  });

  it('refers only to files that are there', () => {
    const present = new Set(assets().map((path) => path.slice('assets/'.length)));
    const named = [
      ...text('karmania-viewer.js').matchAll(/assets\/([\w.-]+\.(?:js|wasm|woff2))/g),
      ...text('style.css').matchAll(/assets\/([\w.-]+\.(?:js|wasm|woff2))/g),
    ]
      .map((match) => match[1] ?? '')
      .concat(
        namesBefore(
          text(assets().find((path) => /worker-entry-.*\.js$/.test(path)) ?? ''),
          '.wasm',
        ),
      );
    expect(named.length).toBeGreaterThan(3);
    for (const name of named) {
      expect(present.has(name), name).toBe(true);
    }
  });

  it('has the tokens and Inter in its style sheet, and styles nothing of the page', () => {
    const sheet = text('style.css');
    expect(sheet.includes('--k-space-8')).toBe(true);
    expect(sheet.includes('--k-font-sans')).toBe(true);
    expect(sheet.match(/@font-face/g)).toHaveLength(2);
    // What it selects is the root (for the custom properties), and what it is told with a data-theme; the page's own elements are not styled.
    const selectors = [...sheet.replace(/@font-face\s*\{[^}]*\}/g, '').matchAll(/([^{}]+)\{/g)].map(
      (match) => (match[1] ?? '').trim(),
    );
    for (const selector of selectors) {
      if (!selector.startsWith('@')) {
        expect(selector, selector).toMatch(/^:root/);
      }
    }
  });
});
