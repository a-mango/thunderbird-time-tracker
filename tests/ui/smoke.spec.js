import { expect, test } from '@playwright/test';
import { collectErrors, expectNoAxeViolations, openTracker, project } from './helpers.js';

test('tracker tab renders the three panes from the database', async ({ page }) => {
  const errors = collectErrors(page);
  await openTracker(page);
  await expect(page).toHaveTitle('Time Tracker');
  await expect(page.getByRole('complementary', { name: 'Projects and views' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('treegrid', { name: 'Tasks' })).toContainText(
    'Checkout form validation',
  );
  await expect(page.getByRole('region', { name: 'Task details' })).toContainText(
    'No task selected.',
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Today');
  await expect(project(page, 'Client work')).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Projects' }).getByRole('treeitem')).toHaveCount(11);
  expect(errors).toEqual([]);
});

test('tracker tab passes axe in light and dark mode', async ({ page }) => {
  await openTracker(page);
  await expectNoAxeViolations(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectNoAxeViolations(page);
});

test('tracker tab shows the empty state', async ({ page }) => {
  await openTracker(page, '?fixtures=empty');
  await expect(page.getByText('No projects yet.')).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Projects' })).toBeHidden();
  await expectNoAxeViolations(page);
});

test('tracker tab shows an error when the database cannot be opened', async ({ page }) => {
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, version) {
      // Only the page's own open: the dev harness has seeded the database by then.
      if (document.documentElement.hasAttribute('data-dev-ready')) {
        throw new DOMException('blocked for the test', 'UnknownError');
      }
      return open.call(this, name, version);
    };
  });
  await page.goto('/ui/tracker.html');
  await expect(page.getByText('Could not load your data. Try reopening this tab.')).toBeVisible();
});

test('popup renders without errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/ui/popup.html?fixtures=empty');
  await expect(page.getByRole('heading', { name: 'Time Tracker' })).toBeAttached();
  await expect(page.getByText('No timer running')).toBeVisible();
  await expectNoAxeViolations(page);
  expect(errors).toEqual([]);
});
