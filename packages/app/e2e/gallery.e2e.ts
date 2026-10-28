import { expect, test } from '@playwright/test';

test('the gallery page loads the UI package and renders a Lit element', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.goto('/gallery.html');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Karmania components');
  await expect(page.locator('karmania-gallery p').first()).toHaveText('From @karmania/ui.');
  expect(errors).toEqual([]);
});
