import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { pickFiles } from './picker.js';
import type { Pick } from './picker.js';

/** The import wizard's controls, as a person meets them. */
export function wizard(page: Page) {
  const host = page.locator('karmania-import-dialog');
  return {
    host,
    dialog: host.locator('dialog'),
    /** The `data-step` of the step that is shown. */
    step: host.locator('.step'),
    next: host.locator('k-button[slot="footer-end"]').nth(1),
    back: host.locator('k-button[slot="footer-end"]').nth(0),
    cancel: host.locator('k-button[slot="footer-start"]'),
    note: host.locator('span[slot="footer-note"]'),
    importButton: page.locator('karmania-app header.toolbar k-button button'),
    map: page.locator('karmania-map-area k-empty-state'),
    tabs: page.locator('karmania-panel k-tabs [role="tab"]'),
  };
}

/** What the app has kept, and what the engine holds, as plain data. */
export interface Kept {
  readonly datasets: readonly {
    readonly id: number;
    readonly name: string;
    readonly kind: string;
    readonly elementCount: number;
    readonly vertexCount: number | undefined;
    readonly hasZ: boolean;
    readonly crs: unknown;
    readonly bbox: unknown;
    readonly columns: readonly {
      readonly name: string;
      readonly type: string;
      readonly nullCount: number;
    }[];
    readonly findings: readonly string[];
  }[];
  readonly selected: number | undefined;
  readonly inEngine: readonly number[];
}

/** What the app has kept of what was loaded, and what the engine holds. */
export function kept(page: Page): Promise<Kept> {
  return page.evaluate(() => {
    const app = document.querySelector('karmania-app') as unknown as {
      datasets: Record<string, unknown>[];
      selected: number | undefined;
      engine: { datasets: () => { id: number }[] } | undefined;
    };
    const summaries = app.datasets as unknown as {
      id: number;
      name: string;
      kind: string;
      elementCount: number;
      vertexCount?: number;
      hasZ: boolean;
      crs?: unknown;
      bbox?: unknown;
      columns: { name: string; type: string; nullCount: number }[];
      findings: { code: string }[];
    }[];
    return {
      datasets: summaries.map((summary) => ({
        id: summary.id,
        name: summary.name,
        kind: summary.kind,
        elementCount: summary.elementCount,
        vertexCount: summary.vertexCount,
        hasZ: summary.hasZ,
        crs: summary.crs,
        bbox: summary.bbox,
        columns: summary.columns,
        findings: summary.findings.map((finding) => finding.code),
      })),
      selected: app.selected,
      inEngine: app.engine?.datasets().map((each) => each.id) ?? [],
    };
  });
}

/** Presses Import, chooses `picks` in the picker, and waits for the wizard to have looked at them. */
export async function startWizard(page: Page, ...picks: Pick[]): Promise<void> {
  const w = wizard(page);
  await pickFiles(
    page,
    async () => {
      await w.importButton.click();
    },
    picks,
  );
  await expect(w.host.locator('karmania-file-step')).toBeVisible();
}

/** Presses Next, and waits for the step that follows to be shown. */
export async function goTo(page: Page, step: string): Promise<void> {
  const w = wizard(page);
  await expect(w.next.locator('button')).toBeEnabled();
  await w.next.click();
  await expect(w.step).toHaveAttribute('data-step', step);
}

/** The text of each element, with the white space of the markup gone. */
export function textsOf(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((all) =>
    all.map((element) => element.textContent.trim().replace(/\s+/g, ' ')),
  );
}
