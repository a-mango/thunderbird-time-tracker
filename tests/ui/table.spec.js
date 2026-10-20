import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, openGallery, recordEvents } from './helpers.js';

/** @param {import('@playwright/test').Page} page */
const grid = (page) => page.getByRole('treegrid', { name: 'Tasks' });
/** @param {import('@playwright/test').Page} page */
const bodyRows = (page) => grid(page).locator('tbody tr');
/** @param {import('@playwright/test').Page} page */
const taskNames = (page) => grid(page).locator('tbody tr td:nth-child(3)').allTextContents();

test.beforeEach(async ({ page }) => {
  await openGallery(page);
});

test('the selected row has focus and is the only tabbable row', async ({ page }) => {
  const selected = grid(page).locator('tr[aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  await expect(selected).toBeFocused();
  await expect(selected).toContainText('Checkout form validation');
  await expect(grid(page).locator('tbody tr[tabindex="0"]')).toHaveCount(1);
});

test('Up/Down, Home/End and PageUp/PageDown select rows', async ({ page }) => {
  const events = await recordEvents(page, 'tt-select');
  const rows = bodyRows(page);
  const count = await rows.count();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('End');
  await expect(rows.nth(count - 1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(count - 1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect(rows.nth(0)).not.toBeFocused();
  await page.keyboard.press('PageUp');
  await expect(rows.nth(0)).toBeFocused();
  expect((await events()).length).toBeGreaterThanOrEqual(4);
});

test('Enter and double-click activate the row', async ({ page }) => {
  const activated = await recordEvents(page, 'tt-activate');
  await page.keyboard.press('Enter');
  await bodyRows(page).nth(2).dblclick();
  const keys = await activated();
  expect(keys).toHaveLength(2);
  expect(keys[0].key).not.toBe(keys[1].key);
});

test('header buttons sort ascending, then descending, by click or keyboard', async ({ page }) => {
  const sorts = await recordEvents(page, 'tt-sort');
  const header = grid(page).getByRole('columnheader', { name: 'Task' });
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  const ascending = await taskNames(page);
  expect(ascending).toEqual([...ascending].sort((a, b) => a.localeCompare(b, 'en')));
  await header.getByRole('button').focus();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  expect(await taskNames(page)).toEqual([...ascending].reverse());
  // Only the sorted column carries aria-sort.
  await expect(grid(page).locator('th[aria-sort]')).toHaveCount(1);
  expect(await sorts()).toEqual([
    { column: 'name', direction: 'ascending' },
    { column: 'name', direction: 'descending' },
  ]);
  // Selection survives sorting.
  await expect(grid(page).locator('tr[aria-selected="true"]')).toContainText(
    'Checkout form validation',
  );
});

test('column picker hides and shows columns from the keyboard and persists', async ({ page }) => {
  const picker = page.getByRole('button', { name: 'Select columns to display' });
  await picker.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(picker).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menu', { name: 'Select columns to display' })).toBeVisible();
  await expectNoAxeViolations(page);
  const week = menu.getByRole('menuitemcheckbox', { name: 'Week' });
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Starred' })).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect(week).toBeFocused();
  await page.keyboard.press(' ');
  await expect(week).toHaveAttribute('aria-checked', 'false');
  await expect(grid(page).getByRole('columnheader', { name: 'Week' })).toHaveCount(0);
  // The required column cannot be hidden.
  const task = menu.getByRole('menuitemcheckbox', { name: 'Task' });
  await expect(task).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(picker).toBeFocused();
  await expect(picker).toHaveAttribute('aria-expanded', 'false');

  await page.reload();
  await page.locator('html[data-ready]').waitFor();
  await expect(grid(page).getByRole('columnheader', { name: 'Week' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Select columns to display' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Week' }).click();
  await expect(grid(page).getByRole('columnheader', { name: 'Week' })).toHaveCount(1);
});

test('columns resize from the keyboard and the width persists', async ({ page }) => {
  const resizer = page.getByRole('separator', { name: 'Resize column Week' });
  const header = grid(page).getByRole('columnheader', { name: 'Week' });
  const before = (await header.boundingBox())?.width ?? 0;
  await expect(resizer).toHaveAttribute('aria-valuenow', '80');
  await resizer.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(resizer).toHaveAttribute('aria-valuenow', '140');
  expect((await header.boundingBox())?.width ?? 0).toBeGreaterThan(before + 50);
  for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect(resizer).toHaveAttribute('aria-valuenow', '40');
  await page.reload();
  await page.locator('html[data-ready]').waitFor();
  await expect(page.getByRole('separator', { name: 'Resize column Week' })).toHaveAttribute(
    'aria-valuenow',
    '40',
  );
});
