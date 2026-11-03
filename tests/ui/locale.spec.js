import { expect, test } from '@playwright/test';
import { NOW, expectNoAxeViolations, openTracker } from './helpers.js';

// M7: the French locale renders, keeps the page language, passes axe, and its longer strings
// don't overflow the fixed-width controls (header buttons, pills, popup buttons).

/**
 * Buttons whose text is cut off (scrollWidth beyond the box) in the visible page.
 * @param {import('@playwright/test').Page} page
 */
const clipped = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((button) => button.offsetParent !== null && button.textContent?.trim())
      .filter((button) => button.scrollWidth > button.clientWidth + 1)
      .map((button) => button.textContent?.trim()),
  );

test('tracker in French', async ({ page }) => {
  await openTracker(page, '?seed=42&locale=fr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('button', { name: 'Nouvelle tâche' })).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Vues' })).toBeVisible();
  await page.getByRole('button', { name: 'Filtre rapide' }).click();
  expect(await clipped(page)).toEqual([]);
  await expectNoAxeViolations(page);
});

test('popup in French', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/ui/popup.html?seed=42&locale=fr');
  await page.locator('html[data-ready]').waitFor();
  await expect(page.getByRole('button', { name: 'Ouvrir Time Tracker' })).toBeVisible();
  expect(await clipped(page)).toEqual([]);
  await expectNoAxeViolations(page);
});
