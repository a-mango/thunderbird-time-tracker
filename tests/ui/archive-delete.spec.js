import { expect, test } from '@playwright/test';
import { contextMenu, named, openTracker, project, projectTree } from './helpers.js';

/** @param {import('@playwright/test').Page} page */
const archiveRow = (page) => projectTree(page).getByRole('treeitem', { name: 'Archive' });

/** Rows inside the Archive root. @param {import('@playwright/test').Page} page @param {string} name */
const archived = (page, name) =>
  projectTree(page)
    .locator('li')
    .filter({ has: page.getByRole('treeitem', { name: 'Archive' }) })
    .getByRole('group')
    .getByRole('treeitem', { name: named(name) });

/** Expands the collapsed Archive root from the keyboard. @param {import('@playwright/test').Page} page */
async function expandArchive(page) {
  await archiveRow(page).click();
  await page.keyboard.press('ArrowRight');
  await expect(archiveRow(page)).toHaveAttribute('aria-expanded', 'true');
}

test('context menu items depend on where the project is', async ({ page }) => {
  await openTracker(page);

  const active = await contextMenu(page, project(page, 'Build'));
  expect(active.overridden).toEqual({ showDefaults: false });
  expect(active.visible).toEqual([
    'tt-project-new-subproject',
    'tt-project-rename',
    'tt-project-color',
    'tt-project-move',
    'tt-project-archive',
    'tt-project-delete',
  ]);

  // The Archive root is not a project: Thunderbird's default menu, none of our items.
  const root = await contextMenu(page, archiveRow(page));
  expect(root.overridden).toBeNull();
  expect(root.visible).toEqual([]);

  await expandArchive(page);
  const inArchive = await contextMenu(page, archived(page, 'Discovery'));
  expect(inArchive.visible).toEqual([
    'tt-project-rename',
    'tt-project-color',
    'tt-project-unarchive',
    'tt-project-delete',
  ]);
});

test('archive moves a project into the muted Archive root; unarchive brings it back', async ({
  page,
}) => {
  await openTracker(page);
  await contextMenu(page, project(page, 'Support retainer'), 'tt-project-archive');
  // It stays selected, so the Archive opens to show it.
  const row = archived(page, 'Support retainer');
  await expect(row).toHaveAttribute('aria-level', '2');
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(archiveRow(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(
    projectTree(page).locator('li.muted > [role="treeitem"]', { hasText: 'Support retainer' }),
  ).toHaveCount(1);
  await expect(
    projectTree(page).getByRole('treeitem', { name: named('Support retainer') }),
  ).toHaveCount(1);

  await contextMenu(page, row, 'tt-project-unarchive');
  const back = project(page, 'Support retainer');
  await expect(back).toBeFocused();
  await expect(back).toHaveAttribute('aria-level', '2');
  await expect(archived(page, 'Support retainer')).toHaveCount(0);
});

test('deleting an empty project asks once; the selection falls back to the parent', async ({
  page,
}) => {
  await openTracker(page);
  await contextMenu(page, project(page, 'Training'), 'tt-project-delete');
  const confirm = page.getByRole('dialog', { name: 'Delete Project' });
  await expect(confirm).toContainText('Delete the project “Training”?');
  await expect(confirm.getByRole('listitem')).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(project(page, 'Training')).toHaveCount(0);
  await expect(project(page, 'Internal')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Internal');
});

test('deleting a project with content lists what goes with it', async ({ page }) => {
  await openTracker(page);
  const harbor = project(page, 'Harbor Coffee — website');
  await harbor.click();
  await page.keyboard.press('Delete');
  const confirm = page.getByRole('dialog', { name: 'Delete Project' });
  await expect(confirm).toContainText(
    'Delete the project “Harbor Coffee — website” and everything in it?',
  );
  await expect(confirm.getByRole('listitem')).toHaveText([
    'Subprojects: 3',
    'Tasks: 13',
    'Time entries: 47',
  ]);

  // Cancel keeps everything and returns focus to the row.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(harbor).toBeFocused();
  await expect(project(page, 'Build')).toBeVisible();

  await page.keyboard.press('Delete');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(harbor).toHaveCount(0);
  await expect(project(page, 'Build')).toHaveCount(0);
  await expect(project(page, 'Client work')).toHaveAttribute('aria-selected', 'true');

  // Deleted for good: a reload doesn't bring it back.
  await page.reload();
  await page.locator('html[data-ready]').waitFor();
  await expect(project(page, 'Harbor Coffee — website')).toHaveCount(0);
});
