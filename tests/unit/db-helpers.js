// Shared helpers for db/ tests: a fresh fake-indexeddb per test and fictional seed data.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { vi } from 'vitest';
import { openDB, req, tx } from '../../src/db/idb.js';
import { createProject } from '../../src/db/projects.js';
import { createTask } from '../../src/db/tasks.js';

// Pages and the event page have IDBKeyRange as a global; Node doesn't. Only the key range is
// global here: every test opens its own IDBFactory.
globalThis.IDBKeyRange ??= IDBKeyRange;

export const MIN = 60_000;
/** Tuesday 2026-10-20 09:00 in Europe/Zurich. */
export const T0 = Date.UTC(2026, 9, 20, 7, 0);

/**
 * Opens a database on its own factory with a spy notifier.
 * @param {Partial<Parameters<typeof openDB>[0]>} [options]
 */
export async function freshDB(options = {}) {
  const factory = new IDBFactory();
  const notify = vi.fn();
  const db = await openDB({ factory, notify, ...options });
  return { db, factory, notify };
}

/**
 * Every entry in the store, soft-deleted ones included.
 * @param {IDBDatabase} db
 * @returns {Promise<import('../../src/lib/types.js').Entry[]>}
 */
export function allEntries(db) {
  return tx(db, ['entries'], 'readonly', ({ entries }) => req(entries.getAll()));
}

/**
 * The raw running pointer.
 * @param {IDBDatabase} db
 */
export function runningPointer(db) {
  return tx(db, ['meta'], 'readonly', ({ meta }) => req(meta.get('running')));
}

/**
 * A small fictional tree: Client work > Harbor Coffee — website > Build, with two tasks.
 * @param {IDBDatabase} db
 */
export async function seed(db) {
  const now = T0 - 10 * 24 * 60 * MIN;
  const client = await createProject(db, { name: 'Client work' }, { now });
  const harbor = await createProject(
    db,
    { name: 'Harbor Coffee — website', parentId: client.id },
    { now },
  );
  const build = await createProject(db, { name: 'Build', parentId: harbor.id }, { now });
  const internal = await createProject(db, { name: 'Internal' }, { now });
  const checkout = await createTask(
    db,
    { projectId: build.id, name: 'Checkout form validation' },
    { now },
  );
  const pipeline = await createTask(
    db,
    { projectId: build.id, name: 'Product image pipeline' },
    { now },
  );
  const bookkeeping = await createTask(
    db,
    { projectId: internal.id, name: 'Monthly bookkeeping' },
    { now },
  );
  return { client, harbor, build, internal, checkout, pipeline, bookkeeping };
}
