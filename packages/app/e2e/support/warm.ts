/**
 * The first WebGL context of a browser starts its graphics process, which holds the page that asks for it for a hundred milliseconds or
 * more (118 to 292 ms were seen in the first measurement of a run, and 58 and 60 ms in the load of the first of each of the large files): that
 * is the browser's own start, once, and not the page's work. The timings of `pnpm perf` make a context, and use it, before anything is measured.
 */
import type { Browser } from '@playwright/test';

export async function warmTheGraphicsProcess(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('about:blank');
  await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.clear(gl.COLOR_BUFFER_BIT);
    gl?.finish();
  });
  await context.close();
}
