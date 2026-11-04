// Idle time of the running entry (S2, docs/prompts/S2-idle.md). `meta.idle` holds one record
// `{entryId, since, until}`: `since` is when the user went away, `until` when they came back
// (`null` while still away). A record whose entry no longer runs is stale and ignored, so
// stopping or switching the timer by other means needs no cleanup here.
//
// Resolutions run in one readwrite transaction over tasks + entries + meta, like the timer
// operations in entries.js, so "one running entry" and `start < end` hold.
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { touchTasks } from './aggregates.js';
import { readRunning } from './entries.js';
import { emit, req, tx } from './idb.js';
import { META, STORES } from './schema.js';
import { checkId, checkTime, newId } from './validate.js';

/**
 * @typedef {import('../lib/types.js').Entry} Entry
 * @typedef {{entryId: string, since: number, until: number | null}} IdleRecord
 * @typedef {'keep' | 'discard' | 'stop' | 'assign'} IdleAction
 * @typedef {{entries: IDBObjectStore, meta: IDBObjectStore}} Stores
 * @typedef {{action: IdleAction, idle: IdleRecord, stopped: Entry | null, assigned: Entry | null,
 *   running: Entry | null}} IdleResolution
 *   `stopped`: the running entry trimmed to `since` (`null` when it was removed: it started
 *   after `since`, or Keep). `assigned`: the idle part on another task. `running`: the entry
 *   running afterwards.
 */

/**
 * The idle record of the running entry, or `null` (none, or stale).
 * @param {Stores} stores
 * @returns {Promise<{idle: IdleRecord, running: Entry} | null>}
 */
async function readIdle(stores) {
  /** @type {IdleRecord | undefined} */
  const idle = await req(stores.meta.get(META.idle));
  if (!idle) return null;
  const running = await readRunning(stores);
  if (!running || running.id !== idle.entryId) return null;
  return { idle, running };
}

/**
 * The running entry's idle record, or `null`. `until === null`: still away; otherwise the
 * prompt is pending.
 * @param {IDBDatabase} db
 * @returns {Promise<IdleRecord | null>}
 */
export async function getIdle(db) {
  const found = await tx(db, [STORES.entries, STORES.meta], 'readonly', readIdle);
  return found?.idle ?? null;
}

/**
 * Records that the user was away from `since` (and back at `until`, when known) while the
 * current entry runs. Merges with the entry's existing record: the earliest `since` and the
 * latest `until` win, so an idle event followed by a suspend reads as one absence. `since` is
 * clamped to the entry's start.
 * @param {IDBDatabase} db
 * @param {{since: number, until?: number | null}} away
 * @returns {Promise<IdleRecord | null>} `null` when no timer runs
 */
export async function recordIdle(db, { since, until = null }) {
  checkTime(since, 'since');
  if (until !== null) checkTime(until, 'until');
  const record = await tx(db, [STORES.entries, STORES.meta], 'readwrite', async (stores) => {
    const running = await readRunning(stores);
    if (!running) return null;
    const found = await readIdle(stores);
    const previous = found?.idle;
    const start = Math.max(running.start, Math.min(since, previous?.since ?? since));
    const ends = [previous?.until ?? null, until].filter((value) => value !== null);
    /** @type {IdleRecord} */
    const next = {
      entryId: running.id,
      since: start,
      until: ends.length > 0 ? Math.max(.../** @type {number[]} */ (ends)) : null,
    };
    await req(stores.meta.put(next, META.idle));
    return next;
  });
  if (record) emit(db, { type: 'idle', ids: [record.entryId] });
  return record;
}

/**
 * The user is back: sets `until = now` on a record that is still away. A stale record is
 * removed.
 * @param {IDBDatabase} db
 * @param {{now?: number}} [options]
 * @returns {Promise<IdleRecord | null>} the pending record, `null` when there is nothing to ask
 */
export async function markActive(db, { now = Date.now() } = {}) {
  checkTime(now, 'now');
  const record = await tx(db, [STORES.entries, STORES.meta], 'readwrite', async (stores) => {
    const found = await readIdle(stores);
    if (!found) {
      await req(stores.meta.delete(META.idle));
      return null;
    }
    if (found.idle.until !== null) return found.idle;
    const next = { ...found.idle, until: Math.max(found.idle.since, now) };
    await req(stores.meta.put(next, META.idle));
    return next;
  });
  if (record) emit(db, { type: 'idle', ids: [record.entryId] });
  return record;
}

/**
 * Ends `entry` at `at` inside the transaction, or removes it when `at` is not after its start.
 * @param {Stores} stores
 * @param {Entry} entry
 * @param {number} at
 * @param {number} now
 * @returns {Promise<Entry | null>} the stopped entry, `null` when removed
 */
async function endAt(stores, entry, at, now) {
  if (at > entry.start) {
    const stopped = { ...entry, end: at, updatedAt: now };
    await req(stores.entries.put(stopped));
    return stopped;
  }
  await req(stores.entries.delete(entry.id));
  return null;
}

/**
 * Adds an entry (running when `end` is `null`) inside the transaction.
 * @param {Stores} stores
 * @param {{taskId: string, start: number, end: number | null, note: string, now: number}} fields
 * @returns {Promise<Entry>}
 */
async function addIdleEntry(stores, { taskId, start, end, note, now }) {
  /** @type {Entry} */
  const entry = {
    id: newId(),
    taskId,
    start,
    end,
    note,
    source: 'idle',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await req(stores.entries.add(entry));
  return entry;
}

/**
 * Answers the idle prompt for the running entry (away from `since` to `until`):
 * - `keep`: nothing changes.
 * - `discard`: the entry ends at `since`; the same task restarts at `until` (source `idle`).
 * - `stop`: the entry ends at `since`; nothing runs.
 * - `assign`: the entry ends at `since`, `[since, until)` goes to `taskId` (source `idle`), and
 *   the same task restarts at `until`.
 * Restarting at `until`, not at `now`, keeps the time worked between coming back and answering.
 * The record is removed in every case.
 * @param {IDBDatabase} db
 * @param {IdleAction} action
 * @param {{taskId?: string, entryId?: string, now?: number}} [options] `entryId`: only if the
 *   prompt is still about that entry (a page answering an old prompt)
 * @returns {Promise<IdleResolution | null>} `null` when there is no pending prompt (stale,
 *   answered elsewhere, or still away)
 * @throws {ValidationError} `idle-action`, `taskId` (missing, or the running task for `assign`)
 * @throws {NotFoundError} `task`
 */
export async function resolveIdle(db, action, { taskId, entryId, now = Date.now() } = {}) {
  if (!['keep', 'discard', 'stop', 'assign'].includes(action)) {
    throw new ValidationError('idle-action', 'unknown idle action', { action });
  }
  if (action === 'assign') checkId(taskId, 'taskId');
  checkTime(now, 'now');
  const result = await tx(
    db,
    [STORES.tasks, STORES.entries, STORES.meta],
    'readwrite',
    async ({ tasks, entries, meta }) => {
      const stores = { entries, meta };
      const found = await readIdle(stores);
      if (!found || found.idle.until === null || (entryId && found.idle.entryId !== entryId)) {
        if (!found) await req(meta.delete(META.idle));
        return null;
      }
      const { idle, running } = found;
      await req(meta.delete(META.idle));
      /** @type {IdleResolution} */
      const resolution = { action, idle, stopped: null, assigned: null, running };
      if (action === 'keep') return resolution;

      if (action === 'assign') {
        if (taskId === running.taskId) {
          throw new ValidationError('taskId', 'assign the idle time to another task');
        }
        if (!(await req(tasks.get(/** @type {string} */ (taskId))))) {
          throw new NotFoundError('task', 'task not found', { id: taskId });
        }
      }
      // `until` can't be later than now; `since` not before the entry's start (recordIdle).
      const since = Math.max(idle.since, running.start);
      const until = Math.min(Math.max(/** @type {number} */ (idle.until), since), now);
      resolution.stopped = await endAt(stores, running, since, now);
      resolution.running = null;
      if (action === 'assign' && until > since) {
        resolution.assigned = await addIdleEntry(stores, {
          taskId: /** @type {string} */ (taskId),
          start: since,
          end: until,
          note: '',
          now,
        });
      }
      if (action !== 'stop') {
        resolution.running = await addIdleEntry(stores, {
          taskId: running.taskId,
          start: until,
          end: null,
          note: running.note,
          now,
        });
      }
      await req(meta.put(resolution.running?.id ?? null, META.running));
      const touched = [running.taskId, resolution.assigned?.taskId].filter(
        (id) => id !== undefined,
      );
      await touchTasks(stores, /** @type {string[]} */ (touched));
      return resolution;
    },
  );
  if (result) {
    emit(db, { type: 'idle', ids: [result.idle.entryId] });
    if (result.action !== 'keep') {
      const ids = [result.idle.entryId, result.assigned?.id, result.running?.id];
      emit(db, {
        type: 'entries',
        ids: [...new Set(ids.filter((id) => id !== undefined))],
      });
    }
  }
  return result;
}
