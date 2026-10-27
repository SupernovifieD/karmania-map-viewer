import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // Not `.spec.ts`: Vitest would pick those up as unit tests.
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  forbidOnly: process.env['CI'] !== undefined,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'pnpm exec vite build --config vite.e2e.config.ts && pnpm exec vite preview --config vite.e2e.config.ts',
    url: 'http://localhost:4173',
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 120_000,
  },
});
