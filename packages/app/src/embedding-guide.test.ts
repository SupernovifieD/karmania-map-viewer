/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EMBED_POLICY, policyHeader } from '../e2e/support/policy';

/*
 * What `docs/embedding.md` says that has to be what the code and the other documents say (step 23.6): the Content Security Policy is the one that `embed-csp.e2e.ts` shows to be the
 * smallest, and the acknowledgement of the EPSG Dataset is the one of `THIRD_PARTY_NOTICES.md`, which `docs/dependencies.md` says this guide has to carry. (The TypeScript examples are
 * compiled against the built declarations in `library-types.test.ts`.)
 */
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const guide = readFileSync(join(repo, 'docs', 'embedding.md'), 'utf8');
const notices = readFileSync(join(repo, 'THIRD_PARTY_NOTICES.md'), 'utf8');
/** A text as a reader sees it: the white space of its layout is one space. */
const squash = (text: string): string => text.replace(/\s+/g, ' ');

describe('the guide to embedding the viewer', () => {
  it('gives the policy that the strict-policy test shows to be the smallest, whole', () => {
    expect(guide.includes(policyHeader(EMBED_POLICY))).toBe(true);
  });

  it('has the acknowledgement of the EPSG Dataset that THIRD_PARTY_NOTICES.md has, and the address of its terms', () => {
    const acknowledgement =
      'Ownership of the EPSG Dataset by IOGP (the International Association of Oil & Gas Producers) is acknowledged.';
    expect(squash(guide).includes(acknowledgement)).toBe(true);
    expect(squash(notices).includes(acknowledgement)).toBe(true);
    for (const text of [guide, notices]) {
      expect(text.includes('https://epsg.org/terms-of-use.html')).toBe(true);
    }
  });

  it('names, in its table of what the build gives, every file that the build puts in the folder (the prose may say them too, which is not the table)', () => {
    const table = guide.slice(guide.indexOf('## What you get'), guide.indexOf('## A page'));
    expect(table.length).toBeGreaterThan(200);
    for (const name of [
      'karmania-viewer.js',
      'style.css',
      'worker-entry',
      'karmania_wasm_bg',
      'inter-',
      'OFL.txt',
      'karmania-viewer.d.ts',
      'THIRD_PARTY_NOTICES.md',
      'LICENSE',
    ]) {
      expect(table.includes(name), `${name} is not in the table of the files`).toBe(true);
    }
  });

  it('gives every code of an ExportError that the renderer has, in the guide and in the comment of exportPng, since a page that switches on the code has to know them all', () => {
    const source = readFileSync(
      join(repo, 'packages', 'render', 'src', 'export-render.ts'),
      'utf8',
    );
    const block = /export type ExportErrorCode =([\s\S]*?);/.exec(source)?.[1] ?? '';
    const codes = [...block.matchAll(/\|\s*'([a-z_]+)'/g)].map((match) => match[1] ?? '');
    // A list that is found to be empty would find no fault.
    expect(codes.length).toBeGreaterThanOrEqual(8);
    const api = readFileSync(join(repo, 'packages', 'viewer', 'src', 'create-viewer.ts'), 'utf8');
    for (const code of codes) {
      expect(guide.includes(`\`${code}\``), `${code} is not in the guide`).toBe(true);
      expect(api.includes(`\`${code}\``), `${code} is not in the comment of exportPng`).toBe(true);
    }
  });
});
