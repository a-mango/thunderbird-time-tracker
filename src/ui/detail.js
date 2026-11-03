// Detail pane (docs/DESIGN.md, Detail pane = message pane): breadcrumb, title and tags, the timer
// box, the action row, the stat strip and the task's time entries grouped by day.
import { listEntriesByTask } from '../db/index.js';
import { ENTRY_RANGES, groupByDay, rangeOf } from '../lib/entry-list.js';
import {
  formatDay,
  formatDuration,
  formatElapsed,
  formatEstimate,
  formatTime,
  formatTimeRange,
} from '../lib/format.js';
import { colorValue } from '../lib/palette.js';
import { ancestorPath } from '../lib/sidebar.js';
import { dayKey } from '../lib/time.js';
import { t } from './i18n.js';
import { getLayout, setLayout } from './layout-store.js';
import { showMenu } from './menu.js';
import { el, icon, renderList } from './render.js';

/**
 * @typedef {import('./tracker-data.js').TrackerData} TrackerData
 * @typedef {import('../lib/types.js').Entry} Entry
 * @typedef {import('../lib/types.js').Task} Task
 * @typedef {import('../lib/entry-list.js').EntryRange} EntryRange
 * @typedef {import('../lib/entry-list.js').DayGroup} DayGroup
 * @typedef {ReturnType<typeof import('./entry-commands.js').createEntryCommands>} EntryCommands
 * @typedef {ReturnType<typeof import('./task-commands.js').createTaskCommands>} TaskCommands
 */

const MINUTE = 60_000;
const RANGE_KEY = 'tracker.detail.range';

/** @type {Record<EntryRange, string>} */
const RANGE_LABELS = {
  today: 'rangeToday',
  week: 'rangeWeek',
  lastWeek: 'rangeLastWeek',
  month: 'rangeMonth',
  all: 'rangeAll',
};

/** @type {Record<Entry['source'], {icon: string, label: string}>} */
const SOURCES = {
  timer: { icon: 'clock', label: 'sourceTimer' },
  split: { icon: 'clock', label: 'sourceSplit' },
  idle: { icon: 'clock', label: 'sourceIdle' },
  manual: { icon: 'pencil', label: 'sourceManual' },
};

/** @param {unknown} value @returns {EntryRange} */
const readRange = (value) =>
  ENTRY_RANGES.includes(/** @type {EntryRange} */ (value))
    ? /** @type {EntryRange} */ (value)
    : 'week';

/**
 * @param {{
 *   data: TrackerData,
 *   root: HTMLElement,
 *   taskCommands: TaskCommands,
 *   entryCommands: EntryCommands,
 *   moreTask: (id: string, anchor: HTMLElement) => unknown,
 * }} options
 */
export function createDetail({ data, root, taskCommands, entryCommands, moreTask }) {
  const locale = messenger.i18n.getUILanguage();
  const placeholder = /** @type {HTMLElement} */ (root.querySelector('.pane-placeholder'));
  /** @type {string | null} */
  let taskId = null;
  /** @type {Entry[]} */
  let entries = [];
  /** Guards against an older entries query finishing after a newer one. */
  let loadToken = 0;
  /** @type {EntryRange} */
  let range = readRange(getLayout(RANGE_KEY));

  const button = (
    /** @type {string} */ label,
    /** @type {string} */ cls,
    /** @type {() => unknown} */ onClick,
    /** @type {string} */ iconName = '',
  ) =>
    el(
      'button',
      { class: `button ${cls}`, type: 'button', on: { click: () => taskId && onClick() } },
      iconName ? icon(iconName) : null,
      el('span', { text: label }),
    );

  // ---- Static structure ----
  const crumb = el('nav', { class: 'breadcrumb', attrs: { 'aria-label': t('detailBreadcrumb') } });
  const title = el('h2', { class: 'detail-title', id: 'detail-title' });
  const tags = el('div', { class: 'detail-tags' });
  const elapsed = el('span', { class: 'timer-elapsed num' });
  const since = el('span', { class: 'timer-since' });
  const stopButton = button(t('timerBoxStop'), 'primary', () => entryCommands.stopTimer());
  const splitButton = button(t('timerBoxSplit'), '', () => entryCommands.splitRunning());
  const startButton = button(
    t('timerBoxStart'),
    'primary',
    () => taskId && taskCommands.toggleTimer(taskId),
  );
  const resumeButton = button(
    t('timerBoxResume'),
    '',
    () => taskId && entryCommands.resumeTask(taskId),
  );
  const timerBox = el(
    'div',
    { class: 'timer-box', attrs: { role: 'group', 'aria-label': t('timerBoxLabel') } },
    el(
      'div',
      { class: 'timer-main' },
      el('span', { class: 'timer-line' }, el('span', { class: 'live-dot' }), elapsed),
      since,
    ),
    stopButton,
    splitButton,
    startButton,
    resumeButton,
  );
  const doneButton = button(
    '',
    'small',
    () => taskId && taskCommands.setDone(taskId, data.tasks.get(taskId)?.status !== 'done'),
    'check',
  );
  const moreButton = el(
    'button',
    {
      class: 'button small more-button',
      type: 'button',
      attrs: { 'aria-label': t('detailMore'), 'aria-haspopup': 'menu' },
      on: { click: () => taskId && moreTask(taskId, moreButton) },
    },
    icon('more'),
  );
  const actions = el(
    'div',
    { class: 'detail-actions' },
    button(t('detailAddEntry'), 'small', () => taskId && entryCommands.add(taskId), 'add'),
    doneButton,
    button(t('detailEdit'), 'small', () => taskId && taskCommands.edit(taskId), 'pencil'),
    el('span', { class: 'spacer' }),
    moreButton,
  );
  /** @param {string} label */
  const stat = (label) => {
    const value = el('span', { class: 'stat-value num' });
    const name = el('span', { class: 'stat-label', text: label });
    const meter = el('span', { class: 'meter' }, el('span'));
    const cell = el('div', { class: 'stat' }, name, value);
    return { cell, name, value, meter };
  };
  const stats = {
    today: stat(t('statToday')),
    week: stat(t('statWeek')),
    total: stat(t('statTotal')),
    estimate: stat(t('statEstimate')),
  };
  // Estimate: the bar with the share used next to it, so the label stays one line.
  const percent = el('span', { class: 'stat-percent num' });
  const overText = el('span', { class: 'visually-hidden', text: t('estimateOver') });
  const estimateBar = el('span', { class: 'stat-bar' }, stats.estimate.meter, percent, overText);
  stats.estimate.cell.append(estimateBar);
  const strip = el('div', { class: 'stat-strip' }, ...Object.values(stats).map((s) => s.cell));
  const rangeButton = el(
    'button',
    {
      class: 'button small range-button',
      type: 'button',
      attrs: { 'aria-haspopup': 'menu' },
      on: { click: () => chooseRange() },
    },
    el('span'),
    icon('nav-down-xs'),
  );
  const list = el('div', { class: 'entry-groups' });
  const emptyEntries = el('p', { class: 'entries-empty' });
  const entriesSection = el(
    'section',
    { class: 'detail-entries scroll', attrs: { 'aria-labelledby': 'detail-entries-title' } },
    el(
      'div',
      { class: 'section-header' },
      el('h3', { class: 'section-title', id: 'detail-entries-title', text: t('entriesTitle') }),
      rangeButton,
    ),
    list,
    emptyEntries,
  );
  const content = el(
    'div',
    { class: 'detail', hidden: true },
    el('header', { class: 'detail-header' }, crumb, title, tags, timerBox, actions),
    strip,
    entriesSection,
  );
  root.append(content);

  list.addEventListener('click', (event) => {
    const row = /** @type {HTMLElement | null} */ (
      /** @type {Element} */ (event.target).closest('.entry-row')
    );
    if (row?.dataset.id) entryCommands.edit(row.dataset.id);
  });
  list.addEventListener('keydown', (event) => {
    const row = /** @type {HTMLElement | null} */ (
      /** @type {Element} */ (event.target).closest('.entry-row')
    );
    if (!row?.dataset.id || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Delete') entryCommands.remove(row.dataset.id);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
      moveFocus(row, event.key === 'ArrowDown' ? 1 : -1);
    else if (event.key === 'Home' || event.key === 'End')
      moveFocus(row, event.key === 'Home' ? -Infinity : Infinity);
    else return;
    event.preventDefault();
  });

  /** All entry rows, in order. */
  const rowsOf = () => /** @type {HTMLElement[]} */ ([...list.querySelectorAll('.entry-row')]);

  /**
   * Roving tabindex: the entry list is one tab stop, like Thunderbird's lists.
   * @param {HTMLElement | undefined} current
   */
  function setCurrent(current) {
    const rows = rowsOf();
    const target = current && rows.includes(current) ? current : rows[0];
    for (const row of rows) row.tabIndex = row === target ? 0 : -1;
  }
  list.addEventListener('focusin', (event) => {
    const row = /** @type {Element} */ (event.target).closest('.entry-row');
    if (row) setCurrent(/** @type {HTMLElement} */ (row));
  });

  /** @param {HTMLElement} row @param {number} step */
  function moveFocus(row, step) {
    const rows = rowsOf();
    const index = Math.max(0, Math.min(rows.length - 1, rows.indexOf(row) + step));
    rows[index]?.focus();
  }

  async function chooseRange() {
    const value = await showMenu(
      rangeButton,
      ENTRY_RANGES.map((name) => ({
        label: t(RANGE_LABELS[name]),
        value: name,
        checked: name === range,
      })),
    );
    if (!value) return;
    range = readRange(value);
    setLayout(RANGE_KEY, range);
    renderEntries();
  }

  // ---- Rendering ----

  /** @param {number} ms */
  const duration = (ms) => formatDuration(ms, { format: data.settings.durationFormat });

  function renderHeader(/** @type {Task} */ task) {
    const project = data.project(task.projectId);
    const path = ancestorPath(data.projects, task.projectId).reverse();
    crumb.replaceChildren(
      icon('folder', { class: 'crumb-icon' }),
      ...path.flatMap((id, index) => [
        ...(index > 0
          ? [el('span', { class: 'crumb-separator', text: '›', attrs: { 'aria-hidden': 'true' } })]
          : []),
        el('span', { text: data.project(id)?.name ?? '' }),
      ]),
    );
    crumb.style.setProperty('--icon-color', project ? colorValue(project.color) : 'currentColor');
    title.textContent = task.name;
    const chips = [...task.tags];
    if (task.billable) chips.push(t('taskBillable'));
    if (task.status === 'done') chips.push(t('taskDone'));
    tags.replaceChildren(...chips.map((text) => el('span', { class: 'chip', text })));
    tags.hidden = tags.childElementCount === 0;
    const label = /** @type {HTMLElement} */ (doneButton.lastElementChild);
    label.textContent = task.status === 'done' ? t('detailReopen') : t('detailMarkDone');
  }

  function renderTimer(/** @type {Task} */ task) {
    const running = data.running?.taskId === task.id ? data.running : null;
    timerBox.classList.toggle('running', running !== null);
    stopButton.hidden = splitButton.hidden = running === null;
    startButton.hidden = resumeButton.hidden = running !== null;
    const last = entries.filter((entry) => entry.end !== null).at(-1);
    resumeButton.disabled = !last;
    since.title = '';
    if (running) {
      const time = formatTime(running.start, { locale });
      since.textContent = running.note
        ? t('timerSinceNote', time, running.note)
        : t('timerSince', time);
    } else {
      since.textContent = last
        ? t('timerLast', formatTimeRange(last.start, last.end, { locale, nowLabel: '' }))
        : t('timerIdle');
    }
    // The line is cut with an ellipsis; the tooltip shows a long note in full.
    since.title = since.textContent ?? '';
    tickTimer();
  }

  function renderStats(/** @type {Task} */ task) {
    const totals = data.rollup.task(task.id);
    stats.today.value.textContent = duration(totals.today);
    stats.week.value.textContent = duration(totals.week);
    stats.total.value.textContent = duration(totals.total);
    const { estimate } = stats;
    if (task.estimateMin === null) {
      estimate.value.textContent = '–';
      estimateBar.hidden = true;
      estimate.cell.classList.remove('over');
      return;
    }
    const ratio = totals.total / (task.estimateMin * MINUTE);
    const used = Math.round(ratio * 100);
    const over = ratio > 1;
    estimate.value.textContent = formatEstimate(task.estimateMin);
    estimateBar.hidden = false;
    percent.textContent = `${used}%`;
    overText.hidden = !over;
    estimate.cell.classList.toggle('over', over);
    estimate.meter.classList.toggle('over', over);
    estimate.meter.style.setProperty('--value', `${Math.min(100, used)}%`);
  }

  function renderEntries() {
    const now = data.now();
    /** @type {HTMLElement} */ (rangeButton.firstElementChild).textContent = t(RANGE_LABELS[range]);
    rangeButton.setAttribute('aria-label', t('rangeLabel', t(RANGE_LABELS[range])));
    const groups = groupByDay(entries, {
      now,
      range: rangeOf(range, { now, weekStart: data.settings.weekStart }),
    });
    const today = dayKey(now);
    renderList(
      list,
      groups,
      (group) => group.day,
      () =>
        el(
          'section',
          { class: 'day-group' },
          el('h4', { class: 'day-header' }, el('span'), el('span', { class: 'num' })),
          el('div', { class: 'day-rows' }),
        ),
      () => {},
    ).forEach((node, index) => {
      const group = groups[index];
      const [label, total] = /** @type {HTMLElement[]} */ ([
        ...node.querySelectorAll('.day-header > span'),
      ]);
      const day = formatDay(group.start, { now, locale });
      label.textContent = group.day === today ? t('dayToday', day) : day;
      total.textContent = duration(group.total);
      renderList(
        /** @type {HTMLElement} */ (node.querySelector('.day-rows')),
        group.rows,
        (row) => row.entry.id,
        () => entryRow(),
        () => {},
      ).forEach((rowNode, i) =>
        fillRow(/** @type {HTMLElement} */ (rowNode), group.rows[i], group.day === today),
      );
    });
    const focused = /** @type {HTMLElement | null} */ (list.querySelector('.entry-row:focus'));
    setCurrent(focused ?? rowsOf().find((row) => row.tabIndex === 0));
    emptyEntries.hidden = groups.length > 0;
    emptyEntries.textContent = t('entriesEmpty');
  }

  function entryRow() {
    return el(
      'button',
      { class: 'entry-row', type: 'button' },
      el('span', { class: 'entry-source' }, el('span'), el('span', { class: 'visually-hidden' })),
      el('span', { class: 'entry-time num' }),
      el('span', { class: 'entry-note' }),
      el('span', { class: 'entry-duration num' }),
    );
  }

  /**
   * The accessible name comes from the content (the source is visually hidden text), so it
   * always matches what is shown, including the running time.
   * @param {HTMLElement} row
   * @param {import('../lib/entry-list.js').DayRow} item
   * @param {boolean} isToday
   */
  function fillRow(row, { entry, ms }, isToday) {
    // A running entry ticks in today's row; earlier days (overnight) show their own part.
    const running = entry.end === null && isToday;
    row.dataset.id = entry.id;
    row.classList.toggle('running', running);
    const [source, time, note, length] = /** @type {HTMLElement[]} */ ([...row.children]);
    const kind = running ? 'running' : entry.source;
    const [mark, sourceLabel] = /** @type {HTMLElement[]} */ ([...source.children]);
    if (source.dataset.kind !== kind) {
      source.dataset.kind = kind;
      const look = SOURCES[entry.source] ?? SOURCES.timer;
      mark.replaceChildren(running ? el('span', { class: 'live-dot' }) : icon(look.icon));
      sourceLabel.textContent = `${running ? t('sourceRunning') : t(look.label)}, `;
      source.title = sourceLabel.textContent.slice(0, -2);
    }
    time.textContent = formatTimeRange(entry.start, entry.end, { locale, nowLabel: t('entryNow') });
    note.textContent = entry.note;
    length.textContent = running ? formatElapsed(data.now() - entry.start) : duration(ms);
  }

  /** Every second while visible: the big elapsed time and the running row. */
  function tickTimer() {
    const running = taskId !== null && data.running?.taskId === taskId ? data.running : null;
    if (!running) {
      elapsed.textContent = formatElapsed(0);
      return;
    }
    const text = formatElapsed(data.now() - running.start);
    elapsed.textContent = text;
    const row = /** @type {HTMLElement | null} */ (
      list.querySelector('.entry-row.running .entry-duration')
    );
    if (row) row.textContent = text;
  }

  function render() {
    const task = taskId ? data.tasks.get(taskId) : undefined;
    content.hidden = !task;
    placeholder.hidden = Boolean(task);
    if (!task) return;
    renderHeader(task);
    renderTimer(task);
    renderStats(task);
    renderEntries();
  }

  async function loadEntries() {
    const token = ++loadToken;
    const id = taskId;
    const loaded = id ? await listEntriesByTask(data.db, id) : [];
    if (token !== loadToken) return;
    entries = loaded;
    render();
  }

  return {
    /** Shows a task (or the placeholder for null). @param {string | null} id */
    show(id) {
      const next = id && data.tasks.has(id) ? id : null;
      if (next === taskId) return;
      taskId = next;
      entries = [];
      render();
      if (next) loadEntries();
    },
    /** After a change: reloads entries when they changed. @param {Set<string>} types */
    update(types) {
      if (taskId && !data.tasks.has(taskId)) taskId = null;
      if (types.has('entries') && taskId) loadEntries();
      else render();
    },
    tick: tickTimer,
    get taskId() {
      return taskId;
    },
    /** The entry id of a row element (context menu target lookup). @param {Element} element */
    entryAt(element) {
      const row = /** @type {HTMLElement | null} */ (element.closest('.entry-row'));
      return row && list.contains(row) ? (row.dataset.id ?? null) : null;
    },
    /** @param {string} id */
    focusEntry(id) {
      /** @type {HTMLElement | null} */ (
        list.querySelector(`.entry-row[data-id="${CSS.escape(id)}"]`)
      )?.focus();
    },
    list,
  };
}
