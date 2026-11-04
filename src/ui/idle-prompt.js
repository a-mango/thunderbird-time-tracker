// The idle prompt (S2) as a notification bar, shared by the tracker tab and the popup: "You were
// away 23m (14:02 – 14:25)" with Keep, Discard, Stop at 14:02 and Assign to…. The background
// records the absence (background/idle.js); this reads it after every change and writes the
// answer through db/.
import { getIdle, resolveIdle } from '../db/index.js';
import { formatTime } from '../lib/format.js';
import { awayMessage } from '../lib/idle.js';
import { t } from './i18n.js';

/**
 * @typedef {import('../db/idle.js').IdleRecord} IdleRecord
 * @typedef {import('./components/tt-notification-bar.js').TtNotificationBar} TtNotificationBar
 * @typedef {object} IdlePromptOptions
 * @property {IDBDatabase} db
 * @property {TtNotificationBar} bar a persistent bar of its own (errors use another one)
 * @property {(idle: IdleRecord & {until: number}) => Promise<string | null>} assign asks for the
 *   task that gets the time away; `null` when cancelled (the popup opens the tracker instead)
 * @property {(error: unknown) => void} onError
 * @property {() => unknown} [onResolved] after this page answered (its own write isn't echoed
 *   back over the channel)
 */

/**
 * @param {IdlePromptOptions} options
 * @returns {{refresh: () => Promise<void>}} call `refresh` after every change from db/
 */
export function createIdlePrompt({ db, bar, assign, onError, onResolved }) {
  bar.setAttribute('persistent', '');
  bar.classList.add('idle-prompt');
  /** The record shown, so a refresh with the same record keeps focus on the buttons. */
  let shown = '';

  /**
   * @param {import('../db/idle.js').IdleAction} action
   * @param {IdleRecord} idle
   * @param {string} [taskId]
   */
  const answer = async (action, idle, taskId) => {
    try {
      await resolveIdle(db, action, { entryId: idle.entryId, taskId });
      await refresh();
      await onResolved?.();
    } catch (error) {
      onError(error);
    }
  };

  async function refresh() {
    const idle = await getIdle(db);
    if (!idle || idle.until === null) {
      shown = '';
      bar.hidden = true;
      return;
    }
    const pending = /** @type {IdleRecord & {until: number}} */ (idle);
    const key = JSON.stringify(pending);
    if (key === shown && !bar.hidden) return;
    shown = key;
    const locale = messenger.i18n.getUILanguage();
    bar.show({
      type: 'info',
      message: awayMessage(pending.since, pending.until, {
        getMessage: (name, substitutions = []) => t(name, ...substitutions),
        locale,
      }),
      actions: [
        { label: t('idleKeep'), onClick: () => answer('keep', pending) },
        { label: t('idleDiscard'), onClick: () => answer('discard', pending) },
        {
          label: t('idleStopAt', formatTime(pending.since, { locale })),
          onClick: () => answer('stop', pending),
        },
        {
          label: t('idleAssign'),
          onClick: async () => {
            const taskId = await assign(pending);
            if (taskId) await answer('assign', pending, taskId);
          },
        },
      ],
    });
  }

  return { refresh: () => refresh().catch(onError) };
}
