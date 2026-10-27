/**
 * Builds and serves the page the browser tests open. It is a build, not the dev server,
 * so the tests run what an application would ship: the worker and the WebAssembly module
 * bundled as separate files.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'e2e/page',
  // The sample files in the repository, served from the root of the page.
  publicDir: '../../../../fixtures',
  // The worker is a module worker (it imports other modules).
  worker: { format: 'es' },
  build: { outDir: '../../dist/e2e', emptyOutDir: true, target: 'es2022' },
  preview: { port: 4173, strictPort: true },
});
