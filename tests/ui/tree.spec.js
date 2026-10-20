import { expect, test } from '@playwright/test';
import { openGallery, recordEvents } from './helpers.js';

/** @param {import('@playwright/test').Page} page */
const projects = (page) => page.getByRole('tree', { name: 'Projects' });
/** Accessible names are "<name> <badge>", e.g. "Build 56h 31m". */
const named = (/** @type {string} */ name) =>
  new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
/** @param {import('@playwright/test').Page} page @param {string} name */
const item = (page, name) => projects(page).getByRole('treeitem', { name: named(name) });
/** @param {import('@playwright/test').Page} page @param {string} name */
const twisty = (page, name) => item(page, name).locator('.twisty');

test.beforeEach(async ({ page }) => {
  await openGallery(page);
});

test('roving tabindex: only the selected item is tabbable', async ({ page }) => {
  const tabbable = projects(page).locator('[role="treeitem"][tabindex="0"]');
  await expect(tabbable).toHaveCount(1);
  await expect(tabbable).toHaveAccessibleName(named('Build'));
  await expect(item(page, 'Build')).toHaveAttribute('aria-selected', 'true');
  await expect(projects(page).locator('[aria-selected="true"]')).toHaveCount(1);
});

test('Up/Down move focus and selection through visible items', async ({ page }) => {
  const selected = await recordEvents(page, 'tt-select');
  await item(page, 'Build').focus();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Content')).toBeFocused();
  await expect(item(page, 'Content')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Content')).toHaveAttribute('tabindex', '0');
  await expect(item(page, 'Build')).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(item(page, 'Discovery')).toBeFocused();
  expect((await selected()).length).toBe(3);
});

test('Home and End go to the first and last visible items', async ({ page }) => {
  await item(page, 'Build').focus();
  await page.keyboard.press('End');
  await expect(item(page, 'Archive')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(item(page, 'Client work')).toBeFocused();
});

test('Left goes to the parent, then collapses; Right expands, then enters', async ({ page }) => {
  const toggles = await recordEvents(page, 'tt-toggle');
  const harbor = item(page, 'Harbor Coffee — website');
  await item(page, 'Build').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(harbor).toBeFocused();
  await expect(harbor).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(harbor).toHaveAttribute('aria-expanded', 'false');
  await expect(item(page, 'Build')).toBeHidden();
  // Collapsed items are skipped by Down.
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Fern & Co — branding')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await expect(harbor).toHaveAttribute('aria-expanded', 'true');
  await expect(harbor).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(item(page, 'Discovery')).toBeFocused();
  expect(await toggles()).toEqual([
    { id: expect.any(String), expanded: false },
    { id: expect.any(String), expanded: true },
  ]);
});

test('collapsing an ancestor of the selection selects the ancestor', async ({ page }) => {
  await item(page, 'Build').focus();
  await twisty(page, 'Client work').click();
  await expect(item(page, 'Client work')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Client work')).toHaveAttribute('aria-expanded', 'false');
});

test('type-ahead jumps to the next matching label', async ({ page }) => {
  await item(page, 'Client work').focus();
  await page.keyboard.press('f');
  await expect(item(page, 'Fern & Co — branding')).toBeFocused();
  // After a pause a new search starts; a prefix typed quickly refines the match.
  await page.waitForTimeout(600);
  await page.keyboard.type('bo');
  await expect(item(page, 'Bookkeeping')).toBeFocused();
  // Repeating one letter cycles through matches after a pause.
  await page.waitForTimeout(600);
  await page.keyboard.press('t');
  await expect(item(page, 'Training')).toBeFocused();
});

test('Enter and double-click activate', async ({ page }) => {
  const activated = await recordEvents(page, 'tt-activate');
  await item(page, 'Build').focus();
  await page.keyboard.press('Enter');
  await item(page, 'Content').locator('.name').first().dblclick();
  const ids = await activated();
  expect(ids).toHaveLength(2);
});

test('clicking the twisty toggles and the state persists across reloads', async ({ page }) => {
  const internal = item(page, 'Internal');
  await twisty(page, 'Internal').click();
  await expect(internal).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await page.locator('html[data-ready]').waitFor();
  await expect(item(page, 'Internal')).toHaveAttribute('aria-expanded', 'false');
  await expect(item(page, 'Client work')).toHaveAttribute('aria-expanded', 'true');
});
