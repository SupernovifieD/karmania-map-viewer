import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/target/',
    '**/pkg/',
    'packages/engine/wasm/',
    '**/playwright-report/',
    '**/test-results/',
    'fixtures/',
    '.claude/',
  ]),
  eslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Named exports only. Tool config files (below) are the exception.
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
    },
  },
  {
    // Plain JavaScript (tool configs, scripts) is not part of any tsconfig.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Vite, Vitest, Playwright and ESLint require a default export.
    files: ['**/*.config.{js,mjs,cjs,ts,mts}'],
    rules: { 'no-restricted-exports': 'off' },
  },
);
