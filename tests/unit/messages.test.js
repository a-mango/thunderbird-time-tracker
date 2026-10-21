import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { handleMessage, summarize } from '../../src/background/messages.js';
import { openDB } from '../../src/db/idb.js';
import { addEntry, softDeleteEntry, startEntry } from '../../src/db/entries.js';
import { archiveProject, createProject, updateProject } from '../../src/db/projects.js';
import { MIN, T0, seed } from './db-helpers.js';

describe('tt:summary', () => {
  it('answers from the database: projects in tree order with depth, live counts', async () => {
    const factory = new IDBFactory();
    const db = await openDB({ factory, notify: vi.fn() });
    const { client, internal, checkout, pipeline } = await seed(db);
    const fern = await createProject(db, { name: 'Fern & Co — branding', parentId: client.id });
    await updateProject(db, internal.id, { order: -1 });
    await archiveProject(db, fern.id);
    await addEntry(db, { taskId: checkout.id, start: T0 - 60 * MIN, end: T0 - 30 * MIN });
    const gone = await addEntry(db, { taskId: pipeline.id, start: T0 - 90 * MIN, end: T0 - 80 * MIN }); // prettier-ignore
    await softDeleteEntry(db, gone.id);
    await startEntry(db, pipeline.id, { now: T0 });
    db.close();

    const openDb = vi.fn(() => openDB({ factory }));
    const summary = await handleMessage({ type: 'tt:summary' }, { openDb });
    expect(summary).toEqual({
      projects: [
        { id: internal.id, name: 'Internal', depth: 0 },
        { id: client.id, name: 'Client work', depth: 0 },
        { id: expect.any(String), name: 'Harbor Coffee — website', depth: 1 },
        { id: expect.any(String), name: 'Build', depth: 2 },
        { id: fern.id, name: 'Fern & Co — branding', depth: 1 },
      ],
      taskCount: 3,
      entryCount: 2,
    });
    expect(openDb).toHaveBeenCalledTimes(1);

    // The connection was closed, so a schema upgrade from another page is not blocked.
    const upgraded = await openDB({
      factory,
      migrations: [
        ...(await import('../../src/db/migrations.js')).MIGRATIONS,
        { version: 2, up() {} },
      ],
      blockedTimeoutMs: 50,
    });
    expect(upgraded.version).toBe(2);
    upgraded.close();
  });

  it('answers an empty summary for an empty database', async () => {
    const factory = new IDBFactory();
    await expect(
      handleMessage({ type: 'tt:summary' }, { openDb: () => openDB({ factory }) }),
    ).resolves.toEqual({ projects: [], taskCount: 0, entryCount: 0 });
  });

  it('keeps orphans out of the tree', async () => {
    const db = await openDB({ factory: new IDBFactory(), notify: vi.fn() });
    const { tx, req } = await import('../../src/db/idb.js');
    await tx(db, ['projects'], 'readwrite', ({ projects }) =>
      req(projects.put({ id: 'orphan', parentId: 'gone', name: 'Training', order: 0 })),
    );
    expect((await summarize(db)).projects).toEqual([]);
    db.close();
  });

  it('closes the database even when reading fails', async () => {
    const close = vi.fn();
    const db = /** @type {any} */ ({
      close,
      transaction() {
        throw new Error('broken');
      },
    });
    await expect(handleMessage({ type: 'tt:summary' }, { openDb: async () => db })).rejects.toThrow(
      'broken',
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('opens the extension database by default', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    try {
      await expect(handleMessage({ type: 'tt:summary' })).resolves.toEqual({
        projects: [],
        taskCount: 0,
        entryCount: 0,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves other messages, including tt:changed, to other listeners', () => {
    expect(
      handleMessage({ type: 'tt:changed', change: { type: 'tasks', ids: [] } }),
    ).toBeUndefined();
    expect(handleMessage({ type: 'other' })).toBeUndefined();
    expect(handleMessage(null)).toBeUndefined();
  });
});
