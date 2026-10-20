// Primitives gallery (dev only): every primitive in its states, plus reference A's project pane
// and task list built from the fixtures. Served at /dev/gallery.html by the dev harness and by
// the Thunderbird spike stage (scripts/tb-spike.mjs); both serve src/ at / and dev/ at /dev/.
import '../ui/components/index.js';
import { TtDialog } from '../ui/components/tt-dialog.js';
import { el, icon } from '../ui/render.js';
import { formatDuration, formatElapsed, NO_VALUE } from '../lib/format.js';
import { generateFixtures } from './fixtures.js';

/** @typedef {import('./fixtures.js').Project} Project */
/** @typedef {import('./fixtures.js').Task} Task */
/** @typedef {import('../ui/components/tt-tree.js').TreeNode} TreeNode */
/** @typedef {import('../ui/components/tt-tree.js').TtTree} TtTree */
/** @typedef {import('../ui/components/tt-table.js').TtTable<TaskRow>} TaskTable */
/** @typedef {import('../ui/components/tt-splitter.js').TtSplitter} TtSplitter */

const t = (/** @type {string} */ name, /** @type {string[]} */ ...subs) =>
  messenger.i18n.getMessage(name, subs);

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// Fixed clock so shots are stable: Tue 20 Oct 2026, 14:45 local, like reference A.
const NOW = new Date(2026, 9, 20, 14, 45).getTime();

// ---- Page controls: ?density= and ?accent= ----
const params = new URLSearchParams(location.search);
for (const name of ['density', 'accent']) {
  const value = params.get(name) ?? '';
  const select = /** @type {HTMLSelectElement} */ (
    document.querySelector(`[data-control="${name}"]`)
  );
  select.value = value;
  if (value) document.documentElement.dataset[name] = value;
  select.addEventListener('change', () => {
    if (select.value) document.documentElement.dataset[name] = select.value;
    else delete document.documentElement.dataset[name];
    const url = new URL(location.href);
    if (select.value) url.searchParams.set(name, select.value);
    else url.searchParams.delete(name);
    history.replaceState(null, '', url);
  });
}

for (const node of document.querySelectorAll('[data-i18n]')) {
  node.textContent = t(/** @type {HTMLElement} */ (node).dataset.i18n ?? '');
}
for (const node of document.querySelectorAll('[data-i18n-label]')) {
  node.setAttribute('aria-label', t(/** @type {HTMLElement} */ (node).dataset.i18nLabel ?? ''));
}

/** @param {string} name */
const slot = (name) => /** @type {HTMLElement} */ (document.querySelector(`[data-slot="${name}"]`));

// ---- Data from fixtures ----
const { projects, tasks, entries } = generateFixtures({ now: NOW });
const today = new Date(NOW);
today.setHours(0, 0, 0, 0);
const weekStart = new Date(today);
weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));

/**
 * @typedef {Task & {total: number, week: number, today: number, last: number | null,
 *   running: boolean}} TaskRow
 */
/** @type {Map<string, TaskRow>} */
const rowsById = new Map(
  tasks.map((task) => [
    task.id,
    { ...task, total: 0, week: 0, today: 0, last: null, running: false },
  ]),
);
for (const entry of entries) {
  const row = /** @type {TaskRow} */ (rowsById.get(entry.taskId));
  const end = entry.end ?? NOW;
  const ms = end - entry.start;
  row.total += ms;
  if (entry.start >= weekStart.getTime()) row.week += ms;
  if (entry.start >= today.getTime()) row.today += ms;
  if (entry.end === null) row.running = true;
  row.last = Math.max(row.last ?? 0, end);
}
const rows = [...rowsById.values()];
const runningTask = rows.find((r) => r.running);

/** @type {Map<string | null, Project[]>} */
const childrenOf = new Map();
for (const project of projects) {
  childrenOf.set(project.parentId, [...(childrenOf.get(project.parentId) ?? []), project]);
}
/** @param {string} id @returns {number} own tasks plus all descendants */
const rollup = (id) =>
  rows.filter((r) => r.projectId === id).reduce((sum, r) => sum + r.total, 0) +
  (childrenOf.get(id) ?? []).reduce((sum, p) => sum + rollup(p.id), 0);
const projectById = new Map(projects.map((p) => [p.id, p]));
/** Running project and its ancestors. */
const runningPath = new Set();
for (let id = runningTask?.projectId ?? null; id; id = projectById.get(id)?.parentId ?? null) {
  runningPath.add(id);
}

// ---- Project pane ----
slot('new-task').append(icon('add'), el('span', { text: t('sidebarNewTask') }));
for (const [name, iconName, label] of /** @type {const} */ ([
  ['add-entry', 'clock', 'sidebarAddEntry'],
  ['sidebar-more', 'more', 'sidebarMore'],
])) {
  slot(name).append(icon(iconName));
  slot(name).setAttribute('aria-label', t(label));
  slot(name).title = t(label);
}
slot('projects-more').append(icon('kebab'));
slot('projects-more').setAttribute('aria-label', t('modeOptions', t('modeProjects')));

const viewsTree = /** @type {TtTree} */ (document.getElementById('views-tree'));
const VIEWS = [
  {
    id: 'today',
    label: t('viewToday'),
    icon: 'calendar-today',
    badge: formatDuration(rows.reduce((s, r) => s + r.today, 0)),
  },
  {
    id: 'week',
    label: t('viewThisWeek'),
    icon: 'calendar',
    badge: formatDuration(rows.reduce((s, r) => s + r.week, 0)),
  },
  {
    id: 'starred',
    label: t('viewStarred'),
    icon: 'star',
    badge: String(rows.filter((r) => r.starred && r.status === 'open').length),
  },
];
viewsTree.renderRow = (node, content) => {
  const view = /** @type {(typeof VIEWS)[number]} */ (VIEWS.find((v) => v.id === node.id));
  content.append(
    icon(view.icon, { class: `view-icon ${view.id}` }),
    el('span', { class: 'name', text: node.label }),
    el('span', { class: 'count-badge num', text: view.badge }),
  );
};
viewsTree.setItems(VIEWS.map(({ id, label }) => ({ id, label })));

const projectsTree = /** @type {TtTree} */ (document.getElementById('projects-tree'));
/** @param {string | null} parentId @returns {TreeNode[]} */
const projectNodes = (parentId) =>
  (childrenOf.get(parentId) ?? [])
    .sort((a, b) => a.order - b.order)
    .map((p) => ({ id: p.id, label: p.name, expanded: true, children: projectNodes(p.id) }));
const ARCHIVE = { id: 'archive', label: t('projectArchive') };
projectsTree.renderRow = (node, content) => {
  const li = /** @type {HTMLElement} */ (content.closest('li'));
  const project = projectById.get(node.id);
  li.classList.toggle('root', !project?.parentId);
  li.classList.toggle('muted', node.id === ARCHIVE.id);
  li.classList.toggle('running', node.id === runningTask?.projectId);
  const folder = icon('folder');
  if (project) folder.style.setProperty('--icon-color', project.color);
  content.append(folder, el('span', { class: 'name', text: node.label }));
  if (!project) return;
  const badge = el('span', { class: 'count-badge num', text: formatDuration(rollup(node.id)) });
  if (node.id === runningTask?.projectId) badge.classList.add('new');
  else if (runningPath.has(node.id) && !projectsTree.isExpanded(node.id))
    badge.classList.add('outlined');
  content.append(badge);
};
projectsTree.setItems([...projectNodes(null), ARCHIVE]);
const selectedProject = /** @type {Project} */ (projects.find((p) => p.name === 'Build'));
projectsTree.selectedId = selectedProject.id;

// ---- Task list ----
const projectRows = rows.filter((r) => r.projectId === selectedProject.id);
const openRows = projectRows.filter((r) => r.status === 'open');
/** @type {HTMLElement} */ (document.getElementById('list-title')).textContent =
  selectedProject.name;
/** @type {HTMLElement} */ (document.querySelector('.list-count')).textContent = t(
  'listSummary',
  String(openRows.length),
  formatDuration(rollup(selectedProject.id)),
);
slot('quick-filter').append(icon('filter'), el('span', { text: t('listQuickFilter') }));
slot('display-options').append(icon('display-options'));
slot('display-options').setAttribute('aria-label', t('listDisplayOptions'));
slot('display-options').title = t('listDisplayOptions');
slot('done-hidden').textContent = t('doneHidden', String(projectRows.length - openRows.length));

const qfb = slot('qfb');
for (const [label, iconName, pressed] of /** @type {const} */ ([
  ['filterOpen', 'check', true],
  ['filterStarred', 'star', false],
  ['filterBillable', null, false],
  ['filterTags', 'tag', false],
])) {
  const button = el(
    'button',
    { class: 'button small toggle', type: 'button', attrs: { 'aria-pressed': String(pressed) } },
    iconName ? icon(iconName) : null,
    el('span', { text: t(label) }),
  );
  button.addEventListener('click', () =>
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')),
  );
  qfb.append(button);
}
qfb.append(searchField());

/** Estimate label: whole hours as `20h`, otherwise like durations. @param {number} minutes */
const formatEstimate = (minutes) =>
  minutes % 60 === 0 ? `${minutes / 60}h` : formatDuration(minutes * MINUTE);

const locale = messenger.i18n.getUILanguage();
const timeFormat = new Intl.DateTimeFormat(locale, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short' });
const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
/** Message-list style dates: `Today 10:25`, `Mon 17:30`, `16 Oct`. @param {number} ms */
function formatLast(ms) {
  if (ms >= today.getTime()) return `${t('viewToday')} ${timeFormat.format(ms)}`;
  if (ms >= today.getTime() - 6 * DAY) {
    return `${weekdayFormat.format(ms)} ${timeFormat.format(ms)}`;
  }
  return dayFormat.format(ms);
}

const ICON_WIDTH = 'var(--table-header-cell-icon-width)';
const byNumber =
  (/** @type {(r: TaskRow) => number} */ get) =>
  (/** @type {TaskRow} */ a, /** @type {TaskRow} */ b) =>
    get(a) - get(b);
const table = /** @type {TaskTable} */ (document.getElementById('tasks-table'));
table.setAttribute('label', t('tasksLabel'));
table.columns = [
  {
    id: 'starred',
    label: t('columnStarred'),
    icon: 'star',
    width: ICON_WIDTH,
    compare: byNumber((r) => Number(!r.starred)),
  },
  { id: 'timer', label: t('columnTimer'), icon: 'clock', width: ICON_WIDTH },
  {
    id: 'name',
    label: t('columnTask'),
    required: true,
    compare: (a, b) => a.name.localeCompare(b.name, locale),
  },
  { id: 'week', label: t('columnWeek'), width: 80, align: 'end', compare: byNumber((r) => r.week) },
  {
    id: 'total',
    label: t('columnTotal'),
    width: 80,
    align: 'end',
    compare: byNumber((r) => r.total),
  },
  {
    id: 'estimate',
    label: t('columnEstimate'),
    width: 110,
    compare: byNumber((r) => r.estimateMin ?? -1),
  },
  { id: 'last', label: t('columnLastTracked'), width: 110, compare: byNumber((r) => r.last ?? 0) },
];
table.renderRow = (row, tr) => tr.classList.toggle('running', row.running);
table.renderCell = (row, column, cell) => {
  switch (column.id) {
    case 'starred':
      cell.append(
        icon('star', {
          class: row.starred ? 'star starred' : 'star',
          label: row.starred ? t('columnStarred') : undefined,
        }),
      );
      break;
    case 'timer':
      cell.append(
        row.running
          ? icon('clock', { class: 'timer running', label: t('taskRunning') })
          : icon('nav-right', { class: 'timer' }),
      );
      break;
    case 'name':
      cell.textContent = row.name;
      break;
    case 'week':
      cell.textContent = row.week ? formatDuration(row.week) : NO_VALUE;
      break;
    case 'total':
      cell.textContent = row.total ? formatDuration(row.total) : NO_VALUE;
      break;
    case 'estimate': {
      if (row.estimateMin === null) {
        cell.textContent = NO_VALUE;
        break;
      }
      const ratio = row.total / (row.estimateMin * MINUTE);
      const meter = el('span', { class: ratio > 1 ? 'meter over' : 'meter' }, el('span'));
      meter.style.setProperty('--value', `${Math.min(100, Math.round(ratio * 100))}%`);
      cell.append(
        el(
          'span',
          { class: ratio > 1 ? 'estimate over' : 'estimate' },
          meter,
          el('span', { class: 'num', text: formatEstimate(row.estimateMin) }),
        ),
      );
      break;
    }
    case 'last':
      cell.textContent = row.running
        ? t('lastTrackedRunning')
        : row.last
          ? formatLast(row.last)
          : t('lastTrackedNever');
      break;
  }
};
table.rows = openRows;
if (runningTask) table.selectedKey = runningTask.id;

// ---- Primitive cards ----
/** @param {string} title @param {...(Node | null)} content */
function card(title, ...content) {
  const id = `card-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return el(
    'section',
    { class: 'card', attrs: { 'aria-labelledby': id } },
    el('h3', { id, text: title }),
    el('div', { class: 'card-body' }, ...content),
  );
}

function searchField() {
  return el(
    'div',
    { class: 'search-field' },
    icon('search'),
    el('input', {
      class: 'field',
      type: 'search',
      placeholder: t('filterPlaceholder'),
      attrs: { 'aria-label': t('filterLabel') },
    }),
    el('kbd', { text: t('filterShortcut') }),
  );
}

/** @param {string} label @param {Record<string, unknown>} [props] @param {...Node} children */
const button = (label, props = {}, ...children) =>
  el(
    'button',
    { class: 'button', type: 'button', ...props },
    ...children,
    el('span', { text: label }),
  );
/** @param {string} name @param {string} label @param {Record<string, unknown>} [props] */
const iconButton = (name, label, props = {}) =>
  el(
    'button',
    {
      class: 'icon-button',
      type: 'button',
      title: label,
      attrs: { 'aria-label': label },
      ...props,
    },
    icon(name),
  );

const bars = el('div', { class: 'stack' });
const NOTIFICATIONS = /** @type {const} */ ([
  ['info', 'You were idle for 12 minutes. Keep the time?', ['Keep', 'Discard']],
  ['warning', 'This entry overlaps “Client call notes” by 10 minutes.', ['Adjust']],
  ['error', 'Could not save the entry. Try again.', ['Retry']],
  ['success', 'Backup exported.', []],
]);
for (const [type, message, actions] of NOTIFICATIONS) {
  const bar = /** @type {import('../ui/components/tt-notification-bar.js').TtNotificationBar} */ (
    document.createElement('tt-notification-bar')
  );
  bar.setAttribute('type', type);
  bar.setAttribute('message', message);
  bar.actions = actions.map((label) => ({ label, onClick: () => bar.dismiss() }));
  bars.append(bar);
}

const dialogResult = el('output', { class: 'muted', text: '' });
const splitterPane = el('div', { class: 'demo-pane', id: 'demo-pane', text: 'Pane' });

const iconNames = [
  'folder',
  'clock',
  'calendar',
  'calendar-today',
  'star',
  'tag',
  'add',
  'more',
  'kebab',
  'search',
  'filter',
  'display-options',
  'check',
  'pencil',
  'trash',
  'mail',
  'export',
  'settings',
  'nav-left',
  'nav-right',
  'close',
  'info',
  'warning',
  'error-circle',
];

slot('cards').append(
  card(
    'Buttons',
    button('Split'),
    button('Stop', { class: 'button primary' }),
    button('Delete', { class: 'button destructive' }),
    button('Edit', { class: 'button flat' }),
    button('Add Entry', { class: 'button small' }, icon('add')),
    button('Mark Done', { class: 'button small' }, icon('check')),
    button('Disabled', { disabled: true }),
  ),
  card(
    'Icon buttons',
    iconButton('add', 'Add'),
    iconButton('more', 'More'),
    iconButton('kebab', 'Options'),
    iconButton('settings', 'Settings'),
    iconButton('filter', 'Filter', { attrs: { 'aria-label': 'Filter', 'aria-pressed': 'true' } }),
    iconButton('display-options', 'Display options'),
    iconButton('trash', 'Delete', { disabled: true }),
  ),
  card(
    'Fields',
    el(
      'label',
      { class: 'field-row' },
      el('span', { text: 'Task name' }),
      el('input', { class: 'field', value: 'Checkout form validation' }),
    ),
    searchField(),
  ),
  card(
    'Pill toggles',
    ...['Open', 'Starred', 'Billable'].map((label, i) =>
      el(
        'button',
        {
          class: 'button small toggle',
          type: 'button',
          attrs: { 'aria-pressed': String(i === 0) },
        },
        el('span', { text: label }),
      ),
    ),
  ),
  card(
    'Count badges',
    el('span', { class: 'count-badge num', text: '8h 55m' }),
    el('span', { class: 'count-badge num new', text: '30h 45m' }),
    el('span', { class: 'count-badge num outlined', text: '51h 45m' }),
    el('span', { class: 'count-badge num', text: '2' }),
  ),
  card(
    'Chips and meters',
    ...[
      ['Implementation', '#ae55f7'],
      ['Frontend', '#25a6a0'],
      ['Billable', null],
    ].map(([label, color]) => {
      const chip = el('span', { class: 'chip', text: label ?? '' });
      if (color) {
        chip.dataset.color = '';
        chip.style.setProperty('--chip-color', color);
      }
      return chip;
    }),
    el(
      'span',
      { class: 'estimate' },
      el('span', { class: 'meter', style: { '--value': '72%' } }, el('span')),
      el('span', { class: 'num', text: '20h' }),
    ),
    el(
      'span',
      { class: 'estimate over' },
      el('span', { class: 'meter over', style: { '--value': '100%' } }, el('span')),
      el('span', { class: 'num', text: '4h' }),
    ),
    el('span', { class: 'num elapsed', text: formatElapsed(65 * MINUTE + 12_000) }),
  ),
  card('Notification bars', bars),
  card(
    'Dialog',
    button('Delete task…', {
      on: {
        click: async () => {
          const value = await TtDialog.show({
            heading: 'Delete “Performance pass”?',
            body: 'Its 4 time entries (4h 30m) are deleted too. You can undo this for 10 seconds.',
            buttons: [
              { label: 'Cancel', value: 'cancel' },
              { label: 'Delete', value: 'delete', primary: true, destructive: true },
            ],
          });
          dialogResult.textContent = `Result: ${value ?? 'cancelled'}`;
        },
      },
    }),
    dialogResult,
  ),
  card(
    'Splitter (height)',
    el(
      'div',
      { class: 'splitter-demo' },
      splitterPane,
      el('tt-splitter', {
        attrs: {
          controls: 'demo-pane',
          resize: 'height',
          min: 30,
          max: 150,
          'aria-label': 'Resize the demo pane',
        },
      }),
      el('div', { class: 'demo-pane rest', text: 'Rest' }),
    ),
  ),
  card(
    'Icons',
    el(
      'ul',
      { class: 'icon-grid' },
      ...iconNames.map((name) => el('li', {}, icon(name), el('span', { text: name }))),
    ),
  ),
);

// Like Thunderbird after selecting a folder: the message list has focus.
table.focusSelected();
document.documentElement.dataset.ready = '';
