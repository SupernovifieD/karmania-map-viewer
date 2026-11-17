import type { Page } from '@playwright/test';

/** The directives of a Content Security Policy, each with its sources. */
export type Policy = Readonly<Record<string, readonly string[]>>;

/**
 * The smallest policy under which the viewer works (step 23.3): nothing is allowed unless a directive here says so, and each of the five allowances below is shown
 * necessary by `embed-csp.e2e.ts` (take it away and something fails). It is the policy of `docs/embedding.md`.
 *
 * - `script-src 'self'`: the page's module and the library's. It governs the engine's worker as well, which is a script of the library's own folder (`worker-src` falls back to
 *   it), so a page that names `worker-src` has to give it `'self'` too.
 * - `'wasm-unsafe-eval'`: the engine's WebAssembly module (the coordinate systems, the file readers, the contours) is compiled in the worker.
 * - `connect-src 'self'`: the worker fetches that module (`fetch` is governed by `connect-src`).
 * - `style-src 'self'`: the style sheets (the library's and the page's). No inline style is written as text, so no `'unsafe-inline'`.
 * - `font-src 'self'`: Inter, which the interface is set in and the export waits for.
 *
 * No directive is needed for images (the picture of an export is made on a canvas and given as a `blob:` download, which no directive governs), frames, forms or the base of
 * the page; `default-src 'none'` closes all of them.
 */
export const EMBED_POLICY: Policy = {
  'default-src': ["'none'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'"],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
};

/** The policy as a header: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; ...`. */
export function policyHeader(policy: Policy): string {
  return Object.entries(policy)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');
}

/** `policy` with the directive `name` taken out, or given `sources`. */
export function changed(policy: Policy, name: string, sources?: readonly string[]): Policy {
  const rest = Object.fromEntries(
    Object.entries(policy).filter(([directive]) => directive !== name),
  );
  return sources === undefined ? rest : { ...rest, [name]: sources };
}

declare global {
  interface Window {
    /** What `blockedBy` has heard: the directive and what it blocked. */
    __violations: string[];
  }
}

/**
 * Keeps what the browser says it blocked (a `securitypolicyviolation` event of the document), from before any script of the page runs: call it before `goto`. The
 * function it returns gives them, each as the directive that was violated and what was blocked.
 */
export async function blockedBy(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => [...window.__violations]);
}
