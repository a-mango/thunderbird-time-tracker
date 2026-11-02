// Task commands, shared by the task table (buttons, keys), the native context menu and New Task.
// Writes go through db/ and lib/timer.js; the list updates from the change notifications.
import {
  createTask,
  deleteTask,
  editTask,
  markTaskDone,
  moveTask,
  reopenTask,
  restoreTask,
  updateTask,
} from '../db/index.js';
import { TaskDoneError } from '../lib/errors.js';
import { start, stop } from '../lib/timer.js';
import { t } from './i18n.js';
import { confirmReopen, moveTaskDialog, taskDialog } from './task-dialogs.js';

/**
 * @typedef {import('./tracker-data.js').TrackerData} TrackerData
 * @typedef {import('../lib/types.js').Task} Task
 * @typedef {import('../db/tasks.js').TaskSnapshot} TaskSnapshot
 * @typedef {'timer' | 'edit' | 'rename' | 'star' | 'done' | 'move' | 'delete'} TaskCommand
 */

/**
 * @param {{
 *   data: TrackerData,
 *   onError: (error: unknown) => void,
 *   announce: (text: string) => void,
 *   offerUndo: (message: string, undo: () => Promise<void>) => void,
 * }} options
 */
export function createTaskCommands({ data, onError, announce, offerUndo }) {
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
   * Creates a task named "New Task" at the end of `projectId`.
   * @param {string} projectId
   */
  function create(projectId) {
    return guarded(async () => {
      const task = await createTask(data.db, { projectId, name: t('taskNewName') });
      await data.settled();
      return task;
    });
  }

  /** @param {string} id @param {string} name */
  function rename(id, name) {
    const task = data.tasks.get(id);
    const clean = name.trim();
    if (!task || !clean || clean === task.name) return Promise.resolve();
    return guarded(() => updateTask(data.db, id, { name: clean }));
  }

  /** @param {string} id */
  function toggleStar(id) {
    const task = data.tasks.get(id);
    if (!task) return Promise.resolve();
    return guarded(() => updateTask(data.db, id, { starred: !task.starred }));
  }

  /**
   * Starts the task (stopping any other at the same instant), or stops it if it runs. A done
   * task asks to be reopened first.
   * @param {string} id
   */
  function toggleTimer(id) {
    const task = data.tasks.get(id);
    if (!task) return Promise.resolve();
    return guarded(async () => {
      if (data.running?.taskId === id) {
        await stop(data.db);
        announce(t('timerStopped', task.name));
        return;
      }
      try {
        await start(data.db, id);
      } catch (error) {
        if (!(error instanceof TaskDoneError)) throw error;
        if (!(await confirmReopen(task))) return;
        await reopenTask(data.db, id);
        await start(data.db, id);
      }
      announce(t('timerStarted', task.name));
    });
  }

  /** @param {string} id @param {boolean} done */
  function setDone(id, done) {
    return guarded(async () => {
      if (done) await markTaskDone(data.db, id);
      else await reopenTask(data.db, id);
    });
  }

  /** Properties dialog. @param {string} id */
  function edit(id) {
    const task = data.tasks.get(id);
    if (!task) return Promise.resolve();
    return guarded(async () => {
      const input = await taskDialog(task, { projects: data.projects, tasks: data.tasks.values() });
      if (!input) return;
      const { projectId, done, ...patch } = input;
      // One transaction: if the move fails (another tab deleted the project), nothing is saved.
      await editTask(data.db, id, { patch, projectId, done });
    });
  }

  /** @param {string} id */
  function move(id) {
    const task = data.tasks.get(id);
    if (!task) return Promise.resolve();
    return guarded(async () => {
      const projectId = await moveTaskDialog(task, data.projects);
      if (projectId && projectId !== task.projectId) await moveTask(data.db, id, projectId);
    });
  }

  /**
   * Deletes the task with its entries at once (no confirmation), with Undo in the notification
   * bar, like deleting a message.
   * @param {string} id
   */
  function remove(id) {
    const task = data.tasks.get(id);
    if (!task) return Promise.resolve();
    return guarded(async () => {
      const { snapshot } = await deleteTask(data.db, id, { cascade: true });
      offerUndo(t('taskDeleted', task.name), () => restore(snapshot));
    });
  }

  /** @param {TaskSnapshot} snapshot */
  function restore(snapshot) {
    return guarded(async () => {
      await restoreTask(data.db, snapshot);
    }).then(() => undefined);
  }

  /**
   * Runs a command by name (context menu).
   * @param {TaskCommand} command
   * @param {string} id
   * @param {{startRename: (id: string) => void}} ui
   */
  function run(command, id, ui) {
    const task = data.tasks.get(id);
    if (!task) return Promise.resolve();
    switch (command) {
      case 'timer':
        return toggleTimer(id);
      case 'edit':
        return edit(id);
      case 'rename':
        ui.startRename(id);
        return Promise.resolve();
      case 'star':
        return toggleStar(id);
      case 'done':
        return setDone(id, task.status !== 'done');
      case 'move':
        return move(id);
      case 'delete':
        return remove(id);
    }
    return Promise.resolve();
  }

  return { create, rename, toggleStar, toggleTimer, setDone, edit, move, remove, run };
}
