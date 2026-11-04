import { describe, expect, it } from 'vitest';
import { getIdle, markActive, recordIdle, resolveIdle } from '../../src/db/idle.js';
import { exportBackup, restoreBackup, wipeAll } from '../../src/db/backup.js';
import { getAggregates } from '../../src/db/aggregates.js';
import { start, stop } from '../../src/lib/timer.js';
import { NotFoundError, ValidationError } from '../../src/lib/errors.js';
import { MIN, T0, allEntries, freshDB, runningPointer, seed } from './db-helpers.js';

/** Timer started at T0 (09:00), away 09:40–10:05, prompt answered at 10:10. */
async function awayScenario() {
  const ctx = await freshDB();
  const tasks = await seed(ctx.db);
  const { entry } = await start(ctx.db, tasks.checkout.id, { now: T0, note: 'Form errors' });
  await recordIdle(ctx.db, { since: T0 + 40 * MIN });
  await markActive(ctx.db, { now: T0 + 65 * MIN });
  return { ...ctx, tasks, entry, now: T0 + 70 * MIN };
}

/** @param {import('../../src/lib/types.js').Entry[]} entries */
const byStart = (entries) => [...entries].sort((a, b) => a.start - b.start);

describe('idle records', () => {
  it('records nothing without a running timer', async () => {
    const { db } = await freshDB();
    expect(await recordIdle(db, { since: T0 })).toBeNull();
    expect(await markActive(db, { now: T0 })).toBeNull();
    expect(await getIdle(db)).toBeNull();
  });

  it('records away, then back', async () => {
    const { db, notify } = await freshDB();
    const { checkout } = await seed(db);
    const { entry } = await start(db, checkout.id, { now: T0 });
    expect(await recordIdle(db, { since: T0 + 40 * MIN })).toEqual({
      entryId: entry.id,
      spans: [{ since: T0 + 40 * MIN, until: null }],
      since: T0 + 40 * MIN,
      until: null,
    });
    expect(await markActive(db, { now: T0 + 65 * MIN })).toEqual({
      entryId: entry.id,
      spans: [{ since: T0 + 40 * MIN, until: T0 + 65 * MIN }],
      since: T0 + 40 * MIN,
      until: T0 + 65 * MIN,
    });
    // A second "active" keeps the first return time.
    expect((await markActive(db, { now: T0 + 90 * MIN }))?.until).toBe(T0 + 65 * MIN);
    expect(notify).toHaveBeenCalledWith({ type: 'idle', ids: [entry.id] });
  });

  it('clamps since to the entry start and merges absences', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    await start(db, checkout.id, { now: T0 });
    expect((await recordIdle(db, { since: T0 - 30 * MIN }))?.since).toBe(T0);
    // A later suspend while still away: earliest since, its end as until.
    const merged = await recordIdle(db, { since: T0 + 10 * MIN, until: T0 + 120 * MIN });
    expect(merged).toMatchObject({ since: T0, until: T0 + 120 * MIN });
  });

  it('ignores a record whose entry no longer runs', async () => {
    const { db } = await freshDB();
    const { checkout, pipeline } = await seed(db);
    await start(db, checkout.id, { now: T0 });
    await recordIdle(db, { since: T0 + 10 * MIN });
    await start(db, pipeline.id, { now: T0 + 20 * MIN });
    expect(await getIdle(db)).toBeNull();
    expect(await markActive(db, { now: T0 + 30 * MIN })).toBeNull();
    // A new absence on the new entry starts fresh.
    expect(await recordIdle(db, { since: T0 + 40 * MIN })).toMatchObject({ since: T0 + 40 * MIN });
  });
});

describe('resolveIdle', () => {
  it('keep: nothing changes', async () => {
    const { db, entry, now } = await awayScenario();
    const result = await resolveIdle(db, 'keep', { now });
    expect(result).toMatchObject({ action: 'keep', running: entry });
    expect(await allEntries(db)).toEqual([entry]);
    expect(await getIdle(db)).toBeNull();
  });

  it('discard: trims to since and restarts at until', async () => {
    const { db, entry, now, tasks } = await awayScenario();
    const result = await resolveIdle(db, 'discard', { now });
    const [first, second] = byStart(await allEntries(db));
    expect(first).toMatchObject({ id: entry.id, start: T0, end: T0 + 40 * MIN });
    expect(second).toMatchObject({
      taskId: tasks.checkout.id,
      start: T0 + 65 * MIN,
      end: null,
      source: 'idle',
      note: 'Form errors',
    });
    expect(result?.running).toEqual(second);
    expect(await runningPointer(db)).toBe(second.id);
    const aggregates = await getAggregates(db);
    expect(aggregates.tasks[tasks.checkout.id]).toMatchObject({ count: 2 });
  });

  it('stop: ends at since and nothing runs', async () => {
    const { db, entry, now } = await awayScenario();
    const result = await resolveIdle(db, 'stop', { now });
    expect(result?.running).toBeNull();
    expect(await allEntries(db)).toEqual([
      expect.objectContaining({ id: entry.id, end: T0 + 40 * MIN }),
    ]);
    expect(await runningPointer(db)).toBeNull();
  });

  it('assign: the idle part goes to another task', async () => {
    const { db, entry, now, tasks, notify } = await awayScenario();
    const result = await resolveIdle(db, 'assign', { taskId: tasks.bookkeeping.id, now });
    const [first, assigned, restarted] = byStart(await allEntries(db));
    expect(first).toMatchObject({ id: entry.id, end: T0 + 40 * MIN });
    expect(assigned).toMatchObject({
      taskId: tasks.bookkeeping.id,
      start: T0 + 40 * MIN,
      end: T0 + 65 * MIN,
      source: 'idle',
    });
    expect(restarted).toMatchObject({ taskId: tasks.checkout.id, start: T0 + 65 * MIN, end: null });
    expect(result?.assigned).toEqual([assigned]);
    expect(notify).toHaveBeenCalledWith({
      type: 'entries',
      ids: [entry.id, assigned.id, restarted.id],
    });
  });

  it('assign: refuses the running task, a missing task and no task', async () => {
    const { db, now, tasks } = await awayScenario();
    await expect(resolveIdle(db, 'assign', { taskId: tasks.checkout.id, now })).rejects.toThrow(
      ValidationError,
    );
    await expect(resolveIdle(db, 'assign', { taskId: 'missing', now })).rejects.toThrow(
      NotFoundError,
    );
    await expect(resolveIdle(db, 'assign', { now })).rejects.toThrow(ValidationError);
    // Nothing was written: the prompt is still pending.
    expect((await getIdle(db))?.until).toBe(T0 + 65 * MIN);
  });

  it('rejects an unknown action', async () => {
    const { db } = await freshDB();
    // @ts-expect-error testing a bad value
    await expect(resolveIdle(db, 'snooze')).rejects.toThrow(ValidationError);
  });

  it('removes the entry when the whole entry was idle', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    const { entry } = await start(db, checkout.id, { now: T0 });
    await recordIdle(db, { since: T0 - 5 * MIN, until: T0 + 30 * MIN });
    await resolveIdle(db, 'discard', { now: T0 + 31 * MIN });
    const entries = await allEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ start: T0 + 30 * MIN, end: null });
    expect(entries[0].id).not.toBe(entry.id);
  });

  it('does nothing while still away, for an old prompt, or after a stop', async () => {
    const { db, tasks } = await freshDB().then(async (ctx) => ({
      ...ctx,
      tasks: await seed(ctx.db),
    }));
    const { entry } = await start(db, tasks.checkout.id, { now: T0 });
    await recordIdle(db, { since: T0 + 10 * MIN });
    expect(await resolveIdle(db, 'stop', { now: T0 + 20 * MIN })).toBeNull();
    await markActive(db, { now: T0 + 20 * MIN });
    const seen = /** @type {import('../../src/db/idle.js').IdleRecord} */ (await getIdle(db));
    // The prompt changed after it was shown (a suspend was added): nothing happens.
    const changed = { ...seen, spans: [{ since: T0 + 5 * MIN, until: T0 + 20 * MIN }] };
    expect(await resolveIdle(db, 'stop', { seen: changed, now: T0 + 21 * MIN })).toBeNull();
    expect(await resolveIdle(db, 'stop', { seen: { ...seen, entryId: 'other' } })).toBeNull();
    await stop(db, { now: T0 + 22 * MIN });
    expect(await resolveIdle(db, 'discard', { seen, now: T0 + 23 * MIN })).toBeNull();
    expect(entry.id).toBe(seen.entryId);
    expect(await allEntries(db)).toEqual([expect.objectContaining({ end: T0 + 22 * MIN })]);
  });

  it('never restarts later than now', async () => {
    const { db } = await freshDB();
    const { checkout } = await seed(db);
    await start(db, checkout.id, { now: T0 });
    await recordIdle(db, { since: T0 + 10 * MIN, until: T0 + 60 * MIN });
    const result = await resolveIdle(db, 'discard', { now: T0 + 50 * MIN });
    expect(result?.running?.start).toBe(T0 + 50 * MIN);
  });

  it('works across midnight', async () => {
    const { db } = await freshDB();
    const { checkout, pipeline } = await seed(db);
    const evening = T0 + 14 * 60 * MIN; // 23:00
    await start(db, checkout.id, { now: evening });
    await recordIdle(db, { since: evening + 50 * MIN }); // 23:50
    await markActive(db, { now: evening + 80 * MIN }); // 00:20
    await resolveIdle(db, 'assign', { taskId: pipeline.id, now: evening + 81 * MIN });
    const [, assigned] = byStart(await allEntries(db));
    expect(assigned).toMatchObject({ start: evening + 50 * MIN, end: evening + 80 * MIN });
  });
});

describe('several absences before an answer', () => {
  /** Timer since 09:00; away 09:40–10:05; back, not answered; away again 11:00–12:00. */
  async function twiceAway() {
    const ctx = await awayScenario();
    await recordIdle(ctx.db, { since: T0 + 120 * MIN });
    const away = await getIdle(ctx.db);
    await markActive(ctx.db, { now: T0 + 180 * MIN });
    return { ...ctx, away, now: T0 + 181 * MIN };
  }

  it('keeps both absences: leaving again reopens the record', async () => {
    const { db, away, entry } = await twiceAway();
    expect(away?.until).toBeNull();
    expect(await getIdle(db)).toEqual({
      entryId: entry.id,
      spans: [
        { since: T0 + 40 * MIN, until: T0 + 65 * MIN },
        { since: T0 + 120 * MIN, until: T0 + 180 * MIN },
      ],
      since: T0 + 40 * MIN,
      until: T0 + 180 * MIN,
    });
  });

  it('discard cuts out both absences', async () => {
    const { db, now, entry } = await twiceAway();
    const result = await resolveIdle(db, 'discard', { now });
    const lines = byStart(await allEntries(db)).map((e) => [e.start, e.end, e.source]);
    expect(lines).toEqual([
      [T0, T0 + 40 * MIN, 'timer'],
      [T0 + 65 * MIN, T0 + 120 * MIN, 'idle'],
      [T0 + 180 * MIN, null, 'idle'],
    ]);
    expect(result?.worked[0].id).toBe(entry.id);
    expect(await runningPointer(db)).toBe(result?.running?.id);
  });

  it('stop ends when the user last left, without the first absence', async () => {
    const { db, now } = await twiceAway();
    await resolveIdle(db, 'stop', { now });
    const lines = byStart(await allEntries(db)).map((e) => [e.start, e.end]);
    expect(lines).toEqual([
      [T0, T0 + 40 * MIN],
      [T0 + 65 * MIN, T0 + 120 * MIN],
    ]);
    expect(await runningPointer(db)).toBeNull();
  });

  it('assign moves both absences', async () => {
    const { db, now, tasks } = await twiceAway();
    const result = await resolveIdle(db, 'assign', { taskId: tasks.pipeline.id, now });
    expect(result?.assigned.map((e) => [e.start, e.end, e.taskId])).toEqual([
      [T0 + 40 * MIN, T0 + 65 * MIN, tasks.pipeline.id],
      [T0 + 120 * MIN, T0 + 180 * MIN, tasks.pipeline.id],
    ]);
    expect(await allEntries(db)).toHaveLength(5);
  });

  it('a suspend while away merges into the open absence', async () => {
    const { db } = await awayScenario();
    await recordIdle(db, { since: T0 + 120 * MIN });
    await recordIdle(db, { since: T0 + 125 * MIN, until: T0 + 300 * MIN });
    expect((await getIdle(db))?.spans).toEqual([
      { since: T0 + 40 * MIN, until: T0 + 65 * MIN },
      { since: T0 + 120 * MIN, until: T0 + 300 * MIN },
    ]);
  });

  it('an absence overlapping the last return extends it', async () => {
    const { db } = await awayScenario();
    await recordIdle(db, { since: T0 + 60 * MIN, until: T0 + 90 * MIN });
    expect((await getIdle(db))?.spans).toEqual([{ since: T0 + 40 * MIN, until: T0 + 90 * MIN }]);
  });
});

describe('idle record and data commands', () => {
  it('wipe and replace drop it; backups never contain it', async () => {
    const { db } = await awayScenario();
    const backup = await exportBackup(db);
    expect(JSON.stringify(backup)).not.toContain('"until"');
    await restoreBackup(db, backup, { mode: 'replace' });
    expect(await getIdle(db)).toBeNull();
    await recordIdle(db, { since: T0 + 40 * MIN });
    await wipeAll(db);
    expect(await getIdle(db)).toBeNull();
  });
});
