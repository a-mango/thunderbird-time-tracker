import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { LATEST_VERSION, openDB, req, tx } from '../../src/db/idb.js';
import { MIGRATIONS } from '../../src/db/migrations.js';
import { listProjects } from '../../src/db/projects.js';
import { listTasks } from '../../src/db/tasks.js';
import { getRunning, listEntriesByTask } from '../../src/db/entries.js';
import { getSettings } from '../../src/db/settings.js';
import { BlockedError, InvariantError, VersionError } from '../../src/lib/errors.js';

const NAME = 'time-tracker';
const T = Date.UTC(2026, 9, 12, 8, 0);

/** @param {IDBOpenDBRequest} request @returns {Promise<IDBDatabase>} */
const opened = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/**
 * Builds a schema v1 database with the raw IndexedDB API (not schema.js), so a change to the
 * shipped schema that would break existing installs shows up here.
 * @param {IDBFactory} factory
 */
async function buildV1Fixture(factory) {
  const request = factory.open(NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    const projects = db.createObjectStore('projects', { keyPath: 'id' });
    projects.createIndex('parentId', 'parentId');
    const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
    tasks.createIndex('projectId', 'projectId');
    const entries = db.createObjectStore('entries', { keyPath: 'id' });
    entries.createIndex('taskId', 'taskId');
    entries.createIndex('start', 'start');
    entries.createIndex('end', 'end');
    entries.createIndex('deletedAt', 'deletedAt');
    const links = db.createObjectStore('links', { keyPath: 'id' });
    links.createIndex('taskId', 'taskId');
    const meta = db.createObjectStore('meta');

    const base = { createdAt: T, updatedAt: T };
    projects.put({ id: 'p1', parentId: null, name: 'Client work', color: '#2493ef', order: 0, archived: false, ...base }); // prettier-ignore
    projects.put({ id: 'p2', parentId: 'p1', name: 'Fern & Co — branding', color: '#ea7308', order: 0, archived: false, ...base }); // prettier-ignore
    tasks.put({ id: 't1', projectId: 'p2', name: 'Brand review call', status: 'open', starred: false, estimateMin: 60, billable: true, tags: [], notes: '', order: 0, doneAt: null, ...base }); // prettier-ignore
    entries.put({ id: 'e1', taskId: 't1', start: T, end: T + 3_600_000, note: 'Moodboard', source: 'manual', deletedAt: null, ...base }); // prettier-ignore
    entries.put({ id: 'e2', taskId: 't1', start: T + 7_200_000, end: null, note: '', source: 'timer', deletedAt: null, ...base }); // prettier-ignore
    meta.put(1, 'schemaVersion');
    meta.put({ weekStart: 0 }, 'settings');
    meta.put('e2', 'running');
  };
  (await opened(request)).close();
}

/** @param {IDBDatabase} db */
function layout(db) {
  const names = [...db.objectStoreNames].sort();
  const t = db.transaction(names, 'readonly');
  return names.map((name) => {
    const store = t.objectStore(name);
    return {
      name,
      keyPath: store.keyPath,
      autoIncrement: store.autoIncrement,
      indexes: [...store.indexNames].sort().map((index) => {
        const i = store.index(index);
        return { name: index, keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry };
      }),
    };
  });
}

/** A test-only v2 migration that counts its runs. */
function v2Migration() {
  const up = vi.fn((/** @type {IDBDatabase} */ _db, /** @type {IDBTransaction} */ t) => {
    t.objectStore('tasks').createIndex('status', 'status');
  });
  return { migration: { version: 2, up }, up };
}

describe('openDB', () => {
  it('creates the v1 stores and indexes on a fresh database', async () => {
    const factory = new IDBFactory();
    const db = await openDB({ factory });
    expect(db.version).toBe(1);
    expect(LATEST_VERSION).toBe(1);
    const fixtureFactory = new IDBFactory();
    await buildV1Fixture(fixtureFactory);
    const fixture = await opened(fixtureFactory.open(NAME));
    expect(layout(db)).toEqual(layout(fixture));
    expect(layout(db).map((s) => s.name)).toEqual([
      'entries',
      'links',
      'meta',
      'projects',
      'tasks',
    ]);
    expect(await tx(db, ['meta'], 'readonly', ({ meta }) => req(meta.get('schemaVersion')))).toBe(
      1,
    );
    db.close();
    fixture.close();
  });

  it('opens a v1 fixture database with its data intact', async () => {
    const factory = new IDBFactory();
    await buildV1Fixture(factory);
    const db = await openDB({ factory });
    expect((await listProjects(db)).map((p) => p.name)).toEqual([
      'Client work',
      'Fern & Co — branding',
    ]);
    expect((await listTasks(db)).map((t) => t.name)).toEqual(['Brand review call']);
    expect((await listEntriesByTask(db, 't1')).map((e) => e.note)).toEqual(['Moodboard', '']);
    expect((await getRunning(db))?.id).toBe('e2');
    expect((await getSettings(db)).weekStart).toBe(0);
    db.close();
  });

  it('upgrades the v1 fixture through a later migration exactly once', async () => {
    const factory = new IDBFactory();
    await buildV1Fixture(factory);
    const { migration, up } = v2Migration();
    const migrations = [...MIGRATIONS, migration];
    const db = await openDB({ factory, migrations });
    expect(db.version).toBe(2);
    expect(up).toHaveBeenCalledTimes(1);
    expect([...db.transaction('tasks').objectStore('tasks').indexNames]).toContain('status');
    expect((await listTasks(db)).map((t) => t.id)).toEqual(['t1']);
    expect((await listEntriesByTask(db, 't1')).map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(await tx(db, ['meta'], 'readonly', ({ meta }) => req(meta.get('schemaVersion')))).toBe(
      2,
    );
    db.close();

    const again = await openDB({ factory, migrations });
    expect(up).toHaveBeenCalledTimes(1);
    expect(again.version).toBe(2);
    again.close();
  });

  it('runs every migration in order on a fresh database', async () => {
    const order = /** @type {number[]} */ ([]);
    const factory = new IDBFactory();
    const migrations = [
      { version: 1, up: () => order.push(1) },
      { version: 2, up: () => order.push(2) },
      { version: 3, up: () => order.push(3) },
    ];
    const db = await openDB({ factory, migrations, version: 2 });
    expect(order).toEqual([1, 2]);
    db.close();
    (await openDB({ factory, migrations })).close();
    expect(order).toEqual([1, 2, 3]);
  });

  it('rejects a migration list with gaps', async () => {
    const migrations = [MIGRATIONS[0], { version: 3, up() {} }];
    await expect(openDB({ factory: new IDBFactory(), migrations })).rejects.toBeInstanceOf(
      InvariantError,
    );
  });

  it('aborts a throwing migration and leaves the database at the old version', async () => {
    const factory = new IDBFactory();
    await buildV1Fixture(factory);
    const boom = new Error('boom');
    const migrations = [
      ...MIGRATIONS,
      {
        version: 2,
        /** @param {IDBDatabase} _db @param {IDBTransaction} t */
        up(_db, t) {
          t.objectStore('tasks').createIndex('status', 'status');
          throw boom;
        },
      },
    ];
    await expect(openDB({ factory, migrations })).rejects.toBe(boom);
    const db = await openDB({ factory });
    expect(db.version).toBe(1);
    expect([...db.transaction('tasks').objectStore('tasks').indexNames]).toEqual(['projectId']);
    expect((await listTasks(db)).map((t) => t.id)).toEqual(['t1']);
    db.close();
  });

  it('closes the connection and reports a versionchange from a newer page', async () => {
    const factory = new IDBFactory();
    const onVersionChange = vi.fn();
    const old = await openDB({ factory, onVersionChange });
    const { migration } = v2Migration();
    const db = await openDB({ factory, migrations: [...MIGRATIONS, migration] });
    expect(db.version).toBe(2);
    expect(onVersionChange).toHaveBeenCalledTimes(1);
    expect(() => old.transaction('meta')).toThrow();
    db.close();
  });

  it('rejects with BlockedError when an old connection never closes', async () => {
    const factory = new IDBFactory();
    (await openDB({ factory })).close();
    const stubborn = await opened(factory.open(NAME, 1)); // no onversionchange handler
    const onBlocked = vi.fn();
    const { migration, up } = v2Migration();
    const result = openDB({
      factory,
      migrations: [...MIGRATIONS, migration],
      onBlocked,
      blockedTimeoutMs: 20,
    });
    await expect(result).rejects.toBeInstanceOf(BlockedError);
    await expect(result).rejects.toMatchObject({ code: 'blocked' });
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(up).not.toHaveBeenCalled();

    // Once the stubborn page closes, the late upgrade finishes and its connection is closed.
    stubborn.close();
    await vi.waitFor(() => expect(up).toHaveBeenCalledTimes(1));
    const db = await openDB({ factory, migrations: [...MIGRATIONS, migration] });
    expect(db.version).toBe(2);
    db.close();
  });

  it('continues when the blocking connection closes before the timeout', async () => {
    const factory = new IDBFactory();
    (await openDB({ factory })).close();
    const stubborn = await opened(factory.open(NAME, 1));
    const { migration } = v2Migration();
    const db = await openDB({
      factory,
      migrations: [...MIGRATIONS, migration],
      onBlocked: () => stubborn.close(),
      blockedTimeoutMs: 1000,
    });
    expect(db.version).toBe(2);
    db.close();
  });

  it('rejects with VersionError when the stored database is newer than the code', async () => {
    const factory = new IDBFactory();
    const { migration } = v2Migration();
    (await openDB({ factory, migrations: [...MIGRATIONS, migration] })).close();
    const result = openDB({ factory });
    await expect(result).rejects.toBeInstanceOf(VersionError);
    await expect(result).rejects.toMatchObject({ code: 'version' });
  });
});

describe('tx', () => {
  it('resolves with the callback result after the commit', async () => {
    const db = await openDB({ factory: new IDBFactory() });
    const result = await tx(db, ['meta'], 'readwrite', async ({ meta }) => {
      await req(meta.put('x', 'probe'));
      return req(meta.get('probe'));
    });
    expect(result).toBe('x');
    db.close();
  });

  it('accepts a single store name', async () => {
    const db = await openDB({ factory: new IDBFactory() });
    expect(await tx(db, 'meta', 'readonly', ({ meta }) => req(meta.count()))).toBeGreaterThan(0);
    db.close();
  });

  it('aborts and rethrows the typed error from the callback, rolling back writes', async () => {
    const db = await openDB({ factory: new IDBFactory() });
    const error = new InvariantError('nope');
    const result = tx(db, ['meta'], 'readwrite', async ({ meta }) => {
      await req(meta.put('x', 'probe'));
      throw error;
    });
    await expect(result).rejects.toBe(error);
    expect(await tx(db, ['meta'], 'readonly', ({ meta }) => req(meta.get('probe')))).toBe(
      undefined,
    );
    db.close();
  });

  it('rethrows an error thrown synchronously by the callback', async () => {
    const db = await openDB({ factory: new IDBFactory() });
    const error = new InvariantError('sync');
    await expect(
      tx(db, ['meta'], 'readwrite', () => {
        throw error;
      }),
    ).rejects.toBe(error);
    db.close();
  });

  it('rejects with the request error when a write fails', async () => {
    const db = await openDB({ factory: new IDBFactory() });
    const result = tx(db, ['projects'], 'readwrite', async ({ projects }) => {
      await req(projects.add({ id: 'dup' }));
      await req(projects.add({ id: 'dup' }));
    });
    await expect(result).rejects.toMatchObject({ name: 'ConstraintError' });
    expect(await tx(db, ['projects'], 'readonly', ({ projects }) => req(projects.count()))).toBe(0);
    db.close();
  });

  it('rejects when the callback fails after the transaction finished', async () => {
    const db = await openDB({ factory: new IDBFactory() });
    const error = new InvariantError('late');
    const result = tx(db, ['meta'], 'readonly', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw error;
    });
    await expect(result).rejects.toBe(error);
    db.close();
  });
});
