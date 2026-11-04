import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { collectErrors, expectNoAxeViolations, openTracker, project } from './helpers.js';

// S3: the Reports mode. Fixture week (seed 42, clock Tue 20 Oct 2026 14:45): Monday has stopped
// entries; Checkout form validation runs since 13:20 on Tuesday.

/** @param {import('@playwright/test').Page} page */
async function openReport(page, query = '?seed=42') {
  await openTracker(page, query);
  await page.getByRole('treeitem', { name: 'Timesheet' }).click();
  const grid = page.getByRole('grid', { name: 'Timesheet: time per task and day' });
  await expect(grid).toBeVisible();
  return grid;
}

/**
 * The grid cell of a task (or `Total`) and a column header ("19 Mon", "Total").
 * @param {import('@playwright/test').Locator} grid
 * @param {string} rowName
 * @param {number} col 0 = task name, 1–7 = days, 8 = total
 */
const cell = (grid, rowName, col) =>
  grid
    .getByRole('row')
    .filter({ has: grid.page().getByRole('rowheader', { name: rowName, exact: true }) })
    .locator(`[data-col="${col}"]`);

/**
 * Live entries of a task on a local day as `HH:MM–HH:MM source`.
 * @param {import('@playwright/test').Page} page
 * @param {string} taskName
 * @param {number} date day of October 2026
 */
function dayEntries(page, taskName, date) {
  return page.evaluate(
    async ({ taskName, date }) => {
      const db = await import('/db/index.js');
      const conn = await db.openDB();
      const [tasks, entries] = await Promise.all([db.listTasks(conn), db.listEntries(conn)]);
      conn.close();
      const task = tasks.find((t) => t.name === taskName);
      const start = new Date(2026, 9, date).getTime();
      const end = new Date(2026, 9, date + 1).getTime();
      /** @param {number} ms */
      const hm = (ms) =>
        new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return entries
        .filter((e) => e.taskId === task?.id && e.end !== null && e.start < end && e.end > start)
        .sort((a, b) => a.start - b.start)
        .map((e) => `${hm(e.start)}–${hm(/** @type {number} */ (e.end))} ${e.source}`);
    },
    { taskName, date },
  );
}

test('shows the week grid, totals and the summary with rates', async ({ page }) => {
  const errors = collectErrors(page);
  const grid = await openReport(page);
  await expect(page.locator('#list')).toBeHidden();
  await expect(page.locator('#detail')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Timesheet', level: 1 })).toBeVisible();
  await expect(page.locator('[data-ref="report-range"]')).toHaveText(/^Oct 19\s?–\s?25, 2026$/);
  await expect(grid.getByRole('columnheader')).toHaveText([
    'Task',
    '19 Mon',
    '20 Tue',
    '21 Wed',
    '22 Thu',
    '23 Fri',
    '24 Sat',
    '25 Sun',
    'Total',
  ]);
  await expect(
    grid.getByRole('rowheader', { name: 'Client work / Support retainer' }),
  ).toBeVisible();
  await expect(cell(grid, 'Checkout form validation', 1)).toHaveText('2h 01m');
  await expect(cell(grid, 'Checkout form validation', 2)).toHaveText('1h 25m');
  await expect(cell(grid, 'Checkout form validation', 2)).toHaveAttribute('aria-readonly', 'true');
  await expect(cell(grid, 'Total', 8)).toHaveText('9h 28m');

  const summary = page.getByRole('table', { name: 'Summary' });
  await expect(summary.getByRole('row', { name: /^Client work / })).toContainText('1,087.33');
  await expect(summary.getByRole('row', { name: /^Support retainer / })).toContainText('80.00');
  await expect(page.locator('[data-ref="report-rounding"]')).toBeHidden();

  // Back to a project: the task list and details return.
  await project(page, 'Build').click();
  await expect(page.locator('#list')).toBeVisible();
  await expect(page.locator('#report')).toBeHidden();
  expect(errors).toEqual([]);
});

test('is accessible in light and dark', async ({ page }) => {
  await openReport(page);
  await page.clock.resume();
  await expectNoAxeViolations(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectNoAxeViolations(page);
});

test('arrow keys move between cells; the running day and totals are read-only', async ({
  page,
}) => {
  const grid = await openReport(page);
  await cell(grid, 'Checkout form validation', 1).click();
  await expect(cell(grid, 'Checkout form validation', 1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(cell(grid, 'Product image pipeline', 1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await expect(cell(grid, 'Checkout form validation', 2)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(grid.locator('input')).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(cell(grid, 'Checkout form validation', 8)).toBeFocused();
  await page.keyboard.press('F2');
  await expect(grid.locator('input')).toHaveCount(0);
  await page.keyboard.press('Control+End');
  await expect(cell(grid, 'Total', 8)).toBeFocused();
  await page.keyboard.press('Control+Home');
  await expect(cell(grid, 'Checkout form validation', 0)).toBeFocused();
  // One tab stop: Tab leaves the grid.
  await expect(grid.locator('[tabindex="0"]')).toHaveCount(1);
});

test('typing in an empty cell adds a manual entry from 09:00; Undo removes it', async ({
  page,
}) => {
  const grid = await openReport(page);
  const wed = cell(grid, 'Weekly client sync', 3);
  await wed.click();
  await page.keyboard.type('1:30');
  const input = grid.getByRole('textbox', { name: 'Weekly client sync, Wed, Oct 21' });
  await expect(input).toHaveValue('1:30');
  await page.keyboard.press('Enter');
  await expect(wed).toHaveText('1h 30m');
  await expect(wed).toBeFocused();
  await expect(cell(grid, 'Total', 3)).toHaveText('1h 30m');
  expect(await dayEntries(page, 'Weekly client sync', 21)).toEqual(['09:00–10:30 manual']);

  const bar = page.locator('[data-ref="report-notification"]');
  await expect(bar).toContainText('Timesheet updated.');
  await bar.getByRole('button', { name: 'Undo' }).click();
  await expect(wed).toHaveText('');
  expect(await dayEntries(page, 'Weekly client sync', 21)).toEqual([]);
});

test('Escape cancels an edit; an unreadable value keeps the field open', async ({ page }) => {
  const grid = await openReport(page);
  const mon = cell(grid, 'Weekly client sync', 1);
  await mon.dblclick();
  const input = mon.getByRole('textbox');
  await expect(input).toHaveValue('1:13');
  await input.fill('lots');
  await input.press('Enter');
  await expect(page.locator('[data-ref="report-notification"]')).toContainText(
    'Enter a duration such as 1:30, 1.5 (hours) or 90m, at most a day.',
  );
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(mon).toHaveText('1h 13m');
  await expect(mon).toBeFocused();
});

test('more time on a day with timer entries adds a manual entry after them', async ({ page }) => {
  const grid = await openReport(page);
  const before = await dayEntries(page, 'Weekly client sync', 19);
  const mon = cell(grid, 'Weekly client sync', 1);
  await mon.click();
  await page.keyboard.press('Enter');
  await mon.getByRole('textbox').fill('2h');
  await page.keyboard.press('Enter');
  await expect(mon).toHaveText('2h 00m');
  const after = await dayEntries(page, 'Weekly client sync', 19);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after).toHaveLength(before.length + 1);
  expect(after.at(-1)).toMatch(/ manual$/);
});

test('less time than the timer entries asks before replacing them', async ({ page }) => {
  const grid = await openReport(page);
  // Two timer entries on Wednesday 21 Oct.
  await page.evaluate(async () => {
    const db = await import('/db/index.js');
    const conn = await db.openDB();
    const task = (await db.listTasks(conn)).find((t) => t.name === 'Weekly client sync');
    for (const [from, to] of [
      [9, 10],
      [13, 14],
    ]) {
      await db.addEntry(conn, {
        taskId: /** @type {any} */ (task).id,
        start: new Date(2026, 9, 21, from).getTime(),
        end: new Date(2026, 9, 21, to).getTime(),
        source: 'timer',
      });
    }
    conn.close();
  });
  const wed = cell(grid, 'Weekly client sync', 3);
  await expect(wed).toHaveText('2h 00m');
  await wed.click();
  await page.keyboard.type('1');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Replace Entries?' });
  await expect(dialog).toContainText(
    'Replace the 2 entries of “Weekly client sync” on Wed, Oct 21 with one entry of 1h 00m?',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(wed).toHaveText('2h 00m');
  await expect(wed).toBeFocused();

  await page.keyboard.type('1');
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(wed).toHaveText('1h 00m');
  expect(await dayEntries(page, 'Weekly client sync', 21)).toEqual(['09:00–10:00 manual']);

  await page
    .locator('[data-ref="report-notification"]')
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(wed).toHaveText('2h 00m');
  expect(await dayEntries(page, 'Weekly client sync', 21)).toEqual([
    '09:00–10:00 timer',
    '13:00–14:00 timer',
  ]);
});

test('Delete clears a day after confirming', async ({ page }) => {
  const grid = await openReport(page);
  const mon = cell(grid, 'Field components skeleton', 1);
  await mon.click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: /^Delete Entr/ });
  await expect(dialog).toContainText(
    /^.*Delete the (\d+ entries|entry) of “Field components skeleton”/,
  );
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(grid.getByRole('rowheader', { name: 'Field components skeleton' })).toHaveCount(0);
});

test('Add Task… adds an empty row to fill in', async ({ page }) => {
  const grid = await openReport(page);
  await page.getByRole('button', { name: 'Add Task…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a Task to the Timesheet' });
  await dialog.getByLabel('Task').selectOption({ label: 'Accessibility fixes' });
  await dialog.getByRole('button', { name: 'Add' }).click();
  const first = cell(grid, 'Accessibility fixes', 1);
  await expect(first).toBeFocused();
  await expect(cell(grid, 'Accessibility fixes', 8)).toHaveText('0m');
  await page.keyboard.type('45m');
  await page.keyboard.press('Enter');
  await expect(first).toHaveText('45m');
});

test('filters by project subtree, billable and tags', async ({ page }) => {
  const grid = await openReport(page);
  const rows = grid.locator('tbody tr:not(.group) th');
  await page
    .getByRole('combobox', { name: 'Project' })
    .selectOption({ label: 'Client work / Support retainer' });
  await expect(rows).toHaveText(['Weekly client sync']);
  await expect(page.getByRole('table', { name: 'Summary' }).locator('tbody th')).toHaveText([
    'Support retainer',
  ]);
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'All Projects' });
  await page.getByRole('button', { name: 'Tags' }).click();
  await page
    .getByRole('group', { name: 'Tags to report' })
    .getByRole('button', { name: 'Frontend' })
    .click();
  await expect(rows).toHaveText(['Checkout form validation', 'Field components skeleton']);
  // Closing the tag bar drops the tag filter.
  await page.getByRole('button', { name: 'Tags' }).click();
  await expect(rows).toHaveCount(6);
  await page.getByRole('button', { name: 'Billable' }).click();
  await expect(page.getByRole('button', { name: 'Billable' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(rows).toHaveCount(6);
});

test('moves between weeks, shows a month, and a custom range', async ({ page }) => {
  const grid = await openReport(page);
  const range = page.locator('[data-ref="report-range"]');
  await page.getByRole('button', { name: 'Previous Range' }).click();
  await expect(range).toHaveText(/^Oct 12\s?–\s?18, 2026$/);
  await page.getByRole('button', { name: 'Next Range' }).click();
  await expect(range).toHaveText(/^Oct 19\s?–\s?25, 2026$/);
  await page.getByRole('combobox', { name: 'Range' }).selectOption({ label: 'This Month' });
  await expect(grid.getByRole('columnheader')).toHaveCount(33);
  await page.getByRole('combobox', { name: 'Range' }).selectOption({ label: 'Custom' });
  await page.getByLabel('From', { exact: true }).fill('2026-10-19');
  await page.getByLabel('To', { exact: true }).fill('2026-10-21');
  await page.getByLabel('To', { exact: true }).dispatchEvent('change');
  await expect(grid.getByRole('columnheader')).toHaveCount(5);
  await page.getByLabel('To', { exact: true }).fill('2026-12-01');
  await page.getByLabel('To', { exact: true }).dispatchEvent('change');
  await expect(page.locator('[data-ref="report-notification"]')).toContainText(
    'Choose up to 31 days',
  );
  // The choice survives a reload.
  await page.reload();
  await page.locator('html[data-ready]').waitFor();
  await expect(page.getByRole('combobox', { name: 'Range' })).toHaveValue('custom');
  await expect(grid.getByRole('columnheader')).toHaveCount(5);
});

test('rounding from Settings changes the report, not the entries', async ({ page }) => {
  const grid = await openReport(page);
  await page.getByRole('button', { name: 'More' }).first().click();
  await page.getByRole('menuitem', { name: 'Settings…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByLabel('Round', { exact: true })).toBeDisabled();
  await dialog.getByLabel('Round durations up to').selectOption('15');
  await dialog.getByLabel('Round', { exact: true }).selectOption('day');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('[data-ref="report-rounding"]')).toHaveText(
    'Rounded up to 15 min per task and day.',
  );
  await expect(cell(grid, 'Checkout form validation', 1)).toHaveText('2h 15m');
  // The cell editor shows the exact time.
  await cell(grid, 'Checkout form validation', 1).dblclick();
  await expect(grid.getByRole('textbox')).toHaveValue('2:01');
});

test('exports the report as CSV', async ({ page }) => {
  await openReport(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('time-tracker-report-2026-10-19.csv');
  const text = await readFile(/** @type {string} */ (await download.path()), 'utf8');
  const lines = text.replace(/^\uFEFF/, '').split('\r\n');
  expect(lines[0]).toBe('Date,Project,Task,Billable,Tags,Minutes,Hours,Rate,Amount');
  expect(lines[1]).toBe(
    '2026-10-19,Client work / Harbor Coffee — website / Build,Checkout form validation,true,Frontend; Implementation,121,2.02,120.00,242.00',
  );
  await expect(page.locator('[data-ref="report-notification"]')).toContainText(
    'Exported the timesheet as time-tracker-report-2026-10-19.csv.',
  );
});

test('prints only the report', async ({ page }) => {
  const grid = await openReport(page);
  await page.getByRole('button', { name: 'Billable' }).click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('[data-ref="report-filters"]')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  await expect(grid).toBeVisible();
  await expect(page.getByRole('table', { name: 'Summary' })).toBeVisible();
  await expect(page.locator('[data-ref="report-print-filters"]')).toHaveText('Filters: Billable');
  await page.screenshot({ path: 'artifacts/shots/report-print.png', fullPage: true });
});

test('the project dialog sets an hourly rate that the summary uses', async ({ page }) => {
  await openReport(page);
  await project(page, 'Support retainer').dblclick();
  const dialog = page.getByRole('dialog', { name: 'Project Properties' });
  const rate = dialog.getByLabel('Hourly rate');
  await expect(rate).toHaveValue('80');
  await rate.fill('ten');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeVisible();
  await rate.fill('100,50');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('treeitem', { name: 'Timesheet' }).click();
  const summary = page.getByRole('table', { name: 'Summary' });
  await expect(summary.getByRole('row', { name: /^Support retainer / })).toContainText('100.50');
});

test('leaving Reports mid-edit drops the edit; the grid works when coming back', async ({
  page,
}) => {
  const grid = await openReport(page);
  const mon = cell(grid, 'Weekly client sync', 1);
  await mon.dblclick();
  await mon.getByRole('textbox').fill('lots');
  // Clicking elsewhere drops an unreadable value instead of pulling focus back.
  await page.getByRole('treeitem', { name: /^Today/ }).click();
  await expect(page.locator('#report')).toBeHidden();
  await page.getByRole('treeitem', { name: 'Timesheet' }).click();
  await expect(grid.getByRole('textbox')).toHaveCount(0);
  await expect(mon).toHaveText('1h 13m');
  await mon.click();
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await expect(mon).toHaveText('2h 00m');
});
