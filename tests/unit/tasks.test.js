import { describe, expect, it } from 'vitest';
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  listTasksByProject,
  markTaskDone,
  moveTask,
  reopenTask,
  updateTask,
} from '../../src/db/tasks.js';
import { addEntry, getRunning, softDeleteEntry, startEntry } from '../../src/db/entries.js';
import {
  CascadeRequiredError,
  NotFoundError,
  TaskDoneError,
  ValidationError,
} from '../../src/lib/errors.js';
import { MIN, T0, allEntries, freshDB, runningPointer, seed } from './db-helpers.js';

describe('tasks', () => {
  it('creates a task with defaults, appended to its project', async () => {
    const { db, notify } = await freshDB();
    const { build, checkout, pipeline } = await seed(db);
    expect(checkout).toEqual({
      id: expect.any(String),
      projectId: build.id,
      name: 'Checkout form validation',
      status: 'open',
      starred: false,
      estimateMin: null,
      billable: false,
      tags: [],
      notes: '',
      order: 0,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      doneAt: null,
    });
    expect(pipeline.order).toBe(1);
    const fix = await createTask(
      db,
      {
        projectId: build.id,
        name: 'Fix mobile nav overflow',
        starred: true,
        estimateMin: 120,
        billable: true,
        tags: ['Frontend'],
        notes: 'Menu wraps below 360px',
      },
      { now: T0 },
    );
    expect(fix).toMatchObject({ starred: true, estimateMin: 120, billable: true, order: 2 });
    expect(fix.tags).toEqual(['Frontend']);
    expect(notify).toHaveBeenLastCalledWith({ type: 'tasks', ids: [fix.id] });
    expect((await listTasksByProject(db, build.id)).map((t) => t.name)).toEqual([
      'Checkout form validation',
      'Product image pipeline',
      'Fix mobile nav overflow',
    ]);
    expect(await listTasks(db)).toHaveLength(4);
  });

  it('needs an existing project', async () => {
    const { db } = await freshDB();
    await expect(createTask(db, { projectId: 'missing', name: 'Build' })).rejects.toMatchObject({
      constructor: NotFoundError,
      code: 'project',
    });
  });

  it('validates the input', async () => {
    const { db } = await freshDB();
    const { build } = await seed(db);
    const bad = [
      { projectId: build.id, name: '' },
      { projectId: build.id, name: 'Build', estimateMin: -5 },
      { projectId: build.id, name: 'Build', estimateMin: 1.5 },
      { projectId: build.id, name: 'Build', tags: ['ok', 3] },
      { projectId: build.id, name: 'Build', tags: 'Frontend' },
      { projectId: build.id, name: 'Build', starred: 'yes' },
      { projectId: build.id, name: 'Build', notes: null },
      { projectId: build.id, name: 'Build', colour: 'red' },
      { name: 'Build' },
    ];
    for (const input of bad) {
      await expect(createTask(db, /** @type {any} */ (input))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it('updates editable fields only', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const updated = await updateTask(
      db,
      checkout.id,
      { name: 'Checkout validation', starred: true, estimateMin: null, tags: ['Frontend'] },
      { now: T0 },
    );
    expect(updated).toMatchObject({ name: 'Checkout validation', starred: true, updatedAt: T0 });
    expect(await getTask(db, checkout.id)).toEqual(updated);
    await expect(
      updateTask(db, checkout.id, /** @type {any} */ ({ status: 'done' })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateTask(db, checkout.id, /** @type {any} */ ({ projectId: 'x' })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(updateTask(db, 'missing', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    expect(await getTask(db, 'missing')).toBeNull();
  });

  it('marks a task done and stops its running timer at the same instant', async () => {
    const { db, notify } = await freshDB();
    const { checkout } = await seed(db);
    const { entry } = await startEntry(db, checkout.id, { now: T0 });
    notify.mockClear();
    const { task, stopped } = await markTaskDone(db, checkout.id, { now: T0 + 25 * MIN });
    expect(task).toMatchObject({ status: 'done', doneAt: T0 + 25 * MIN });
    expect(stopped).toEqual({
      entry: expect.objectContaining({ id: entry.id, end: T0 + 25 * MIN }),
      discarded: false,
    });
    expect(await getRunning(db)).toBeNull();
    expect(await runningPointer(db)).toBeNull();
    expect(notify.mock.calls.map(([c]) => c)).toEqual([
      { type: 'tasks', ids: [checkout.id] },
      { type: 'entries', ids: [entry.id] },
    ]);
    await expect(startEntry(db, checkout.id, { now: T0 + 30 * MIN })).rejects.toBeInstanceOf(
      TaskDoneError,
    );
  });

  it('leaves another task running when marking a task done', async () => {
    const { db } = await freshDB();
    const { checkout, pipeline } = await seed(db);
    const { entry } = await startEntry(db, pipeline.id, { now: T0 });
    const { stopped } = await markTaskDone(db, checkout.id, { now: T0 + MIN });
    expect(stopped).toBeNull();
    expect((await getRunning(db))?.id).toBe(entry.id);
  });

  it('discards a zero-length running entry when marked done in the same millisecond', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const { entry } = await startEntry(db, checkout.id, { now: T0 });
    const { stopped } = await markTaskDone(db, checkout.id, { now: T0 });
    expect(stopped).toEqual({ entry: expect.objectContaining({ id: entry.id }), discarded: true });
    expect(await allEntries(db)).toEqual([]);
  });

  it('reopens a done task', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    await markTaskDone(db, checkout.id, { now: T0 });
    const reopened = await reopenTask(db, checkout.id, { now: T0 + MIN });
    expect(reopened).toMatchObject({ status: 'open', doneAt: null, updatedAt: T0 + MIN });
    await expect(reopenTask(db, 'missing')).rejects.toBeInstanceOf(NotFoundError);
    await expect(markTaskDone(db, 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('moves a task to another project, appended at the end', async () => {
    const { db } = await freshDB();
    const { checkout, internal } = await seed(db);
    const moved = await moveTask(db, checkout.id, internal.id, { now: T0 });
    expect(moved).toMatchObject({ projectId: internal.id, order: 1 });
    expect((await listTasksByProject(db, internal.id)).map((t) => t.id)).toContain(checkout.id);
    await expect(moveTask(db, checkout.id, 'missing')).rejects.toBeInstanceOf(NotFoundError);
    await expect(moveTask(db, 'missing', internal.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes a task without entries directly', async () => {
    const { db, notify } = await freshDB();
    const { pipeline } = await seed(db);
    expect(await deleteTask(db, pipeline.id)).toEqual({ tasks: [pipeline.id], entries: [] });
    expect(await getTask(db, pipeline.id)).toBeNull();
    expect(notify).toHaveBeenLastCalledWith({ type: 'tasks', ids: [pipeline.id] });
    await expect(deleteTask(db, pipeline.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('requires a cascade to delete a task with entries', async () => {
    const { db } = await freshDB();
    const { checkout, pipeline } = await seed(db);
    const old = await addEntry(db, {
      taskId: checkout.id,
      start: T0 - 60 * MIN,
      end: T0 - 30 * MIN,
    });
    const other = await addEntry(db, {
      taskId: pipeline.id,
      start: T0 - 20 * MIN,
      end: T0 - 10 * MIN,
    });
    const { entry: running } = await startEntry(db, checkout.id, { now: T0 });
    await expect(deleteTask(db, checkout.id)).rejects.toMatchObject({
      constructor: CascadeRequiredError,
      details: { entries: 2 },
    });
    const removed = await deleteTask(db, checkout.id, { cascade: true });
    expect(removed.entries.sort()).toEqual([old.id, running.id].sort());
    expect((await allEntries(db)).map((e) => e.id)).toEqual([other.id]);
    expect(await runningPointer(db)).toBeNull();
  });

  it('purges soft-deleted entries of a task deleted without cascade', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const entry = await addEntry(db, {
      taskId: checkout.id,
      start: T0 - 60 * MIN,
      end: T0 - 30 * MIN,
    });
    await softDeleteEntry(db, entry.id, { now: T0 });
    expect(await deleteTask(db, checkout.id)).toEqual({
      tasks: [checkout.id],
      entries: [entry.id],
    });
    expect(await allEntries(db)).toEqual([]);
  });
});
