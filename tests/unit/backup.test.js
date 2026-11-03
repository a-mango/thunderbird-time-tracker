import { describe, expect, it } from 'vitest';
import { exportBackup, restoreBackup, wipeAll } from '../../src/db/backup.js';
import {
  addEntry,
  getRunning,
  recentTasks,
  softDeleteEntry,
  startEntry,
} from '../../src/db/entries.js';
import { createProject, listProjects } from '../../src/db/projects.js';
import { getSettings, updateSettings } from '../../src/db/settings.js';
import { listTasks, markTaskDone, updateTask } from '../../src/db/tasks.js';
import { tx, req } from '../../src/db/idb.js';
import { ImportError } from '../../src/lib/errors.js';
import { parseBackup } from '../../src/lib/importer.js';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.js';
import { MIN, T0, allEntries, freshDB, runningPointer, seed } from './db-helpers.js';

/** Every store's raw contents (meta included), for deep-equal comparisons. */
async function dump(/** @type {IDBDatabase} */ db) {
  return tx(db, ['projects', 'tasks', 'entries', 'meta', 'links'], 'readonly', async (s) => ({
    projects: await req(s.projects.getAll()),
    tasks: await req(s.tasks.getAll()),
    entries: await req(s.entries.getAll()),
    links: await req(s.links.getAll()),
    meta: Object.fromEntries(
      await Promise.all(
        (await req(s.meta.getAllKeys())).map(async (key) => [key, await req(s.meta.get(key))]),
      ),
    ),
  }));
}

/** A database with a bit of everything: nesting, a done task, deleted and running entries. */
async function populated() {
  const ctx = await freshDB();
  const { db } = ctx;
  const ids = await seed(db);
  await addEntry(db, { taskId: ids.checkout.id, start: T0 - 120 * MIN, end: T0 - 60 * MIN });
  const gone = await addEntry(db, {
    taskId: ids.pipeline.id,
    start: T0 - 50 * MIN,
    end: T0 - 40 * MIN,
  });
  await softDeleteEntry(db, gone.id, { now: T0 });
  await addEntry(db, {
    taskId: ids.bookkeeping.id,
    start: T0 - 30 * MIN,
    end: T0 - 20 * MIN,
    note: 'Receipts, "Q3"',
  });
  await markTaskDone(db, ids.bookkeeping.id, { now: T0 });
  await startEntry(db, ids.pipeline.id, { now: T0 });
  await updateSettings(db, { density: 'compact', durationFormat: 'decimal' });
  return { ...ctx, ids };
}

describe('backup', () => {
  it('round-trips: backup → wipe → restore gives a deep-equal database', async () => {
    const { db } = await populated();
    const before = await dump(db);
    const backup = await exportBackup(db, { now: T0 + MIN });
    expect(backup).toMatchObject({
      format: 'thunderbird-time-tracker',
      version: 1,
      exportedAt: T0 + MIN,
    });
    // Through JSON and the importer, like a file on disk.
    const parsed = parseBackup(JSON.stringify(backup));

    await wipeAll(db);
    const wiped = await dump(db);
    expect(wiped).toMatchObject({ projects: [], tasks: [], entries: [], links: [] });
    expect(wiped.meta).toEqual({ schemaVersion: before.meta.schemaVersion, running: null });

    await restoreBackup(db, parsed, { mode: 'replace' });
    expect(await dump(db)).toEqual(before);
    expect((await getRunning(db))?.taskId).toBeDefined();
  });

  it('replace clears message links (not in a v1 backup)', async () => {
    const { db } = await populated();
    const backup = await exportBackup(db);
    await tx(db, ['links'], 'readwrite', ({ links }) =>
      req(
        links.put({
          id: 'l1',
          taskId: 'x',
          headerMessageId: 'a@example.invalid',
          subject: 'Hi',
          date: T0,
        }),
      ),
    );
    await restoreBackup(db, backup, { mode: 'replace' });
    expect((await dump(db)).links).toEqual([]);
  });

  it('exports soft-deleted entries and only known settings', async () => {
    const { db } = await populated();
    const backup = await exportBackup(db);
    expect(backup.entries).toHaveLength(4);
    expect(backup.entries.filter((entry) => entry.deletedAt !== null)).toHaveLength(1);
    expect(backup.settings).toEqual({ density: 'compact', durationFormat: 'decimal' });
  });

  it('leaves settings out when none are stored, and restoring that resets them', async () => {
    const { db } = await freshDB();
    await seed(db);
    const backup = await exportBackup(db);
    expect(backup).not.toHaveProperty('settings');
    await updateSettings(db, { accent: 'teal' });
    await restoreBackup(db, backup, { mode: 'replace' });
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('notifies a reset after restore and wipe', async () => {
    const { db, notify } = await populated();
    const backup = await exportBackup(db);
    notify.mockClear();
    await restoreBackup(db, backup, { mode: 'replace' });
    await wipeAll(db);
    expect(notify.mock.calls).toEqual([
      [{ type: 'reset', ids: ['*'] }],
      [{ type: 'reset', ids: ['*'] }],
    ]);
  });
});

describe('restore: merge by id', () => {
  it('replaces records with the same id, adds new ones and keeps the rest', async () => {
    const { db, ids } = await populated();
    const backup = await exportBackup(db);
    // Changes after the backup: a rename (overwritten by the merge) and a new project (kept).
    await updateTask(db, ids.checkout.id, { name: 'Renamed later' });
    const later = await createProject(db, { name: 'Later' });
    // A record only the backup has.
    const extra = { ...backup.tasks[0], id: 'task-from-backup', name: 'From the backup' };
    const incoming = parseBackup(JSON.stringify({ ...backup, tasks: [...backup.tasks, extra] }));
    await updateSettings(db, { accent: 'teal' });

    const counts = await restoreBackup(db, incoming, { mode: 'merge' });
    const tasks = await listTasks(db);
    expect(tasks.find((task) => task.id === ids.checkout.id)?.name).toBe(
      'Checkout form validation',
    );
    expect(tasks.find((task) => task.id === 'task-from-backup')?.name).toBe('From the backup');
    expect((await listProjects(db)).map((p) => p.id)).toContain(later.id);
    expect(counts).toEqual({ projects: 5, tasks: 4, entries: 4 });
    // Settings stay as they are on merge.
    expect((await getSettings(db)).accent).toBe('teal');
    expect(await runningPointer(db)).toBe((await getRunning(db))?.id);
  });

  it('rejects a merge that would leave two running entries, and writes nothing', async () => {
    const { db } = await freshDB();
    const ids = await seed(db);
    await startEntry(db, ids.checkout.id, { now: T0 });
    const backup = await exportBackup(db);
    const other = { ...backup.entries[0], id: 'another-running', taskId: ids.pipeline.id };
    const incoming = parseBackup(JSON.stringify({ ...backup, entries: [other] }));
    const before = await dump(db);
    await expect(restoreBackup(db, incoming, { mode: 'merge' })).rejects.toMatchObject({
      constructor: ImportError,
      code: 'multiple-running',
    });
    expect(await dump(db)).toEqual(before);
  });

  it('rejects a merge that marks the running task done', async () => {
    const { db } = await freshDB();
    const ids = await seed(db);
    const backup = await exportBackup(db);
    await startEntry(db, ids.checkout.id, { now: T0 });
    const tasks = backup.tasks.map((task) =>
      task.id === ids.checkout.id ? { ...task, status: 'done', doneAt: T0 } : task,
    );
    const incoming = parseBackup(JSON.stringify({ ...backup, tasks }));
    await expect(restoreBackup(db, incoming, { mode: 'merge' })).rejects.toMatchObject({
      code: 'running',
    });
    expect((await getRunning(db))?.taskId).toBe(ids.checkout.id);
  });
});

describe('recentTasks', () => {
  it('lists tasks by their last ended entry, skipping rejected and repeated ones', async () => {
    const { db } = await freshDB();
    const ids = await seed(db);
    await addEntry(db, { taskId: ids.checkout.id, start: T0 - 90 * MIN, end: T0 - 80 * MIN });
    await addEntry(db, { taskId: ids.bookkeeping.id, start: T0 - 70 * MIN, end: T0 - 60 * MIN });
    await addEntry(db, { taskId: ids.pipeline.id, start: T0 - 50 * MIN, end: T0 - 40 * MIN });
    await addEntry(db, { taskId: ids.checkout.id, start: T0 - 30 * MIN, end: T0 - 20 * MIN });
    await markTaskDone(db, ids.bookkeeping.id, { now: T0 });
    const names = async (/** @type {number} */ limit) =>
      (await recentTasks(db, { limit })).map((task) => task.name);
    expect(await names(5)).toEqual(['Checkout form validation', 'Product image pipeline']);
    expect(await names(1)).toEqual(['Checkout form validation']);
    expect(await names(0)).toEqual([]);
    const all = await recentTasks(db, { limit: 5, accept: () => true });
    expect(all.map((task) => task.id)).toEqual([
      ids.checkout.id,
      ids.pipeline.id,
      ids.bookkeeping.id,
    ]);
  });

  it('ignores soft-deleted entries', async () => {
    const { db } = await freshDB();
    const ids = await seed(db);
    const entry = await addEntry(db, { taskId: ids.checkout.id, start: T0 - 9 * MIN, end: T0 });
    await softDeleteEntry(db, entry.id, { now: T0 });
    expect(await recentTasks(db, { limit: 5 })).toEqual([]);
    expect(await allEntries(db)).toHaveLength(1);
  });
});
