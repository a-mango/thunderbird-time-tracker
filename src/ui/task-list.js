// The task list pane (docs/DESIGN.md, List pane): header, quick filter bar, the task table with
// its row actions, the done-tasks footer and the empty states.
import { NO_VALUE, formatDuration, formatEstimate, formatRelative } from '../lib/format.js';
import {
  defaultFilter,
  filterTasks,
  isFiltering,
  readFilter,
  scopeTasks,
  tagsOf,
} from '../lib/task-list.js';
import { t } from './i18n.js';
import { getLayout, setLayout } from './layout-store.js';
import { showMenu } from './menu.js';
import { el, icon } from './render.js';

/**
 * @typedef {import('./tracker-data.js').TrackerData} TrackerData
 * @typedef {import('../lib/types.js').Task} Task
 * @typedef {import('../lib/task-list.js').TaskScope} TaskScope
 * @typedef {import('../lib/task-list.js').TaskFilter} TaskFilter
 * @typedef {import('./components/tt-table.js').TtTable<Task>} TaskTable
 * @typedef {import('./components/tt-table.js').TableColumn<Task>} TaskColumn
 * @typedef {ReturnType<typeof import('./task-commands.js').createTaskCommands>} TaskCommands
 */

const MINUTE = 60_000;
const QFB_KEY = 'tracker.qfb';
const ICON_WIDTH = 'var(--table-header-cell-icon-width)';
const PILLS = /** @type {const} */ ([
  { id: 'open', label: 'filterOpen', icon: 'check' },
  { id: 'starred', label: 'filterStarred', icon: 'star' },
  { id: 'billable', label: 'filterBillable', icon: null },
  { id: 'tags', label: 'filterTags', icon: 'tag' },
]);
const VIEW_TITLES = { today: 'viewToday', week: 'viewThisWeek', starred: 'viewStarred' };
const VIEW_EMPTY = { today: 'emptyToday', week: 'emptyWeek', starred: 'emptyStarred' };

/** @param {TaskScope} scope */
const scopeKey = (scope) => `${scope.type}:${scope.id}`;

/**
 * @param {{data: TrackerData, commands: TaskCommands}} options
 */
export function createTaskList({ data, commands }) {
  /** @param {string} name */
  const ref = (name) => /** @type {HTMLElement} */ (document.querySelector(`[data-ref="${name}"]`));
  const table = /** @type {TaskTable} */ (ref('task-table'));
  const qfb = ref('qfb');
  const quickFilter = ref('quick-filter');
  const filterText = /** @type {HTMLInputElement} */ (ref('filter-text'));
  const tagBar = ref('qfb-tags');
  const locale = messenger.i18n.getUILanguage();

  /** @type {TaskScope | null} */
  let scope = null;
  /** @type {TaskFilter} */
  let filter = defaultFilter(data.settings.showDone);
  /** Selected task per scope (kept while switching between projects). */
  /** @type {Map<string, string>} */
  const selected = new Map();
  /** The task being renamed inline; table updates wait until it's done. */
  /** @type {string | null} */
  let editingId = null;
  let renderPending = false;
  /** @type {Task[]} the scope's tasks before filtering */
  let scoped = [];
  /** @type {'project' | 'view' | null} */
  let columnsFor = null;

  // ---- Header and quick filter bar ----
  quickFilter.prepend(icon('filter'));
  ref('display-options').append(icon('display-options'));
  filterText.placeholder = t('filterPlaceholder');
  filterText.before(icon('search'));
  table.setAttribute('label', t('tasksLabel'));

  /** @type {Record<string, HTMLButtonElement>} */
  const pills = {};
  for (const pill of PILLS) {
    const button = el(
      'button',
      { class: 'button small toggle', type: 'button', dataset: { pill: pill.id } },
      pill.icon ? icon(pill.icon) : null,
      el('span', { text: t(pill.label) }),
    );
    button.addEventListener('click', () => {
      if (pill.id === 'tags') setFilter({ tags: filter.tags === null ? [] : null });
      else setFilter({ [pill.id]: !filter[pill.id] });
    });
    pills[pill.id] = button;
    ref('qfb-pills').append(button);
  }
  filterText.addEventListener('input', () => setFilter({ text: filterText.value }, false));
  filterText.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && filterText.value) {
      event.preventDefault();
      event.stopPropagation();
      filterText.value = '';
      setFilter({ text: '' });
    } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
      event.preventDefault();
      table.focusSelected();
    }
  });

  quickFilter.addEventListener('click', () => setQuickFilterOpen(qfb.hidden === true));
  ref('display-options').addEventListener('click', async () => {
    const value = await showMenu(ref('display-options'), [
      { label: t('displayColumns'), value: 'columns', disabled: table.hidden === true },
      {
        label: t('displayShowDone'),
        value: 'done',
        checked: !filter.open,
        disabled: scope === null,
      },
    ]);
    if (value === 'done') setFilter({ open: !filter.open });
    else if (value === 'columns') table.openColumnPicker();
  });
  ref('show-done').addEventListener('click', () => setFilter({ open: false }));
  ref('clear-filter').addEventListener('click', () => {
    setFilter({ ...defaultFilter(data.settings.showDone), open: filter.open });
    table.focusSelected();
  });

  /** @param {boolean} open */
  function setQuickFilterOpen(open) {
    qfb.hidden = !open;
    quickFilter.setAttribute('aria-pressed', String(open));
    setLayout(QFB_KEY, open);
    // Closing the bar drops what it filters (the Open pill stays), so nothing hides unseen.
    if (!open && isFiltering(filter)) {
      setFilter({ ...defaultFilter(data.settings.showDone), open: filter.open });
    }
    render();
  }

  /** Ctrl+Shift+K: open the bar and focus the text filter. */
  function focusFilter() {
    if (qfb.hidden) setQuickFilterOpen(true);
    filterText.focus();
    filterText.select();
  }

  /**
   * @param {Partial<TaskFilter>} patch
   * @param {boolean} [syncText] write `filter.text` back into the field
   */
  function setFilter(patch, syncText = true) {
    filter = { ...filter, ...patch };
    if (scope) setLayout(`tracker.filter.${scopeKey(scope)}`, filter);
    if (syncText && filterText.value !== filter.text) filterText.value = filter.text;
    render();
  }

  // ---- Table ----
  /** @param {(task: Task) => number} get */
  const byNumber = (get) => (/** @type {Task} */ a, /** @type {Task} */ b) => get(a) - get(b);
  /** @param {string} id */
  const projectName = (id) => data.project(id)?.name ?? '';

  /** @param {boolean} view @returns {TaskColumn[]} */
  function columns(view) {
    return [
      {
        id: 'starred',
        label: t('columnStarred'),
        icon: 'star',
        width: ICON_WIDTH,
        compare: byNumber((task) => Number(!task.starred)),
      },
      {
        id: 'timer',
        label: t('columnTimer'),
        icon: 'clock',
        width: ICON_WIDTH,
        compare: byNumber((task) => Number(task.id !== data.running?.taskId)),
      },
      {
        id: 'name',
        label: t('columnTask'),
        required: true,
        compare: (a, b) => a.name.localeCompare(b.name, locale),
      },
      ...(view
        ? [
            /** @type {TaskColumn} */ ({
              id: 'project',
              label: t('columnProject'),
              width: 160,
              compare: (a, b) => projectName(a.projectId).localeCompare(projectName(b.projectId)),
            }),
          ]
        : []),
      {
        id: 'week',
        label: t('columnWeek'),
        width: 80,
        align: 'end',
        compare: byNumber((task) => data.rollup.task(task.id).week),
      },
      {
        id: 'total',
        label: t('columnTotal'),
        width: 80,
        align: 'end',
        compare: byNumber((task) => data.rollup.task(task.id).total),
      },
      {
        id: 'estimate',
        label: t('columnEstimate'),
        width: 110,
        compare: byNumber((task) => task.estimateMin ?? -1),
      },
      {
        id: 'last',
        label: t('columnLastTracked'),
        width: 130,
        numeric: true,
        compare: byNumber((task) => data.rollup.last(task.id) ?? 0),
      },
    ];
  }

  table.renderRow = (task, tr) => {
    tr.classList.toggle('running', task.id === data.running?.taskId);
    tr.classList.toggle('done', task.status === 'done');
  };

  table.renderCell = (task, column, cell) => {
    const running = task.id === data.running?.taskId;
    switch (column.id) {
      case 'starred':
        cell.append(
          el(
            'button',
            {
              type: 'button',
              class: `cell-button star${task.starred ? ' starred' : ''}`,
              tabIndex: -1,
              title: t('columnStarred'),
              attrs: { 'aria-label': t('columnStarred'), 'aria-pressed': String(task.starred) },
              on: { click: () => commands.toggleStar(task.id) },
            },
            icon('star'),
          ),
        );
        break;
      case 'timer': {
        const label = t(running ? 'timerStop' : 'timerStart');
        cell.append(
          el(
            'button',
            {
              type: 'button',
              class: `cell-button timer${running ? ' running' : ''}`,
              tabIndex: -1,
              title: label,
              attrs: { 'aria-label': label },
              on: { click: () => commands.toggleTimer(task.id) },
            },
            icon(running ? 'clock' : 'nav-right'),
          ),
        );
        break;
      }
      case 'name':
        if (task.id === editingId) cell.append(renameField(task));
        else cell.textContent = task.name;
        break;
      case 'project':
        cell.textContent = projectName(task.projectId);
        break;
      case 'week':
      case 'total': {
        const value = data.rollup.task(task.id)[column.id];
        cell.textContent = value > 0 ? duration(value) : NO_VALUE;
        break;
      }
      case 'estimate':
        renderEstimate(task, cell);
        break;
      case 'last': {
        if (running) {
          cell.textContent = t('lastTrackedRunning');
          break;
        }
        const last = data.rollup.last(task.id);
        if (last === null) cell.append(el('span', { class: 'muted', text: t('lastTrackedNever') }));
        else {
          cell.textContent = formatRelative(last, {
            now: data.now(),
            locale,
            todayLabel: t('viewToday'),
          });
        }
        break;
      }
    }
  };

  /** @param {Task} task @param {HTMLTableCellElement} cell */
  function renderEstimate(task, cell) {
    if (task.estimateMin === null) {
      cell.textContent = NO_VALUE;
      return;
    }
    const ratio = data.rollup.task(task.id).total / (task.estimateMin * MINUTE);
    const over = ratio > 1;
    const meter = el('span', { class: over ? 'meter over' : 'meter' }, el('span'));
    meter.style.setProperty('--value', `${Math.min(100, Math.round(ratio * 100))}%`);
    cell.append(
      el(
        'span',
        { class: over ? 'estimate over' : 'estimate', title: over ? t('estimateOver') : '' },
        meter,
        el('span', { class: 'num', text: formatEstimate(task.estimateMin) }),
        ...(over ? [el('span', { class: 'visually-hidden', text: t('estimateOver') })] : []),
      ),
    );
  }

  /** @param {number} ms */
  function duration(ms) {
    return formatDuration(ms, { format: data.settings.durationFormat });
  }

  table.addEventListener('tt-select', (event) => {
    const { key } = /** @type {CustomEvent} */ (event).detail;
    if (scope) selected.set(scopeKey(scope), String(key));
  });
  table.addEventListener('tt-activate', (event) => {
    commands.edit(String(/** @type {CustomEvent} */ (event).detail.key));
  });
  table.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = /** @type {Element} */ (event.target);
    if (target.localName !== 'tr' || !target.closest('tbody')) return;
    const id = String(table.selectedKey ?? '');
    if (!data.tasks.has(id)) return;
    if (event.key === ' ') commands.toggleTimer(id);
    else if (event.key === 'F2') startRename(id);
    else if (event.key === 'Delete') removeSelected(id);
    else if (event.key.toLowerCase() === 's' && !event.shiftKey) commands.toggleStar(id);
    else return;
    event.preventDefault();
  });

  /** Deletes `id`; the next row (else the previous one) takes the selection. @param {string} id */
  async function removeSelected(id) {
    const keys = [...table.querySelectorAll('tbody tr')].map(
      (tr) => /** @type {HTMLElement} */ (tr).dataset.key,
    );
    const index = keys.indexOf(id);
    const neighbour = keys[index + 1] ?? keys[index - 1] ?? null;
    await commands.remove(id);
    await data.settled();
    if (neighbour && data.tasks.has(neighbour)) {
      table.selectedKey = neighbour;
      table.focusSelected();
    }
  }

  // ---- Inline rename (F2, New Task) ----
  /** @param {Task} task */
  function renameField(task) {
    const input = el('input', {
      class: 'field rename-field',
      type: 'text',
      value: task.name,
      maxLength: 500,
      attrs: { 'aria-label': t('renameLabel') },
    });
    let done = false;
    /** @param {boolean} save */
    const finish = async (save) => {
      if (done) return;
      done = true;
      editingId = null;
      if (save) await commands.rename(task.id, input.value);
      await data.settled();
      render(true);
      table.focusSelected();
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    // Clicks in the field must not reach the table (row selection, double-click to edit).
    for (const type of ['click', 'dblclick', 'mousedown']) {
      input.addEventListener(type, (event) => event.stopPropagation());
    }
    return input;
  }

  /** @param {string} id */
  function startRename(id) {
    if (!data.tasks.has(id)) return;
    // A new task the filter hides (e.g. Starred on): clear the filter so it shows.
    if (!table.rows.some((task) => task.id === id) && scoped.some((task) => task.id === id)) {
      setFilter({ ...defaultFilter(data.settings.showDone), open: filter.open });
    }
    if (!table.rows.some((task) => task.id === id)) return;
    editingId = id;
    table.selectedKey = id;
    table.rows = [...table.rows];
    const input = /** @type {HTMLInputElement | null} */ (table.querySelector('.rename-field'));
    input?.focus();
    input?.select();
  }

  // ---- Rendering ----
  /**
   * Shows `next` (a project, a view, or null for the Archive root).
   * @param {TaskScope | null} next
   */
  function setScope(next) {
    if (editingId) editingId = null;
    scope = next;
    filter = next
      ? readFilter(
          getLayout(`tracker.filter.${scopeKey(next)}`),
          defaultFilter(data.settings.showDone),
        )
      : defaultFilter(data.settings.showDone);
    filterText.value = filter.text;
    if (next && columnsFor !== next.type) {
      columnsFor = next.type;
      table.setAttribute('persist', next.type === 'view' ? 'tracker.tasks.views' : 'tracker.tasks');
      table.columns = columns(next.type === 'view');
    }
    render(true);
    if (next) {
      const key = selected.get(scopeKey(next));
      table.selectedKey = key ?? null;
    }
  }

  /** Default order: project tree order, then the task order within a project. */
  function defaultOrder() {
    const index = new Map(data.projects.map((project, i) => [project.id, i]));
    return (/** @type {Task} */ a, /** @type {Task} */ b) =>
      (index.get(a.projectId) ?? 0) - (index.get(b.projectId) ?? 0) ||
      a.order - b.order ||
      a.createdAt - b.createdAt;
  }

  /**
   * Re-renders from `data`. While a row is being renamed the table waits (unless `force`).
   * @param {boolean} [force]
   */
  function render(force = false) {
    if (editingId && !force) {
      renderPending = true;
      return;
    }
    renderPending = false;
    const startedAt = performance.now();
    renderHeader();
    const runningId = data.running?.taskId ?? null;
    scoped = scope
      ? scopeTasks(data.tasks.values(), scope, (id) => data.rollup.task(id), runningId)
      : [];
    const { tasks, doneHidden } = filterTasks(scoped, filter);
    tasks.sort(defaultOrder());

    for (const pill of PILLS) {
      const on = pill.id === 'tags' ? filter.tags !== null : filter[pill.id];
      pills[pill.id].setAttribute('aria-pressed', String(on));
    }
    const qfbOpen = getLayout(QFB_KEY) === true;
    qfb.hidden = !qfbOpen;
    quickFilter.setAttribute('aria-pressed', String(qfbOpen));
    renderTagBar(qfbOpen);

    const empty = emptyState(tasks.length, doneHidden);
    table.hidden = tasks.length === 0;
    table.rows = tasks;
    ref('list-empty').hidden = empty === null;
    ref('list-empty-text').textContent = empty ? t(empty) : '';
    ref('clear-filter').hidden = empty !== 'emptyFilter';
    ref('list-footer').hidden = doneHidden === 0;
    ref('done-hidden').textContent =
      doneHidden === 1 ? t('doneHiddenOne') : t('doneHidden', String(doneHidden));
    quickFilter.toggleAttribute('disabled', scope === null);
    performance.measure('tt-task-list', { start: startedAt });
  }

  /** @param {number} shown @param {number} doneHidden */
  function emptyState(shown, doneHidden) {
    if (!scope) return 'emptyNoProject';
    if (shown > 0) return null;
    if (scoped.length === 0) return scope.type === 'view' ? VIEW_EMPTY[scope.id] : 'emptyProject';
    if (isFiltering(filter)) return 'emptyFilter';
    if (doneHidden > 0) return 'emptyProjectAllDone';
    return 'emptyFilter';
  }

  /** @param {boolean} qfbOpen */
  function renderTagBar(qfbOpen) {
    const show = qfbOpen && filter.tags !== null;
    tagBar.hidden = !show;
    if (!show) return;
    const chosen = new Set((filter.tags ?? []).map((tag) => tag.toLocaleLowerCase()));
    tagBar.replaceChildren(
      ...tagsOf(scoped, locale).map((tag) =>
        el(
          'button',
          {
            class: 'button small toggle',
            type: 'button',
            attrs: { 'aria-pressed': String(chosen.has(tag.toLocaleLowerCase())) },
            on: {
              click: () => {
                const key = tag.toLocaleLowerCase();
                const tags = (filter.tags ?? []).filter((t2) => t2.toLocaleLowerCase() !== key);
                if (!chosen.has(key)) tags.push(tag);
                setFilter({ tags });
              },
            },
          },
          icon('tag'),
          el('span', { text: tag }),
        ),
      ),
    );
  }

  /** "N open tasks · total". @param {number} open @param {number} total */
  function summary(open, total) {
    return open === 1
      ? t('listSummaryOne', duration(total))
      : t('listSummary', String(open), duration(total));
  }

  function renderHeader() {
    const title = ref('list-title');
    const count = ref('list-count');
    if (!scope) {
      title.textContent = t('projectArchive');
      count.textContent = '';
      return;
    }
    if (scope.type === 'project') {
      const project = data.project(scope.id);
      const id = scope.id;
      const open = [...data.tasks.values()].filter(
        (task) => task.projectId === id && task.status === 'open',
      ).length;
      title.textContent = project?.name ?? '';
      count.textContent = summary(open, data.rollup.project(id).total);
      return;
    }
    const view = scope.id;
    title.textContent = t(VIEW_TITLES[view]);
    const tasks = scopeTasks(
      data.tasks.values(),
      scope,
      (id) => data.rollup.task(id),
      data.running?.taskId ?? null,
    );
    const open = tasks.filter((task) => task.status === 'open').length;
    if (view === 'starred') {
      count.textContent = open === 1 ? t('listCountOne') : t('listCount', String(open));
      return;
    }
    const total = tasks.reduce((sum, task) => sum + data.rollup.task(task.id)[view], 0);
    count.textContent = summary(open, total);
  }

  return {
    setScope,
    render: () => render(),
    focusFilter,
    startRename,
    focus: () => table.focusSelected(),
    /** Selects and focuses a task row. @param {string} id */
    focusTask(id) {
      table.selectedKey = id;
      table.focusSelected();
    },
    get selectedId() {
      const key = table.selectedKey;
      return key === null ? null : String(key);
    },
    get pending() {
      return renderPending;
    },
    /** Row element of a task (context menu target lookup). @param {Element} element */
    taskAt(element) {
      const tr = /** @type {HTMLElement | null} */ (element.closest('tr[data-key]'));
      return tr && table.contains(tr) ? (tr.dataset.key ?? null) : null;
    },
    table,
  };
}
