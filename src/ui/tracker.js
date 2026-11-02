// Tracker tab (docs/DESIGN.md, Layout A): the three-pane shell with the project pane and the task
// list. The details pane (M5) is a placeholder.
import './components/index.js';
import { installContextMenu } from './context-menu.js';
import { localize, t } from './i18n.js';
import { commandsFor, createProjectCommands, projectPlace } from './project-commands.js';
import { createSidebar } from './sidebar.js';
import { createTaskCommands } from './task-commands.js';
import { createTaskList } from './task-list.js';
import { TrackerData } from './tracker-data.js';

/**
 * @typedef {import('./components/tt-notification-bar.js').TtNotificationBar} TtNotificationBar
 * @typedef {import('./sidebar.js').Selection} Selection
 */

/** Badges advance while a timer runs; Thunderbird's own tick is a minute (alarms, M5). */
const TICK_MS = 60_000;

/** @param {string} name */
const ref = (name) => /** @type {HTMLElement} */ (document.querySelector(`[data-ref="${name}"]`));
const notification = /** @type {TtNotificationBar} */ (ref('notification'));

/** @param {import('../lib/types.js').Settings} settings */
function applySettings(settings) {
  const root = document.documentElement;
  if (settings.density === 'default') delete root.dataset.density;
  else root.dataset.density = settings.density;
  if (settings.accent === 'system') delete root.dataset.accent;
  else root.dataset.accent = settings.accent;
}

/** @param {unknown} error */
function showError(error) {
  console.error('time tracker: write failed', error);
  notification.show({ type: 'error', message: t('errorSave') });
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
  localize();
  /** @type {TrackerData} */
  let data;
  try {
    data = await TrackerData.open();
  } catch (error) {
    console.error('time tracker: opening the database failed', error);
    notification.show({ type: 'error', message: t('trackerLoadError') });
    notification.setAttribute('persistent', '');
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
  const taskCommands = createTaskCommands({
    data,
    onError: showError,
    announce,
    offerUndo: (message, undo) =>
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
      }),
  });
  const taskList = createTaskList({ data, commands: taskCommands });
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

  sidebar = createSidebar({
    data,
    run: commands.run,
    drop: commands.drop,
    onSelect: (selection) => {
      taskList.setScope(scopeOf(data, selection));
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
  });

  data.addEventListener('change', (event) => {
    const { types } = /** @type {CustomEvent} */ (event).detail;
    if (types.has('settings')) applySettings(data.settings);
    sidebar.render();
    taskList.render();
    syncNewTask();
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
    // docs/SPEC.md, Keyboard: Ctrl+Shift+N new project, Ctrl+N new task, Ctrl+Shift+K filter.
    if (event.shiftKey && event.code === 'KeyN') commands.run('new', null);
    else if (!event.shiftKey && event.code === 'KeyN') newTask();
    else if (event.shiftKey && event.code === 'KeyK') taskList.focusFilter();
    else return;
    event.preventDefault();
  });

  /** @type {ReturnType<typeof setInterval> | undefined} */
  let ticker;
  const syncTicker = () => {
    clearInterval(ticker);
    ticker = document.hidden ? undefined : setInterval(() => data.tick(), TICK_MS);
    if (!document.hidden) data.tick();
  };
  document.addEventListener('visibilitychange', syncTicker);
  syncTicker();
  document.documentElement.dataset.ready = '';
}

main();
