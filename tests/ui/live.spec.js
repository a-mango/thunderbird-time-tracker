import { expect, test } from '@playwright/test';
import { contextMenu, openTracker, project } from './helpers.js';

// Short window so the project pane scrolls.
test.use({ viewport: { width: 1280, height: 360 } });

/** @param {import('@playwright/test').Page} page */
const sidebarScroll = (page) => page.locator('[data-ref="sidebar-scroll"]');

test('a change in another tab refreshes the tree and keeps selection and scroll', async ({
  page,
  context,
}) => {
  await openTracker(page);
  const other = await context.newPage();
  await openTracker(other);

  await project(page, 'Build').click();
  const scroll = sidebarScroll(page);
  await scroll.evaluate((element) => {
    element.scrollTop = 120;
  });
  const top = await scroll.evaluate((element) => element.scrollTop);
  expect(top).toBeGreaterThan(0);

  // Rename and recolour in the other tab.
  await project(other, 'Training').dblclick();
  const edit = other.getByRole('dialog', { name: 'Project Properties' });
  await edit.getByLabel('Name').fill('Workshops');
  await edit.getByRole('radio', { name: 'Orange' }).check();
  await edit.getByRole('button', { name: 'Save' }).click();

  await expect(project(page, 'Workshops')).toHaveCount(1);
  await expect(project(page, 'Workshops').locator('[data-icon="folder"]')).toHaveAttribute(
    'style',
    /--icon-color: var\(--color-accent-orange\)/,
  );
  await expect(project(page, 'Build')).toHaveAttribute('aria-selected', 'true');
  expect(await scroll.evaluate((element) => element.scrollTop)).toBe(top);

  // A new project there shows up here.
  await other.keyboard.press('Control+Shift+N');
  const create = other.getByRole('dialog', { name: 'New Project' });
  await create.getByLabel('Name').fill('Workshop prep');
  await create.getByRole('button', { name: 'Create Project' }).click();
  await expect(project(page, 'Workshop prep')).toHaveAttribute('aria-level', '1');
  await expect(project(page, 'Build')).toHaveAttribute('aria-selected', 'true');
});

test('deleting the selected project in another tab selects its parent', async ({
  page,
  context,
}) => {
  await openTracker(page);
  const other = await context.newPage();
  await openTracker(other);

  await project(page, 'Training').click();
  await contextMenu(other, project(other, 'Training'), 'tt-project-delete');
  await other.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

  await expect(project(page, 'Training')).toHaveCount(0);
  await expect(project(page, 'Internal')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Internal');
});
