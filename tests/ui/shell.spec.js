import { expect, test } from '@playwright/test';
import { collectErrors, expectNoAxeViolations, openTracker } from './helpers.js';

/** @param {import('@playwright/test').Page} page @param {string} id */
const width = (page, id) =>
  page.locator(`#${id}`).evaluate((element) => element.getBoundingClientRect().width);

/**
 * Drags a splitter horizontally by `dx` pixels.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} splitter
 * @param {number} dx
 */
async function drag(page, splitter, dx) {
  const box = /** @type {{x: number, y: number, width: number, height: number}} */ (
    await splitter.boundingBox()
  );
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 5 });
  await page.mouse.up();
}

test('both splitters resize their pane and the widths persist', async ({ page }) => {
  const errors = collectErrors(page);
  await openTracker(page);
  const sidebarSplitter = page.getByRole('separator', { name: 'Resize the project pane' });
  const detailSplitter = page.getByRole('separator', { name: 'Resize the task details pane' });

  const sidebar = await width(page, 'sidebar');
  await drag(page, sidebarSplitter, 60);
  await expect.poll(() => width(page, 'sidebar')).toBeGreaterThan(sidebar + 50);

  // Keyboard: the details splitter grows its pane with Left (the pane is after it).
  const detail = await width(page, 'detail');
  await detailSplitter.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => width(page, 'detail')).toBe(detail + 50);

  const sidebarAfter = await width(page, 'sidebar');
  const detailAfter = await width(page, 'detail');
  await page.reload();
  await page.locator('html[data-ready]').waitFor();
  expect(await width(page, 'sidebar')).toBe(sidebarAfter);
  expect(await width(page, 'detail')).toBe(detailAfter);
  await expect(sidebarSplitter).toHaveAttribute('aria-valuenow', String(Math.round(sidebarAfter)));
  expect(errors).toEqual([]);
});

test('header: New Task and Add entry need a selection; More offers New Project, Export, Settings', async ({
  page,
}) => {
  await openTracker(page);
  await expect(page.getByRole('button', { name: 'New Task' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add time entry' })).toBeDisabled();

  await page.getByRole('button', { name: 'More options' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['New Project…', 'Export CSV…', 'Settings…']);
  await expect(menu.getByRole('menuitem', { name: 'New Project…' })).toBeFocused();
  await expectNoAxeViolations(page);

  // Escape closes and returns focus.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('button', { name: 'More options' })).toBeFocused();

  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'New Project…' }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'New Project' })).toBeVisible();
});

test('empty database: the Projects mode says so', async ({ page }) => {
  await openTracker(page, '?fixtures=empty');
  await expect(page.getByText('No projects yet.')).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Projects' })).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Today');
});

test('running project styling and collapsed state survive a reload', async ({ page }) => {
  await openTracker(page);
  const tree = page.getByRole('tree', { name: 'Projects' });
  const build = tree.getByRole('treeitem', { name: /^Build / });
  const harbor = tree.getByRole('treeitem', { name: /^Harbor Coffee — website / });
  // The fixtures' running entry is on a Build task: "new mail" style on Build.
  await expect(tree.locator('li.running > [role="treeitem"]')).toHaveAccessibleName(/^Build /);
  await expect(build.locator('.count-badge')).toHaveClass(/\bnew\b/);
  await expect(harbor.locator('.count-badge')).not.toHaveClass(/outlined/);

  // Collapsed, the parent of the running project gets the outlined badge.
  await harbor.click();
  await page.keyboard.press('ArrowLeft');
  await expect(harbor).toHaveAttribute('aria-expanded', 'false');
  await expect(harbor.locator('.count-badge')).toHaveClass(/\boutlined\b/);

  await page.reload();
  await page.locator('html[data-ready]').waitFor();
  await expect(harbor).toHaveAttribute('aria-expanded', 'false');
  await expect(build).toBeHidden();
});
