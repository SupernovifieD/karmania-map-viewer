import { defineConfig, devices } from '@playwright/test';

/**
 * Three kinds of test. The ordinary ones (`*.e2e.ts`) run in the browser Playwright installed.
 * The screenshot tests (`*.visual.ts`) only exist when `PW_VISUAL_WS` says where a browser in the
 * official Playwright Docker image is listening, which `scripts/visual-tests` arranges: pixels
 * must come from the same browser on every machine to be compared. The accessibility pass
 * (`*.axe.ts`) only exists when `KARMANIA_AXE` is set, which `pnpm test:axe` does, and the timings
 * of the large files (`*.perf.ts`) when `KARMANIA_PERF` is, which `pnpm perf` does.
 */
const visualBrowser = process.env['PW_VISUAL_WS'];
// The accessibility pass over every state takes minutes, so it is a project of its own that exists
// only when `pnpm test:axe` asks for it.
const withAxe = process.env['KARMANIA_AXE'] !== undefined;
// The timings of the large files need a quiet machine and the files of `scripts/generate-fixtures`, so
// they are a project of their own too, that exists only when `pnpm perf` asks for it.
const withPerf = process.env['KARMANIA_PERF'] !== undefined;
// How that browser reaches this machine's web server.
const visualHost = process.env['PW_VISUAL_HOST'] ?? 'host.docker.internal';

export default defineConfig({
  testDir: 'e2e',
  // Not `.spec.ts`: Vitest would pick those up as unit tests.
  testMatch: '**/*.{e2e,visual}.ts',
  // One set of screenshots, whatever the platform of the machine that runs the tests: the
  // browser that takes them is always the one in the Docker image.
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  expect: {
    // Tight: a pixel has to be nearly the same colour, and none may differ more than that.
    toHaveScreenshot: { threshold: 0.05, animations: 'disabled', caret: 'hide' },
  },
  timeout: 60_000,
  forbidOnly: process.env['CI'] !== undefined,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4174' },
  projects: [
    { name: 'chromium', testIgnore: '**/*.visual.ts', use: { ...devices['Desktop Chrome'] } },
    ...(withPerf
      ? [
          {
            name: 'performance',
            testMatch: '**/*.perf.ts',
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
    ...(withAxe
      ? [
          {
            name: 'accessibility',
            testMatch: '**/*.axe.ts',
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
    ...(visualBrowser === undefined
      ? []
      : [
          {
            name: 'visual',
            testMatch: '**/*.visual.ts',
            use: {
              ...devices['Desktop Chrome'],
              baseURL: `http://${visualHost}:4174`,
              connectOptions: { wsEndpoint: visualBrowser },
            },
          },
        ]),
  ],
  webServer: {
    // For the browser in Docker the server has to listen on more than this machine's own address.
    command: `pnpm exec vite build && pnpm exec vite preview${visualBrowser === undefined ? '' : ' --host 0.0.0.0'}`,
    url: 'http://localhost:4174/gallery.html',
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 120_000,
  },
});
