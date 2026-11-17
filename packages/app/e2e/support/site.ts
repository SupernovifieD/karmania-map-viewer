import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, isAbsolute, join, normalize } from 'node:path';

/** What a site answered, to one request. */
export interface SiteRequest {
  /** The path asked for, without the query. */
  readonly path: string;
  readonly status: number;
  /** The `Content-Type` of the answer. */
  readonly type: string;
}

export interface Site {
  /** Where the site is, as a page goes to it: `http://127.0.0.1:port`. */
  readonly origin: string;
  /** Every request so far, in the order they were answered. */
  readonly requests: readonly SiteRequest[];
  close(): Promise<void>;
}

export interface SiteOptions {
  /** Pages and files made of text, by their path from the root of the site (`/index.html`, which is also `/`). */
  readonly pages: Readonly<Record<string, string>>;
  /** Folders of files, each served under a path (`/lib/` for the folder of a build). */
  readonly folders: Readonly<Record<string, string>>;
  /**
   * Headers on every answer, the pages and the files alike: a policy has to be on all of them, since the policy of a worker is the one on the answer that
   * gave its script, not the one of the page that started it.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

/** The `Content-Type` of what a build has. `.wasm` has to be `application/wasm`, or the browser will not compile it as it arrives. */
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.json': 'application/json',
};

/**
 * A static site on a port of its own, on this machine, for a test of what a page does with files that are not the app's (the built library, loaded as an embedder
 * would load it, from a path it chose). Nothing is cached, and a request for what is not there is a 404 that `requests` shows.
 */
export async function serveSite(options: SiteOptions): Promise<Site> {
  const requests: SiteRequest[] = [];
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
    const answer = (status: number, type: string, body: Buffer | string): void => {
      requests.push({ path, status, type });
      response.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
        ...options.headers,
      });
      response.end(body);
    };
    const page = options.pages[path === '/' ? '/index.html' : path];
    if (page !== undefined) {
      answer(200, TYPES[extname(path === '/' ? '/index.html' : path)] ?? 'text/plain', page);
      return;
    }
    for (const [mount, folder] of Object.entries(options.folders)) {
      if (!path.startsWith(mount)) {
        continue;
      }
      const inside = normalize(path.slice(mount.length));
      // Only what is under the folder.
      if (isAbsolute(inside) || inside.startsWith('..')) {
        answer(403, 'text/plain', 'Not under the folder');
        return;
      }
      try {
        const file = join(folder, inside);
        if (statSync(file).isFile()) {
          answer(200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file));
          return;
        }
      } catch {
        // There is no such file: the 404 below.
      }
    }
    answer(404, 'text/plain', `Nothing at ${path}`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
