import { defineConfig } from 'vite';

/** The pages of the app: the app itself, the gallery that shows the components in isolation, and the page that embeds the viewer as an embedder would. */
export default defineConfig({
  // The engine's worker is a module worker (it imports other modules).
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        index: new URL('./index.html', import.meta.url).pathname,
        gallery: new URL('./gallery.html', import.meta.url).pathname,
        embed: new URL('./embed.html', import.meta.url).pathname,
      },
      // The licence comments of three.js and Lit are kept in the code (the minifier drops them otherwise); THIRD_PARTY_NOTICES.md, which is copied into the build, has the texts.
      output: { comments: { legal: true } },
    },
  },
  // The screenshot tests' browser runs in Docker and reaches this server by that name.
  preview: { port: 4174, strictPort: true, allowedHosts: ['host.docker.internal'] },
});
