import { describe, expect, it } from 'vitest';
import { addEntry, listEntriesByTask, startEntry, updateEntry } from '../../src/db/entries.js';
import { getAggregates } from '../../src/db/aggregates.js';
import { setDayTotal, undoDayTotal } from '../../src/db/timesheet.js';
import { InvariantError, NotFoundError, ValidationError } from '../../src/lib/errors.js';
import { MIN, freshDB, seed } from './db-helpers.js';

const HOUR = 60 * MIN;
// Europe/Zurich. Tue 20 Oct 2026; DST ends on Sun 25 Oct (25 h), starts on Sun 29 Mar 2026 (23 h).
/** @param {number} hour @param {number} [minute] @param {number} [date] */
const at = (hour, minute = 0, date = 20) => new Date(2026, 9, date, hour, minute).getTime();
const DAY = at(0);
const NOW = at(12, 0, 30);

/** Live entries of a task as [start, end, source] in local "HH:MM" (day offsets as +N). */
async function shape(/** @type {IDBDatabase} */ db, /** @type {string} */ taskId) {
  const hhmm = (/** @type {number} */ ms) => {
    const d = new Date(ms);
    const offset = d.getDate() - 20;
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return offset === 0 ? time : `${time}${offset > 0 ? '+' : ''}${offset}`;
  };
  return (await listEntriesByTask(db, taskId)).map((e) => [
    hhmm(e.start),
    hhmm(/** @type {number} */ (e.end)),
    e.source,
  ]);
}

async function setup() {
  const { db, notify } = await freshDB();
  const { checkout, pipeline } = await seed(db);
  return { db, notify, task: checkout.id, other: pipeline.id };
}

describe('setDayTotal', () => {
  it('adds a manual entry from 09:00 on an empty day', async () => {
    const { db, task, notify } = await setup();
    notify.mockClear();
    const result = await setDayTotal(db, { taskId: task, day: at(15), ms: 90 * MIN }, { now: NOW });
    expect(await shape(db, task)).toEqual([['09:00', '10:30', 'manual']]);
    expect(result.undo.added).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith({ type: 'entries', ids: result.ids });
    expect((await getAggregates(db)).tasks[task].ms).toBe(90 * MIN);
  });

  it('extends the last manual entry of the day when the cell grows', async () => {
    const { db, task } = await setup();
    await addEntry(db, { taskId: task, start: at(8), end: at(9) }, { now: NOW });
    await addEntry(db, { taskId: task, start: at(13), end: at(14) }, { now: NOW });
    await setDayTotal(db, { taskId: task, day: DAY, ms: 2.5 * HOUR }, { now: NOW });
    expect(await shape(db, task)).toEqual([
      ['08:00', '09:00', 'manual'],
      ['13:00', '14:30', 'manual'],
    ]);
  });

  it('adds after the day’s timer entries instead of changing them', async () => {
    const { db, task } = await setup();
    await addEntry(db, { taskId: task, start: at(9), end: at(11), source: 'timer' }, { now: NOW });
    await setDayTotal(db, { taskId: task, day: DAY, ms: 3 * HOUR }, { now: NOW });
    expect(await shape(db, task)).toEqual([
      ['09:00', '11:00', 'timer'],
      ['11:00', '12:00', 'manual'],
    ]);
  });

  it('puts a new entry at the end of the day when it no longer fits after 09:00', async () => {
    const { db, task } = await setup();
    await addEntry(db, { taskId: task, start: at(20), end: at(23), source: 'timer' }, { now: NOW });
    await setDayTotal(db, { taskId: task, day: DAY, ms: 5 * HOUR }, { now: NOW });
    expect(await shape(db, task)).toEqual([
      ['20:00', '23:00', 'timer'],
      ['22:00', '00:00+1', 'manual'],
    ]);
  });

  it('shortens the last manual entry without asking', async () => {
    const { db, task } = await setup();
    await addEntry(db, { taskId: task, start: at(9), end: at(11), source: 'timer' }, { now: NOW });
    await addEntry(db, { taskId: task, start: at(13), end: at(15) }, { now: NOW });
    await setDayTotal(db, { taskId: task, day: DAY, ms: 3 * HOUR }, { now: NOW });
    expect(await shape(db, task)).toEqual([
      ['09:00', '11:00', 'timer'],
      ['13:00', '14:00', 'manual'],
    ]);
  });

  it('asks before replacing: removing a whole entry, touching timer entries, or setting 0', async () => {
    const { db, task } = await setup();
    await addEntry(db, { taskId: task, start: at(9), end: at(11), source: 'timer' }, { now: NOW });
    await addEntry(db, { taskId: task, start: at(13), end: at(14) }, { now: NOW });
    for (const ms of [90 * MIN, 0]) {
      const error = await setDayTotal(db, { taskId: task, day: DAY, ms }, { now: NOW }).catch(
        (e) => e,
      );
      expect(error).toBeInstanceOf(InvariantError);
      expect(error).toMatchObject({ code: 'replace-needed', details: { count: 2 } });
    }
    expect(await shape(db, task)).toEqual([
      ['09:00', '11:00', 'timer'],
      ['13:00', '14:00', 'manual'],
    ]);
  });

  it('replaces the day’s entries with one entry, and undo brings them back', async () => {
    const { db, task, other } = await setup();
    await addEntry(db, { taskId: task, start: at(9), end: at(11), source: 'timer' }, { now: NOW });
    await addEntry(db, { taskId: task, start: at(13), end: at(14), note: 'Call' }, { now: NOW });
    await addEntry(db, { taskId: other, start: at(9), end: at(10) }, { now: NOW });
    const result = await setDayTotal(
      db,
      { taskId: task, day: DAY, ms: 45 * MIN },
      { replace: true, now: NOW },
    );
    expect(await shape(db, task)).toEqual([['09:00', '09:45', 'manual']]);
    expect(await shape(db, other)).toEqual([['09:00', '10:00', 'manual']]);
    expect((await getAggregates(db)).tasks[task].ms).toBe(45 * MIN);

    await undoDayTotal(db, result.undo, { now: NOW + 1 });
    expect(await shape(db, task)).toEqual([
      ['09:00', '11:00', 'timer'],
      ['13:00', '14:00', 'manual'],
    ]);
    expect((await listEntriesByTask(db, task))[1].note).toBe('Call');
    expect((await getAggregates(db)).tasks[task].ms).toBe(3 * HOUR);
  });

  it('undo leaves entries changed since the edit alone', async () => {
    const { db, task } = await setup();
    const kept = await addEntry(
      db,
      { taskId: task, start: at(9), end: at(10), source: 'timer' },
      { now: NOW },
    );
    await addEntry(db, { taskId: task, start: at(13), end: at(14), source: 'timer' }, { now: NOW });
    const result = await setDayTotal(
      db,
      { taskId: task, day: DAY, ms: 30 * MIN },
      { replace: true, now: NOW },
    );
    // The new entry gets a note (another page) before the undo: undo leaves it.
    const [added] = result.undo.added;
    await updateEntry(db, added, { note: 'Agenda' }, { now: NOW + 5 });
    await undoDayTotal(db, result.undo, { now: NOW + 10 });
    const live = await listEntriesByTask(db, task);
    expect(live.map((e) => e.id)).toContain(added);
    expect(live.map((e) => e.id)).toContain(kept.id);
    await expect(
      undoDayTotal(db, { added: [], previous: [{ ...kept, end: null }], at: NOW }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('0 with replace clears the day, trimming entries that cross midnight', async () => {
    const { db, task } = await setup();
    await addEntry(
      db,
      { taskId: task, start: at(22, 0, 19), end: at(1), source: 'timer' },
      { now: NOW },
    );
    await addEntry(
      db,
      { taskId: task, start: at(23), end: at(2, 0, 21), source: 'timer' },
      { now: NOW },
    );
    await addEntry(db, { taskId: task, start: at(10), end: at(11) }, { now: NOW });
    await setDayTotal(db, { taskId: task, day: DAY, ms: 0 }, { replace: true, now: NOW });
    expect(await shape(db, task)).toEqual([
      ['22:00-1', '00:00', 'timer'],
      ['00:00+1', '02:00+1', 'timer'],
    ]);
  });

  it('splits an entry that spans the whole day, keeping both outside parts', async () => {
    const { db, task } = await setup();
    await addEntry(
      db,
      { taskId: task, start: at(20, 0, 19), end: at(4, 0, 21), note: 'Deploy' },
      { now: NOW },
    );
    const result = await setDayTotal(
      db,
      { taskId: task, day: DAY, ms: HOUR },
      { replace: true, now: NOW },
    );
    expect(await shape(db, task)).toEqual([
      ['20:00-1', '00:00', 'manual'],
      ['09:00', '10:00', 'manual'],
      ['00:00+1', '04:00+1', 'manual'],
    ]);
    await undoDayTotal(db, result.undo, { now: NOW + 1 });
    expect(await shape(db, task)).toEqual([['20:00-1', '04:00+1', 'manual']]);
  });

  it('refuses a day the running entry touches', async () => {
    const { db, task } = await setup();
    await startEntry(db, task, { now: at(10) });
    await expect(
      setDayTotal(db, { taskId: task, day: DAY, ms: HOUR }, { now: at(11) }),
    ).rejects.toMatchObject({ code: 'running' });
  });

  it('does nothing when the total does not change', async () => {
    const { db, task, notify } = await setup();
    await addEntry(db, { taskId: task, start: at(9), end: at(10) }, { now: NOW });
    notify.mockClear();
    const result = await setDayTotal(db, { taskId: task, day: DAY, ms: HOUR }, { now: NOW });
    expect(result.ids).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('fits a whole 25-hour DST day and refuses more than a 23-hour one', async () => {
    const { db, task } = await setup();
    const longDay = new Date(2026, 9, 25).getTime();
    await setDayTotal(db, { taskId: task, day: longDay, ms: 25 * HOUR }, { now: NOW });
    const [entry] = await listEntriesByTask(db, task);
    expect(entry.end - entry.start).toBe(25 * HOUR);
    const shortDay = new Date(2026, 2, 29).getTime();
    await expect(
      setDayTotal(db, { taskId: task, day: shortDay, ms: 24 * HOUR }, { now: NOW }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('validates the input', async () => {
    const { db, task } = await setup();
    await expect(setDayTotal(db, { taskId: 'missing', day: DAY, ms: HOUR })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    for (const ms of [-1, 1.5, Number.NaN]) {
      await expect(setDayTotal(db, { taskId: task, day: DAY, ms })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(setDayTotal(db, { taskId: task, day: -5, ms: HOUR })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(undoDayTotal(db, /** @type {any} */ ({}))).rejects.toBeInstanceOf(ValidationError);
    await undoDayTotal(db, { added: [], previous: [] });
  });
});
