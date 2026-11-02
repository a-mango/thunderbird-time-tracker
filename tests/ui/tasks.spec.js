import { expect, test } from '@playwright/test';
import { contextMenu, expectNoAxeViolations, openTracker, project } from './helpers.js';

// M4 task list: create, edit, star, filters, sorting, columns, timer, done/undone, delete + undo.

/** @param {import('@playwright/test').Page} page */
const grid = (page) => page.getByRole('treegrid', { name: 'Tasks' });
/** @param {import('@playwright/test').Page} page */
const rows = (page) => grid(page).locator('tbody tr[data-key]');
/** @param {import('@playwright/test').Page} page @param {string} name */
const row = (page, name) => rows(page).filter({ hasText: name });
/** @param {import('@playwright/test').Page} page */
const names = (page) => rows(page).locator('td[data-column="name"]').allTextContents();
/** @param {import('@playwright/test').Page} page */
const reload = async (page) => {
  await page.reload();
  await page.locator('html[data-ready]').waitFor();
};

test.beforeEach(async ({ page }) => {
  // Fresh context, so the default seed applies once and later reloads keep the database.
  await openTracker(page);
  await project(page, 'Build').click();
  await expect(row(page, 'Checkout form validation')).toBeVisible();
});

test('header shows the project, the open count and the total', async ({ page }) => {
  await expect(page.locator('[data-ref="list-title"]')).toHaveText('Build');
  await expect(page.locator('[data-ref="list-count"]')).toContainText('7 open tasks ·');
  await expect(rows(page)).toHaveCount(7);
  await expect(page.locator('[data-ref="done-hidden"]')).toHaveText('3 done tasks hidden');
});

test('Ctrl+N creates a task and renames it inline; it persists', async ({ page }) => {
  await page.keyboard.press('Control+n');
  const field = grid(page).getByRole('textbox');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('New Task');
  await field.fill('Cart summary copy');
  await page.keyboard.press('Enter');
  await expect(row(page, 'Cart summary copy')).toBeFocused();
  await expect(rows(page)).toHaveCount(8);
  await reload(page);
  await expect(row(page, 'Cart summary copy')).toBeVisible();
});

test('F2 renames; Escape cancels', async ({ page }) => {
  await row(page, 'Client call notes').click();
  await page.keyboard.press('F2');
  const field = grid(page).getByRole('textbox');
  await field.fill('Ignored name');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Client call notes')).toBeVisible();
  await page.keyboard.press('F2');
  await grid(page).getByRole('textbox').fill('Kickoff call notes');
  await page.keyboard.press('Enter');
  await expect(row(page, 'Kickoff call notes')).toBeVisible();
});

test('Enter opens the properties dialog; estimate, billable and tags are saved', async ({
  page,
}) => {
  await row(page, 'Staging deploy script').click();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Task Properties' });
  await expect(dialog).toBeVisible();
  await expectNoAxeViolations(page);
  const estimate = dialog.getByLabel('Estimate');
  await estimate.fill('soon');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeVisible(); // invalid estimate keeps the dialog open
  await estimate.fill('1h30');
  await dialog.getByLabel('Billable').uncheck();
  await dialog.getByLabel('Tags').fill('Ops, Implementation');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'Staging deploy script').locator('td[data-column="estimate"]')).toHaveText(
    '1h 30m',
  );

  await page.keyboard.press('Enter');
  await expect(estimate).toHaveValue('1h 30m');
  await expect(dialog.getByLabel('Billable')).not.toBeChecked();
  await expect(dialog.getByLabel('Tags')).toHaveValue(/Ops/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('star toggles from the row button and from S', async ({ page }) => {
  const target = row(page, 'Performance pass');
  const star = target.getByRole('button', { name: 'Starred' });
  // Unstarred rows show the star on hover or selection, like Thunderbird.
  await target.hover();
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await target.click();
  await page.keyboard.press('s');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
});

test('quick filter pills and text combine with AND, persist per project, and clear', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Quick Filter' }).click();
  await page.getByRole('button', { name: 'Starred' }).first().click();
  expect(await names(page)).toEqual(['Checkout form validation', 'Fix mobile nav overflow']);
  await page.keyboard.press('Control+Shift+K');
  await expect(page.getByRole('searchbox', { name: 'Filter tasks' })).toBeFocused();
  await page.keyboard.type('mobile');
  expect(await names(page)).toEqual(['Fix mobile nav overflow']);
  await page.keyboard.type(' nothing');
  await expect(page.getByText('No tasks match the filter.')).toBeVisible();

  // Another project keeps its own filter.
  await project(page, 'Discovery').first().click();
  expect(await names(page)).toEqual(['Competitor site audit']);
  await project(page, 'Build').click();
  await expect(page.getByText('No tasks match the filter.')).toBeVisible();
  await reload(page);
  await expect(page.getByText('No tasks match the filter.')).toBeVisible();

  await page.getByRole('button', { name: 'Clear Filter' }).click();
  await expect(rows(page)).toHaveCount(7);
});

test('sorting by a column persists', async ({ page }) => {
  const header = grid(page).getByRole('columnheader', { name: 'Task' });
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  const sorted = await names(page);
  expect(sorted).toEqual([...sorted].sort((a, b) => a.localeCompare(b, 'en')));
  await reload(page);
  await expect(grid(page).getByRole('columnheader', { name: 'Task' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  expect(await names(page)).toEqual(sorted);
});

test('column picker choice persists', async ({ page }) => {
  await page.getByRole('button', { name: 'Select columns to display' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Last tracked' }).click();
  await page.keyboard.press('Escape');
  await expect(grid(page).getByRole('columnheader', { name: 'Last tracked' })).toHaveCount(0);
  await reload(page);
  await expect(grid(page).getByRole('columnheader', { name: 'Last tracked' })).toHaveCount(0);
});

test('starting a task stops the running one: only one runs', async ({ page }) => {
  const first = row(page, 'Checkout form validation');
  const second = row(page, 'Product image pipeline');
  await expect(first).toHaveClass(/running/);
  await second.getByRole('button', { name: 'Start timer' }).click();
  await expect(second).toHaveClass(/running/);
  await expect(first).not.toHaveClass(/running/);
  await expect(grid(page).locator('tr.running')).toHaveCount(1);
  // Space toggles the selected row.
  await second.click();
  await page.keyboard.press(' ');
  await expect(grid(page).locator('tr.running')).toHaveCount(0);
});

test('done hides the task behind the footer; Show and reopen bring it back', async ({ page }) => {
  await contextMenu(page, row(page, 'Client call notes'), 'tt-task-done');
  await expect(row(page, 'Client call notes')).toHaveCount(0);
  await expect(page.locator('[data-ref="done-hidden"]')).toHaveText('4 done tasks hidden');

  await page.locator('[data-ref="show-done"]').click();
  const done = row(page, 'Client call notes');
  await expect(done).toHaveClass(/done/);
  await contextMenu(page, done, 'tt-task-reopen');
  await expect(done).not.toHaveClass(/done/);
});

test('Delete removes the task at once; Undo restores it', async ({ page }) => {
  await row(page, 'Performance pass').click();
  await page.keyboard.press('Delete');
  await expect(row(page, 'Performance pass')).toHaveCount(0);
  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(page.getByText('Deleted “Performance pass”.')).toBeVisible();
  await undo.click();
  await expect(row(page, 'Performance pass')).toBeVisible();
  await reload(page);
  await expect(row(page, 'Performance pass')).toBeVisible();
});

test('views add a Project column; empty states', async ({ page }) => {
  await page
    .getByRole('tree', { name: 'Views' })
    .getByRole('treeitem', { name: /Starred/ })
    .click();
  await expect(grid(page).getByRole('columnheader', { name: 'Project' })).toHaveCount(1);
  expect(await names(page)).toEqual(['Checkout form validation', 'Fix mobile nav overflow']);

  await page.keyboard.press('Control+Shift+N');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Packaging');
  await page.keyboard.press('Enter');
  await project(page, 'Packaging').click();
  await expect(page.getByText('No tasks in this project yet.')).toBeVisible();
  await expectNoAxeViolations(page);
});
