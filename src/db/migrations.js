// Versioned schema migrations. `openDB` runs every migration above the stored version, in order,
// inside the `versionchange` transaction. A migration that throws aborts the whole upgrade, so the
// database stays at its previous version.
//
// Rules: never edit a shipped migration; append a new one with the next version and a test that
// upgrades a fixture of the previous version (tests/unit/idb.test.js).
import { INDEXES, STORES } from './schema.js';

/**
 * @typedef {{version: number, up: (db: IDBDatabase, tx: IDBTransaction) => void}} Migration
 */

/** @type {readonly Migration[]} */
export const MIGRATIONS = Object.freeze([
  {
    // v1: projects → tasks → entries, links (S1), and `meta` with out-of-line keys (META).
    version: 1,
    up(db) {
      const projects = db.createObjectStore(STORES.projects, { keyPath: 'id' });
      projects.createIndex(INDEXES.projectParent, 'parentId');

      const tasks = db.createObjectStore(STORES.tasks, { keyPath: 'id' });
      tasks.createIndex(INDEXES.taskProject, 'projectId');

      const entries = db.createObjectStore(STORES.entries, { keyPath: 'id' });
      entries.createIndex(INDEXES.entryTask, 'taskId');
      entries.createIndex(INDEXES.entryStart, 'start');
      entries.createIndex(INDEXES.entryEnd, 'end');
      entries.createIndex(INDEXES.entryDeleted, 'deletedAt');

      const links = db.createObjectStore(STORES.links, { keyPath: 'id' });
      links.createIndex(INDEXES.linkTask, 'taskId');

      db.createObjectStore(STORES.meta);
    },
  },
  {
    // v2 (S3): every project gets `hourlyRate: null` (no rate of its own).
    version: 2,
    up(_db, tx) {
      const cursorRequest = tx.objectStore(STORES.projects).openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        if (cursor.value.hourlyRate === undefined)
          cursor.update({ ...cursor.value, hourlyRate: null });
        cursor.continue();
      };
    },
  },
]);
