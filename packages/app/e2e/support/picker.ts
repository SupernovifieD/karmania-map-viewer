import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

/** The contents of a file to choose in the picker, as Playwright takes them. */
export interface Sample {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

/** A file to choose: a sample file of the repository, by name, or one made on the spot. */
export type Pick = string | Sample;

/** A sample file of the repository (in `fixtures/`), by name. */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url));
}

/** What to give the picker for a pick. Playwright takes paths or contents but not both at once. */
function sampleOf(pick: Pick): Sample {
  return typeof pick === 'string'
    ? { name: pick, mimeType: 'text/plain', buffer: readFileSync(fixturePath(pick)) }
    : pick;
}

/**
 * Does `trigger` (which makes the page open its file picker) and chooses `files` in the picker that
 * opens. Playwright turns on its hold on the picker a moment after it is asked to, and a picker
 * opened before then is never seen, which a quick key press would do: so a round trip to the page
 * comes between asking and triggering.
 */
export async function pickFiles(
  page: Page,
  trigger: () => Promise<void>,
  files: readonly Pick[],
): Promise<void> {
  const opened = page.waitForEvent('filechooser', { timeout: 10_000 });
  // If the trigger fails first, there is nothing to say about a picker that never came.
  opened.catch(() => undefined);
  await page.evaluate(() => undefined);
  await trigger();
  const chooser = await opened;
  await chooser.setFiles(files.map(sampleOf));
}
