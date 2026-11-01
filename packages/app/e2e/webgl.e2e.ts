/**
 * WebGL2 works in the browser that Playwright installed, the one the ordinary tests, the accessibility
 * pass and the CI jobs use. The same check runs in the screenshot browser in `webgl.visual.ts`.
 */
import { test } from '@playwright/test';
import { expectTriangle } from './support/webgl.js';

test.describe('WebGL2 in the browser of the ordinary tests', () => {
  test('draws a triangle and reads the pixels back', async ({ page }, testInfo) => {
    const result = await expectTriangle(page);
    // It shows in the report which driver drew it.
    testInfo.annotations.push({
      type: 'renderer',
      description: `${result.renderer}, picture ${result.hash}`,
    });
  });
});
