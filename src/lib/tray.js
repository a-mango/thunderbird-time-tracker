// The tray helper's status message (S6, native/tray/): what the system tray icon shows for the
// running entry. Pure: the background passes the strings (`_locales`) in.
import { formatClock } from './format.js';

/** Name of the native messaging host (native/tray/, `npm run tray:install`). */
export const TRAY_HOST = 'time_tracker_tray';

/** Menu item ids the helper sends back as commands; `activate` is a click on the icon. */
export const TRAY_COMMANDS = /** @type {const} */ (['toggle', 'tracker', 'activate']);

/**
 * @typedef {{type: 'status', running: boolean, title: string,
 *            tooltip: {title: string, text: string},
 *            menu: ({id: string, label: string, enabled: boolean} | {type: 'separator'})[]}}
 *   TrayStatus
 */

/**
 * The status for the running entry (or none).
 * @param {{start: number} | null} running
 * @param {string | null} taskName
 * @param {{now: number, t: (name: string) => string}} options
 * @returns {TrayStatus}
 */
export function trayStatus(running, taskName, { now, t }) {
  const title = t('extensionName');
  const text =
    running && taskName !== null
      ? `${formatClock(now - running.start)} · ${taskName}`
      : t('trayIdle');
  return {
    type: 'status',
    running: running !== null && taskName !== null,
    title,
    tooltip: { title, text },
    menu: [
      { id: 'toggle', label: t(running ? 'trayStop' : 'trayStartLast'), enabled: true },
      { type: 'separator' },
      { id: 'tracker', label: t('trayOpen'), enabled: true },
    ],
  };
}

/**
 * The command in a message from the helper, or null for anything else.
 * @param {unknown} message
 * @returns {(typeof TRAY_COMMANDS)[number] | null}
 */
export function trayCommand(message) {
  if (typeof message !== 'object' || message === null) return null;
  const { type, command } = /** @type {Record<string, unknown>} */ (message);
  if (type !== 'command') return null;
  return TRAY_COMMANDS.includes(/** @type {any} */ (command))
    ? /** @type {(typeof TRAY_COMMANDS)[number]} */ (command)
    : null;
}
