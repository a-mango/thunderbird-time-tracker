import { describe, expect, it } from 'vitest';
import {
  archiveProject,
  DEFAULT_PROJECT_COLOR,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  unarchiveProject,
  updateProject,
} from '../../src/db/projects.js';
import { createTask, getTask, listTasks } from '../../src/db/tasks.js';
import { addEntry, getRunning, softDeleteEntry, startEntry } from '../../src/db/entries.js';
import {
  CascadeRequiredError,
  InvariantError,
  NotFoundError,
  ValidationError,
} from '../../src/lib/errors.js';
import { MIN, T0, allEntries, freshDB, runningPointer, seed } from './db-helpers.js';
import { req, tx } from '../../src/db/idb.js';

describe('projects', () => {
  it('creates root and child projects with defaults and sibling order', async () => {
    const { db, notify } = await freshDB();
    const client = await createProject(db, { name: '  Client work ' }, { now: T0 });
    expect(client).toEqual({
      id: expect.any(String),
      parentId: null,
      name: 'Client work',
      color: DEFAULT_PROJECT_COLOR,
      order: 0,
      archived: false,
      createdAt: T0,
      updatedAt: T0,
    });
    const internal = await createProject(db, { name: 'Internal', color: '#2493ef' }, { now: T0 });
    expect(internal.order).toBe(1);
    const harbor = await createProject(
      db,
      { name: 'Harbor Coffee — website', parentId: client.id },
      { now: T0 },
    );
    expect(harbor).toMatchObject({ parentId: client.id, order: 0 });
    expect(await getProject(db, harbor.id)).toEqual(harbor);
    expect(notify).toHaveBeenLastCalledWith({ type: 'projects', ids: [harbor.id] });
    expect((await listProjects(db)).map((p) => p.name)).toEqual([
      'Client work',
      'Harbor Coffee — website',
      'Internal',
    ]);
  });

  it('rejects a blank name, a bad colour and an unknown parent', async () => {
    const { db, notify } = await freshDB();
    await expect(createProject(db, { name: '   ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createProject(db, /** @type {any} */ ({}))).rejects.toMatchObject({
      code: 'name',
    });
    await expect(
      createProject(db, /** @type {any} */ ({ name: 'Build', color: 3 })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createProject(db, { name: 'Build', parentId: 'missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(createProject(db, /** @type {any} */ (null))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await listProjects(db)).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('returns null for an unknown id', async () => {
    const { db } = await freshDB();
    expect(await getProject(db, 'missing')).toBeNull();
  });

  it('updates name, colour and order', async () => {
    const { db, notify } = await freshDB();
    const { build } = await seed(db);
    const updated = await updateProject(
      db,
      build.id,
      { name: 'Build & launch', color: '#ae55f7', order: 5 },
      { now: T0 },
    );
    expect(updated).toMatchObject({ name: 'Build & launch', color: '#ae55f7', order: 5 });
    expect(updated.updatedAt).toBe(T0);
    expect(updated.createdAt).toBe(build.createdAt);
    expect(await getProject(db, build.id)).toEqual(updated);
    expect(notify).toHaveBeenLastCalledWith({ type: 'projects', ids: [build.id] });
  });

  it('rejects unknown fields, bad values and unknown ids on update', async () => {
    const { db } = await freshDB();
    const { build } = await seed(db);
    await expect(
      updateProject(db, build.id, /** @type {any} */ ({ status: 'done' })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(updateProject(db, build.id, { name: '' })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateProject(db, build.id, { order: Number.NaN })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      updateProject(db, build.id, /** @type {any} */ ({ archived: 'yes' })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(updateProject(db, 'missing', { name: 'Build' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('reparents a project and appends it to its new siblings', async () => {
    const { db } = await freshDB();
    const { build, internal } = await seed(db);
    await createProject(db, { name: 'Bookkeeping', parentId: internal.id });
    const moved = await updateProject(db, build.id, { parentId: internal.id });
    expect(moved).toMatchObject({ parentId: internal.id, order: 1 });
    const root = await updateProject(db, build.id, { parentId: null });
    expect(root).toMatchObject({ parentId: null, order: 2 });
  });

  it('refuses to reparent a project under itself or a descendant', async () => {
    const { db } = await freshDB();
    const { client, harbor, build } = await seed(db);
    await expect(updateProject(db, client.id, { parentId: client.id })).rejects.toMatchObject({
      constructor: InvariantError,
      code: 'cycle',
    });
    await expect(updateProject(db, client.id, { parentId: build.id })).rejects.toMatchObject({
      constructor: InvariantError,
      code: 'cycle',
    });
    await expect(updateProject(db, harbor.id, { parentId: 'missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await getProject(db, client.id))?.parentId).toBeNull();
  });

  it('archives and unarchives', async () => {
    const { db } = await freshDB();
    const { harbor } = await seed(db);
    expect((await archiveProject(db, harbor.id, { now: T0 })).archived).toBe(true);
    expect((await getProject(db, harbor.id))?.archived).toBe(true);
    expect((await unarchiveProject(db, harbor.id)).archived).toBe(false);
  });

  it('deletes an empty project without cascade', async () => {
    const { db, notify } = await freshDB();
    const empty = await createProject(db, { name: 'Training' });
    expect(await deleteProject(db, empty.id)).toEqual({
      projects: [empty.id],
      tasks: [],
      entries: [],
    });
    expect(await getProject(db, empty.id)).toBeNull();
    expect(notify).toHaveBeenLastCalledWith({ type: 'projects', ids: [empty.id] });
    await expect(deleteProject(db, empty.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('requires a cascade to delete a project with tasks or subprojects', async () => {
    const { db } = await freshDB();
    const { client, build, internal } = await seed(db);
    await expect(deleteProject(db, build.id)).rejects.toMatchObject({
      constructor: CascadeRequiredError,
      code: 'cascade',
      details: { projects: 0, tasks: 2 },
    });
    await expect(deleteProject(db, client.id)).rejects.toBeInstanceOf(CascadeRequiredError);
    await expect(deleteProject(db, internal.id)).rejects.toBeInstanceOf(CascadeRequiredError);
    expect(await listProjects(db)).toHaveLength(4);
  });

  it('cascades through subprojects, tasks and entries in one transaction', async () => {
    const { db, notify } = await freshDB();
    const { client, harbor, build, checkout, pipeline, bookkeeping } = await seed(db);
    const kept = await addEntry(db, {
      taskId: bookkeeping.id,
      start: T0 - 60 * MIN,
      end: T0 - 30 * MIN,
    });
    const done = await addEntry(db, {
      taskId: checkout.id,
      start: T0 - 120 * MIN,
      end: T0 - 90 * MIN,
    });
    const gone = await addEntry(db, {
      taskId: pipeline.id,
      start: T0 - 80 * MIN,
      end: T0 - 70 * MIN,
    });
    await softDeleteEntry(db, gone.id, { now: T0 - 5 * MIN });
    const { entry: running } = await startEntry(db, checkout.id, { now: T0 });
    notify.mockClear();

    const removed = await deleteProject(db, client.id, { cascade: true });
    expect(removed.projects.sort()).toEqual([client.id, harbor.id, build.id].sort());
    expect(removed.tasks.sort()).toEqual([checkout.id, pipeline.id].sort());
    expect(removed.entries.sort()).toEqual([done.id, gone.id, running.id].sort());

    expect((await listProjects(db)).map((p) => p.name)).toEqual(['Internal']);
    expect((await listTasks(db)).map((t) => t.id)).toEqual([bookkeeping.id]);
    expect((await allEntries(db)).map((e) => e.id)).toEqual([kept.id]);
    expect(await getRunning(db)).toBeNull();
    expect(await runningPointer(db)).toBeNull();
    expect(await getTask(db, checkout.id)).toBeNull();
    expect(notify.mock.calls.map(([change]) => change.type).sort()).toEqual([
      'entries',
      'projects',
      'tasks',
    ]);
  });

  it('keeps the running pointer when the cascade does not touch the running entry', async () => {
    const { db } = await freshDB();
    const { build, bookkeeping } = await seed(db);
    const { entry } = await startEntry(db, bookkeeping.id, { now: T0 });
    await deleteProject(db, build.id, { cascade: true });
    expect((await getRunning(db))?.id).toBe(entry.id);
  });

  it('counts the whole subtree in the cascade error details', async () => {
    const { db } = await freshDB();
    const { internal } = await seed(db);
    const training = await createProject(db, { name: 'Training', parentId: internal.id });
    await createTask(db, { projectId: training.id, name: 'Keyboard shortcuts course' });
    await expect(deleteProject(db, internal.id)).rejects.toMatchObject({
      details: { projects: 1, tasks: 2, entries: 0 },
    });
  });
});

describe('corrupt project trees', () => {
  /**
   * Stores Harbor and Build as each other's parent, bypassing the repository.
   * @param {IDBDatabase} db
   */
  async function corruptCycle(db) {
    const tree = await seed(db);
    await tx(db, ['projects'], 'readwrite', async ({ projects }) => {
      await req(projects.put({ ...tree.harbor, parentId: tree.build.id }));
    });
    return tree;
  }

  it('stops the reparent walk on a stored cycle', async () => {
    const { db } = await freshDB();
    const { internal, build } = await corruptCycle(db);
    await expect(updateProject(db, internal.id, { parentId: build.id })).rejects.toMatchObject({
      constructor: InvariantError,
      code: 'cycle',
    });
  });

  it('deletes a subtree that contains a stored cycle', async () => {
    const { db } = await freshDB();
    const { harbor, build } = await corruptCycle(db);
    const removed = await deleteProject(db, harbor.id, { cascade: true });
    expect(new Set(removed.projects)).toEqual(new Set([harbor.id, build.id]));
    expect(await getProject(db, build.id)).toBeNull();
  });
});
