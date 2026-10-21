// Small promise wrapper over IndexedDB: open + migrate, transactions, requests, change emission.
import { BlockedError, InvariantError, VersionError } from '../lib/errors.js';
import { notifyChanged } from './changes.js';
import { MIGRATIONS } from './migrations.js';
import { DB_NAME, META, STORES } from './schema.js';

/**
 * @typedef {import('./migrations.js').Migration} Migration
 * @typedef {import('./changes.js').Change} Change
 * @typedef {import('./changes.js').Notifier} Notifier
 * @typedef {{
 *   name?: string,
 *   factory?: IDBFactory,
 *   migrations?: readonly Migration[],
 *   version?: number,
 *   notify?: Notifier,
 *   onBlocked?: (event: IDBVersionChangeEvent) => void,
 *   onVersionChange?: (event: IDBVersionChangeEvent) => void,
 *   blockedTimeoutMs?: number,
 * }} OpenOptions
 */

/** Highest schema version this code knows. */
export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Notifier per connection, set by `openDB`. */
/** @type {WeakMap<IDBDatabase, Notifier>} */
const notifiers = new WeakMap();

/**
 * @param {readonly Migration[]} migrations
 * @throws {InvariantError} `migrations` unless versions run 1, 2, 3… without gaps
 */
function checkMigrations(migrations) {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new InvariantError('migrations', `migration ${index} must have version ${index + 1}`);
    }
  });
}

/**
 * Opens (and creates or upgrades) the database.
 *
 * - Runs `migrations` above the stored version in order, inside the upgrade transaction, then
 *   stores `meta.schemaVersion`. A throwing migration aborts the upgrade and the promise rejects
 *   with that error; the database keeps its previous version.
 * - Another connection still open on an older version blocks the upgrade: `onBlocked` is called
 *   and, if the upgrade hasn't started after `blockedTimeoutMs`, the promise rejects with
 *   `BlockedError` (a connection that arrives late is closed).
 * - When a newer page upgrades the database, this connection closes itself and calls
 *   `onVersionChange`, so it never blocks the upgrade.
 * - A stored version newer than `version` rejects with `VersionError`.
 * - `notify` receives every change committed through this connection (default: `notifyChanged`).
 * @param {OpenOptions} [options]
 * @returns {Promise<IDBDatabase>}
 */
export function openDB({
  name = DB_NAME,
  factory = globalThis.indexedDB,
  migrations = MIGRATIONS,
  version = migrations[migrations.length - 1]?.version,
  notify = notifyChanged,
  onBlocked,
  onVersionChange,
  blockedTimeoutMs = 5000,
} = {}) {
  return new Promise((resolve, reject) => {
    checkMigrations(migrations);
    /** @type {unknown} */
    let migrationError;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let blockedTimer;
    let gaveUp = false;

    const request = factory.open(name, version);

    request.onupgradeneeded = (event) => {
      clearTimeout(blockedTimer);
      const db = request.result;
      const transaction = /** @type {IDBTransaction} */ (request.transaction);
      try {
        for (const migration of migrations) {
          if (migration.version > event.oldVersion && migration.version <= version) {
            migration.up(db, transaction);
          }
        }
        if (db.objectStoreNames.contains(STORES.meta)) {
          transaction.objectStore(STORES.meta).put(version, META.schemaVersion);
        }
      } catch (error) {
        migrationError = error;
        transaction.abort();
      }
    };

    request.onblocked = (event) => {
      onBlocked?.(event);
      blockedTimer = setTimeout(() => {
        gaveUp = true;
        reject(new BlockedError('blocked', 'another connection blocks the upgrade', { name }));
      }, blockedTimeoutMs);
    };

    request.onsuccess = () => {
      clearTimeout(blockedTimer);
      const db = request.result;
      if (gaveUp) {
        db.close();
        return;
      }
      db.onversionchange = (event) => {
        db.close();
        onVersionChange?.(event);
      };
      notifiers.set(db, notify);
      resolve(db);
    };

    request.onerror = () => {
      clearTimeout(blockedTimer);
      const error = request.error;
      if (migrationError !== undefined) reject(migrationError);
      else if (error?.name === 'VersionError') {
        reject(
          new VersionError('version', 'the stored database is newer than this version', { name }),
        );
      } else reject(error);
    };
  });
}

/**
 * Promise for an IDBRequest.
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
export function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Runs `fn` in one transaction and resolves with its result once the transaction committed.
 * `fn` may be async but must only await requests of this transaction (anything else lets the
 * transaction commit early). If `fn` throws or rejects, the transaction is aborted and the promise
 * rejects with that same error, so typed errors reach the caller unchanged.
 * @template {string} S
 * @template R
 * @param {IDBDatabase} db
 * @param {S | S[]} storeNames
 * @param {IDBTransactionMode} mode
 * @param {(stores: Record<S, IDBObjectStore>, transaction: IDBTransaction) => R | Promise<R>} fn
 * @returns {Promise<R>}
 */
export function tx(db, storeNames, mode, fn) {
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(names, mode);
    const stores = /** @type {Record<S, IDBObjectStore>} */ (
      Object.fromEntries(names.map((store) => [store, transaction.objectStore(store)]))
    );
    /** @type {{error: unknown} | null} */
    let failure = null;
    /** @type {Promise<R>} */
    let result;
    try {
      result = Promise.resolve(fn(stores, transaction));
    } catch (error) {
      result = Promise.reject(error);
    }
    result.catch((error) => {
      failure ??= { error };
      try {
        transaction.abort();
      } catch {
        // Already committed or aborted: oncomplete/onabort reports it.
      }
    });
    transaction.oncomplete = () => result.then(resolve, reject);
    transaction.onabort = () => reject(failure ? failure.error : transaction.error);
  });
}

/**
 * Hands committed changes to the connection's notifier. Never throws: a failing notifier is
 * logged so a write that already committed still resolves.
 * @param {IDBDatabase} db
 * @param {...Change} changes changes with empty `ids` are skipped
 */
export function emit(db, ...changes) {
  const notify = notifiers.get(db) ?? notifyChanged;
  for (const change of changes) {
    if (change.ids.length === 0) continue;
    try {
      Promise.resolve(notify(change)).catch(logNotifyError);
    } catch (error) {
      logNotifyError(error);
    }
  }
}

/** @param {unknown} error */
function logNotifyError(error) {
  console.error('time tracker: change notification failed', error);
}
