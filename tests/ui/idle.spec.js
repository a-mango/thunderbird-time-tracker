import { expect, test } from '@playwright/test';
import {
  NOW,
  chooseFromMenu,
  collectErrors,
  expectNoAxeViolations,
  openTracker,
} from './helpers.js';

// S2: the idle prompt in the tracker tab and the popup. `?idle=23` gives the running entry
// (Checkout form validation, since 13:20) a pending absence 14:21–14:44; the clock is 14:45.

/**
 * Entries of the dev database as `task start–end source`, local HH:MM, sorted by start.
 * @param {import('@playwright/test').Page} page
 */
function entryLines(page) {
  return page.evaluate(async () => {
    const db = await import('/db/index.js');
    const conn = await db.openDB();
    const [tasks, entries] = await Promise.all([db.listTasks(conn), db.listEntries(conn)]);
    conn.close();
    const name = new Map(tasks.map((task) => [task.id, task.name]));
    /** @param {number | null} ms */
    const hm = (ms) =>
      ms === null
        ? 'now'
        : new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const start = new Date(2026, 9, 20, 13, 0).getTime();
    return entries
      .filter((entry) => entry.end === null || entry.end > start)
      .sort((a, b) => a.start - b.start)
      .map((e) => `${name.get(e.taskId)} ${hm(e.start)}–${hm(e.end)} ${e.source}`);
  });
}

/** @param {import('@playwright/test').Page} page */
const prompt = (page) => page.locator('tt-notification-bar.idle-prompt');

test('the tracker shows the prompt and Keep leaves the entry alone', async ({ page }) => {
  const errors = collectErrors(page);
  await openTracker(page, '?seed=42&idle=23');
  const bar = prompt(page);
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('role', 'status');
  await expect(bar).toContainText('You were away 23m (2:21 PM – 2:44 PM).');
  await expect(bar.getByRole('button', { name: 'Close' })).toHaveCount(0);
  await page.clock.resume();
  await expectNoAxeViolations(page);
  await bar.getByRole('button', { name: 'Keep' }).focus();
  await page.keyboard.press('Enter');
  await expect(bar).toBeHidden();
  // Focus moves to the task list instead of falling to <body>.
  await expect(page.locator('body')).not.toBeFocused();
  await expect(page.getByRole('row', { name: /Checkout form validation/ })).toBeFocused();
  expect(await entryLines(page)).toContain('Checkout form validation 13:20–now timer');
  expect(errors).toEqual([]);
});

test('Discard trims the entry and restarts at the return', async ({ page }) => {
  await openTracker(page, '?seed=42&idle=23');
  await prompt(page).getByRole('button', { name: 'Discard' }).click();
  await expect(prompt(page)).toBeHidden();
  const lines = await entryLines(page);
  expect(lines).toContain('Checkout form validation 13:20–14:21 timer');
  expect(lines).toContain('Checkout form validation 14:44–now idle');
});

test('Stop at ends the entry when the user left', async ({ page }) => {
  await openTracker(page, '?seed=42&idle=23');
  await prompt(page).getByRole('button', { name: 'Stop at 2:21 PM' }).click();
  await expect(prompt(page)).toBeHidden();
  const lines = await entryLines(page);
  expect(lines).toContain('Checkout form validation 13:20–14:21 timer');
  expect(lines.some((line) => line.includes('–now'))).toBe(false);
  await expect(page.getByRole('status').filter({ hasText: 'stopped' })).toHaveCount(1);
});

test('Assign to… moves the time away to another task', async ({ page }) => {
  await openTracker(page, '?seed=42&idle=23');
  await prompt(page).getByRole('button', { name: 'Assign to…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign Time Away' });
  await expect(dialog).toContainText('The time away (2:21 PM – 2:44 PM) goes to another task.');
  const select = dialog.getByLabel('Task');
  // The running task isn't offered.
  await expect(select.locator('option', { hasText: 'Checkout form validation' })).toHaveCount(0);
  await select.selectOption({ label: 'Product image pipeline' });
  await page.clock.resume();
  await expectNoAxeViolations(page);
  await dialog.getByRole('button', { name: 'Assign' }).click();
  await expect(prompt(page)).toBeHidden();
  const lines = await entryLines(page);
  expect(lines).toContain('Checkout form validation 13:20–14:21 timer');
  expect(lines).toContain('Product image pipeline 14:21–14:44 idle');
  expect(lines).toContain('Checkout form validation 14:44–now idle');
});

test('cancelling Assign to… keeps the prompt', async ({ page }) => {
  await openTracker(page, '?seed=42&idle=23');
  await prompt(page).getByRole('button', { name: 'Assign to…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(prompt(page)).toBeVisible();
});

test('the prompt appears when another page records an absence', async ({ page }) => {
  await openTracker(page, '?seed=42');
  await expect(prompt(page)).toBeHidden();
  await page.evaluate(async (now) => {
    const db = await import('/db/index.js');
    // A second connection, like the background: its change reaches this page over the channel.
    const conn = await db.openDB();
    await db.recordIdle(conn, { since: now - 30 * 60_000, until: now - 60_000 });
    conn.close();
  }, NOW.getTime());
  await expect(prompt(page)).toContainText('You were away 29m (2:15 PM – 2:44 PM).');
});

test('the popup shows the prompt and closes after an answer', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/ui/popup.html?seed=42&idle=23');
  await page.locator('html[data-ready]').waitFor();
  await page.evaluate(() => {
    const store = /** @type {any} */ (window);
    store.__closed = 0;
    window.close = () => {
      store.__closed += 1;
    };
  });
  const bar = prompt(page);
  await expect(bar).toContainText('You were away 23m (2:21 PM – 2:44 PM).');
  await expect(bar.getByRole('button', { name: 'Assign in Time Tracker…' })).toBeVisible();
  await page.clock.resume();
  await expectNoAxeViolations(page);
  await bar.getByRole('button', { name: 'Discard' }).click();
  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__closed)).toBe(1);
  expect(await entryLines(page)).toContain('Checkout form validation 14:44–now idle');
});

test('the idle threshold setting', async ({ page }) => {
  await openTracker(page, '?seed=42');
  await chooseFromMenu(page, 'More options', 'Settings…');
  const select = page.getByRole('dialog').getByLabel('Ask when away for');
  await expect(select).toHaveValue('10');
  await expect(select.locator('option')).toHaveText([
    'Never',
    '5 min',
    '10 min',
    '15 min',
    '30 min',
  ]);
  await select.selectOption({ label: 'Never' });
  const stored = await page.evaluate(async () => {
    const db = await import('/db/index.js');
    const conn = await db.openDB();
    const settings = await db.getSettings(conn);
    conn.close();
    return settings.idleThresholdMin;
  });
  expect(stored).toBe(0);
});
