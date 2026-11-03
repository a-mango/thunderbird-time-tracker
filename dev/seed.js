// Dev-only: fills the page origin's IndexedDB with fixtures, through the same importer checks a
// backup goes through. Used by mock-messenger.js in the dev harness; never shipped.
import { DB_NAME, META, STORES } from '../src/db/schema.js';
import { storeAggregates } from '../src/db/aggregates.js';
import { openDB, tx } from '../src/db/idb.js';
import { updateSettings } from '../src/db/settings.js';
import { parseBackup } from '../src/lib/importer.js';

/** @typedef {import('./fixtures.js').Fixtures} Fixtures */
/** @typedef {import('../src/lib/types.js').Settings} Settings */

/** Opens without change notifications: seeding is not a user change. */
const openQuiet = (/** @type {IDBFactory} */ factory) => openDB({ factory, notify: () => {} });

/**
 * Deletes the database. Open connections close themselves (openDB's versionchange handler).
 * @param {IDBFactory} [factory]
 * @returns {Promise<void>}
 */
export function deleteDatabase(factory = indexedDB) {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Whether the database exists already (the harness keeps changes across reloads).
 * @param {IDBFactory} [factory]
 */
export async function databaseExists(factory = indexedDB) {
  return (await factory.databases()).some((info) => info.name === DB_NAME);
}

/**
 * Replaces the database with `fixtures` (validated like a backup import) in one transaction,
 * pointing `meta.running` at the open entry if there is one.
 * @param {Fixtures} fixtures
 * @param {{factory?: IDBFactory, now?: number}} [options]
 */
export async function seedDatabase(fixtures, { factory = indexedDB, now = Date.now() } = {}) {
  const backup = parseBackup(
    JSON.stringify({
      format: 'thunderbird-time-tracker',
      version: 1,
      exportedAt: now,
      ...fixtures,
    }),
  );
  await deleteDatabase(factory);
  const db = await openQuiet(factory);
  try {
    await tx(db, [STORES.projects, STORES.tasks, STORES.entries, STORES.meta], 'readwrite', (s) => {
      for (const project of backup.projects) s.projects.put(project);
      for (const task of backup.tasks) s.tasks.put(task);
      for (const entry of backup.entries) s.entries.put(entry);
      const running = backup.entries.find((entry) => entry.end === null);
      s.meta.put(running?.id ?? null, META.running);
      return storeAggregates(s, backup.entries);
    });
  } finally {
    db.close();
  }
}

/**
 * Stores settings (e.g. `?density=compact` for screenshots).
 * @param {Partial<Settings>} settings
 * @param {{factory?: IDBFactory}} [options]
 */
export async function seedSettings(settings, { factory = indexedDB } = {}) {
  const db = await openQuiet(factory);
  try {
    await updateSettings(db, settings);
  } finally {
    db.close();
  }
}
