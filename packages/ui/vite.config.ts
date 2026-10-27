import { defineConfig } from 'vite';

/** Builds the components as an ES module library. Lit is a dependency, not bundled. */
export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'karmania-ui' },
    rolldownOptions: { external: [/^lit(\/.*)?$/, /^@lit\//] },
    target: 'es2022',
    sourcemap: true,
  },
});
