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
    },
  },
  // The screenshot tests' browser runs in Docker and reaches this server by that name.
  preview: { port: 4174, strictPort: true, allowedHosts: ['host.docker.internal'] },
});
