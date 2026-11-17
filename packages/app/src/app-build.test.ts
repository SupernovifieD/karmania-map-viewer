/// <reference types="node" />
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * The build of the app (the app, the gallery and the page that embeds the viewer) is a build that is given to people too, so it keeps the licence comments of three.js and Lit in its
 * code as the library build does (step 23.5); `scripts/copy-notices.mjs` puts the notices beside it, which `library-types.test.ts` checks and which `package.json` of the app calls.
 */
const app = fileURLToPath(new URL('../', import.meta.url));
let out = '';

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'karmania-app-'));
  await build({
    root: app,
    configFile: join(app, 'vite.config.ts'),
    logLevel: 'silent',
    build: { outDir: out, emptyOutDir: true },
  });
}, 180_000);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe('the build of the app', () => {
  it('keeps the licence comments of three.js (MIT) and of Lit (BSD-3-Clause) in its code', () => {
    const code = readdirSync(join(out, 'assets'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(out, 'assets', name), 'utf8'))
      .join('\n');
    expect(/SPDX-License-Identifier: MIT/.test(code), 'MIT').toBe(true);
    expect(/Copyright 20\d\d-20\d\d Three\.js Authors/.test(code), 'three.js').toBe(true);
    expect(/SPDX-License-Identifier: BSD-3-Clause/.test(code), 'BSD').toBe(true);
    expect(/Copyright 20\d\d Google LLC/.test(code), 'Google').toBe(true);
  });
});
