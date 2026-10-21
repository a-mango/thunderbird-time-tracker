import { expect, test } from '@playwright/test';
import { collectErrors, expectNoAxeViolations } from './helpers.js';

test('tracker tab renders fixture data through the mock messenger', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/ui/tracker.html');
  await expect(page.getByRole('heading', { level: 1, name: 'Time Tracker' })).toBeVisible();
  await expect(page).toHaveTitle('Time Tracker');
  const projects = page.getByRole('list').getByRole('listitem');
  await expect(projects.first()).toHaveText('Client work');
  await expect(projects).toHaveCount(10);
  await expect(page.getByText(/Projects: 10 · Tasks: 15 · Time entries: \d+/)).toBeVisible();
  await expectNoAxeViolations(page);
  expect(errors).toEqual([]);
});

test('tracker tab shows the empty state', async ({ page }) => {
  await page.goto('/ui/tracker.html?fixtures=empty');
  await expect(page.getByText('No projects yet.')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);
});

test('tracker tab passes axe in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/ui/tracker.html');
  await expect(page.getByRole('listitem').first()).toBeVisible();
  await expectNoAxeViolations(page);
});

test('tracker tab shows an error when the background does not answer', async ({ page }) => {
  await page.goto('/ui/tracker.html?fixtures=none');
  await expect(page.getByText('Could not load your data. Try reopening this tab.')).toBeVisible();
});

test('popup renders its placeholder', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/ui/popup.html');
  await expect(page.getByRole('heading', { name: 'Time Tracker' })).toBeVisible();
  await expect(page.getByText('No timer running.')).toBeVisible();
  await expectNoAxeViolations(page);
  expect(errors).toEqual([]);
});
