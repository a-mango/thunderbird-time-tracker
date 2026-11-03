// Timer operations (start, stop, switch, split, discard, adjust start) for the UI and the
// background. Each one is a single transaction in db/entries.js, so the invariants (one running
// entry, start < end, same-instant handoff) hold across pages. `now` defaults to `Date.now()`.
import {
  adjustRunningStart,
  discardRunning,
  getRunning as getRunningEntry,
  lastTrackedTask,
  listEntriesByTask,
  splitRunning,
  startEntry,
  stopRunning,
} from '../db/entries.js';

/**
 * @typedef {import('./types.js').Entry} Entry
 * @typedef {import('../db/entries.js').TimerStop} TimerStop
 * @typedef {import('../db/entries.js').StartResult} StartResult
 * @typedef {import('../db/entries.js').SplitResult} SplitResult
 * @typedef {{now?: number}} TimerOptions
 */

/**
 * Starts tracking a task. A running entry on another task stops at the same instant; if the task
 * is already running nothing changes.
 * @param {IDBDatabase} db
 * @param {string} taskId
 * @param {TimerOptions & {note?: string}} [options]
 * @returns {Promise<StartResult>}
 * @throws {import('./errors.js').TaskDoneError} `task-done`: ask to reopen the task
 * @throws {import('./errors.js').NotFoundError} `task`
 */
export function start(db, taskId, { now = Date.now(), note = '' } = {}) {
  return startEntry(db, taskId, { now, note, source: 'timer' });
}

/**
 * Stops the running entry; one that would be zero-length is discarded.
 * @param {IDBDatabase} db
 * @param {TimerOptions} [options]
 * @returns {Promise<TimerStop | null>} `null` when nothing was running
 */
export function stop(db, { now = Date.now() } = {}) {
  return stopRunning(db, { now });
}

/**
 * Stops the running entry at an earlier time ("I stopped at 17:30").
 * @param {IDBDatabase} db
 * @param {number} at in `(running.start, now]`: never in the future
 * @param {TimerOptions} [options]
 * @returns {Promise<TimerStop | null>} `null` when nothing was running
 * @throws {import('./errors.js').ValidationError} `end`
 */
export function stopAt(db, at, { now = Date.now() } = {}) {
  return stopRunning(db, { now, at });
}

/**
 * Switches tracking to another task (same-instant handoff). Same as `start`; named for the UI
 * action that has a timer running.
 * @param {IDBDatabase} db
 * @param {string} taskId
 * @param {TimerOptions & {note?: string}} [options]
 * @returns {Promise<StartResult>}
 */
export function switchTo(db, taskId, options) {
  return start(db, taskId, options);
}

/**
 * Splits the running entry at `at`: the current entry ends at `at` and a new running entry
 * (source `split`) starts at `at`, for the same task or for `taskId`.
 * @param {IDBDatabase} db
 * @param {number} at in `(running.start, now]`
 * @param {TimerOptions & {taskId?: string}} [options]
 * @returns {Promise<SplitResult>}
 * @throws {import('./errors.js').ValidationError} `split-at`
 * @throws {import('./errors.js').NotFoundError} `running`, `task`
 * @throws {import('./errors.js').TaskDoneError} `task-done` when `taskId` is done
 */
export function split(db, at, { now = Date.now(), taskId } = {}) {
  return splitRunning(db, at, { now, taskId });
}

/**
 * "Resume last entry": starts the task again with the note of its latest entry. Stopped entries
 * are never reopened (`start < end` holds for them), so this is a new entry.
 * @param {IDBDatabase} db
 * @param {string} taskId
 * @param {TimerOptions} [options]
 * @returns {Promise<StartResult>}
 * @throws {import('./errors.js').TaskDoneError} `task-done`
 * @throws {import('./errors.js').NotFoundError} `task`
 */
export async function resume(db, taskId, { now = Date.now() } = {}) {
  const entries = await listEntriesByTask(db, taskId);
  const last = entries.filter((entry) => entry.end !== null).at(-1);
  return start(db, taskId, { now, note: last?.note ?? '' });
}

/**
 * The `toggle-timer` command: stops the running entry, else starts the open task tracked last.
 * @param {IDBDatabase} db
 * @param {TimerOptions} [options]
 * @returns {Promise<{action: 'stopped', stop: TimerStop} | {action: 'started', start: StartResult}
 *   | {action: 'none'}>} `none` when nothing runs and no open task was ever tracked
 */
export async function toggle(db, { now = Date.now() } = {}) {
  const stopped = await stop(db, { now });
  if (stopped) return { action: 'stopped', stop: stopped };
  const task = await lastTrackedTask(db);
  if (!task) return { action: 'none' };
  return { action: 'started', start: await start(db, task.id, { now }) };
}

/**
 * Throws away the running entry.
 * @param {IDBDatabase} db
 * @returns {Promise<Entry | null>} the discarded entry, `null` when nothing was running
 */
export function discard(db) {
  return discardRunning(db);
}

/**
 * Moves the start of the running entry ("I started 15 minutes ago").
 * @param {IDBDatabase} db
 * @param {number} startAt must be before `now`
 * @param {TimerOptions} [options]
 * @returns {Promise<Entry>}
 * @throws {import('./errors.js').ValidationError} `start`
 * @throws {import('./errors.js').NotFoundError} `running`
 */
export function adjustStart(db, startAt, { now = Date.now() } = {}) {
  return adjustRunningStart(db, startAt, { now });
}

/**
 * @param {IDBDatabase} db
 * @returns {Promise<Entry | null>}
 */
export function getRunning(db) {
  return getRunningEntry(db);
}
