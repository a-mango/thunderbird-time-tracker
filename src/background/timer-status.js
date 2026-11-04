// Timer side effects in Thunderbird's chrome (docs/SPEC.md, Architecture: Timer): while an entry
// runs, the action button shows `h:mm · task`, and the alarm `tt-tick` refreshes it every minute. Everything is derived from the database on each
// call, so it works the same after a restart or an event-page wake-up.
import { getRunning, getTask } from '../db/index.js';
import { formatTimerLabel } from '../lib/format.js';
import { toggle } from '../lib/timer.js';
import { armIdle } from './idle.js';

export const TICK_ALARM = 'tt-tick';
export const NOTIFICATION_ID = 'tt-no-last-task';
const MINUTE = 60_000;

/**
 * @typedef {{api?: typeof messenger, now?: number}} StatusOptions
 */

/**
 * Runs Thunderbird side effects independently: one that fails (or whose API is missing, e.g. a
 * permission the profile refused) is logged and doesn't stop the others.
 * @param {string} what
 * @param {(() => unknown)[]} effects
 */
async function sideEffects(what, effects) {
  const results = await Promise.allSettled(effects.map(async (effect) => effect()));
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(`time tracker: ${what} failed`, result.reason);
    }
  }
}

/**
 * Sets or clears the action label and the tick alarm from the running entry. The alarm fires on
 * whole running minutes (start + n min), so `h:mm` changes on time. No badges: the label already
 * shows the time (maintainer's call after the M5 check in Thunderbird).
 * @param {IDBDatabase} db
 * @param {StatusOptions} [options]
 * @returns {Promise<'running' | 'stopped'>}
 */
export async function syncTimerStatus(db, { api = messenger, now = Date.now() } = {}) {
  const running = await getRunning(db);
  const task = running ? await getTask(db, running.taskId) : null;
  if (running && task) {
    const elapsed = Math.max(0, now - running.start);
    const nextMinute = running.start + (Math.floor(elapsed / MINUTE) + 1) * MINUTE;
    await sideEffects('timer status', [
      () => api.alarms?.create(TICK_ALARM, { when: nextMinute, periodInMinutes: 1 }),
      () => api.action.setLabel({ label: formatTimerLabel(elapsed, task.name) }),
      () => armIdle(db, { api }),
    ]);
    return 'running';
  }
  await sideEffects('timer status', [
    () => api.alarms?.clear(TICK_ALARM),
    () => api.action.setLabel({ label: null }),
  ]);
  return 'stopped';
}

/**
 * The `toggle-timer` command: stop the running entry, else start the open task tracked last.
 * With no such task, a notification says how to start one. Status follows via `syncTimerStatus`
 * (the write's own `tt:changed` ping does not reach the sender).
 * @param {IDBDatabase} db
 * @param {StatusOptions} [options]
 */
export async function toggleTimer(db, { api = messenger, now = Date.now() } = {}) {
  const result = await toggle(db, { now });
  if (result.action === 'none') {
    await sideEffects('notification', [
      () =>
        api.notifications?.create(NOTIFICATION_ID, {
          type: 'basic',
          title: api.i18n.getMessage('extensionName'),
          message: api.i18n.getMessage('notificationNoLastTask'),
        }),
    ]);
  }
  await syncTimerStatus(db, { api, now });
  return result;
}
