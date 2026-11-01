import { defineConfig, devices } from '@playwright/test';

const inCi = process.env['CI'] !== undefined;

export default defineConfig({
  testDir: 'e2e',
  // Not `.spec.ts`: Vitest would pick those up as unit tests.
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  forbidOnly: process.env['CI'] !== undefined,
  // In CI a failed run leaves a report and the traces of the tests that failed, which the workflow
  // uploads (decision 10.6). On a developer's machine nothing is added to the list.
  reporter: inCi ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL: 'http://localhost:4173', trace: inCi ? 'retain-on-failure' : 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'pnpm exec vite build --config vite.e2e.config.ts && pnpm exec vite preview --config vite.e2e.config.ts',
    url: 'http://localhost:4173',
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 120_000,
  },
});
