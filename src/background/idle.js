// Idle detection (S2): while a timer runs, the `idle` API reports when the user leaves and comes
// back; a late tick alarm reveals a suspend. The absence is stored in `meta.idle` (db/idle.js)
// and the prompt is answered in the tracker tab or the popup. When neither is open, a system
// notification asks the user to open the tracker. Nothing is kept in memory.
import { getIdle, getSettings, markActive, recordIdle } from '../db/index.js';
import { awayMessage, detectionInterval, idleSince, sleepGap } from '../lib/idle.js';
import { TRACKER_PATH } from './space.js';

export const IDLE_NOTIFICATION_ID = 'tt-idle';
const POPUP_PATH = 'ui/popup.html';

/**
 * @typedef {import('../db/idle.js').IdleRecord} IdleRecord
 * @typedef {{api?: typeof messenger, now?: number}} IdleOptions
 */

/**
 * Sets the detection interval from the setting while a timer runs (the API has no "off": with
 * idle detection off, events are ignored instead).
 * @param {IDBDatabase} db
 * @param {{api?: typeof messenger}} [options]
 */
export async function armIdle(db, { api = messenger } = {}) {
  if (!api.idle) return;
  const interval = detectionInterval((await getSettings(db)).idleThresholdMin);
  if (interval !== null) api.idle.setDetectionInterval(interval);
}

/**
 * Whether the tracker tab or the popup is open (they show the prompt themselves).
 * @param {typeof messenger} api
 */
async function promptVisible(api) {
  if (!api.runtime.getContexts) return false;
  const pages = [TRACKER_PATH, POPUP_PATH].map((path) => api.runtime.getURL(path));
  const contexts = await api.runtime.getContexts({ contextTypes: ['TAB', 'POPUP'] });
  return contexts.some((c) => pages.some((page) => c.documentUrl?.startsWith(page)));
}

/**
 * A pending prompt with no page open to show it: a system notification. Clicking it opens the
 * tracker tab (main.js).
 * @param {IdleRecord} idle
 * @param {{api?: typeof messenger}} [options]
 */
export async function raiseIdlePrompt(idle, { api = messenger } = {}) {
  if (idle.until === null || !api.notifications) return;
  if (await promptVisible(api)) return;
  const message = awayMessage(idle.since, idle.until, {
    getMessage: (name, substitutions) => api.i18n.getMessage(name, substitutions),
    locale: api.i18n.getUILanguage(),
  });
  await api.notifications.create(IDLE_NOTIFICATION_ID, {
    type: 'basic',
    title: api.i18n.getMessage('extensionName'),
    message: `${message} ${api.i18n.getMessage('idleNotificationHint')}`,
  });
}

/**
 * Removes the notification once the prompt was answered (or became stale).
 * @param {IDBDatabase} db
 * @param {{api?: typeof messenger}} [options]
 */
export async function syncIdleNotification(db, { api = messenger } = {}) {
  if (!api.notifications) return;
  const idle = await getIdle(db);
  if (!idle || idle.until === null) await api.notifications.clear(IDLE_NOTIFICATION_ID);
}

/**
 * `idle.onStateChanged`: `idle` dates the absence back by the threshold; `active` ends it and
 * raises the prompt. Ignored when idle detection is off or no timer runs.
 * @param {IDBDatabase} db
 * @param {string} state `active` | `idle` (`locked` from other platforms counts as idle)
 * @param {IdleOptions} [options]
 * @returns {Promise<IdleRecord | null>} the pending prompt after `active`
 */
export async function onIdleState(db, state, { api = messenger, now = Date.now() } = {}) {
  if (state !== 'active') {
    const { idleThresholdMin } = await getSettings(db);
    if (detectionInterval(idleThresholdMin) !== null) {
      await recordIdle(db, { since: idleSince(now, idleThresholdMin) });
    }
    return null;
  }
  const pending = await markActive(db, { now });
  if (pending) await raiseIdlePrompt(pending, { api });
  return pending;
}

/**
 * The tick alarm fired late (suspend/resume): the gap counts as an absence.
 * @param {IDBDatabase} db
 * @param {{scheduledTime: number, periodInMinutes?: number}} alarm
 * @param {IdleOptions} [options]
 * @returns {Promise<IdleRecord | null>} the pending prompt, if the tick was late
 */
export async function checkSleep(db, alarm, { api = messenger, now = Date.now() } = {}) {
  const gap = sleepGap(alarm, now, (await getSettings(db)).idleThresholdMin);
  if (!gap) return null;
  const pending = await recordIdle(db, gap);
  if (pending) await raiseIdlePrompt(pending, { api });
  return pending;
}

/**
 * Thunderbird start: an absence that was still open when Thunderbird quit ends now.
 * @param {IDBDatabase} db
 * @param {IdleOptions} [options]
 * @returns {Promise<IdleRecord | null>}
 */
export async function checkIdleOnStartup(db, { api = messenger, now = Date.now() } = {}) {
  const idle = await getIdle(db);
  if (!idle) return null;
  const pending = idle.until === null ? await markActive(db, { now }) : idle;
  if (pending) await raiseIdlePrompt(pending, { api });
  return pending;
}
