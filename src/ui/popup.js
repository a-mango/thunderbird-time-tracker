// Action popup (docs/DESIGN.md, Popup): the running timer with Stop and Split, a "Switch to…"
// field that fuzzy-searches open tasks (the 5 most recent when empty; Enter starts), and
// "Open Time Tracker". Closes after every action.
import { ensureSpace } from '../background/space.js';
import {
  CHANNEL_NAME,
  getRunning,
  getSettings,
  listProjects,
  listTasks,
  openDB,
  recentTasks,
} from '../db/index.js';
import { formatElapsed } from '../lib/format.js';
import { fuzzyFilter } from '../lib/fuzzy.js';
import { colorValue } from '../lib/palette.js';
import { isArchived, projectPathName } from '../lib/sidebar.js';
import { split, start, stop } from '../lib/timer.js';
import './components/tt-notification-bar.js';
import { applySettings } from './apply-settings.js';
import { createIdlePrompt } from './idle-prompt.js';
import { localize, t } from './i18n.js';
import { storageMessage } from './storage-errors.js';
import { el, icon } from './render.js';

/**
 * @typedef {import('../lib/types.js').Task} Task
 * @typedef {import('../lib/types.js').Project} Project
 * @typedef {import('../lib/types.js').Entry} Entry
 */

const RECENT = 5;
const MATCHES = 8;
const SECOND_MS = 1000;

/** @param {string} name */
const ref = (name) => /** @type {HTMLElement} */ (document.querySelector(`[data-ref="${name}"]`));
const field = /** @type {HTMLInputElement} */ (ref('field'));
const list = ref('list');

/** @type {IDBDatabase} */
let db;
/** @type {Project[]} */
let projects = [];
/** @type {Map<string, Task>} */
let tasks = new Map();
/** @type {Entry | null} */
let running = null;
/** @type {Task[]} */
let recent = [];
/** Tasks the list shows, and the highlighted one. */
/** @type {Task[]} */
let shown = [];
let active = 0;
let busy = false;

/** A task the field can start: open, in an active project, not the running one. */
/** @param {Task} task */
const switchable = (task) =>
  task.status === 'open' &&
  task.id !== running?.taskId &&
  projects.some((p) => p.id === task.projectId) &&
  !isArchived(projects, task.projectId);

async function load() {
  const [projectList, taskList, entry, settings] = await Promise.all([
    listProjects(db),
    listTasks(db),
    getRunning(db),
    getSettings(db),
  ]);
  projects = projectList;
  tasks = new Map(taskList.map((task) => [task.id, task]));
  running = entry;
  applySettings(settings);
  recent = await recentTasks(db, { limit: RECENT, accept: switchable });
}

function renderTimer() {
  const task = running ? tasks.get(running.taskId) : undefined;
  ref('timer').hidden = !task;
  ref('idle').hidden = Boolean(task);
  ref('timer').classList.toggle('running', Boolean(task));
  ref('switch-label').textContent = t(task ? 'popupSwitchTo' : 'popupStart');
  if (!task || !running) return;
  ref('task').textContent = task.name;
  ref('project').textContent = projectPathName(projects, task.projectId, ' › ');
  tick();
}

function tick() {
  if (running) ref('elapsed').textContent = formatElapsed(Date.now() - running.start);
}

/** @param {Task} task @param {number} index */
function option(task, index) {
  const folder = icon('folder');
  const project = projects.find((p) => p.id === task.projectId);
  if (project) folder.style.setProperty('--icon-color', colorValue(project.color));
  return el(
    'li',
    {
      class: 'popup-option',
      id: `switch-option-${index}`,
      attrs: { role: 'option', 'aria-selected': String(index === active) },
      on: {
        // Keep focus in the field; the click starts the task.
        mousedown: (event) => event.preventDefault(),
        click: () => startTask(task.id),
        // Hover and the keyboard move the same highlight, like Thunderbird's autocomplete.
        mousemove: () => index !== active && setActive(index),
      },
    },
    folder,
    el(
      'span',
      { class: 'popup-option-text' },
      el('span', { class: 'popup-option-name', text: task.name }),
      el('span', {
        class: 'popup-option-path',
        text: projectPathName(projects, task.projectId, ' › '),
      }),
    ),
  );
}

function renderList() {
  const query = field.value.trim();
  shown = query
    ? fuzzyFilter([...tasks.values()].filter(switchable), query, (task) => ({
        primary: task.name,
        secondary: projectPathName(projects, task.projectId, ' › '),
      })).slice(0, MATCHES)
    : recent.filter(switchable);
  active = Math.min(active, Math.max(0, shown.length - 1));
  ref('list-label').textContent = t(query ? 'popupMatching' : 'popupRecent');
  list.replaceChildren(...shown.map(option));
  list.hidden = shown.length === 0;
  const empty = ref('empty');
  empty.hidden = shown.length > 0;
  empty.textContent = t(query ? 'popupNoMatch' : 'popupNoRecent');
  if (shown.length > 0) field.setAttribute('aria-activedescendant', `switch-option-${active}`);
  else field.removeAttribute('aria-activedescendant');
  field.setAttribute('aria-expanded', String(shown.length > 0));
}

/** @param {number} index */
function setActive(index) {
  if (shown.length === 0) return;
  active = (index + shown.length) % shown.length;
  for (const [i, item] of [...list.children].entries()) {
    item.setAttribute('aria-selected', String(i === active));
  }
  field.setAttribute('aria-activedescendant', `switch-option-${active}`);
  list.children[active]?.scrollIntoView({ block: 'nearest' });
}

/** Runs one action, then closes the popup; an error stays visible instead. */
/** @param {() => Promise<unknown>} action */
async function act(action) {
  if (busy) return;
  busy = true;
  ref('error').textContent = '';
  try {
    await action();
    window.close();
  } catch (error) {
    console.error('time tracker: popup action failed', error);
    ref('error').textContent = storageMessage(error, 'write').message;
  } finally {
    busy = false;
  }
}

/** @param {string} id */
const startTask = (id) => act(() => start(db, id));

field.addEventListener('input', () => {
  active = 0;
  renderList();
});
field.addEventListener('keydown', (event) => {
  // Enter that confirms an IME composition doesn't start a task.
  if (event.isComposing) return;
  if (event.key === 'ArrowDown') setActive(active + 1);
  else if (event.key === 'ArrowUp') setActive(active - 1);
  else if (event.key === 'Home' && shown.length && !field.value) setActive(0);
  else if (event.key === 'End' && shown.length && !field.value) setActive(shown.length - 1);
  else if (event.key === 'Enter') {
    const task = shown[active];
    if (task) startTask(task.id);
  } else return;
  event.preventDefault();
});
ref('stop').addEventListener('click', () => act(() => stop(db)));
ref('split').addEventListener('click', () => act(() => split(db, Date.now())));
const openTracker = async () => {
  const space = await ensureSpace();
  await messenger.spaces.open(space.id);
};
ref('open').addEventListener('click', () => act(openTracker));

async function main() {
  localize();
  field.placeholder = t('popupSearchPlaceholder');
  field.before(icon('search'));
  document.title = t('popupHeading');
  try {
    db = await openDB();
    await load();
  } catch (error) {
    console.error('time tracker: opening the database failed', error);
    ref('error').textContent = storageMessage(error, 'open').message;
    // Nothing to show or switch to; Open Time Tracker still works.
    ref('timer').hidden = true;
    /** @type {HTMLElement} */ (document.querySelector('.popup-switch')).hidden = true;
    document.documentElement.dataset.ready = '';
    return;
  }
  renderTimer();
  renderList();
  field.focus();
  // The idle prompt. Assign to… needs the task picker: the tracker tab shows the same prompt.
  const idlePrompt = createIdlePrompt({
    db,
    bar: /** @type {import('./components/tt-notification-bar.js').TtNotificationBar} */ (
      ref('idle-prompt')
    ),
    assign: async () => {
      await act(openTracker);
      return null;
    },
    onError: (error) => {
      console.error('time tracker: popup action failed', error);
      ref('error').textContent = storageMessage(error, 'write').message;
    },
    onResolved: () => window.close(),
    assignLabel: t('idleAssignInTracker'),
  });
  await idlePrompt.refresh();
  // Writes from other pages (or the background) while the popup is open.
  if (typeof BroadcastChannel === 'function') {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = async () => {
      await load();
      renderTimer();
      renderList();
      await idlePrompt.refresh();
    };
  }
  setInterval(tick, SECOND_MS);
  document.documentElement.dataset.ready = '';
}

main();
