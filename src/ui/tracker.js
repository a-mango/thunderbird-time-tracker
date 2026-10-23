// Tracker tab (docs/DESIGN.md, Layout A): the three-pane shell. The project pane is live; the
// task list (M4) and details (M5) panes are placeholders.
import './components/index.js';
import { formatDuration } from '../lib/format.js';
import { installContextMenu } from './context-menu.js';
import { localize, t } from './i18n.js';
import { createProjectCommands } from './project-commands.js';
import { createSidebar } from './sidebar.js';
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
 * List pane header: the selected project (name, open tasks in it, total with subprojects) or view.
 * @param {TrackerData} data
 * @param {Selection} selection
 */
function renderListHeader(data, selection) {
  const title = ref('list-title');
  const count = ref('list-count');
  const project = selection.tree === 'projects' ? data.project(selection.id) : undefined;
  if (project) {
    const open = [...data.tasks.values()].filter(
      (task) => task.projectId === project.id && task.status === 'open',
    ).length;
    title.textContent = project.name;
    count.textContent = t(
      'listSummary',
      String(open),
      formatDuration(data.rollup.project(project.id).total, {
        format: data.settings.durationFormat,
      }),
    );
    return;
  }
  const VIEW_LABELS = /** @type {Record<string, string>} */ ({
    today: 'viewToday',
    week: 'viewThisWeek',
    starred: 'viewStarred',
  });
  title.textContent = t(VIEW_LABELS[selection.id] ?? 'projectArchive');
  count.textContent = '';
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
  sidebar = createSidebar({
    data,
    run: commands.run,
    drop: commands.drop,
    onSelect: (selection) => renderListHeader(data, selection),
  });
  installContextMenu({ tree: sidebar.projectsTree, data, run: commands.run });

  data.addEventListener('change', (event) => {
    const { types } = /** @type {CustomEvent} */ (event).detail;
    if (types.has('settings')) applySettings(data.settings);
    sidebar.render();
    renderListHeader(data, sidebar.selection);
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
    // Ctrl+Shift+N: new project (docs/SPEC.md, Keyboard).
    if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === 'KeyN') {
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      commands.run('new', null);
    }
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
