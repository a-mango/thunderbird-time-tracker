import { expect, test } from '@playwright/test';
import { chooseFromMenu, contextMenu, openTracker, project, projectTree } from './helpers.js';

/** @param {import('@playwright/test').Page} page @param {string} title */
const dialog = (page, title) => page.getByRole('dialog', { name: title });

test('create, rename, recolour and nest three levels', async ({ page }) => {
  await openTracker(page);

  await chooseFromMenu(page, 'More options', 'New Project…');
  const create = dialog(page, 'New Project');
  await expect(create.getByLabel('Name')).toBeFocused();
  await expect(create.getByRole('combobox', { name: 'Create as a subproject of' })).toHaveValue('');
  await create.getByLabel('Name').fill('Research');
  await create.getByRole('radio', { name: 'Teal' }).check();
  await create.getByRole('button', { name: 'Create Project' }).click();
  await expect(create).toBeHidden();
  const research = project(page, 'Research');
  await expect(research).toBeFocused();
  await expect(research).toHaveAttribute('aria-level', '1');
  await expect(research.locator('[data-icon="folder"]')).toHaveAttribute(
    'style',
    /--icon-color: var\(--color-accent-teal\)/,
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Research');

  // Second and third level through the Projects menu; the selected project is the parent.
  for (const [name, parent] of [
    ['Interviews', 'Research'],
    ['Notes', 'Interviews'],
  ]) {
    await chooseFromMenu(page, 'Projects options', 'New Subproject…');
    const sub = dialog(page, 'New Project');
    await expect(
      sub.getByRole('combobox', { name: 'Create as a subproject of' }).locator('option:checked'),
    ).toHaveText(new RegExp(`${parent}$`));
    await sub.getByLabel('Name').fill(name);
    await page.keyboard.press('Enter');
    await expect(sub).toBeHidden();
  }
  await expect(project(page, 'Interviews')).toHaveAttribute('aria-level', '2');
  await expect(project(page, 'Notes')).toHaveAttribute('aria-level', '3');
  await expect(project(page, 'Notes')).toBeFocused();

  // Rename with F2.
  await page.keyboard.press('F2');
  const edit = dialog(page, 'Project Properties');
  await expect(edit.getByLabel('Name')).toHaveValue('Notes');
  await edit.getByLabel('Name').fill('Field notes');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(project(page, 'Field notes')).toHaveAttribute('aria-level', '3');

  // Recolour from the native context menu (colour submenu, current colour checked).
  const menu = await contextMenu(page, project(page, 'Field notes'), 'tt-project-color:#e247c4');
  expect(menu.overridden).toEqual({ showDefaults: false });
  expect(menu.checked).toBe('tt-project-color:#2493ef');
  await expect(project(page, 'Field notes').locator('[data-icon="folder"]')).toHaveAttribute(
    'style',
    /--icon-color: var\(--color-accent-pink\)/,
  );

  // Everything is stored: a reload shows the same tree.
  await page.reload();
  await page.locator('html[data-ready]').waitFor();
  await expect(project(page, 'Field notes')).toHaveAttribute('aria-level', '3');
  await expect(project(page, 'Field notes')).toHaveAttribute('aria-selected', 'true');
});

test('a blank name is refused and Escape cancels', async ({ page }) => {
  await openTracker(page);
  const before = await projectTree(page).getByRole('treeitem').count();
  await page.keyboard.press('Control+Shift+N');
  const create = dialog(page, 'New Project');
  await create.getByLabel('Name').fill('   ');
  await create.getByRole('button', { name: 'Create Project' }).click();
  await expect(create).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(create).toBeHidden();
  await expect(projectTree(page).getByRole('treeitem')).toHaveCount(before);
});

test('edit moves a project when its parent changes', async ({ page }) => {
  await openTracker(page);
  await project(page, 'Training').dblclick();
  const edit = dialog(page, 'Project Properties');
  await edit
    .getByRole('combobox', { name: 'Subproject of' })
    .selectOption({ label: 'None (top level)' });
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(project(page, 'Training')).toHaveAttribute('aria-level', '1');
  await expect(project(page, 'Training')).toBeFocused();
});

test('Enter in the parent select submits the dialog, like Thunderbird dialogs', async ({
  page,
}) => {
  await openTracker(page);
  await page.keyboard.press('Control+Shift+N');
  const create = dialog(page, 'New Project');
  await create.getByLabel('Name').fill('Archive tidy-up');
  const parent = create.getByRole('combobox', { name: 'Create as a subproject of' });
  await parent.focus();
  await page.keyboard.press('Enter');
  await expect(create).toBeHidden();
  await expect(project(page, 'Archive tidy-up')).toBeFocused();
});
