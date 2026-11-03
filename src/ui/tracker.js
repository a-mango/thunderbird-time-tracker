// Tracker tab (docs/DESIGN.md, Layout A): the three-pane shell with the project pane, the task
// list and the details pane.
import './components/index.js';
import { applySettings } from './apply-settings.js';
import { installContextMenu } from './context-menu.js';
import { createDataCommands } from './data-commands.js';
import { createDetail } from './detail.js';
import { createEntryCommands } from './entry-commands.js';
import { showMenu } from './menu.js';
import { localize, t } from './i18n.js';
import { commandsFor, createProjectCommands, projectPlace } from './project-commands.js';
import { settingsDialog } from './settings-dialog.js';
import { storageMessage } from './storage-errors.js';
import { createSidebar } from './sidebar.js';
import { createTaskCommands } from './task-commands.js';
import { createTaskList } from './task-list.js';
import { TrackerData } from './tracker-data.js';
import { timerTransition } from '../lib/timer.js';

/**
 * @typedef {import('./components/tt-notification-bar.js').TtNotificationBar} TtNotificationBar
 * @typedef {import('./sidebar.js').Selection} Selection
 */

/** Badges and totals advance once a minute while a timer runs, like the background's alarm. */
const TICK_MS = 60_000;
/** The detail pane's running time ticks every second (only while the page is visible). */
const SECOND_MS = 1000;

/** @param {string} name */
const ref = (name) => /** @type {HTMLElement} */ (document.querySelector(`[data-ref="${name}"]`));
const notification = /** @type {TtNotificationBar} */ (ref('notification'));

/**
 * A storage failure as an error bar with its recovery hint (and Reload where that helps).
 * @param {unknown} error
 * @param {'open' | 'write'} phase
 */
function showStorageError(error, phase) {
  const { message, reload } = storageMessage(error, phase);
  notification.show({
    type: 'error',
    message,
    actions: reload ? [{ label: t('notificationReload'), onClick: () => location.reload() }] : [],
  });
}

/** @param {unknown} error */
function showError(error) {
  console.error('time tracker: write failed', error);
  showStorageError(error, 'write');
}

/**
 * What the task list shows for a sidebar selection: a view, a project, or nothing (Archive root).
 * @param {TrackerData} data
 * @param {Selection} selection
 * @returns {import('../lib/task-list.js').TaskScope | null}
 */
function scopeOf(data, selection) {
  if (selection.tree === 'views') {
    return { type: 'view', id: /** @type {'today' | 'week' | 'starred'} */ (selection.id) };
  }
  return data.project(selection.id) ? { type: 'project', id: selection.id } : null;
}

/** Polite live region (timer start and stop). @param {string} text */
function announce(text) {
  const live = ref('live');
  live.textContent = '';
  requestAnimationFrame(() => {
    live.textContent = text;
  });
}

async function main() {
  // Cold-open timing (tests/ui/perf-large.spec.js): tt-start → tt-ready.
  performance.mark('tt-start');
  localize();
  /** @type {TrackerData} */
  let data;
  try {
    data = await TrackerData.open();
  } catch (error) {
    console.error('time tracker: opening the database failed', error);
    showStorageError(error, 'open');
    notification.setAttribute('persistent', '');
    // Only the error bar and the tab's name: the empty panes would offer nothing that works.
    ref('list-title').textContent = t('extensionName');
    const list = /** @type {HTMLElement} */ (document.getElementById('list'));
    for (const pane of document.querySelectorAll('.tracker > *')) {
      if (pane !== list) /** @type {HTMLElement} */ (pane).hidden = true;
    }
    const title = ref('list-title');
    for (const part of [...list.children, ...(title.parentElement?.children ?? [])]) {
      if (part !== notification && part !== title && !part.contains(title)) {
        /** @type {HTMLElement} */ (part).hidden = true;
      }
    }
    document.documentElement.dataset.ready = '';
    return;
  }
  applySettings(data.settings);

  /** @type {ReturnType<typeof createSidebar>} */
  let sidebar;
  const commands = createProjectCommands({
    data,
    reveal: (id) => sidebar.reveal(id),
    onError: showError,
  });
  /** @param {string} message @param {() => Promise<void>} undo */
  const offerUndo = (message, undo) =>
    notification.show({
      type: 'info',
      message,
      actions: [
        {
          label: t('undo'),
          onClick: () => {
            notification.dismiss();
            undo();
          },
        },
      ],
    });
  const taskCommands = createTaskCommands({ data, onError: showError, offerUndo });
  const entryCommands = createEntryCommands({ data, onError: showError, offerUndo });
  const taskList = createTaskList({ data, commands: taskCommands });
  const addEntryButton = /** @type {HTMLButtonElement} */ (ref('add-entry'));
  const detail = createDetail({
    data,
    root: ref('detail'),
    taskCommands,
    entryCommands,
    moreTask: async (id, anchor) => {
      const task = data.tasks.get(id);
      if (!task) return;
      const value = await showMenu(anchor, [
        { label: t(task.starred ? 'menuTaskUnstar' : 'menuTaskStar'), value: 'star' },
        { label: t('menuTaskRename'), value: 'rename' },
        { label: t('menuTaskMove'), value: 'move' },
        'separator',
        { label: t('menuTaskDelete'), value: 'delete' },
      ]);
      if (value) {
        taskCommands.run(
          /** @type {import('./task-commands.js').TaskCommand} */ (value),
          id,
          taskList,
        );
      }
    },
  });
  /** The detail pane follows the task list's selection. */
  const syncDetail = () => {
    detail.show(taskList.selectedId);
    addEntryButton.disabled = detail.taskId === null;
  };
  taskList.table.addEventListener('tt-select', syncDetail);
  const addEntry = () => {
    if (detail.taskId) entryCommands.add(detail.taskId);
  };
  addEntryButton.addEventListener('click', addEntry);
  const newTaskButton = /** @type {HTMLButtonElement} */ (ref('new-task'));

  /** The project New Task adds to: the selected project, if it is active. */
  const newTaskProject = () => {
    const selection = sidebar.selection;
    if (selection.tree !== 'projects' || !data.project(selection.id)) return null;
    return commandsFor(projectPlace(data.projects, selection.id)).includes('new-sub')
      ? selection.id
      : null;
  };
  const syncNewTask = () => {
    newTaskButton.disabled = newTaskProject() === null;
  };
  const newTask = async () => {
    const projectId = newTaskProject();
    if (!projectId) return;
    const task = await taskCommands.create(projectId);
    if (task) taskList.startRename(task.id);
  };
  newTaskButton.addEventListener('click', newTask);

  const dataCommands = createDataCommands({ data });
  /** @param {import('./data-commands.js').DataMessage | null} message */
  const showDataMessage = (message) => {
    if (message) notification.show({ type: message.type, message: message.text });
  };
  sidebar = createSidebar({
    data,
    run: commands.run,
    drop: commands.drop,
    openSettings: () => settingsDialog({ data, commands: dataCommands, onError: showError }),
    exportCsv: () => dataCommands.exportCsv().then(showDataMessage, showError),
    onSelect: (selection) => {
      taskList.setScope(scopeOf(data, selection));
      syncDetail();
      if (sidebar) syncNewTask();
    },
  });
  syncNewTask();
  installContextMenu({
    tree: sidebar.projectsTree,
    table: taskList.table,
    taskAt: (element) => taskList.taskAt(element),
    data,
    run: commands.run,
    runTask: (command, id) => taskCommands.run(command, id, taskList),
    focusTask: (id) => taskList.focusTask(id),
    entries: detail.list,
    entryAt: (element) => detail.entryAt(element),
    runEntry: (command, id) => entryCommands.run(command, id),
    focusEntry: (id) => detail.focusEntry(id),
  });

  let showDone = data.settings.showDone;
  // Timer start and stop are announced whatever started them: this tab, the popup, the shortcut.
  let running = data.running;
  /** The running task's name, kept for "stopped" when the task was deleted with its timer. */
  let runningName = running ? (data.tasks.get(running.taskId)?.name ?? '') : '';
  data.addEventListener('change', (event) => {
    const { types } = /** @type {CustomEvent} */ (event).detail;
    const transition = timerTransition(running, data.running);
    if (transition?.type === 'started') {
      announce(t('timerStarted', data.tasks.get(transition.taskId)?.name ?? ''));
    } else if (transition) {
      announce(t('timerStopped', data.tasks.get(transition.taskId)?.name ?? runningName));
    }
    running = data.running;
    runningName = running ? (data.tasks.get(running.taskId)?.name ?? '') : '';
    if (types.has('settings')) {
      applySettings(data.settings);
      if (data.settings.showDone !== showDone) {
        showDone = data.settings.showDone;
        taskList.applyShowDone();
      }
    }
    sidebar.render();
    taskList.render();
    syncNewTask();
    detail.update(types);
    syncDetail();
  });
  data.addEventListener('closed', () => {
    notification.setAttribute('persistent', '');
    notification.show({
      type: 'warning',
      message: t('dbUpgraded'),
      actions: [{ label: t('notificationReload'), onClick: () => location.reload() }],
    });
  });

  document.addEventListener('keydown', (event) => {
    if (document.querySelector('dialog[open]') || event.altKey || event.metaKey) return;
    if (!event.ctrlKey) return;
    // docs/SPEC.md, Keyboard: Ctrl+Shift+N new project, Ctrl+N new task, Ctrl+Shift+K filter,
    // Ctrl+E add a time entry.
    if (event.shiftKey && event.code === 'KeyN') commands.run('new', null);
    else if (!event.shiftKey && event.code === 'KeyN') newTask();
    else if (!event.shiftKey && event.code === 'KeyE') addEntry();
    else if (event.shiftKey && event.code === 'KeyK') taskList.focusFilter();
    else return;
    event.preventDefault();
  });

  /** @type {ReturnType<typeof setInterval> | undefined} */
  let ticker;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let secondTicker;
  const syncTicker = () => {
    clearInterval(ticker);
    clearInterval(secondTicker);
    const visible = document.visibilityState === 'visible';
    ticker = visible ? setInterval(() => data.tick(), TICK_MS) : undefined;
    secondTicker = visible ? setInterval(() => detail.tick(), SECOND_MS) : undefined;
    if (visible) data.tick();
  };
  document.addEventListener('visibilitychange', syncTicker);
  syncTicker();
  performance.mark('tt-ready');
  document.documentElement.dataset.ready = '';
}

main();
