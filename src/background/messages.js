/** Change types that can change the timer status (running entry, or its task's name). */
const STATUS_TYPES = new Set(['entries', 'tasks']);

/**
 * Handles runtime messages from extension pages. Pages read and write `db/` themselves; their
 * `tt:changed` pings (db/changes.js) wake the event page, which then refreshes the action label,
 * badges and tick alarm. Returns `undefined` (no answer), so other listeners can answer.
 * @param {any} message
 * @param {{syncStatus: () => unknown}} handlers
 * @returns {undefined}
 */
export function handleMessage(message, { syncStatus }) {
  if (message?.type === 'tt:changed' && STATUS_TYPES.has(message.change?.type)) syncStatus();
  return undefined;
}
