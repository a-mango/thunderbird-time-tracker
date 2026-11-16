import { expect, test } from '@playwright/test';
import { SP_COUNTS, spBackup } from '../unit/sp-fixture.js';
import {
  chooseFromMenu,
  collectErrors,
  expectNoAxeViolations,
  openTracker,
  projectTree,
} from './helpers.js';

// S7: Settings › Data › Import from Super Productivity… with the fictional backup.

/** @param {import('@playwright/test').Page} page */
async function openSettings(page) {
  await chooseFromMenu(page, 'More options', 'Settings…');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Clicks the import button and hands the file chooser `contents`.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} dialog
 * @param {string} contents
 */
async function chooseBackup(page, dialog, contents) {
  const choosing = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Import from Super Productivity…' }).click();
  await (
    await choosing
  ).setFiles({
    name: 'super-productivity-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(contents),
  });
}

const { folders, projects, tasks, entries, skipped } = SP_COUNTS;

/**
 * The preview's counts table as rows of cell texts.
 * @param {import('@playwright/test').Locator} preview
 */
const countRows = (preview) =>
  preview
    .getByRole('table')
    .getByRole('row')
    .evaluateAll((rows) =>
      rows.map((row) => [...row.children].map((cell) => cell.textContent?.trim() ?? '')),
    );

test('imports a Super Productivity backup after a preview, and only once', async ({ page }) => {
  await openTracker(page, '?fixtures=empty');
  const errors = collectErrors(page);
  const dialog = await openSettings(page);
  await chooseBackup(page, dialog, JSON.stringify(spBackup()));

  const preview = page.getByRole('dialog', { name: 'Import from Super Productivity' });
  await expect(preview).toContainText(/Super Productivity backup from Oct 20, 2026/);
  expect(await countRows(preview)).toEqual([
    ['', 'To add', 'Already here'],
    ['Projects', String(folders + projects), '0'],
    ['Tasks', String(tasks), '0'],
    ['Time entries', String(entries), '0'],
  ]);
  await expect(preview.getByRole('rowheader', { name: 'Tasks' })).toBeVisible();
  await expect(preview).toContainText(/Entries from Mar 29, 2026 to Oct 25, 2026/);
  await expect(preview).toContainText(`Unreadable values left out: ${skipped}`);
  await expectNoAxeViolations(page);
  await preview.getByRole('button', { name: 'Import' }).click();
  await expect(dialog.getByRole('status')).toHaveText(
    `Import done. New projects: ${folders + projects}, new tasks: ${tasks}, new time entries: ${entries}.`,
  );
  for (const name of ['Client work', 'Side projects', 'Inbox']) {
    await expect(
      projectTree(page).getByRole('treeitem', { name: new RegExp(`^${name}`) }),
    ).toBeVisible();
  }

  // The same file again: nothing to add.
  await chooseBackup(page, dialog, JSON.stringify(spBackup()));
  expect(await countRows(preview)).toEqual([
    ['', 'To add', 'Already here'],
    ['Projects', '0', String(folders + projects)],
    ['Tasks', '0', String(tasks)],
    ['Time entries', '0', String(entries)],
  ]);
  await expect(preview).toContainText('Everything in this backup is already here.');
  await expect(preview.getByRole('button', { name: 'Import' })).toHaveCount(0);
  await expectNoAxeViolations(page);
  await preview.getByRole('button', { name: 'Close' }).click();
  await expect(preview).toBeHidden();
  // Cancelled: the status line stays empty.
  await expect(dialog.locator('.settings-status')).toBeEmpty();
  expect(errors).toEqual([]);
});

test('a day that changed in Super Productivity is counted, not imported again', async ({
  page,
}) => {
  await openTracker(page, '?fixtures=empty');
  const dialog = await openSettings(page);
  await chooseBackup(page, dialog, JSON.stringify(spBackup()));
  const preview = page.getByRole('dialog', { name: 'Import from Super Productivity' });
  await preview.getByRole('button', { name: 'Import' }).click();
  await expect(dialog.getByRole('status')).toContainText('Import done.');

  const newer = spBackup();
  /** @type {any} */ (newer.data.task.entities.checkout).timeSpentOnDay['2026-10-20'] =
    3 * 3_600_000;
  await chooseBackup(page, dialog, JSON.stringify(newer));
  await expect(preview).toContainText(
    'Days changed in Super Productivity since they were imported (kept as imported): 1',
  );
  await expect(preview).toContainText('Nothing new to import.');
  await expect(preview).not.toContainText('Everything in this backup is already here.');
});

test('an empty backup says so, without a table', async ({ page }) => {
  await openTracker(page, '?fixtures=empty');
  const dialog = await openSettings(page);
  const empty = { task: { ids: [], entities: {} }, project: { ids: [], entities: {} } };
  await chooseBackup(page, dialog, JSON.stringify(empty));
  const preview = page.getByRole('dialog', { name: 'Import from Super Productivity' });
  await expect(preview).toContainText('Super Productivity backup');
  await expect(preview).toContainText('This backup has no projects, tasks or time entries.');
  await expect(preview.getByRole('table')).toHaveCount(0);
  await expect(preview.getByRole('button', { name: 'Close' })).toBeFocused();
});

test('the settings dialog keeps its buttons in view when its body scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 480 });
  await openTracker(page, '?locale=fr');
  await chooseFromMenu(page, 'Plus d’options', 'Paramètres…');
  const dialog = page.getByRole('dialog', { name: 'Paramètres' });
  const close = dialog.getByRole('button', { name: 'Fermer' });
  await expect(close).toBeInViewport({ ratio: 1 });
  const body = dialog.locator('.dialog-body');
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // The last Data button is reachable by scrolling the body.
  const wipe = dialog.getByRole('button', { name: 'Supprimer toutes les données…' });
  await wipe.scrollIntoViewIfNeeded();
  await expect(wipe).toBeInViewport();
  await expect(close).toBeInViewport({ ratio: 1 });
});

test('refuses files that aren’t Super Productivity backups', async ({ page }) => {
  await openTracker(page);
  const dialog = await openSettings(page);
  await chooseBackup(page, dialog, '{"format":"thunderbird-time-tracker","version":1}');
  await expect(dialog.getByRole('status')).toHaveText(
    'This file can’t be imported: it’s a Time Tracker backup: use Restore… instead.',
  );
  await chooseBackup(page, dialog, '{"hello":"world"}');
  await expect(dialog.getByRole('status')).toHaveText(
    'This file can’t be imported: it isn’t a Super Productivity backup.',
  );
  await chooseBackup(page, dialog, 'not json');
  await expect(dialog.getByRole('status')).toHaveText(
    'This file can’t be imported: it isn’t valid JSON.',
  );
});
