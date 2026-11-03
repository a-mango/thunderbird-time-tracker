import { expect, test } from '@playwright/test';
import { NOW, contextMenu, expectNoAxeViolations, openTracker, project } from './helpers.js';

// M5: detail pane, timer box, entry dialog (overlap warning), split, delete + undo, and the
// running state across two pages (BroadcastChannel).

/** @param {import('@playwright/test').Page} page */
const rows = (page) => page.getByRole('treegrid', { name: 'Tasks' }).locator('tbody tr[data-key]');
/** @param {import('@playwright/test').Page} page @param {string} name */
const row = (page, name) => rows(page).filter({ hasText: name });
/** @param {import('@playwright/test').Page} page */
const detail = (page) => page.locator('#detail');
/** @param {import('@playwright/test').Page} page */
const timerBox = (page) => detail(page).getByRole('group', { name: 'Timer' });
/** @param {import('@playwright/test').Page} page */
const entryRows = (page) => detail(page).locator('.entry-row');

/** @param {import('@playwright/test').Page} page @param {string} task */
async function selectTask(page, task) {
  await project(page, 'Build').click();
  await row(page, task).click();
  await expect(detail(page).getByRole('heading', { level: 2 })).toHaveText(task);
}

test('the running task shows breadcrumb, live time, stats and entries by day', async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.goto('/ui/tracker.html');
  await page.locator('html[data-ready]').waitFor();
  await selectTask(page, 'Checkout form validation');
  // Freeze 30 s after NOW (loading takes a few seconds of fake time).
  await page.clock.pauseAt(NOW.getTime() + 30_000);
  await expect(detail(page).getByRole('navigation', { name: 'Project' })).toHaveText(
    'Client work›Harbor Coffee — website›Build',
  );
  const box = timerBox(page);
  // The fixture started the entry 85 minutes before it seeded (just after NOW).
  const elapsed = box.locator('.timer-elapsed');
  await expect(elapsed).toHaveText(/^1:25:[23]\d$/);
  await expect(box).toContainText('Running since');
  await expect(box.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Start' })).toBeHidden();
  const seconds = (/** @type {string} */ text) =>
    text.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
  const before = seconds(await elapsed.innerText());
  await page.clock.runFor(65_000);
  const after = (s) =>
    `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  await expect(elapsed).toHaveText(after(before + 65));
  await expect(detail(page).locator('.entry-row.running .entry-duration')).toHaveText(
    after(before + 65),
  );
  await expect(detail(page).locator('.stat-value').first()).toHaveText(/^1h 2\dm$/);
  await expect(detail(page).locator('.day-header').first()).toContainText('Today · ');
  // axe waits on timers, which a paused clock never fires.
  await page.clock.resume();
  await expectNoAxeViolations(page);
});

test('start from the list: the detail pane shows the running time', async ({ page }) => {
  await openTracker(page);
  await selectTask(page, 'Product image pipeline');
  await expect(timerBox(page).getByRole('button', { name: 'Start' })).toBeVisible();
  await row(page, 'Product image pipeline').getByRole('button', { name: 'Start timer' }).click();
  await expect(timerBox(page).getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(timerBox(page).locator('.timer-elapsed')).toHaveText('0:00:00');
  await expect(entryRows(page).first()).toHaveClass(/running/);
  await expect(row(page, 'Checkout form validation')).not.toContainText('Running');
});

test('split the running entry: the second part moves to another task', async ({ page }) => {
  await openTracker(page);
  await selectTask(page, 'Checkout form validation');
  await timerBox(page).getByRole('button', { name: 'Split…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Split Time Entry' });
  await expect(dialog.getByRole('radio', { name: 'Now' })).toBeChecked();
  // At a chosen time: 14:00 is inside the running entry (13:20 – now).
  await dialog.getByRole('radio', { name: 'At' }).check();
  await dialog.getByLabel('Split time').fill('14:00');
  await dialog.getByLabel('Second part goes to').selectOption({ label: 'Product image pipeline' });
  await dialog.getByRole('button', { name: 'Split' }).click();
  await expect(dialog).toBeHidden();

  await expect(timerBox(page).getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(entryRows(page).first()).toHaveAccessibleName(/1:20 PM – 2:00 PM.*40m$/);
  await expect(row(page, 'Product image pipeline')).toContainText('Running');
  await row(page, 'Product image pipeline').click();
  await expect(entryRows(page).first()).toHaveAccessibleName(/^Running, 2:00 PM – now/);
});

test('a time outside the entry cannot be chosen as split point', async ({ page }) => {
  await openTracker(page);
  await selectTask(page, 'Checkout form validation');
  await timerBox(page).getByRole('button', { name: 'Split…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Split Time Entry' });
  await dialog.getByRole('radio', { name: 'At' }).check();
  await dialog.getByLabel('Split time').fill('15:30');
  await dialog.getByRole('button', { name: 'Split' }).click();
  await expect(dialog).toBeVisible();
  expect(await dialog.getByLabel('Split time').evaluate((i) => i.validationMessage)).toBe(
    'Choose a time inside the entry.',
  );
});

test('editing an entry to overlap warns; Back returns, Save Anyway saves', async ({ page }) => {
  await openTracker(page);
  await selectTask(page, 'Checkout form validation');
  const monday = entryRows(page).filter({ hasText: '9:18 AM – 11:19 AM' });
  await monday.click();
  const editor = page.getByRole('dialog', { name: 'Edit Time Entry' });
  await editor.getByLabel('Date').fill('2026-10-20');
  await editor.getByLabel('Start').fill('13:00');
  await editor.getByLabel('End').fill('13:45');
  await expect(editor.getByLabel('Duration')).toHaveValue('45m');
  await editor.getByLabel('Note').fill('Review');
  await editor.getByRole('button', { name: 'Save' }).click();

  const warning = page.getByRole('dialog', { name: 'Overlapping Time' });
  await expect(warning).toContainText('This entry overlaps another entry:');
  await expect(warning).toContainText('Checkout form validation 1:20 PM – now');
  await warning.getByRole('button', { name: 'Back' }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Note')).toHaveValue('Review');
  await editor.getByRole('button', { name: 'Save' }).click();
  await warning.getByRole('button', { name: 'Save Anyway' }).click();
  await expect(warning).toBeHidden();
  await expect(entryRows(page).filter({ hasText: 'Review' })).toHaveAccessibleName(
    /1:00 PM – 1:45 PM Review 45m$/,
  );
});

test('duration drives the end, and the running entry cannot end in the future', async ({
  page,
}) => {
  await openTracker(page);
  await selectTask(page, 'Checkout form validation');
  await entryRows(page).first().click();
  const editor = page.getByRole('dialog', { name: 'Edit Time Entry' });
  await expect(editor.getByLabel('End')).toHaveValue('');
  await editor.getByLabel('Duration').fill('2h');
  await expect(editor.getByLabel('End')).toHaveValue('15:20');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeVisible();
  expect(await editor.getByLabel('End').evaluate((i) => i.validationMessage)).toBe(
    'The running timer can’t end in the future.',
  );
  // Ending it in the past stops the timer.
  await editor.getByLabel('End').fill('14:30');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  await expect(timerBox(page).getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(entryRows(page).first()).toHaveAccessibleName(/1:20 PM – 2:30 PM .*1h 10m$/);
});

test('add an entry from the action row and Ctrl+E; delete it with undo', async ({ page }) => {
  await openTracker(page);
  await selectTask(page, 'Accessibility fixes');
  await expect(detail(page).locator('.entries-empty')).toBeVisible();
  await detail(page).getByRole('button', { name: 'Add Entry' }).click();
  const editor = page.getByRole('dialog', { name: 'New Time Entry' });
  await editor.getByLabel('Start').fill('08:00');
  await editor.getByLabel('End').fill('08:30');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(entryRows(page)).toHaveCount(1);
  await expect(entryRows(page).first()).toHaveAccessibleName(/^Manual entry, 8:00 AM – 8:30 AM/);

  await page.keyboard.press('Control+e');
  await expect(page.getByRole('dialog', { name: 'New Time Entry' })).toBeVisible();
  await page.keyboard.press('Escape');

  const menu = await contextMenu(page, entryRows(page).first(), 'tt-entry-delete');
  expect(menu.visible).toEqual([
    'tt-entry-edit',
    'tt-entry-split',
    'tt-entry-duplicate',
    'tt-entry-delete',
  ]);
  await expect(entryRows(page)).toHaveCount(0);
  await page.locator('tt-notification-bar').getByRole('button', { name: 'Undo' }).click();
  await expect(entryRows(page)).toHaveCount(1);
});

test('duplicate opens a prefilled new entry', async ({ page }) => {
  await openTracker(page);
  await selectTask(page, 'Checkout form validation');
  const monday = entryRows(page).filter({ hasText: '9:18 AM – 11:19 AM' });
  await contextMenu(page, monday, 'tt-entry-duplicate');
  const editor = page.getByRole('dialog', { name: 'New Time Entry' });
  await expect(editor.getByLabel('Date')).toHaveValue('2026-10-19');
  await expect(editor.getByLabel('Start')).toHaveValue('09:18');
  await editor.getByLabel('Date').fill('2026-10-20');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(entryRows(page).filter({ hasText: '9:18 AM – 11:19 AM' })).toHaveCount(2);
});

test('the range picker filters the entries', async ({ page }) => {
  await openTracker(page);
  await selectTask(page, 'Checkout form validation');
  const range = detail(page).getByRole('button', { name: 'Show entries: This week' });
  await range.click();
  await page.getByRole('menuitemcheckbox', { name: 'Today' }).click();
  await expect(detail(page).locator('.day-header')).toHaveCount(1);
  await detail(page).getByRole('button', { name: 'Show entries: Today' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'All' }).click();
  expect(await detail(page).locator('.day-header').count()).toBeGreaterThan(2);
});

test('stop from the detail pane updates the list in another page', async ({ page, context }) => {
  await openTracker(page);
  const other = await context.newPage();
  await openTracker(other);
  await project(other, 'Build').click();
  await expect(row(other, 'Checkout form validation')).toContainText('Running');

  await selectTask(page, 'Checkout form validation');
  await timerBox(page).getByRole('button', { name: 'Stop' }).click();
  await expect(timerBox(page).getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(row(other, 'Checkout form validation')).not.toContainText('Running');
  await expect(
    row(other, 'Checkout form validation').getByRole('button', { name: 'Start timer' }),
  ).toBeVisible();

  // Resume last entry there: starts again with the last note.
  await row(other, 'Checkout form validation').click();
  await timerBox(other).getByRole('button', { name: 'Resume Last Entry' }).click();
  await expect(timerBox(other)).toContainText('Inline errors for card fields');
  await expect(timerBox(page).getByRole('button', { name: 'Stop' })).toBeVisible();
});
