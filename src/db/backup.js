// Whole-database operations (M6): JSON backup, restore (replace or merge by id) and wipe. Each is
// one transaction over every store, so a page never sees half a restore. Afterwards open pages
// get a `reset` change and reload everything.
import { BACKUP_FORMAT, BACKUP_VERSION, validateBackup } from '../lib/importer.js';
import { emit, req, tx } from './idb.js';
import { META, STORES } from './schema.js';
import { knownSettings } from './settings.js';

/**
 * @typedef {import('../lib/types.js').Backup} Backup
 * @typedef {import('../lib/types.js').Entry} Entry
 * @typedef {'replace' | 'merge'} RestoreMode
 */

const DATA_STORES = [STORES.projects, STORES.tasks, STORES.entries, STORES.meta];

/** @param {Entry[]} entries */
const runningId = (entries) =>
  entries.find((entry) => entry.end === null && entry.deletedAt === null)?.id ?? null;

/**
 * Everything in the database as a backup (schema v1): all projects, tasks and entries (soft-deleted
 * ones included, so a restore gives back the same database) and the stored settings.
 * @param {IDBDatabase} db
 * @param {{now?: number}} [options] `now` becomes `exportedAt`
 * @returns {Promise<Backup>}
 */
export function exportBackup(db, { now = Date.now() } = {}) {
  return tx(db, DATA_STORES, 'readonly', async (s) => {
    const [projects, tasks, entries, settings] = await Promise.all([
      req(s.projects.getAll()),
      req(s.tasks.getAll()),
      req(s.entries.getAll()),
      req(s.meta.get(META.settings)),
    ]);
    /** @type {Backup} */
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now,
      projects,
      tasks,
      entries,
    };
    const stored = knownSettings(settings);
    if (Object.keys(stored).length > 0) backup.settings = stored;
    return backup;
  });
}

/**
 * Writes a validated backup (from `parseBackup`).
 * - `replace`: the database becomes the backup, settings included (none in the backup = defaults);
 *   message links are cleared.
 * - `merge`: records with the same id are replaced by the backup's, others are added, nothing is
 *   removed, settings stay. The merged result must pass the importer's checks (no dangling
 *   reference, no cycle, one running entry at most), else nothing is written.
 * @param {IDBDatabase} db
 * @param {Backup} backup
 * @param {{mode: RestoreMode, now?: number}} options
 * @returns {Promise<{projects: number, tasks: number, entries: number}>} record counts afterwards
 * @throws {import('../lib/errors.js').ImportError} merge only: the merged data breaks a check
 */
export async function restoreBackup(db, backup, { mode, now = Date.now() }) {
  const counts = await tx(db, [...DATA_STORES, STORES.links], 'readwrite', async (s) => {
    if (mode === 'replace') {
      // Message links (S1) aren't in a v1 backup; they'd point at tasks that may be gone.
      s.links.clear();
      await Promise.all([req(s.projects.clear()), req(s.tasks.clear()), req(s.entries.clear())]);
      for (const project of backup.projects) s.projects.put(project);
      for (const task of backup.tasks) s.tasks.put(task);
      for (const entry of backup.entries) s.entries.put(entry);
      if (backup.settings) s.meta.put(backup.settings, META.settings);
      else s.meta.delete(META.settings);
      await req(s.meta.put(runningId(backup.entries), META.running));
      return {
        projects: backup.projects.length,
        tasks: backup.tasks.length,
        entries: backup.entries.length,
      };
    }
    const [projects, tasks, entries] = await Promise.all([
      req(s.projects.getAll()),
      req(s.tasks.getAll()),
      req(s.entries.getAll()),
    ]);
    /** @template {{id: string}} T @param {T[]} current @param {T[]} incoming */
    const byId = (current, incoming) => [
      ...new Map([...current, ...incoming].map((item) => [item.id, item])).values(),
    ];
    const merged = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now,
      projects: byId(projects, backup.projects),
      tasks: byId(tasks, backup.tasks),
      entries: byId(entries, backup.entries),
    };
    // Throws (and so aborts the transaction) before anything is written.
    validateBackup(merged);
    for (const project of backup.projects) s.projects.put(project);
    for (const task of backup.tasks) s.tasks.put(task);
    for (const entry of backup.entries) s.entries.put(entry);
    await req(s.meta.put(runningId(merged.entries), META.running));
    return {
      projects: merged.projects.length,
      tasks: merged.tasks.length,
      entries: merged.entries.length,
    };
  });
  emit(db, { type: 'reset', ids: ['*'] });
  return counts;
}

/**
 * Deletes every project, task, entry, message link and the stored settings. The schema version
 * stays, so the database keeps working.
 * @param {IDBDatabase} db
 * @returns {Promise<void>}
 */
export async function wipeAll(db) {
  await tx(db, [...DATA_STORES, STORES.links], 'readwrite', async (s) => {
    s.projects.clear();
    s.tasks.clear();
    s.entries.clear();
    s.links.clear();
    s.meta.delete(META.settings);
    await req(s.meta.put(null, META.running));
  });
  emit(db, { type: 'reset', ids: ['*'] });
}
