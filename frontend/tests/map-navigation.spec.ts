import { test, expect } from '@playwright/test';

test('user can browse discover, submit, and record pages', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('input[placeholder="Search trails..."]')).toBeVisible();
  await expect(page.locator('#map')).toBeVisible();

  await page.goto('/submit');
  await expect(page.getByRole('heading', { name: /Submit a new trail/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit trail' })).toBeVisible();
  await expect(page.locator('#submission-map')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

  await page.goto('/record');
  await expect(page.getByRole('heading', { name: /Record a hike/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(page.locator('#map')).toBeVisible();
});
