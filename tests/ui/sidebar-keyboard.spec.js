import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, named, openTracker, project, projectTree } from './helpers.js';

/** @param {import('@playwright/test').Page} page @param {string} name */
const view = (page, name) =>
  page.getByRole('tree', { name: 'Views' }).getByRole('treeitem', { name: named(name) });
/** @param {import('@playwright/test').Page} page */
const heading = (page) => page.getByRole('heading', { level: 1 });

test('the whole project pane works from the keyboard', async ({ page }) => {
  await openTracker(page);
  await expectNoAxeViolations(page);

  // Tab order: More (New Task and Add entry are disabled), Views, Projects options, Projects.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'More options' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(view(page, 'Today')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(view(page, 'This Week')).toBeFocused();
  await expect(heading(page)).toHaveText('This Week');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Projects options' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(project(page, 'Client work')).toBeFocused();

  // One selection across both trees: selecting a project clears the view.
  await page.keyboard.press('ArrowDown');
  await expect(project(page, 'Harbor Coffee — website')).toHaveAttribute('aria-selected', 'true');
  await expect(view(page, 'This Week')).toHaveAttribute('aria-selected', 'false');
  await expect(heading(page)).toHaveText('Harbor Coffee — website');

  // Collapse and expand, parent and child, Home/End, type-ahead.
  await page.keyboard.press('ArrowLeft');
  await expect(project(page, 'Harbor Coffee — website')).toHaveAttribute('aria-expanded', 'false');
  await expect(project(page, 'Build')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(project(page, 'Discovery')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(project(page, 'Harbor Coffee — website')).toBeFocused();
  await page.keyboard.press('End');
  await expect(projectTree(page).getByRole('treeitem', { name: 'Archive' })).toBeFocused();
  await expect(heading(page)).toHaveText('Archive');
  await page.keyboard.press('Home');
  await expect(project(page, 'Client work')).toBeFocused();
  await page.keyboard.type('tr');
  await expect(project(page, 'Training')).toBeFocused();

  // Enter edits; Escape returns to the row.
  await page.keyboard.press('Enter');
  const edit = page.getByRole('dialog', { name: 'Project Properties' });
  await expect(edit.getByLabel('Name')).toHaveValue('Training');
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();
  await expect(project(page, 'Training')).toBeFocused();

  // The selection survives a reload.
  await page.reload();
  await page.locator('html[data-ready]').waitFor();
  await expect(project(page, 'Training')).toHaveAttribute('aria-selected', 'true');
});

test('Ctrl+Shift+N creates a project from anywhere in the tab', async ({ page }) => {
  await openTracker(page);
  await view(page, 'Starred').click();
  await page.keyboard.press('Control+Shift+N');
  const create = page.getByRole('dialog', { name: 'New Project' });
  await expect(create.getByLabel('Name')).toBeFocused();
  await page.keyboard.type('Workshop');
  await page.keyboard.press('Enter');
  await expect(create).toBeHidden();
  await expect(project(page, 'Workshop')).toBeFocused();
  await expect(project(page, 'Workshop')).toHaveAttribute('aria-level', '1');
});

test('Delete asks, removes the project and keeps focus in the tree', async ({ page }) => {
  await openTracker(page);
  await project(page, 'Bookkeeping').click();
  await page.keyboard.press('Delete');
  const confirm = page.getByRole('dialog', { name: 'Delete Project' });
  await expect(confirm.getByRole('button', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirm).toBeHidden();
  await expect(project(page, 'Bookkeeping')).toHaveCount(0);
  await expect(project(page, 'Internal')).toBeFocused();
  // Escape on the next confirmation keeps the project.
  await page.keyboard.press('ArrowDown');
  await expect(project(page, 'Training')).toBeFocused();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape');
  await expect(project(page, 'Training')).toBeFocused();
});
