import { ensureSpace } from './space.js';
import { registerMenus } from './menus.js';
import { handleMessage } from './messages.js';
import { TICK_ALARM, syncTimerStatus, toggleTimer } from './timer-status.js';
import {
  IDLE_NOTIFICATION_ID,
  checkIdleOnStartup,
  checkSleep,
  onIdleState,
  syncIdleNotification,
} from './idle.js';
import { openDB, purgeDeleted } from '../db/index.js';

// Event page: listeners are registered synchronously at top level, no state in memory. APIs that
// need a permission (`alarms`, `menus`, `notifications`) may be missing; everything else still
// works without them.

/** @param {unknown} error */
const logSpaceError = (error) => console.error('time tracker: space setup failed', error);

/**
 * Runs `fn` on a short-lived connection: the event page may unload at any time.
 * @template T
 * @param {(db: IDBDatabase) => Promise<T>} fn
 */
async function withDB(fn) {
  const db = await openDB();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

// Every background start (app start, install, re-enable, wake-up) makes sure the space exists:
// Thunderbird drops extension spaces when the add-on shuts down.
const spaceReady = ensureSpace().catch(logSpaceError);

/** Label, badges and the tick alarm follow the running entry (after the space exists). */
const runSync = () =>
  withDB((db) => syncTimerStatus(db)).catch((error) =>
    console.error('time tracker: timer status update failed', error),
  );
// Syncs run one after another, so an older read ("stopped") never lands after a newer one
// ("running"). Ordering of in-flight work only; nothing here must survive an unload.
/** @type {Promise<unknown>} */
let lastSync = spaceReady;
const syncStatus = () => (lastSync = lastSync.then(runSync, runSync));

// Restores the label and re-arms the alarm after a restart, and fixes them after a wake-up.
syncStatus();

// Context menu items for the tracker tab. Recreated on every background start like the space
// (the M1 spike's proven path); the tracker page handles onShown/onClicked.
registerMenus().catch((error) => console.error('time tracker: menu setup failed', error));

messenger.runtime.onInstalled.addListener(() => {
  // After the startup check, so both never race to create the space.
  spaceReady.then(() => ensureSpace(messenger, { repair: true })).catch(logSpaceError);
});

/**
 * Queues idle work behind the status syncs, so it sees the same order of writes.
 * @param {string} what
 * @param {(db: IDBDatabase) => Promise<unknown>} fn
 */
const idleWork = (what, fn) =>
  (lastSync = lastSync
    .then(() => withDB(fn))
    .catch((error) => console.error(`time tracker: ${what} failed`, error)));

// Thunderbird start: the space check runs at top level; this ends the undo window for deleted
// entries ("until the next session"), and an absence still open when Thunderbird quit ends now.
// Not at top level: the event page wakes up many times.
messenger.runtime.onStartup.addListener(async () => {
  try {
    await withDB((db) => purgeDeleted(db));
  } catch (error) {
    console.error('time tracker: purging deleted entries failed', error);
  }
  idleWork('idle check on startup', (db) => checkIdleOnStartup(db));
});

messenger.runtime.onMessage.addListener((message) =>
  handleMessage(message, {
    syncStatus,
    syncIdle: () => idleWork('idle notification update', (db) => syncIdleNotification(db)),
  }),
);

messenger.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== TICK_ALARM) return;
  // A late tick means the machine slept: check that before the status sync re-arms the alarm.
  idleWork('sleep check', (db) => checkSleep(db, alarm));
  syncStatus();
});

messenger.idle?.onStateChanged.addListener((state) => {
  idleWork('idle state change', (db) => onIdleState(db, state));
});

messenger.notifications?.onClicked.addListener((notificationId) => {
  if (notificationId !== IDLE_NOTIFICATION_ID) return;
  ensureSpace()
    .then((space) => messenger.spaces.open(space.id))
    .catch((error) => console.error('time tracker: opening the tracker failed', error));
});

messenger.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-timer') return;
  lastSync = lastSync
    .then(() => withDB((db) => toggleTimer(db)))
    .catch((error) => console.error('time tracker: toggling the timer failed', error));
});
