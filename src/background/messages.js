/**
 * Handles runtime messages from extension pages. Pages read and write `db/` themselves, so
 * nothing needs an answer yet; `tt:changed` pings (db/changes.js) only wake the event page, which
 * M5 uses for badge and label updates. Returns `undefined` for messages it doesn't answer, so
 * other listeners can.
 * @param {any} _message
 * @returns {undefined}
 */
export function handleMessage(_message) {
  return undefined;
}
