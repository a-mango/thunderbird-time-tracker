import { expect, test } from '@playwright/test';
import { NOW, expectNoAxeViolations, openTracker, project } from './helpers.js';

// M7 robustness: storage failures show a notification bar (tab) or an alert (popup) with a
// recovery hint. The harness fakes them: `?fail=newer` (VersionError), `?fail=quota` (full disk).

test('a database from a newer version: the tab says to update the add-on', async ({ page }) => {
  await openTracker(page, '?seed=42&fail=newer');
  const bar = page.locator('tt-notification-bar[data-ref="notification"]');
  await expect(bar).toHaveAttribute('type', 'error');
  await expect(bar).toContainText('newer version of Time Tracker');
  await expect(bar.getByRole('button', { name: 'Reload' })).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('a full disk: a failed write says to free up space', async ({ page }) => {
  await openTracker(page, '?seed=42&fail=quota');
  await project(page, 'Build').click();
  const target = page
    .getByRole('treegrid', { name: 'Tasks' })
    .locator('tbody tr[data-key]')
    .filter({ hasText: 'Performance pass' });
  await target.hover();
  await target.getByRole('button', { name: 'Starred' }).click();
  const bar = page.locator('tt-notification-bar[data-ref="notification"]');
  await expect(bar).toContainText('Not enough storage space');
  await expect(bar).toHaveAttribute('role', 'alert');
  await expectNoAxeViolations(page);
});

test('the popup shows the same hints', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/ui/popup.html?seed=42&fail=newer');
  await page.locator('html[data-ready]').waitFor();
  await expect(page.getByRole('alert')).toContainText('newer version of Time Tracker');
  await expectNoAxeViolations(page);

  await page.goto('/ui/popup.html?seed=42&fail=quota');
  await page.locator('html[data-ready]').waitFor();
  await page.evaluate(() => {
    window.close = () => {};
  });
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('alert')).toContainText('Not enough storage space');
});
