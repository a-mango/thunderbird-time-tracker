// Timer operations (start, stop, switch, split, discard, adjust start) for the UI and the
// background. Each one is a single transaction in db/entries.js, so the invariants (one running
// entry, start < end, same-instant handoff) hold across pages. `now` defaults to `Date.now()`.
import {
  adjustRunningStart,
  discardRunning,
  getRunning as getRunningEntry,
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
 * Splits the running entry at `at`: the current entry ends at `at` and a new running entry for
 * the same task (source `split`) starts at `at`.
 * @param {IDBDatabase} db
 * @param {number} at in `(running.start, now]`
 * @param {TimerOptions} [options]
 * @returns {Promise<SplitResult>}
 * @throws {import('./errors.js').ValidationError} `split-at`
 * @throws {import('./errors.js').NotFoundError} `running`
 */
export function split(db, at, { now = Date.now() } = {}) {
  return splitRunning(db, at, { now });
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
