import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openDB } from '../../src/db/idb.js';
import { markTaskDone } from '../../src/db/tasks.js';
import {
  adjustStart,
  discard,
  getRunning,
  split,
  start,
  stop,
  switchTo,
} from '../../src/lib/timer.js';
import { TaskDoneError, ValidationError } from '../../src/lib/errors.js';
import { MIN, T0, allEntries, freshDB, runningPointer, seed } from './db-helpers.js';

/** @param {import('../../src/lib/types.js').Entry[]} entries */
const running = (entries) => entries.filter((e) => e.end === null);

describe('timer', () => {
  it('starts a running entry from the timer', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const { entry, previous } = await start(db, checkout.id, { now: T0 });
    expect(entry).toMatchObject({ taskId: checkout.id, start: T0, end: null, source: 'timer' });
    expect(previous).toBeNull();
    expect(await getRunning(db)).toEqual(entry);
  });

  it('defaults to the current time', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    try {
      const { db } = await freshDB();
      const { checkout } = await seed(db);
      expect((await start(db, checkout.id)).entry.start).toBe(T0);
      vi.setSystemTime(T0 + MIN);
      expect((await stop(db))?.entry.end).toBe(T0 + MIN);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the running entry at the same instant when another task starts', async () => {
    const { db } = await freshDB();
    const { checkout, pipeline } = await seed(db);
    const first = await start(db, checkout.id, { now: T0 });
    const second = await start(db, pipeline.id, { now: T0 + 30 * MIN });
    expect(second.previous).toEqual({
      entry: expect.objectContaining({ id: first.entry.id, end: T0 + 30 * MIN }),
      discarded: false,
    });
    expect(second.entry.start).toBe(second.previous?.entry.end);
    expect(running(await allEntries(db)).map((e) => e.id)).toEqual([second.entry.id]);
  });

  it('switchTo hands over in the same millisecond', async () => {
    const { db } = await freshDB();
    const { checkout, pipeline } = await seed(db);
    await start(db, checkout.id, { now: T0 });
    const { entry, previous } = await switchTo(db, pipeline.id, { now: T0 + 5 * MIN });
    expect(previous?.entry.end).toBe(entry.start);
    expect(await runningPointer(db)).toBe(entry.id);
  });

  it('refuses to start a done task', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    await markTaskDone(db, checkout.id, { now: T0 });
    await expect(start(db, checkout.id, { now: T0 })).rejects.toMatchObject({
      constructor: TaskDoneError,
      code: 'task-done',
    });
    expect(await allEntries(db)).toEqual([]);
  });

  it('stop with nothing running is a no-op returning null', async () => {
    const { db, notify } = await freshDB();
    expect(await stop(db, { now: T0 })).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('stops the running entry', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const { entry } = await start(db, checkout.id, { now: T0 });
    expect(await stop(db, { now: T0 + 45 * MIN })).toEqual({
      entry: { ...entry, end: T0 + 45 * MIN, updatedAt: T0 + 45 * MIN },
      discarded: false,
    });
    expect(await getRunning(db)).toBeNull();
    expect(await runningPointer(db)).toBeNull();
  });

  it('discards a zero-length entry when stopped in the same millisecond', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const { entry } = await start(db, checkout.id, { now: T0 });
    expect(await stop(db, { now: T0 })).toEqual({ entry, discarded: true });
    expect(await allEntries(db)).toEqual([]);
  });

  it('discards a zero-length entry when switching in the same millisecond', async () => {
    const { db } = await freshDB();
    const { checkout, pipeline } = await seed(db);
    const first = await start(db, checkout.id, { now: T0 });
    const second = await start(db, pipeline.id, { now: T0 });
    expect(second.previous).toEqual({ entry: first.entry, discarded: true });
    expect((await allEntries(db)).map((e) => e.id)).toEqual([second.entry.id]);
  });

  it('splits the running entry at a point in time', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const { entry } = await start(db, checkout.id, { now: T0, note: 'Card fields' });
    const result = await split(db, T0 + 20 * MIN, { now: T0 + 30 * MIN });
    expect(result.stopped).toMatchObject({ id: entry.id, end: T0 + 20 * MIN, source: 'timer' });
    expect(result.entry).toMatchObject({
      taskId: checkout.id,
      start: T0 + 20 * MIN,
      end: null,
      source: 'split',
    });
    expect(result.stopped.end).toBe(result.entry.start);
    expect((await getRunning(db))?.id).toBe(result.entry.id);
    // Splitting at `now` is allowed.
    const again = await split(db, T0 + 30 * MIN, { now: T0 + 30 * MIN });
    expect(again.entry.start).toBe(T0 + 30 * MIN);
  });

  it('rejects a split point outside (start, now]', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    await start(db, checkout.id, { now: T0 });
    for (const at of [T0, T0 - MIN, T0 + 31 * MIN]) {
      await expect(split(db, at, { now: T0 + 30 * MIN })).rejects.toMatchObject({
        constructor: ValidationError,
        code: 'split-at',
      });
    }
    await expect(split(db, /** @type {any} */ ('soon'), { now: T0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await allEntries(db)).toHaveLength(1);
  });

  it('discards the running entry', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const { entry } = await start(db, checkout.id, { now: T0 });
    expect(await discard(db)).toEqual(entry);
    expect(await allEntries(db)).toEqual([]);
    expect(await discard(db)).toBeNull();
  });

  it('adjusts the start of the running entry', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    await start(db, checkout.id, { now: T0 });
    const adjusted = await adjustStart(db, T0 - 15 * MIN, { now: T0 + MIN });
    expect(adjusted).toMatchObject({ start: T0 - 15 * MIN, end: null });
    for (const at of [T0 + MIN, T0 + 2 * MIN]) {
      await expect(adjustStart(db, at, { now: T0 + MIN })).rejects.toMatchObject({
        constructor: ValidationError,
        code: 'start',
      });
    }
    expect((await getRunning(db))?.start).toBe(T0 - 15 * MIN);
  });
});

describe('single running timer across contexts', () => {
  /** Two pages (tab and popup) on one database. */
  async function twoContexts() {
    const factory = new IDBFactory();
    const notify = vi.fn();
    const a = await openDB({ factory, notify });
    const b = await openDB({ factory, notify });
    const tasks = await seed(a);
    return { a, b, tasks };
  }

  it('leaves exactly one running entry when two contexts start at once', async () => {
    const { a, b, tasks } = await twoContexts();
    const [ra, rb] = await Promise.all([
      start(a, tasks.checkout.id, { now: T0 }),
      start(b, tasks.pipeline.id, { now: T0 + 1 }),
    ]);
    const all = await allEntries(a);
    expect(running(all)).toHaveLength(1);
    expect(await runningPointer(b)).toBe(running(all)[0].id);
    // The first start was stopped at the instant the second one started (or dropped, if the
    // second context's clock was behind).
    expect([ra.entry.id, rb.entry.id]).toContain(running(all)[0].id);
    for (const stopped of all.filter((e) => e.end !== null)) {
      expect(stopped.end).toBe(running(all)[0].start);
    }
  });

  it('keeps the invariant over many mixed concurrent starts and stops', async () => {
    const { a, b, tasks } = await twoContexts();
    const ids = [tasks.checkout.id, tasks.pipeline.id, tasks.bookkeeping.id];
    let now = T0;
    for (let i = 0; i < 20; i += 1) {
      const sameInstant = i % 3 === 0;
      const ops = [
        start(a, ids[i % 3], { now }),
        i % 4 === 1
          ? stop(b, { now: sameInstant ? now : now + 1 })
          : start(b, ids[(i + 1) % 3], { now: sameInstant ? now : now + 1 }),
        i % 5 === 2 ? stop(a, { now: now + 2 }) : start(a, ids[(i + 2) % 3], { now: now + 2 }),
      ];
      await Promise.all(ops);
      const all = await allEntries(i % 2 ? a : b);
      const live = running(all);
      expect(live.length).toBeLessThanOrEqual(1);
      expect(await runningPointer(a)).toBe(live[0]?.id ?? null);
      for (const entry of all) if (entry.end !== null) expect(entry.start).toBeLessThan(entry.end);
      now += 10 * MIN;
    }
  });
});
