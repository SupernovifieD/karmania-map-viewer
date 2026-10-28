import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Checks a page, or the part of it that `selector` finds, with axe, and fails on any serious
 * or critical accessibility violation, naming each one and where it is. To look inside a
 * component's shadow root, give the path: the host's selector, then the selector inside it.
 */
export async function expectNoSeriousViolations(
  page: Page,
  selector?: string | string[],
): Promise<void> {
  const builder = new AxeBuilder({ page });
  const results = await (selector === undefined ? builder : builder.include(selector)).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(
    serious.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      where: violation.nodes.map((node) => node.target.join(' ')),
    })),
  ).toEqual([]);
}
