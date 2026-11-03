// Entry and timer commands of the detail pane: add, edit, split, duplicate and delete (with
// undo), plus Stop/Split/Resume on the timer box. Writes go through db/ and lib/timer.js; the
// page updates from the change notifications.
import {
  addEntry,
  getEntry,
  listEntriesInRange,
  reopenTask,
  restoreEntry,
  softDeleteEntry,
  splitEntry,
  updateEntry,
} from '../db/index.js';
import { findOverlaps } from '../lib/entry-list.js';
import { TaskDoneError } from '../lib/errors.js';
import { resume, split, stop, stopAt } from '../lib/timer.js';
import { confirmOverlap, entryDialog, splitDialog } from './entry-dialogs.js';
import { t } from './i18n.js';
import { confirmReopen } from './task-dialogs.js';

/**
 * @typedef {import('./tracker-data.js').TrackerData} TrackerData
 * @typedef {import('../lib/types.js').Entry} Entry
 * @typedef {import('./entry-dialogs.js').EntryDraft} EntryDraft
 * @typedef {'edit' | 'split' | 'duplicate' | 'delete'} EntryCommand
 */

const HOUR = 3_600_000;

/**
 * @param {{
 *   data: TrackerData,
 *   onError: (error: unknown) => void,
 *   offerUndo: (message: string, undo: () => Promise<void>) => void,
 * }} options
 */
export function createEntryCommands({ data, onError, offerUndo }) {
  const locale = messenger.i18n.getUILanguage();
  const now = () => data.now();
  const context = () => ({ projects: data.projects, tasks: data.tasks });

  /** @template T @param {() => Promise<T>} fn @returns {Promise<T | undefined>} */
  const guarded = async (fn) => {
    try {
      return await fn();
    } catch (error) {
      onError(error);
      return undefined;
    }
  };

  /**
   * Overlap warning for a draft (against every task's entries). True to go ahead.
   * @param {EntryDraft} draft
   * @param {string | null} id the entry being edited
   */
  const confirmSave = async (draft, id) => {
    const end = draft.end ?? now();
    if (!(draft.start < end)) return true;
    const nearby = await listEntriesInRange(data.db, draft.start, end);
    const overlaps = findOverlaps(nearby, { id, start: draft.start, end }, { now: now() });
    return overlaps.length === 0 || confirmOverlap(overlaps, { tasks: data.tasks, locale });
  };

  /**
   * New entry dialog for a task: the last hour by default, or the values of `from` (Duplicate).
   * @param {string} taskId
   * @param {Partial<EntryDraft>} [from]
   */
  function add(taskId, from = {}) {
    if (!data.tasks.has(taskId)) return Promise.resolve();
    return guarded(async () => {
      const end = from.end ?? now();
      const draft = await entryDialog({
        heading: t('entryDialogNew'),
        draft: { taskId, start: from.start ?? end - HOUR, end, note: from.note ?? '' },
        running: false,
        context: context(),
        now,
        confirmSave: (input) => confirmSave(input, null),
      });
      if (!draft || draft.end === null) return;
      await addEntry(data.db, { ...draft, end: draft.end });
    });
  }

  /** @param {string} id */
  function edit(id) {
    return guarded(async () => {
      const entry = await getEntry(data.db, id);
      if (!entry) return;
      const running = entry.end === null;
      const draft = await entryDialog({
        heading: t('entryDialogEdit'),
        draft: { taskId: entry.taskId, start: entry.start, end: entry.end, note: entry.note },
        running,
        context: context(),
        now,
        confirmSave: (input) => confirmSave(input, id),
      });
      if (!draft) return;
      const { end, ...patch } = draft;
      if (!running) {
        await updateEntry(data.db, id, { ...patch, end: /** @type {number} */ (end) });
        return;
      }
      // The running entry: edit it, then stop it at the chosen end (never in the future).
      await updateEntry(data.db, id, patch, { now: now() });
      if (end !== null) await stopAt(data.db, end, { now: now(), id });
    });
  }

  /** Split dialog for an entry (running or stopped). @param {string} id */
  function splitAt(id) {
    return guarded(async () => {
      const entry = await getEntry(data.db, id);
      if (!entry) return;
      const answer = await splitDialog({ entry, context: context(), now, locale });
      if (!answer) return;
      const taskId = answer.taskId === entry.taskId ? undefined : answer.taskId;
      if (entry.end === null) await split(data.db, answer.at, { now: now(), taskId, id });
      else await splitEntry(data.db, id, answer.at, { now: now(), taskId });
    });
  }

  /** Opens a new entry with the values of `id`. @param {string} id */
  function duplicate(id) {
    return guarded(async () => {
      const entry = await getEntry(data.db, id);
      if (!entry) return;
      await add(entry.taskId, { start: entry.start, end: entry.end ?? now(), note: entry.note });
    });
  }

  /** Deletes at once, with Undo in the notification bar. @param {string} id */
  function remove(id) {
    return guarded(async () => {
      const deleted = await softDeleteEntry(data.db, id, { now: now() });
      const name = data.tasks.get(deleted.taskId)?.name ?? '';
      offerUndo(t('entryDeleted', name), () =>
        guarded(async () => {
          await restoreEntry(data.db, id);
        }).then(() => undefined),
      );
    });
  }

  /** Timer box: Stop. */
  function stopTimer() {
    return guarded(async () => {
      await stop(data.db, { now: now() });
    });
  }

  /** Timer box: Split (the running entry). */
  function splitRunning() {
    return data.running ? splitAt(data.running.id) : Promise.resolve();
  }

  /** Timer box when idle: Resume last entry (a done task asks to be reopened). @param {string} taskId */
  function resumeTask(taskId) {
    const task = data.tasks.get(taskId);
    if (!task) return Promise.resolve();
    return guarded(async () => {
      try {
        await resume(data.db, taskId, { now: now() });
      } catch (error) {
        if (!(error instanceof TaskDoneError)) throw error;
        if (!(await confirmReopen(task))) return;
        await reopenTask(data.db, taskId);
        await resume(data.db, taskId, { now: now() });
      }
    });
  }

  /**
   * Runs a command by name (context menu, keys).
   * @param {EntryCommand} command
   * @param {string} id
   */
  function run(command, id) {
    switch (command) {
      case 'edit':
        return edit(id);
      case 'split':
        return splitAt(id);
      case 'duplicate':
        return duplicate(id);
      case 'delete':
        return remove(id);
    }
    return Promise.resolve();
  }

  return { add, edit, splitAt, duplicate, remove, stopTimer, splitRunning, resumeTask, run };
}
