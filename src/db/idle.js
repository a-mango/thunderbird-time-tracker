// Idle time of the running entry (S2, docs/prompts/S2-idle.md). `meta.idle` holds one record
// `{entryId, spans, since, until}`: `spans` are the absences, oldest first, each `{since, until}`
// (`until === null` while still away). `since` and `until` mirror the first span's start and the
// last span's end. Leaving again before the prompt was answered adds a span, so a second absence
// is never counted as work. A record whose entry no longer runs is stale and ignored, so stopping
// or switching the timer by other means needs no cleanup here.
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
 * @typedef {{since: number, until: number | null}} IdleSpan
 * @typedef {{entryId: string, spans: IdleSpan[], since: number, until: number | null}} IdleRecord
 *   `until === null`: still away; otherwise the prompt is pending.
 * @typedef {'keep' | 'discard' | 'stop' | 'assign'} IdleAction
 * @typedef {{entries: IDBObjectStore, meta: IDBObjectStore}} Stores
 * @typedef {{action: IdleAction, idle: IdleRecord, worked: Entry[], assigned: Entry[],
 *   running: Entry | null}} IdleResolution
 *   `worked`: the running entry's parts between the absences (the first one keeps its id; none
 *   when it was idle for its whole length). `assigned`: the absences on another task.
 *   `running`: the entry running afterwards.
 */

/**
 * @param {Entry} entry
 * @param {IdleSpan[]} spans
 * @returns {IdleRecord}
 */
function recordOf(entry, spans) {
  return { entryId: entry.id, spans, since: spans[0].since, until: spans.at(-1)?.until ?? null };
}

/**
 * The idle record of the running entry, or `null` (none, or stale).
 * @param {Stores} stores
 * @returns {Promise<{idle: IdleRecord, running: Entry} | null>}
 */
async function readIdle(stores) {
  /** @type {IdleRecord | undefined} */
  const idle = await req(stores.meta.get(META.idle));
  if (!idle || !Array.isArray(idle.spans) || idle.spans.length === 0) return null;
  const running = await readRunning(stores);
  if (!running || running.id !== idle.entryId) return null;
  return { idle, running };
}

/**
 * The running entry's idle record, or `null`.
 * @param {IDBDatabase} db
 * @returns {Promise<IdleRecord | null>}
 */
export async function getIdle(db) {
  const found = await tx(db, [STORES.entries, STORES.meta], 'readonly', readIdle);
  return found?.idle ?? null;
}

/**
 * Adds an absence to the spans: an overlapping or touching one merges with the last span (the
 * earliest start, the latest end; `until === null` reopens it), a later one is a new span.
 * @param {IdleSpan[]} spans
 * @param {IdleSpan} away
 * @returns {IdleSpan[]}
 */
function addSpan(spans, away) {
  const last = spans.at(-1);
  if (!last) return [away];
  if (last.until === null || away.since <= last.until) {
    const until =
      away.until === null || last.until === null ? away.until : Math.max(last.until, away.until);
    return [...spans.slice(0, -1), { since: Math.min(last.since, away.since), until }];
  }
  return [...spans, away];
}

/**
 * Records that the user was away from `since` (and back at `until`, when known) while the
 * current entry runs. `since` is clamped to the entry's start. With a prompt still waiting, a
 * new absence after the return adds a span; an overlapping one (a suspend while away) merges.
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
    const start = Math.max(running.start, since);
    const span = { since: start, until: until === null ? null : Math.max(start, until) };
    const next = recordOf(running, addSpan(found?.idle.spans ?? [], span));
    await req(stores.meta.put(next, META.idle));
    return next;
  });
  if (record) emit(db, { type: 'idle', ids: [record.entryId] });
  return record;
}

/**
 * The user is back: closes the open span at `now`. A stale record is removed.
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
    const last = /** @type {IdleSpan} */ (found.idle.spans.at(-1));
    if (last.until !== null) return found.idle;
    const spans = [
      ...found.idle.spans.slice(0, -1),
      { since: last.since, until: Math.max(last.since, now) },
    ];
    const next = recordOf(found.running, spans);
    await req(stores.meta.put(next, META.idle));
    return next;
  });
  if (record) emit(db, { type: 'idle', ids: [record.entryId] });
  return record;
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
 * Answers the idle prompt for the running entry:
 * - `keep`: nothing changes.
 * - `discard`: the absences are cut out; the same task runs again from the last return.
 * - `stop`: the absences are cut out; nothing runs (the entry ends when the user last left).
 * - `assign`: the absences go to `taskId`; the same task runs again from the last return.
 * The running entry keeps its id for its first part; the parts between absences, the restarted
 * entry and assigned absences are new entries with source `idle`. Restarting at the return, not
 * at `now`, keeps the time worked between coming back and answering. The record is removed in
 * every case.
 * @param {IDBDatabase} db
 * @param {IdleAction} action
 * @param {{taskId?: string, seen?: IdleRecord, now?: number}} [options] `seen`: the record the
 *   user answered; nothing happens when it has changed since (another page answered, or a
 *   suspend was added)
 * @returns {Promise<IdleResolution | null>} `null` when there is no pending prompt (stale,
 *   answered elsewhere, changed, or still away)
 * @throws {ValidationError} `idle-action`, `taskId` (missing, or the running task for `assign`)
 * @throws {NotFoundError} `task`
 */
export async function resolveIdle(db, action, { taskId, seen, now = Date.now() } = {}) {
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
      if (!found) {
        await req(meta.delete(META.idle));
        return null;
      }
      const { idle, running } = found;
      if (idle.until === null) return null;
      if (
        seen &&
        (seen.entryId !== idle.entryId || JSON.stringify(seen.spans) !== JSON.stringify(idle.spans))
      )
        return null;
      await req(meta.delete(META.idle));
      /** @type {IdleResolution} */
      const resolution = { action, idle, worked: [], assigned: [], running };
      if (action === 'keep') return resolution;

      if (action === 'assign') {
        if (taskId === running.taskId) {
          throw new ValidationError('taskId', 'assign the idle time to another task');
        }
        if (!(await req(tasks.get(/** @type {string} */ (taskId))))) {
          throw new NotFoundError('task', 'task not found', { id: taskId });
        }
      }
      // Spans inside [entry start, now], in order and apart (recordIdle keeps them so).
      const spans = idle.spans.map(({ since, until }) => {
        const start = Math.min(Math.max(since, running.start), now);
        return {
          since: start,
          until: Math.min(Math.max(/** @type {number} */ (until), start), now),
        };
      });
      // Worked parts: from the entry's start (or a return) to the next departure.
      let from = running.start;
      let first = true;
      for (const span of spans) {
        if (span.since > from) {
          if (first) {
            const part = { ...running, start: from, end: span.since, updatedAt: now };
            await req(entries.put(part));
            resolution.worked.push(part);
          } else {
            resolution.worked.push(
              await addIdleEntry(stores, {
                taskId: running.taskId,
                start: from,
                end: span.since,
                note: running.note,
                now,
              }),
            );
          }
          first = false;
        }
        if (action === 'assign' && span.until > span.since) {
          resolution.assigned.push(
            await addIdleEntry(stores, {
              taskId: /** @type {string} */ (taskId),
              start: span.since,
              end: span.until,
              note: '',
              now,
            }),
          );
        }
        from = Math.max(from, span.until);
      }
      if (first) await req(entries.delete(running.id));
      resolution.running =
        action === 'stop'
          ? null
          : await addIdleEntry(stores, {
              taskId: running.taskId,
              start: from,
              end: null,
              note: running.note,
              now,
            });
      await req(meta.put(resolution.running?.id ?? null, META.running));
      await touchTasks(
        stores,
        action === 'assign' ? [running.taskId, /** @type {string} */ (taskId)] : [running.taskId],
      );
      return resolution;
    },
  );
  if (result) {
    emit(db, { type: 'idle', ids: [result.idle.entryId] });
    if (result.action !== 'keep') {
      const ids = [
        result.idle.entryId,
        ...result.worked.map((entry) => entry.id),
        ...result.assigned.map((entry) => entry.id),
        ...(result.running ? [result.running.id] : []),
      ];
      emit(db, { type: 'entries', ids: [...new Set(ids)] });
    }
  }
  return result;
}
