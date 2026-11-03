import { expect, test } from '@playwright/test';
import { NOW, collectErrors, expectNoAxeViolations } from './helpers.js';

// M6: the action popup against the mock: running block, Stop, Split, "Switch to…" (recent list,
// fuzzy search, keyboard), Open Time Tracker, and closing after each action.

/**
 * Opens the popup on a fixed clock and records window.close() calls.
 * @param {import('@playwright/test').Page} page
 * @param {string} [query]
 */
async function openPopup(page, query = '') {
  await page.clock.setFixedTime(NOW);
  await page.goto(`/ui/popup.html${query}`);
  await page.locator('html[data-ready]').waitFor();
  await page.evaluate(() => {
    const store = /** @type {any} */ (window);
    store.__closed = 0;
    window.close = () => {
      store.__closed += 1;
    };
  });
}

/** @param {import('@playwright/test').Page} page */
const closed = (page) => page.evaluate(() => /** @type {any} */ (window).__closed);

/** Name of the running task, read from the database after a reload. */
async function runningTask(/** @type {import('@playwright/test').Page} */ page) {
  // No query: the harness keeps the database (a `?seed` would re-seed it).
  await page.goto('/ui/popup.html');
  await page.locator('html[data-ready]').waitFor();
  const timer = page.getByRole('group', { name: 'Timer' });
  return (await timer.isVisible()) ? timer.locator('.popup-task').innerText() : null;
}

test('shows the running task and stops it, then closes', async ({ page }) => {
  const errors = collectErrors(page);
  await openPopup(page);
  const timer = page.getByRole('group', { name: 'Timer' });
  await expect(timer.locator('.popup-task')).toHaveText('Checkout form validation');
  await expect(timer).toContainText('Client work › Harbor Coffee — website › Build');
  await expect(timer.locator('.timer-elapsed')).toHaveText(/^1:2\d:\d\d$/);
  await expect(page.getByRole('combobox', { name: 'Switch to…' })).toBeFocused();
  await timer.getByRole('button', { name: 'Stop' }).click();
  await expect.poll(() => closed(page)).toBe(1);
  expect(await runningTask(page)).toBeNull();
  await expect(page.getByText('No timer running')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Start…' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('split keeps the timer running on the same task', async ({ page }) => {
  await openPopup(page);
  await page.getByRole('button', { name: 'Split Now' }).click();
  await expect.poll(() => closed(page)).toBe(1);
  expect(await runningTask(page)).toBe('Checkout form validation');
  // The new entry started at the split: the elapsed time restarted.
  await expect(page.locator('.timer-elapsed')).toHaveText(/^0:00:\d\d$/);
});

test('lists recent tasks and switches with the keyboard', async ({ page }) => {
  await openPopup(page);
  const field = page.getByRole('combobox', { name: 'Switch to…' });
  const options = page.getByRole('listbox', { name: 'Recent tasks' }).getByRole('option');
  await expect(options).toHaveCount(5);
  // The running task is not offered.
  await expect(options.filter({ hasText: 'Checkout form validation' })).toHaveCount(0);
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await field.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(field).toHaveAttribute('aria-activedescendant', 'switch-option-1');
  await field.press('ArrowUp');
  await field.press('ArrowUp');
  await expect(options.nth(4)).toHaveAttribute('aria-selected', 'true');
  const target = (await options.nth(4).locator('.popup-option-name').innerText()).trim();
  await field.press('Enter');
  await expect.poll(() => closed(page)).toBe(1);
  expect(await runningTask(page)).toBe(target);
});

test('fuzzy search finds open tasks only; Enter starts the best match', async ({ page }) => {
  await openPopup(page);
  const field = page.getByRole('combobox', { name: 'Switch to…' });
  const results = page.getByRole('listbox', { name: 'Matching tasks' }).getByRole('option');
  await field.fill('pipe');
  await expect(results.first()).toContainText('Product image pipeline');
  // Done tasks and tasks in archived projects never show.
  await field.fill('form state');
  await expect(results).toHaveCount(0);
  await expect(page.getByText('No matching open tasks.')).toBeVisible();
  // Name matches rank first; "Brand review call" matches through its path (Client work).
  await field.fill('client call');
  await expect(results).toHaveCount(2);
  await expect(results.first()).toContainText('Client call notes');
  await expect(results.first()).toContainText('Build');
  await expect(results.nth(1)).toContainText('Brand review call');
  await field.fill('harbor perf');
  await expect(results.first()).toContainText('Performance pass');
  await field.press('Enter');
  await expect.poll(() => closed(page)).toBe(1);
  expect(await runningTask(page)).toBe('Performance pass');
});

test('a click on a task starts it', async ({ page }) => {
  await openPopup(page);
  await page.getByRole('combobox').fill('weekly');
  await page.getByRole('option', { name: /Weekly client sync/ }).click();
  await expect.poll(() => closed(page)).toBe(1);
  expect(await runningTask(page)).toBe('Weekly client sync');
});

test('Open Time Tracker opens the space and closes', async ({ page }) => {
  await openPopup(page);
  await page.getByRole('button', { name: 'Open Time Tracker' }).click();
  await expect.poll(() => closed(page)).toBe(1);
  const tabs = await page.evaluate(async () => {
    const api = /** @type {any} */ (globalThis).messenger;
    const [space] = await api.spaces.query({ isSelfOwned: true });
    return (await api.tabs.query({ spaceId: space.id })).map((/** @type {any} */ t) => t.url);
  });
  expect(tabs).toEqual([expect.stringMatching(/\/ui\/tracker\.html$/)]);
});

test('an empty database shows the empty states', async ({ page }) => {
  await openPopup(page, '?fixtures=empty');
  await expect(page.getByText('No timer running')).toBeVisible();
  await expect(page.getByText('No recent tasks. Type to search.')).toBeVisible();
  await expect(page.getByRole('listbox')).toBeHidden();
});

test('follows the density setting and passes axe', async ({ page }) => {
  await openPopup(page, '?density=compact');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expectNoAxeViolations(page);
  await page.getByRole('combobox').fill('pipe');
  await expectNoAxeViolations(page);
});
