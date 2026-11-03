import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  NOW,
  chooseFromMenu,
  collectErrors,
  expectNoAxeViolations,
  openTracker,
} from './helpers.js';

// M6: settings dialog (live in every open page), backup download, restore preview, CSV export
// and wiping all data.

/** @param {import('@playwright/test').Page} page */
async function openSettings(page) {
  await chooseFromMenu(page, 'More options', 'Settings…');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('settings apply live in another open page', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await openTracker(a);
  await openTracker(b);
  const errors = collectErrors(b);
  const dialog = await openSettings(a);
  await dialog.getByLabel('Density').selectOption('compact');
  await expect(a.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(b.locator('html')).toHaveAttribute('data-density', 'compact');
  await dialog.getByLabel('Accent color').selectOption('teal');
  await expect(b.locator('html')).toHaveAttribute('data-accent', 'teal');
  // Duration format re-renders the badges in the other page.
  await dialog.getByLabel('Duration format').selectOption('decimal');
  await expect(
    b.getByRole('tree', { name: 'Views' }).getByRole('treeitem', { name: /^Today/ }),
  ).toHaveAccessibleName(/^Today \d+\.\d\dh$/);
  // Show done tasks: the other page's list drops the Open filter.
  await dialog.getByLabel('Show done tasks').check();
  await b
    .getByRole('tree', { name: 'Projects' })
    .getByRole('treeitem', { name: /^Build/ })
    .click();
  await expect(b.getByRole('treegrid', { name: 'Tasks' })).toContainText('Form state refactor');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  // Kept after a reload.
  await a.goto('/ui/tracker.html');
  await expect(a.locator('html')).toHaveAttribute('data-density', 'compact');
  expect(errors).toEqual([]);
});

test('the settings dialog is keyboard-operable and passes axe', async ({ page }) => {
  await openTracker(page);
  const dialog = await openSettings(page);
  await expect(dialog.getByLabel('Density')).toBeFocused();
  await expect(dialog.getByLabel('Week starts on')).toHaveValue('1');
  await expect(dialog.getByLabel('Daily target (hours)')).toHaveValue('8');
  await expectNoAxeViolations(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'More options' })).toBeFocused();
});

test('backup downloads JSON; restore shows a preview and merges', async ({ page }) => {
  await openTracker(page);
  const dialog = await openSettings(page);
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Back Up…' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('time-tracker-2026-10-20.json');
  const text = await readFile(/** @type {string} */ (await download.path()), 'utf8');
  const backup = JSON.parse(text);
  expect(backup).toMatchObject({ format: 'thunderbird-time-tracker', version: 1 });
  await expect(dialog.getByRole('status')).toHaveText(
    'Backup saved as time-tracker-2026-10-20.json.',
  );

  // Rename a task in the file: a merge brings the backup's version back.
  const task = backup.tasks.find((/** @type {any} */ t) => t.name === 'Performance pass');
  task.name = 'Performance pass (restored)';
  const choosing = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Restore…' }).click();
  await (
    await choosing
  ).setFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  const preview = page.getByRole('dialog', { name: 'Restore Backup' });
  await expect(preview).toContainText('Backup from Oct 20, 2026, 2:45 PM');
  await expect(preview).toContainText(
    `${backup.projects.length} projects, ${backup.tasks.length} tasks`,
  );
  await expect(preview).toContainText(/Entries from \w+ \d+, 2026 to Oct 20, 2026/);
  await expectNoAxeViolations(page);
  await preview.getByRole('button', { name: 'Merge' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Backup restored.');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page
    .getByRole('tree', { name: 'Projects' })
    .getByRole('treeitem', { name: /^Build/ })
    .click();
  await expect(page.getByRole('treegrid', { name: 'Tasks' })).toContainText(
    'Performance pass (restored)',
  );
});

test('restore rejects an invalid file without changing anything', async ({ page }) => {
  await openTracker(page);
  const dialog = await openSettings(page);
  const choosing = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Restore…' }).click();
  await (
    await choosing
  ).setFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"something-else"}'),
  });
  await expect(dialog.getByRole('status')).toHaveText(
    'This file can’t be restored: it isn’t a Time Tracker backup.',
  );
  await expect(page.getByRole('dialog', { name: 'Restore Backup' })).toHaveCount(0);
});

test('CSV export downloads the entries of a range', async ({ page }) => {
  await openTracker(page);
  await chooseFromMenu(page, 'More options', 'Export CSV…');
  const dialog = page.getByRole('dialog', { name: 'Export Time Entries' });
  await expect(dialog.getByLabel('From')).toHaveValue('2026-10-01');
  await expect(dialog.getByLabel('To')).toHaveValue('2026-10-20');
  await dialog
    .getByLabel('Project')
    .selectOption({ label: 'Client work › Harbor Coffee — website › Build' });
  // An inverted range can't be exported.
  await dialog.getByLabel('To').fill('2026-09-01');
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('To').fill('2026-10-20');
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('time-tracker-2026-10-20.csv');
  const csv = await readFile(/** @type {string} */ (await download.path()), 'utf8');
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  expect(lines[0]).toBe('Date,Start,End,Minutes,Project,Task,Note,Billable');
  expect(lines.length).toBeGreaterThan(3);
  for (const line of lines.slice(1, -1)) {
    expect(line).toMatch(
      /^2026-10-\d\d,\d\d:\d\d,\d\d:\d\d,\d+,Client work \/ Harbor Coffee — website \/ Build,/,
    );
  }
  await expect(page.locator('tt-notification-bar')).toContainText(
    `Exported ${lines.length - 2} entries.`,
  );
});

test('wipe needs the typed word, then empties everything', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await openTracker(page);
  // Typed quick-filter text is stored per project in the layout store.
  await page.evaluate(() =>
    localStorage.setItem(
      'tt.layout.tracker.filter.project:p4',
      JSON.stringify({ text: 'invoice' }),
    ),
  );
  const settings = await openSettings(page);
  await settings.getByRole('button', { name: 'Delete All Data…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete All Data' });
  const field = confirm.getByLabel('Type DELETE to confirm');
  await expect(field).toBeFocused();
  await field.fill('delete');
  await confirm.getByRole('button', { name: 'Delete Everything' }).click();
  await expect(confirm).toBeVisible();
  // Thunderbird's destructive hover colour is below AA with white text; check the resting state.
  await page.mouse.move(0, 0);
  await expectNoAxeViolations(page);
  await field.fill('DELETE');
  await confirm.getByRole('button', { name: 'Delete Everything' }).click();
  await expect(settings.getByRole('status')).toHaveText('All data deleted.');
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('No projects yet.')).toBeVisible();
  // Layout values (selection, filter text) are gone too.
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter((key) => key.startsWith('tt.layout.'))).toEqual([]);
});
