// Change propagation (docs/SPEC.md, Architecture): after a commit, `db/` posts `{type, ids}` on
// BroadcastChannel('tt') for open pages and pings the runtime so the event page wakes up.

export const CHANNEL_NAME = 'tt';

/**
 * @typedef {'projects'|'tasks'|'entries'|'settings'} ChangeType
 * @typedef {{type: ChangeType, ids: string[]}} Change
 *   `ids` are record ids; for `settings` they are the changed keys.
 * @typedef {(change: Change) => unknown} Notifier
 *   Called once per change after the transaction committed. May return a promise; a rejection
 *   is logged, never thrown at the writer.
 * @typedef {{postMessage: (message: unknown) => void}} ChannelLike
 * @typedef {{sendMessage: (message: unknown) => Promise<unknown>}} RuntimeLike
 */

/** Lazily created; a cache that is safe to lose when the event page unloads. */
/** @type {ChannelLike | null} */
let sharedChannel = null;

/** @returns {ChannelLike | null} */
function defaultChannel() {
  if (!sharedChannel && typeof BroadcastChannel === 'function') {
    sharedChannel = new BroadcastChannel(CHANNEL_NAME);
  }
  return sharedChannel;
}

/** @param {unknown} error */
const isNoReceiver = (error) =>
  error instanceof Error && error.message.includes('Receiving end does not exist');

/**
 * Posts a change to open pages and pings the background.
 * Resolves once the runtime ping settled. A "Receiving end does not exist" rejection (no page or
 * background listening) is swallowed; any other error rejects.
 * @param {Change} change
 * @param {{channel?: ChannelLike | null, runtime?: RuntimeLike | null}} [options]
 * @returns {Promise<void>}
 */
export async function notifyChanged(
  change,
  { channel = defaultChannel(), runtime = globalThis.messenger?.runtime } = {},
) {
  channel?.postMessage(change);
  if (!runtime) return;
  try {
    await runtime.sendMessage({ type: 'tt:changed', change });
  } catch (error) {
    if (!isNoReceiver(error)) throw error;
  }
}
