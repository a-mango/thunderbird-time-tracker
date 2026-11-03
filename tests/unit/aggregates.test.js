import { describe, expect, it } from 'vitest';
import {
  AGGREGATES_FORMAT,
  aggregatesMatch,
  computeAggregates,
  getAggregates,
  loadRollupState,
  readEntryChanges,
} from '../../src/db/aggregates.js';
import { restoreBackup, exportBackup, wipeAll } from '../../src/db/backup.js';
import {
  addEntry,
  adjustRunningStart,
  discardRunning,
  purgeDeleted,
  restoreEntry,
  softDeleteEntry,
  splitEntry,
  splitRunning,
  startEntry,
  stopRunning,
  updateEntry,
} from '../../src/db/entries.js';
import { req, tx } from '../../src/db/idb.js';
import { deleteProject } from '../../src/db/projects.js';
import { deleteTask, editTask, markTaskDone, restoreTask } from '../../src/db/tasks.js';
import { MIN, T0, freshDB, seed } from './db-helpers.js';

/** @typedef {import('../../src/lib/types.js').Entry} Entry */

/** @param {IDBDatabase} db */
const storedAggregates = (db) =>
  tx(db, 'meta', 'readonly', ({ meta }) => req(meta.get('aggregates')));

/** @param {IDBDatabase} db */
const rawEntries = (db) => tx(db, 'entries', 'readonly', ({ entries }) => req(entries.getAll()));

/**
 * The cache equals a full recompute from the stored entries.
 * @param {IDBDatabase} db
 */
async function expectCurrent(db) {
  const entries = /** @type {Entry[]} */ (await rawEntries(db));
  expect(await storedAggregates(db)).toEqual(computeAggregates(entries));
}

/** A seeded database whose cache exists (as after the first page open). */
async function cached() {
  const ctx = await freshDB();
  const ids = await seed(ctx.db);
  await getAggregates(ctx.db);
  return { ...ctx, ids };
}

describe('computeAggregates', () => {
  it('counts every entry but sums only live, stopped ones', () => {
    /** @param {Partial<Entry>} fields @returns {Entry} */
    const entry = (fields) =>
      /** @type {Entry} */ ({ taskId: 't1', start: 0, end: 10, deletedAt: null, ...fields });
    const result = computeAggregates([
      entry({ start: 0, end: 10 }),
      entry({ start: 20, end: 50 }),
      entry({ start: 60, end: 90, deletedAt: 100 }),
      entry({ start: 100, end: null }),
      entry({ taskId: 't2', start: 5, end: 6 }),
    ]);
    expect(result).toEqual({
      format: AGGREGATES_FORMAT,
      tasks: { t1: { count: 4, ms: 40, last: 50 }, t2: { count: 1, ms: 1, last: 6 } },
    });
  });
});

describe('aggregatesMatch', () => {
  const good = { format: AGGREGATES_FORMAT, tasks: { a: { count: 2, ms: 5, last: 9 } } };
  it.each([
    ['a matching cache', good, 2, true],
    ['a count mismatch', good, 3, false],
    ['another format', { ...good, format: AGGREGATES_FORMAT + 1 }, 2, false],
    ['nothing', undefined, 0, false],
    ['a string', 'x', 0, false],
    ['tasks missing', { format: AGGREGATES_FORMAT }, 0, false],
    ['a bad row', { format: AGGREGATES_FORMAT, tasks: { a: { count: 'x' } } }, 0, false],
    ['a zero count', { format: AGGREGATES_FORMAT, tasks: { a: { count: 0, ms: 0, last: null } } }, 0, false], // prettier-ignore
    ['a bad last', { format: AGGREGATES_FORMAT, tasks: { a: { count: 1, ms: 0, last: 'x' } } }, 1, false], // prettier-ignore
    ['an empty cache', { format: AGGREGATES_FORMAT, tasks: {} }, 0, true],
  ])('%s', (_name, value, count, expected) => {
    expect(aggregatesMatch(value, count)).toBe(expected);
  });
});

describe('meta.aggregates', () => {
  it('is built by the first read and stored', async () => {
    const { db, ids } = await freshDB().then(async (ctx) => ({ ...ctx, ids: await seed(ctx.db) }));
    await addEntry(db, { taskId: ids.checkout.id, start: T0, end: T0 + 30 * MIN });
    // Writes don't create a missing cache (that needs a full scan): readers do.
    expect(await storedAggregates(db)).toBeUndefined();
    const state = await loadRollupState(db, T0 - MIN);
    expect(state.rebuilt).toBe(true);
    expect(state.aggregates.tasks[ids.checkout.id]).toEqual({
      count: 1,
      ms: 30 * MIN,
      last: T0 + 30 * MIN,
    });
    await expectCurrent(db);
    expect((await loadRollupState(db, T0 - MIN)).rebuilt).toBe(false);
  });

  it('is rebuilt when its counts no longer match the entries', async () => {
    const { db, ids } = await cached();
    await addEntry(db, { taskId: ids.checkout.id, start: T0, end: T0 + 10 * MIN });
    // An entry written behind the cache's back (e.g. by an older version).
    await tx(db, 'entries', 'readwrite', ({ entries }) =>
      req(
        entries.put({
          id: 'stray',
          taskId: ids.pipeline.id,
          start: T0,
          end: T0 + 5 * MIN,
          note: '',
          source: 'manual',
          createdAt: T0,
          updatedAt: T0,
          deletedAt: null,
        }),
      ),
    );
    const state = await loadRollupState(db, 0);
    expect(state.rebuilt).toBe(true);
    expect(state.aggregates.tasks[ids.pipeline.id].ms).toBe(5 * MIN);
    await expectCurrent(db);
  });

  it('is rebuilt when it is corrupt', async () => {
    const { db } = await cached();
    await tx(db, 'meta', 'readwrite', ({ meta }) => req(meta.put({ format: 'x' }, 'aggregates')));
    expect((await loadRollupState(db, 0)).rebuilt).toBe(true);
    await expectCurrent(db);
  });

  it('returns the recent window and the running entry from one snapshot', async () => {
    const { db, ids } = await cached();
    await addEntry(db, { taskId: ids.checkout.id, start: T0 - 60 * MIN, end: T0 - 50 * MIN });
    const recent = await addEntry(db, { taskId: ids.checkout.id, start: T0, end: T0 + MIN });
    const gone = await addEntry(db, { taskId: ids.checkout.id, start: T0, end: T0 + 2 * MIN });
    await softDeleteEntry(db, gone.id, { now: T0 + 3 * MIN });
    const { entry: running } = await startEntry(db, ids.pipeline.id, { now: T0 + 5 * MIN });
    const state = await loadRollupState(db, T0 - MIN);
    expect(state.recent.map((entry) => entry.id).sort()).toEqual([recent.id, running.id].sort());
    expect(state.running?.id).toBe(running.id);
  });

  // Every write that touches entries keeps the cache equal to a full recompute.
  it('stays current through every entry, task and project write', async () => {
    const { db, ids } = await cached();
    const at = (/** @type {number} */ minutes) => T0 + minutes * MIN;
    const steps = [
      async () => addEntry(db, { taskId: ids.checkout.id, start: at(0), end: at(30) }),
      async () => {
        const entry = await addEntry(db, { taskId: ids.checkout.id, start: at(40), end: at(50) });
        await updateEntry(db, entry.id, { end: at(55), taskId: ids.pipeline.id }, { now: at(60) });
      },
      async () => {
        const entry = await addEntry(db, { taskId: ids.pipeline.id, start: at(60), end: at(90) });
        await splitEntry(db, entry.id, at(70), { taskId: ids.bookkeeping.id, now: at(95) });
      },
      async () => startEntry(db, ids.checkout.id, { now: at(100) }),
      async () => adjustRunningStart(db, at(98), { now: at(101) }),
      async () => splitRunning(db, at(110), { taskId: ids.pipeline.id, now: at(115) }),
      async () => startEntry(db, ids.checkout.id, { now: at(120) }),
      async () => stopRunning(db, { now: at(130) }),
      async () => {
        await startEntry(db, ids.checkout.id, { now: at(140) });
        await stopRunning(db, { at: at(145), now: at(150) });
      },
      async () => {
        await startEntry(db, ids.checkout.id, { now: at(160) });
        await discardRunning(db);
      },
      async () => {
        const entry = await addEntry(db, { taskId: ids.checkout.id, start: at(170), end: at(180) });
        await softDeleteEntry(db, entry.id, { now: at(185) });
        await restoreEntry(db, entry.id, { now: at(186) });
        await softDeleteEntry(db, entry.id, { now: at(187) });
      },
      async () => {
        await startEntry(db, ids.pipeline.id, { now: at(190) });
        await softDeleteEntry(db, (await getRunningId(db)) ?? '', { now: at(200) });
      },
      async () => purgeDeleted(db),
      async () => {
        await startEntry(db, ids.pipeline.id, { now: at(210) });
        await markTaskDone(db, ids.pipeline.id, { now: at(220) });
      },
      async () => {
        await startEntry(db, ids.checkout.id, { now: at(230) });
        await editTask(db, ids.checkout.id, { done: true }, { now: at(240) });
        await editTask(db, ids.checkout.id, { done: false }, { now: at(241) });
      },
      async () => {
        await startEntry(db, ids.checkout.id, { now: at(250) });
        const { snapshot } = await deleteTask(db, ids.checkout.id, { cascade: true, now: at(260) });
        await expectCurrent(db);
        await restoreTask(db, snapshot);
      },
      async () => deleteProject(db, ids.internal.id, { cascade: true }),
      async () => {
        const backup = await exportBackup(db);
        await restoreBackup(db, backup, { mode: 'merge' });
        await expectCurrent(db);
        await restoreBackup(db, backup, { mode: 'replace' });
      },
      async () => wipeAll(db),
    ];
    for (const step of steps) {
      await step();
      await expectCurrent(db);
    }
  });
});

/** @param {IDBDatabase} db */
async function getRunningId(db) {
  const id = await tx(db, 'meta', 'readonly', ({ meta }) => req(meta.get('running')));
  return typeof id === 'string' ? id : null;
}

describe('readEntryChanges', () => {
  it('returns the changed entries, the aggregates and the running entry', async () => {
    const { db, ids } = await cached();
    const kept = await addEntry(db, { taskId: ids.checkout.id, start: T0, end: T0 + MIN });
    const gone = await addEntry(db, { taskId: ids.checkout.id, start: T0, end: T0 + MIN });
    await softDeleteEntry(db, gone.id, { now: T0 + 2 * MIN });
    const { entry: running } = await startEntry(db, ids.pipeline.id, { now: T0 + 3 * MIN });
    const changes = await readEntryChanges(db, [kept.id, gone.id, 'missing']);
    expect(changes.entries).toEqual(
      new Map([
        [kept.id, kept],
        [gone.id, null],
        ['missing', null],
      ]),
    );
    expect(changes.aggregates?.tasks[ids.checkout.id]).toEqual({
      count: 2,
      ms: MIN,
      last: T0 + MIN,
    });
    expect(changes.running?.id).toBe(running.id);
  });

  it('gives no aggregates when the cache is missing or malformed', async () => {
    const { db } = await freshDB();
    expect((await readEntryChanges(db, [])).aggregates).toBeNull();
    await tx(db, 'meta', 'readwrite', ({ meta }) => req(meta.put({ format: 1 }, 'aggregates')));
    expect((await readEntryChanges(db, [])).aggregates).toBeNull();
  });
});
