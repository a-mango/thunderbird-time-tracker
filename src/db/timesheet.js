// Timesheet cell edits (S3): set a task's total for one local day in one transaction.
//
// Growing a day extends the task's last manual entry of that day or adds a manual entry.
// Shrinking only shortens the last manual entry of the day; anything else (deleting entries,
// trimming timer entries, setting 0) replaces the day's entries and needs `replace: true`, which
// the page asks for first. Every change can be undone with `undoDayTotal`.
import { InvariantError, NotFoundError, ValidationError } from '../lib/errors.js';
import { overlapMs, startOfDay } from '../lib/time.js';
import { touchTasks } from './aggregates.js';
import { emit, req, tx } from './idb.js';
import { INDEXES, STORES } from './schema.js';
import { checkId, checkInteger, checkTime, newId } from './validate.js';

/**
 * @typedef {import('../lib/types.js').Entry} Entry
 * @typedef {import('../lib/types.js').Task} Task
 * @typedef {object} DayTotalUndo what `undoDayTotal` puts back
 * @property {string[]} added entries the edit created (soft-deleted again by undo)
 * @property {Entry[]} previous entries as they were before the edit changed or deleted them
 * @typedef {{undo: DayTotalUndo, ids: string[]}} DayTotalResult `ids`: every entry touched
 */

/** Hour of the day a new timesheet entry starts at, when it fits. */
const START_HOUR = 9;
/** Changes below a second are no change (cells show minutes). */
const SECOND = 1000;

/**
 * Sets the total of `taskId` on the local day containing `day` to `ms`.
 * @param {IDBDatabase} db
 * @param {{taskId: string, day: number, ms: number}} input `ms` from 0 to the day's length
 * @param {{replace?: boolean, now?: number}} [options]
 * @returns {Promise<DayTotalResult>}
 * @throws {ValidationError} bad input, or `duration` when `ms` doesn't fit in the day
 * @throws {InvariantError} `running` when the running entry touches the day;
 *   `replace-needed` (details `{count}` = entries that would be removed or trimmed) without
 *   `replace` when the change needs more than adding to or shortening one manual entry
 * @throws {NotFoundError} `task`
 */
export async function setDayTotal(db, input, { replace = false, now = Date.now() } = {}) {
  const taskId = checkId(input.taskId, 'taskId');
  const dayStart = startOfDay(checkTime(input.day, 'day'));
  const dayEnd = startOfDay(dayStart, 1);
  const target = checkInteger(input.ms, 'duration', 0, dayEnd - dayStart);

  const result = await tx(
    db,
    [STORES.tasks, STORES.entries, STORES.meta],
    'readwrite',
    async ({ tasks, entries, meta }) => {
      if (!(await req(tasks.get(taskId)))) {
        throw new NotFoundError('task', 'task not found', { id: taskId });
      }
      /** @type {Entry[]} */
      const all = await req(entries.index(INDEXES.entryTask).getAll(taskId));
      const inDay = all
        .filter(
          (e) => e.deletedAt === null && e.start < dayEnd && (e.end === null || e.end > dayStart),
        )
        .sort((a, b) => a.start - b.start);
      if (inDay.some((e) => e.end === null)) {
        throw new InvariantError('running', 'the running entry is on this day', { taskId });
      }
      const ended = /** @type {(Entry & {end: number})[]} */ (inDay);
      const current = ended.reduce(
        (sum, e) => sum + overlapMs(e.start, e.end, dayStart, dayEnd),
        0,
      );
      /** @type {DayTotalUndo} */
      const undo = { added: [], previous: [] };
      const delta = target - current;
      if (Math.abs(delta) < SECOND) return { undo, ids: [] };

      /** @param {Entry} before @param {Partial<Entry>} patch */
      const change = async (before, patch) => {
        undo.previous.push(before);
        await req(entries.put({ ...before, ...patch, updatedAt: now }));
      };
      /** @param {number} start @param {number} end @param {Partial<Entry>} [from] */
      const add = async (start, end, from = {}) => {
        /** @type {Entry} */
        const entry = {
          id: newId(),
          taskId,
          start,
          end,
          note: from.note ?? '',
          source: from.source ?? 'manual',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        undo.added.push(entry.id);
        await req(entries.add(entry));
      };
      /** Where `length` ms fit in the day: after the day's entries, from 09:00 at the earliest. */
      const slot = (/** @type {number} */ length, /** @type {Entry[]} */ kept) => {
        const nine = new Date(dayStart);
        nine.setHours(START_HOUR, 0, 0, 0);
        const after = kept.reduce(
          (latest, e) => Math.max(latest, Math.min(/** @type {number} */ (e.end), dayEnd)),
          0,
        );
        const start = Math.max(nine.getTime(), after);
        return start + length <= dayEnd ? start : dayEnd - length;
      };

      // The last manual entry inside the day is the one a cell edit adjusts.
      const manual = ended.filter(
        (e) => e.source === 'manual' && e.start >= dayStart && e.end <= dayEnd,
      );
      const last = manual.at(-1);
      if (
        delta > 0 &&
        last &&
        last.end + delta <= dayEnd &&
        !ended.some((e) => e !== last && e.start >= last.end && e.start < last.end + delta)
      ) {
        await change(last, { end: last.end + delta });
      } else if (delta > 0) {
        const start = slot(delta, ended);
        await add(start, start + delta);
      } else if (last && last.end - last.start > -delta && target > 0) {
        await change(last, { end: last.end + delta });
      } else if (!replace) {
        throw new InvariantError('replace-needed', 'the day has entries to replace', {
          count: ended.length,
        });
      } else {
        for (const e of ended) {
          if (e.start >= dayStart && e.end <= dayEnd) {
            await change(e, { deletedAt: now });
          } else if (e.start < dayStart && e.end > dayEnd) {
            await change(e, { end: dayStart });
            await add(dayEnd, e.end, e);
          } else if (e.start < dayStart) {
            await change(e, { end: dayStart });
          } else {
            await change(e, { start: dayEnd });
          }
        }
        if (target > 0) {
          const start = slot(target, []);
          await add(start, start + target);
        }
      }
      await touchTasks({ entries, meta }, [taskId]);
      return { undo, ids: [...undo.added, ...undo.previous.map((e) => e.id)] };
    },
  );
  if (result.ids.length > 0) emit(db, { type: 'entries', ids: result.ids });
  return result;
}

/**
 * Undoes a `setDayTotal`: removes the entries it added and puts back the ones it changed or
 * deleted, as they were. Entries changed since then are put back too (undo comes right after).
 * @param {IDBDatabase} db
 * @param {DayTotalUndo} undo
 * @param {{now?: number}} [options]
 */
export async function undoDayTotal(db, undo, { now = Date.now() } = {}) {
  if (!Array.isArray(undo?.added) || !Array.isArray(undo?.previous)) {
    throw new ValidationError('undo', 'not a timesheet undo');
  }
  const ids = [...undo.added, ...undo.previous.map((e) => e.id)];
  if (ids.length === 0) return;
  await tx(db, [STORES.entries, STORES.meta], 'readwrite', async ({ entries, meta }) => {
    /** @type {Set<string>} */
    const taskIds = new Set();
    for (const id of undo.added) {
      /** @type {Entry | undefined} */
      const entry = await req(entries.get(id));
      if (!entry || entry.deletedAt !== null || entry.end === null) continue;
      taskIds.add(entry.taskId);
      await req(entries.put({ ...entry, deletedAt: now, updatedAt: now }));
    }
    for (const before of undo.previous) {
      taskIds.add(before.taskId);
      await req(entries.put(before));
    }
    await touchTasks({ entries, meta }, [...taskIds]);
  });
  emit(db, { type: 'entries', ids });
}
