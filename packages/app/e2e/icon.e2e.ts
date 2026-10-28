import { expect, test } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';

test.describe('the icon', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/gallery.html');
  });

  test('is 16 pixels square by default and 20 when asked, for every icon', async ({ page }) => {
    const icons = page.locator('[data-icon]');
    const count = await icons.count();
    expect(count).toBeGreaterThan(10);
    for (let index = 0; index < count; index += 1) {
      const row = icons.nth(index);
      const small = await row.locator('k-icon').first().boundingBox();
      const medium = await row.locator('k-icon[size="20"]').boundingBox();
      expect([small?.width, small?.height]).toEqual([16, 16]);
      expect([medium?.width, medium?.height]).toEqual([20, 20]);
    }
  });

  test('draws something for every icon', async ({ page }) => {
    const empty = await page.evaluate(() =>
      [...document.querySelectorAll('karmania-gallery k-icon')]
        .filter((icon) => (icon.shadowRoot?.querySelector('svg')?.children.length ?? 0) === 0)
        .map((icon) => icon.getAttribute('name')),
    );
    expect(empty).toEqual([]);
  });

  test('is hidden from assistive technology unless it has a label', async ({ page }) => {
    const plain = page.locator('[data-icon="upload"] k-icon').first();
    await expect(plain.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(plain.locator('svg')).not.toHaveAttribute('role', /.*/);
    await expect(plain.locator('svg')).not.toHaveAttribute('aria-label', /.*/);
    const labelled = page.locator('#labelled-icon svg');
    await expect(labelled).toHaveAttribute('role', 'img');
    await expect(labelled).toHaveAttribute('aria-label', 'Warning');
    await expect(labelled).not.toHaveAttribute('aria-hidden', /.*/);
    await expect(page.getByRole('img', { name: 'Warning' })).toHaveCount(1);
    await expect(page.getByRole('img')).toHaveCount(1);
  });

  test('is drawn in the color of the text around it', async ({ page }) => {
    const stroke = await page.evaluate(() => {
      const host = document.createElement('div');
      host.style.color = 'rgb(200, 10, 20)';
      const icon = document.createElement('k-icon');
      icon.setAttribute('name', 'x');
      host.append(icon);
      document.body.append(host);
      return icon.updateComplete.then(() => {
        const svg = icon.shadowRoot?.querySelector('svg');
        return svg === null || svg === undefined ? '' : getComputedStyle(svg).stroke;
      });
    });
    expect(stroke).toBe('rgb(200, 10, 20)');
  });

  test('draws nothing, and does no harm, for a name that is not an icon', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const icon = document.createElement('k-icon');
      icon.setAttribute('name', 'not-an-icon');
      document.body.append(icon);
      await icon.updateComplete;
      return icon.shadowRoot?.querySelector('svg') ?? null;
    });
    expect(result).toBeNull();
  });

  test('changes with its name', async ({ page }) => {
    const drawings = await page.evaluate(async () => {
      const icon = document.createElement('k-icon');
      icon.setAttribute('name', 'x');
      document.body.append(icon);
      await icon.updateComplete;
      const before = icon.shadowRoot?.querySelector('svg')?.innerHTML;
      icon.setAttribute('name', 'check');
      await icon.updateComplete;
      return [before, icon.shadowRoot?.querySelector('svg')?.innerHTML];
    });
    expect(drawings[0]).not.toBe(drawings[1]);
  });

  for (const theme of ['light', 'dark']) {
    test(`has no serious accessibility violations in the ${theme} theme`, async ({ page }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      await expectNoSeriousViolations(page, ['karmania-gallery', '[data-section="icons"]']);
    });
  }
});
