import { defineConfig } from 'vite';

/**
 * The library build of the viewer (brief 23.2): `dist/karmania-viewer.js`, an ES module that a page loads with `<script type="module">`, `dist/style.css`, and
 * what they load by URL, relative to themselves: the engine's worker (`assets/worker-entry-*.js`), the WebAssembly module (`assets/karmania_wasm_bg-*.wasm`)
 * and Inter (`assets/*.woff2`). It is self-contained (Lit and three.js are in it), so that it needs no bundler on the page that embeds it.
 *
 * It is not Vite's library mode: that mode puts every asset in the code as a `data:` URL (a strict policy does not allow them, and the WebAssembly module
 * is 5.7 MB), whatever `assetsInlineLimit` says. A build of one entry whose exports are kept gives the same module, with the assets as files.
 */
export default defineConfig({
  // What the code and the style sheet load is found from where they are, wherever the page puts the files: not from the root of the site.
  base: './',
  // The engine's worker is a module worker (it imports other modules).
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // Nothing is made into a `data:` URL.
    assetsInlineLimit: 0,
    sourcemap: true,
    // One module of about 1 MB is what is wanted (Lit and three.js are in it, the page needs no bundler), so the warning of Vite about a large chunk is not a signal.
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      input: { 'karmania-viewer': new URL('./src/library.ts', import.meta.url).pathname },
      preserveEntrySignatures: 'strict',
      output: {
        format: 'es',
        // The licence comments of three.js and Lit are kept in the code (the minifier drops them otherwise); THIRD_PARTY_NOTICES.md has the texts.
        comments: { legal: true },
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css'))
            ? 'style.css'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
