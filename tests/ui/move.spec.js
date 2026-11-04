import { expect, test } from '@playwright/test';
import { named, openTracker, project, projectTree } from './helpers.js';

/** Names of the visible project rows in order, without badges. */
/** @param {import('@playwright/test').Page} page */
const order = (page) =>
  projectTree(page).locator('[role="treeitem"]:visible .name').allTextContents();

/**
 * Row point at a fraction of the row's height (Thunderbird: top quarter before, bottom quarter
 * after, middle inside).
 * @param {import('@playwright/test').Locator} row
 * @param {number} fraction
 */
async function at(row, fraction) {
  const box = /** @type {{width: number, height: number}} */ (await row.boundingBox());
  return { x: Math.min(60, box.width / 2), y: Math.round(box.height * fraction) };
}

/**
 * Starts an HTML5 drag of `source` and hovers `target` at `fraction`, without dropping.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} source
 * @param {import('@playwright/test').Locator} target
 * @param {number} fraction
 */
async function hover(page, source, target, fraction) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer });
  const box = /** @type {{x: number, y: number, height: number}} */ (await target.boundingBox());
  await target.dispatchEvent('dragover', {
    dataTransfer,
    clientX: box.x + 40,
    clientY: box.y + box.height * fraction,
  });
}

test('drag a project into another one to reparent it', async ({ page }) => {
  await openTracker(page);
  const internal = project(page, 'Internal');
  await project(page, 'Content').dragTo(internal, { targetPosition: await at(internal, 0.5) });
  await expect(project(page, 'Content')).toHaveAttribute('aria-level', '2');
  await expect(project(page, 'Content')).toBeFocused();
  const internalGroup = projectTree(page)
    .locator('li')
    .filter({ has: page.getByRole('treeitem', { name: named('Internal') }) });
  await expect(internalGroup).toContainText('Content');
  expect(await order(page)).toEqual([
    'Client work',
    'Harbor Coffee — website',
    'Discovery',
    'Build',
    'Fern & Co — branding',
    'Support retainer',
    'Internal',
    'Bookkeeping',
    'Training',
    'Content',
    'Archive',
  ]);
});

test('drag onto the top or bottom quarter of a row to reorder', async ({ page }) => {
  await openTracker(page);
  const discovery = project(page, 'Discovery');
  await project(page, 'Content').dragTo(discovery, { targetPosition: await at(discovery, 0.1) });
  await expect
    .poll(async () => (await order(page)).slice(2, 5))
    .toEqual(['Content', 'Discovery', 'Build']);

  const fern = project(page, 'Fern & Co — branding');
  await project(page, 'Training').dragTo(fern, { targetPosition: await at(fern, 0.9) });
  await expect(project(page, 'Training')).toHaveAttribute('aria-level', '2');
  await expect
    .poll(async () => (await order(page)).slice(5, 8))
    .toEqual(['Fern & Co — branding', 'Training', 'Support retainer']);
  // The new order is stored.
  await page.reload();
  await page.locator('html[data-ready]').waitFor();
  expect((await order(page)).slice(2, 5)).toEqual(['Content', 'Discovery', 'Build']);
});

test('drop indicators: a line between rows, the row state inside, a dashed dragged row', async ({
  page,
}) => {
  await openTracker(page);
  const content = project(page, 'Content');
  const internal = project(page, 'Internal');
  const indicator = projectTree(page).locator('.drop-indicator');

  await hover(page, content, internal, 0.5);
  await expect(projectTree(page).locator('li.drop-target')).toHaveCount(1);
  await expect(
    projectTree(page).locator('li.drop-target > [role="treeitem"]'),
  ).toHaveAccessibleName(named('Internal'));
  await expect(indicator).toBeHidden();
  await expect(projectTree(page).locator('li.drag-target')).toContainText('Content');

  await hover(page, content, internal, 0.1);
  await expect(indicator).toBeVisible();
  await expect(projectTree(page).locator('li.drop-target')).toHaveCount(0);
  const line = /** @type {{y: number}} */ (await indicator.boundingBox());
  const row = /** @type {{y: number}} */ (await internal.boundingBox());
  expect(Math.abs(line.y - row.y)).toBeLessThan(3);

  await content.dispatchEvent('dragend');
  await expect(indicator).toBeHidden();
  await expect(projectTree(page).locator('li.drag-target')).toHaveCount(0);
});

test('a project cannot be dropped into its own subtree or onto its parent', async ({ page }) => {
  await openTracker(page);
  const client = project(page, 'Client work');
  const build = project(page, 'Build');
  await hover(page, client, build, 0.5);
  await expect(projectTree(page).locator('li.drop-target')).toHaveCount(0);
  await client.dispatchEvent('dragend');
  await client.dragTo(build, { targetPosition: await at(build, 0.5) });
  await expect(client).toHaveAttribute('aria-level', '1');

  await hover(page, build, project(page, 'Harbor Coffee — website'), 0.5);
  await expect(projectTree(page).locator('li.drop-target')).toHaveCount(0);
});

test('archived projects and the Archive root are not draggable', async ({ page }) => {
  await openTracker(page);
  const archive = projectTree(page).getByRole('treeitem', { name: 'Archive' });
  await expect(archive).not.toHaveAttribute('draggable', 'true');
  await expect(project(page, 'Build')).toHaveAttribute('draggable', 'true');
});

test('keyboard: Move To… from the Projects menu', async ({ page }) => {
  await openTracker(page);
  await project(page, 'Build').click();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Projects options' })).toBeFocused();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  // New Project…, New Subproject…, Rename Project…, Move To…
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Move To…' })).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Move Project' });
  const destination = dialog.getByRole('combobox', { name: 'Move “Build” to:' });
  await expect(destination).toBeFocused();
  // Its own subtree is not offered; Build can't be its own parent.
  await expect(destination.locator('option')).not.toContainText(['Build']);
  await destination.selectOption({ label: '  Training' });
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(project(page, 'Build')).toHaveAttribute('aria-level', '3');
  await expect(project(page, 'Build')).toBeFocused();
});

/** @param {import('@playwright/test').Page} page @param {string} name */
const taskRow = (page, name) =>
  page
    .getByRole('treegrid', { name: 'Tasks' })
    .locator('tbody tr[data-key]')
    .filter({ hasText: name });

test('drag a task onto another project to move it there', async ({ page }) => {
  await openTracker(page);
  await project(page, 'Build').click();
  const source = taskRow(page, 'Performance pass');
  await expect(source).toHaveAttribute('draggable', 'true');
  const training = project(page, 'Training');
  await source.dragTo(training, { targetPosition: await at(training, 0.5) });
  await expect(source).toHaveCount(0);
  await expect(projectTree(page).locator('li.drop-target')).toHaveCount(0);
  await training.click();
  await expect(taskRow(page, 'Performance pass')).toBeVisible();
  // Persisted: still there after a reload.
  await page.reload();
  await page.locator('html[data-ready]').waitFor();
  await training.click();
  await expect(taskRow(page, 'Performance pass')).toBeVisible();
});

test('a task cannot be dropped on its own project or an archived one', async ({ page }) => {
  await openTracker(page);
  const archive = projectTree(page).getByRole('treeitem', { name: 'Archive' });
  await archive.locator('.twisty').click();
  await project(page, 'Build').click();
  const source = taskRow(page, 'Performance pass');
  await hover(page, source, project(page, 'Build'), 0.5);
  await expect(projectTree(page).locator('li.drop-target')).toHaveCount(0);
  // Dropping there anyway changes nothing.
  await project(page, 'Build').dispatchEvent('drop');
  await source.dispatchEvent('dragend');
  await expect(source).toBeVisible();
  await hover(page, source, project(page, 'Content'), 0.1);
  // Task drops go inside a row only: no reorder line.
  await expect(projectTree(page).locator('li.drop-target')).toHaveCount(1);
  await expect(projectTree(page).locator('.drop-indicator')).toBeHidden();
  await source.dispatchEvent('dragend');
  await expect(projectTree(page).locator('li.drop-target')).toHaveCount(0);

  const archived = projectTree(page)
    .getByRole('treeitem', { name: /^Discovery/ })
    .last();
  await expect(archived).toBeVisible();
  await hover(page, source, archived, 0.5);
  await expect(projectTree(page).locator('li.drop-target')).toHaveCount(0);
  await hover(page, source, archive, 0.5);
  await expect(projectTree(page).locator('li.drop-target')).toHaveCount(0);
});

test('the task being renamed is not draggable', async ({ page }) => {
  await openTracker(page);
  await project(page, 'Build').click();
  await taskRow(page, 'Performance pass').click();
  await page.keyboard.press('F2');
  const field = page.getByRole('treegrid', { name: 'Tasks' }).getByRole('textbox');
  await expect(field).toBeFocused();
  await expect(page.locator('tbody tr[data-key]:has(.rename-field)')).toHaveAttribute(
    'draggable',
    'false',
  );
  await page.keyboard.press('Enter');
  await expect(taskRow(page, 'Performance pass')).toHaveAttribute('draggable', 'true');
});
