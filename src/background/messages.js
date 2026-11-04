/**
 * Change types that can change the timer status (running entry, its task's name, a restore) or
 * the idle detection interval (the threshold setting).
 */
const STATUS_TYPES = new Set(['entries', 'tasks', 'settings', 'reset']);
/** Change types that can answer or drop the idle prompt (and so its notification). */
const IDLE_TYPES = new Set(['idle', 'entries', 'reset']);

/**
 * Handles runtime messages from extension pages. Pages read and write `db/` themselves; their
 * `tt:changed` pings (db/changes.js) wake the event page, which then refreshes the action label,
 * badges and tick alarm. Returns `undefined` (no answer), so other listeners can answer.
 * @param {any} message
 * @param {{syncStatus: () => unknown, syncIdle?: () => unknown}} handlers
 * @returns {undefined}
 */
export function handleMessage(message, { syncStatus, syncIdle }) {
  if (message?.type !== 'tt:changed') return undefined;
  if (STATUS_TYPES.has(message.change?.type)) syncStatus();
  if (IDLE_TYPES.has(message.change?.type)) syncIdle?.();
  return undefined;
}
