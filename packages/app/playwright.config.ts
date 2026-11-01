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
const inCi = process.env['CI'] !== undefined;
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
  // In CI a failed run leaves a report and the traces of the tests that failed, which the workflow
  // uploads; a trace is the only way to look into a failure that does not come back on a developer's
  // machine (decision 10.6). On a developer's machine nothing is added to the list.
  reporter: inCi ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL: 'http://localhost:4174', trace: inCi ? 'retain-on-failure' : 'off' },
  // No Chromium flags are set for WebGL2 (decision 11.5): Playwright starts Chromium with
  // `--enable-unsafe-swiftshader` itself, and that is all the software driver needs, for the ordinary
  // and accessibility projects and for the browser in Docker. Adding `args` to the `visual` project
  // would do nothing: the Playwright server in the image drops the arguments a client sends. The
  // two files `webgl.e2e.ts` and `webgl.visual.ts` fail if WebGL2 stops working in either browser.
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
