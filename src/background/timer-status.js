// Timer side effects in Thunderbird's chrome (docs/SPEC.md, Architecture: Timer): while an entry
// runs, the action button shows `h:mm · task` and a badge, the space button shows `h:mm`, and the
// alarm `tt-tick` refreshes them every minute. Everything is derived from the database on each
// call, so it works the same after a restart or an event-page wake-up.
import { getRunning, getTask } from '../db/index.js';
import { formatClock, formatTimerLabel } from '../lib/format.js';
import { toggle } from '../lib/timer.js';
import { SPACE_NAME, TRACKER_PATH } from './space.js';

export const TICK_ALARM = 'tt-tick';
export const NOTIFICATION_ID = 'tt-no-last-task';
/** Action badge while running: a dot, so the elapsed time isn't shown twice next to the label. */
export const RUNNING_BADGE = '●';
const MINUTE = 60_000;

/**
 * @typedef {{api?: typeof messenger, now?: number}} StatusOptions
 */

/**
 * Sets or clears the action label and badge, the space badge and the tick alarm from the running
 * entry. The alarm fires on whole running minutes (start + n min), so `h:mm` changes on time.
 * @param {IDBDatabase} db
 * @param {StatusOptions} [options]
 * @returns {Promise<'running' | 'stopped'>}
 */
export async function syncTimerStatus(db, { api = messenger, now = Date.now() } = {}) {
  const running = await getRunning(db);
  const task = running ? await getTask(db, running.taskId) : null;
  const [space] = await api.spaces.query({ isSelfOwned: true, name: SPACE_NAME });
  // Thunderbird rebuilds the tab properties from what update() gets, so the URL goes along.
  const tab = { url: api.runtime.getURL(TRACKER_PATH) };
  if (running && task) {
    const elapsed = Math.max(0, now - running.start);
    const nextMinute = running.start + (Math.floor(elapsed / MINUTE) + 1) * MINUTE;
    await Promise.all([
      api.alarms.create(TICK_ALARM, { when: nextMinute, periodInMinutes: 1 }),
      api.action.setLabel({ label: formatTimerLabel(elapsed, task.name) }),
      api.action.setBadgeText({ text: RUNNING_BADGE }),
      space && api.spaces.update(space.id, tab, { badgeText: formatClock(elapsed) }),
    ]);
    return 'running';
  }
  await Promise.all([
    api.alarms.clear(TICK_ALARM),
    api.action.setLabel({ label: null }),
    api.action.setBadgeText({ text: null }),
    space && api.spaces.update(space.id, tab, { badgeText: null }),
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
    await api.notifications.create(NOTIFICATION_ID, {
      type: 'basic',
      title: api.i18n.getMessage('extensionName'),
      message: api.i18n.getMessage('notificationNoLastTask'),
    });
  }
  await syncTimerStatus(db, { api, now });
  return result;
}
