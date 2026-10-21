import { describe, expect, it } from 'vitest';
import {
  addEntry,
  adjustRunningStart,
  countEntries,
  discardRunning,
  getEntry,
  getRunning,
  listEntriesByTask,
  listEntriesInRange,
  purgeDeleted,
  restoreEntry,
  softDeleteEntry,
  splitRunning,
  startEntry,
  stopRunning,
  updateEntry,
} from '../../src/db/entries.js';
import { markTaskDone } from '../../src/db/tasks.js';
import {
  InvariantError,
  NotFoundError,
  TaskDoneError,
  ValidationError,
} from '../../src/lib/errors.js';
import { MIN, T0, allEntries, freshDB, runningPointer, seed } from './db-helpers.js';
import { req, tx } from '../../src/db/idb.js';

const H = 60 * MIN;

describe('manual entries', () => {
  it('adds a stopped entry with defaults', async () => {
    const { db, notify } = await freshDB();
    const { checkout } = await seed(db);
    const entry = await addEntry(
      db,
      { taskId: checkout.id, start: T0 - H, end: T0, note: 'Inline errors for card fields' },
      { now: T0 + MIN },
    );
    expect(entry).toEqual({
      id: expect.any(String),
      taskId: checkout.id,
      start: T0 - H,
      end: T0,
      note: 'Inline errors for card fields',
      source: 'manual',
      createdAt: T0 + MIN,
      updatedAt: T0 + MIN,
      deletedAt: null,
    });
    expect(await getEntry(db, entry.id)).toEqual(entry);
    expect(notify).toHaveBeenLastCalledWith({ type: 'entries', ids: [entry.id] });
  });

  it('accepts an idle source and a done task', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    await markTaskDone(db, checkout.id, { now: T0 });
    const entry = await addEntry(db, {
      taskId: checkout.id,
      start: T0 - H,
      end: T0,
      source: 'idle',
    });
    expect(entry.source).toBe('idle');
  });

  it('enforces start < end', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    for (const end of [T0, T0 - MIN]) {
      await expect(addEntry(db, { taskId: checkout.id, start: T0, end })).rejects.toMatchObject({
        constructor: InvariantError,
        code: 'start-end',
      });
    }
    expect(await allEntries(db)).toEqual([]);
  });

  it('cannot add a running entry by hand', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    await expect(
      addEntry(db, /** @type {any} */ ({ taskId: checkout.id, start: T0, end: null })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await getRunning(db)).toBeNull();
  });

  it('validates types and the task', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const bad = [
      { taskId: checkout.id, start: 'today', end: T0 },
      { taskId: checkout.id, start: Number.NaN, end: T0 },
      { taskId: checkout.id, start: T0 - H, end: T0, note: 3 },
      { taskId: checkout.id, start: T0 - H, end: T0, source: 'robot' },
      { taskId: checkout.id, start: T0 - H, end: T0, extra: true },
      { start: T0 - H, end: T0 },
    ];
    for (const input of bad) {
      await expect(addEntry(db, /** @type {any} */ (input))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(addEntry(db, { taskId: 'missing', start: T0 - H, end: T0 })).rejects.toMatchObject(
      { constructor: NotFoundError, code: 'task' },
    );
  });
});

describe('updateEntry', () => {
  it('updates times, note and task', async () => {
    const { db } = await freshDB();
    const { checkout, pipeline } = await seed(db);
    const entry = await addEntry(db, { taskId: checkout.id, start: T0 - H, end: T0 });
    const updated = await updateEntry(
      db,
      entry.id,
      { start: T0 - 2 * H, end: T0 - H, note: 'Pairing', taskId: pipeline.id },
      { now: T0 + MIN },
    );
    expect(updated).toMatchObject({
      start: T0 - 2 * H,
      end: T0 - H,
      note: 'Pairing',
      taskId: pipeline.id,
      updatedAt: T0 + MIN,
    });
    expect(await listEntriesByTask(db, checkout.id)).toEqual([]);
  });

  it('ignores keys passed as undefined', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const entry = await addEntry(db, { taskId: checkout.id, start: T0 - H, end: T0 });
    const patch = { start: undefined, end: undefined, note: undefined, taskId: undefined };
    const same = await updateEntry(db, entry.id, patch, { now: T0 + MIN });
    expect(same).toEqual({ ...entry, updatedAt: T0 + MIN });
    const { entry: running } = await startEntry(db, checkout.id, { now: T0 + MIN });
    const still = await updateEntry(db, running.id, patch, { now: T0 + 2 * MIN });
    expect(still).toEqual({ ...running, updatedAt: T0 + 2 * MIN });
  });

  it('enforces start < end against the stored values', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const entry = await addEntry(db, { taskId: checkout.id, start: T0 - H, end: T0 });
    await expect(updateEntry(db, entry.id, { start: T0 })).rejects.toBeInstanceOf(InvariantError);
    await expect(updateEntry(db, entry.id, { end: T0 - 2 * H })).rejects.toBeInstanceOf(
      InvariantError,
    );
    expect(await getEntry(db, entry.id)).toEqual(entry);
  });

  it('cannot make a stopped entry running', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const entry = await addEntry(db, { taskId: checkout.id, start: T0 - H, end: T0 });
    await expect(
      updateEntry(db, entry.id, /** @type {any} */ ({ end: null })),
    ).rejects.toMatchObject({ constructor: InvariantError, code: 'running' });
    expect(await runningPointer(db)).toBeUndefined();
  });

  it('routes changes to a running end through stop', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const { entry } = await startEntry(db, checkout.id, { now: T0 });
    await expect(updateEntry(db, entry.id, { end: T0 + H })).rejects.toMatchObject({
      constructor: InvariantError,
      code: 'running',
    });
    const noted = await updateEntry(db, entry.id, { note: 'Card fields' }, { now: T0 + MIN });
    expect(noted).toMatchObject({ end: null, note: 'Card fields' });
    await expect(
      updateEntry(db, entry.id, { start: T0 + 2 * MIN }, { now: T0 + MIN }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await updateEntry(db, entry.id, { start: T0 - H }, { now: T0 + MIN })).start).toBe(
      T0 - H,
    );
  });

  it('cannot move the running entry to a done task', async () => {
    const { db } = await freshDB();
    const { checkout, pipeline } = await seed(db);
    await markTaskDone(db, pipeline.id, { now: T0 });
    const { entry } = await startEntry(db, checkout.id, { now: T0 });
    await expect(updateEntry(db, entry.id, { taskId: pipeline.id })).rejects.toBeInstanceOf(
      TaskDoneError,
    );
  });

  it('rejects unknown entries, tasks and fields', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const entry = await addEntry(db, { taskId: checkout.id, start: T0 - H, end: T0 });
    await expect(updateEntry(db, 'missing', { note: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateEntry(db, entry.id, { taskId: 'missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      updateEntry(db, entry.id, /** @type {any} */ ({ source: 'timer' })),
    ).rejects.toBeInstanceOf(ValidationError);
    await softDeleteEntry(db, entry.id);
    await expect(updateEntry(db, entry.id, { note: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('queries', () => {
  it('lists entries of a task by start time', async () => {
    const { db } = await freshDB();
    const { checkout, pipeline } = await seed(db);
    const late = await addEntry(db, { taskId: checkout.id, start: T0 - H, end: T0 });
    const early = await addEntry(db, { taskId: checkout.id, start: T0 - 3 * H, end: T0 - 2 * H });
    await addEntry(db, { taskId: pipeline.id, start: T0 - 3 * H, end: T0 - 2 * H });
    expect((await listEntriesByTask(db, checkout.id)).map((e) => e.id)).toEqual([
      early.id,
      late.id,
    ]);
  });

  it('lists entries overlapping a range, including the running one', async () => {
    const { db } = await freshDB();
    const { checkout, pipeline } = await seed(db);
    const from = T0;
    const to = T0 + 8 * H;
    const before = await addEntry(db, { taskId: checkout.id, start: from - 2 * H, end: from });
    const across = await addEntry(db, { taskId: checkout.id, start: from - H, end: from + H });
    const inside = await addEntry(db, { taskId: pipeline.id, start: from + 2 * H, end: from + 3 * H }); // prettier-ignore
    const overEnd = await addEntry(db, { taskId: pipeline.id, start: to - H, end: to + H });
    const after = await addEntry(db, { taskId: pipeline.id, start: to, end: to + H });
    const { entry: running } = await startEntry(db, checkout.id, { now: from + 4 * H });
    const ids = (await listEntriesInRange(db, from, to)).map((e) => e.id);
    expect(ids).toEqual([across.id, inside.id, running.id, overEnd.id]);
    expect(ids).not.toContain(before.id);
    expect(ids).not.toContain(after.id);
    expect((await listEntriesInRange(db, from - 3 * H, from - 2 * H)).map((e) => e.id)).toEqual([]);
    // A running entry that starts after the range is not in it.
    expect((await listEntriesInRange(db, from, from + H)).map((e) => e.id)).toEqual([across.id]);
    await expect(listEntriesInRange(db, to, from)).rejects.toBeInstanceOf(ValidationError);
  });

  it('counts live entries', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const a = await addEntry(db, { taskId: checkout.id, start: T0 - H, end: T0 });
    await addEntry(db, { taskId: checkout.id, start: T0 - 3 * H, end: T0 - 2 * H });
    await softDeleteEntry(db, a.id);
    expect(await countEntries(db)).toBe(1);
  });
});

describe('soft delete', () => {
  it('hides a deleted entry from every query until restored', async () => {
    const { db, notify } = await freshDB();
    const { checkout } = await seed(db);
    const entry = await addEntry(db, { taskId: checkout.id, start: T0 - H, end: T0 });
    const deleted = await softDeleteEntry(db, entry.id, { now: T0 + MIN });
    expect(deleted).toMatchObject({ id: entry.id, deletedAt: T0 + MIN });
    expect(notify).toHaveBeenLastCalledWith({ type: 'entries', ids: [entry.id] });
    expect(await getEntry(db, entry.id)).toBeNull();
    expect(await getEntry(db, entry.id, { includeDeleted: true })).toEqual(deleted);
    expect(await listEntriesByTask(db, checkout.id)).toEqual([]);
    expect(await listEntriesInRange(db, T0 - 2 * H, T0 + H)).toEqual([]);
    await expect(softDeleteEntry(db, entry.id)).rejects.toBeInstanceOf(NotFoundError);

    const restored = await restoreEntry(db, entry.id, { now: T0 + 2 * MIN });
    expect(restored).toMatchObject({ deletedAt: null, start: T0 - H, end: T0 });
    expect(await getEntry(db, entry.id)).toEqual(restored);
    await expect(restoreEntry(db, entry.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(restoreEntry(db, 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('stops a running entry before deleting it, so a restore is never running', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const { entry } = await startEntry(db, checkout.id, { now: T0 });
    const deleted = await softDeleteEntry(db, entry.id, { now: T0 + 10 * MIN });
    expect(deleted).toMatchObject({ end: T0 + 10 * MIN, deletedAt: T0 + 10 * MIN });
    expect(await getRunning(db)).toBeNull();
    expect(await runningPointer(db)).toBeNull();
    const restored = await restoreEntry(db, entry.id);
    expect(restored.end).toBe(T0 + 10 * MIN);
    expect(await getRunning(db)).toBeNull();
  });

  it('drops a zero-length running entry instead of soft-deleting it', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const { entry } = await startEntry(db, checkout.id, { now: T0 });
    const deleted = await softDeleteEntry(db, entry.id, { now: T0 });
    expect(deleted).toMatchObject({ id: entry.id, deletedAt: T0 });
    expect(await allEntries(db)).toEqual([]);
    expect(await runningPointer(db)).toBeNull();
  });

  it('purges every soft-deleted entry and keeps the rest', async () => {
    const { db, notify } = await freshDB();
    const { checkout, pipeline } = await seed(db);
    const a = await addEntry(db, { taskId: checkout.id, start: T0 - H, end: T0 });
    const b = await addEntry(db, { taskId: pipeline.id, start: T0 - 3 * H, end: T0 - 2 * H });
    const keep = await addEntry(db, { taskId: pipeline.id, start: T0 - 5 * H, end: T0 - 4 * H });
    await softDeleteEntry(db, a.id);
    await softDeleteEntry(db, b.id);
    notify.mockClear();
    expect((await purgeDeleted(db)).sort()).toEqual([a.id, b.id].sort());
    expect((await allEntries(db)).map((e) => e.id)).toEqual([keep.id]);
    expect(notify).toHaveBeenCalledWith({ type: 'entries', ids: expect.any(Array) });
    notify.mockClear();
    expect(await purgeDeleted(db)).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('timer primitives', () => {
  it('starts a running entry and points to it', async () => {
    const { db, notify } = await freshDB();
    const { checkout } = await seed(db);
    const { entry, previous } = await startEntry(db, checkout.id, {
      now: T0,
      note: 'Card fields',
    });
    expect(entry).toMatchObject({ taskId: checkout.id, start: T0, end: null, source: 'timer' });
    expect(entry.note).toBe('Card fields');
    expect(previous).toBeNull();
    expect(await runningPointer(db)).toBe(entry.id);
    expect(await getRunning(db)).toEqual(entry);
    expect(notify).toHaveBeenLastCalledWith({ type: 'entries', ids: [entry.id] });
  });

  it('is a no-op when the task is already running', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const first = await startEntry(db, checkout.id, { now: T0 });
    const again = await startEntry(db, checkout.id, { now: T0 + MIN });
    expect(again).toEqual({ entry: first.entry, previous: null });
    expect(await allEntries(db)).toHaveLength(1);
  });

  it('checks the task', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    await expect(startEntry(db, 'missing', { now: T0 })).rejects.toBeInstanceOf(NotFoundError);
    await markTaskDone(db, checkout.id, { now: T0 });
    await expect(startEntry(db, checkout.id, { now: T0 })).rejects.toMatchObject({
      constructor: TaskDoneError,
      code: 'task-done',
    });
    await expect(
      startEntry(db, checkout.id, /** @type {any} */ ({ source: 'manual' })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('ignores a stale running pointer', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const { entry } = await startEntry(db, checkout.id, { now: T0 });
    // Simulate a pointer to an entry that no longer exists.
    const { tx, req } = await import('../../src/db/idb.js');
    await tx(db, ['entries'], 'readwrite', ({ entries }) => req(entries.delete(entry.id)));
    expect(await getRunning(db)).toBeNull();
    expect(await stopRunning(db, { now: T0 + MIN })).toBeNull();
    const next = await startEntry(db, checkout.id, { now: T0 + MIN });
    expect(next.previous).toBeNull();
  });

  it('stops, splits, discards and adjusts the running entry', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    expect(await stopRunning(db, { now: T0 })).toBeNull();
    expect(await discardRunning(db)).toBeNull();
    await expect(splitRunning(db, T0, { now: T0 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(adjustRunningStart(db, T0 - MIN, { now: T0 })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const { entry } = await startEntry(db, checkout.id, { now: T0 });
    const adjusted = await adjustRunningStart(db, T0 - 5 * MIN, { now: T0 + MIN });
    expect(adjusted).toMatchObject({ id: entry.id, start: T0 - 5 * MIN, end: null });
    const { stopped, entry: second } = await splitRunning(db, T0 + 10 * MIN, {
      now: T0 + 20 * MIN,
    });
    expect(stopped).toMatchObject({ id: entry.id, end: T0 + 10 * MIN });
    expect(second).toMatchObject({ start: T0 + 10 * MIN, end: null, source: 'split' });
    expect(await runningPointer(db)).toBe(second.id);
    expect(await discardRunning(db)).toMatchObject({ id: second.id });
    expect(await runningPointer(db)).toBeNull();
    expect((await allEntries(db)).map((e) => e.id)).toEqual([entry.id]);
  });
});

describe('corrupt data', () => {
  it('refuses to restore a deleted entry that has no end', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const entry = await addEntry(db, { taskId: checkout.id, start: T0 - H, end: T0 }, { now: T0 });
    await tx(db, ['entries'], 'readwrite', ({ entries }) =>
      req(entries.put({ ...entry, end: null, deletedAt: T0 })),
    );
    await expect(restoreEntry(db, entry.id)).rejects.toMatchObject({
      constructor: InvariantError,
      code: 'running',
    });
    expect(await getRunning(db)).toBeNull();
  });
});
