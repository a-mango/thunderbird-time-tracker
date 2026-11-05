// System tray icon (S6): the timer status in the desktop's tray, drawn by the native helper in
// native/tray/ (installed with `npm run tray:install`). The background connects to it while the
// `trayIcon` setting is on and the optional `nativeMessaging` permission is granted, sends the
// status on every status sync, and runs the commands the helper sends back.
//
// The one piece of in-memory state is the open port. It is a connection, not data: the open port
// keeps the event page alive (S6 spike: 145 s idle, never suspended), and every background start
// reconnects from the setting.
import { getRunning, getSettings, getTask } from '../db/index.js';
import { TRAY_HOST, trayCommand, trayStatus } from '../lib/tray.js';

/**
 * @typedef {{
 *   onCommand: (command: (typeof import('../lib/tray.js').TRAY_COMMANDS)[number]) => unknown,
 *   onMissing: (reason: 'missing' | 'broken') => unknown,
 * }} TrayHandlers `onMissing`: the helper isn't installed (`missing`), or keeps failing before
 *   it is ready (`broken`: wrong manifest path, no PyGObject, no session bus)
 */

/** A helper that quit or failed is started again at most once a minute. */
const RETRY_MS = 60_000;
/** Alarm that retries after a failure, also while no timer runs (no tick alarm then). */
export const TRAY_RETRY_ALARM = 'tt-tray-retry';
/** Failures in a row before the helper sent `ready`, after which the user is told. */
const MAX_EARLY_FAILURES = 3;
/** Thunderbird's error when no manifest names the host (NativeMessaging.sys.mjs). */
const MISSING = /no such native application/iu;

/** @type {messenger.runtime.Port | null} */
let port = null;
let failedAt = Number.NEGATIVE_INFINITY;
let earlyFailures = 0;

/**
 * Whether the optional permission is granted (false where the API is missing).
 * @param {typeof messenger} api
 */
async function hasPermission(api) {
  try {
    return (await api.permissions?.contains({ permissions: ['nativeMessaging'] })) === true;
  } catch {
    return false;
  }
}

/**
 * Starts the helper. A disconnect drops the port: a missing helper calls `onMissing`, anything
 * else (the helper quit or crashed) is retried on a later sync.
 * @param {typeof messenger} api
 * @param {TrayHandlers} handlers
 */
function connect(api, handlers) {
  const next = api.runtime.connectNative(TRAY_HOST);
  let ready = false;
  next.onMessage.addListener((message) => {
    if (message?.type === 'ready') {
      ready = true;
      earlyFailures = 0;
      return;
    }
    const command = trayCommand(message);
    if (command) handlers.onCommand(command);
  });
  next.onDisconnect.addListener((closed) => {
    // Closed on purpose (setting or permission off): nothing to report or retry.
    if (port !== next) return;
    port = null;
    failedAt = Date.now();
    const error = closed.error?.message ?? '';
    if (MISSING.test(error)) {
      handlers.onMissing('missing');
      return;
    }
    console.error('time tracker: the tray helper stopped', error);
    if (!ready && ++earlyFailures >= MAX_EARLY_FAILURES) {
      earlyFailures = 0;
      handlers.onMissing('broken');
      return;
    }
    Promise.resolve(api.alarms?.create(TRAY_RETRY_ALARM, { when: failedAt + RETRY_MS })).catch(
      (alarmError) => console.error('time tracker: tray retry alarm failed', alarmError),
    );
  });
  return next;
}

/** Closes the helper (the setting or the permission is off); the icon goes away with it. */
export function closeTray() {
  const open = port;
  port = null;
  open?.disconnect();
}

/**
 * Brings the tray in line with the database: connects or disconnects by the setting and the
 * permission, then sends the current status.
 * @param {IDBDatabase} db
 * @param {TrayHandlers & {api?: typeof messenger, now?: number}} options
 * @returns {Promise<'off' | 'waiting' | 'on'>}
 */
export async function syncTray(db, { api = messenger, now = Date.now(), ...handlers }) {
  const { trayIcon } = await getSettings(db);
  if (!trayIcon || !(await hasPermission(api))) {
    closeTray();
    return 'off';
  }
  if (!port) {
    if (Date.now() - failedAt < RETRY_MS) return 'waiting';
    port = connect(api, handlers);
  }
  const running = await getRunning(db);
  const task = running ? await getTask(db, running.taskId) : null;
  port.postMessage(
    trayStatus(running, task?.name ?? null, {
      now,
      t: (name) => api.i18n.getMessage(name),
    }),
  );
  return 'on';
}

/** Test hook: forget the port and the last failure. */
export function resetTray() {
  port = null;
  failedAt = Number.NEGATIVE_INFINITY;
  earlyFailures = 0;
}
