// The Reports mode (S3): a timesheet grid (tasks × days, editable cells), a per-project summary,
// filters, CSV export and a printable layout. Aggregation lives in lib/report.js; cell edits go
// through db/timesheet.js.
import { TtDialog } from './components/tt-dialog.js';
import { download } from './data-commands.js';
import { taskSelect } from './entry-dialogs.js';
import { t } from './i18n.js';
import { getLayout, setLayout } from './layout-store.js';
import { el, icon } from './render.js';
import { labelled } from './task-dialogs.js';
import { listEntriesInRange, setDayTotal, undoDayTotal } from '../db/index.js';
import { dateInput } from '../lib/entry-form.js';
import { InvariantError, ValidationError } from '../lib/errors.js';
import {
  formatClock,
  formatDateRange,
  formatDay,
  formatDuration,
  formatMoney,
  formatWeekdayDay,
} from '../lib/format.js';
import { parseDayTotal } from '../lib/parse.js';
import {
  REPORT_CSV_COLUMNS,
  buildReport,
  customRange,
  presetRange,
  reportCsv,
  shiftRange,
} from '../lib/report.js';
import { projectPathName } from '../lib/sidebar.js';
import { tagsOf } from '../lib/task-list.js';
import { dayKey, startOfDay } from '../lib/time.js';

/**
 * @typedef {import('./tracker-data.js').TrackerData} TrackerData
 * @typedef {import('../lib/report.js').Report} Report
 * @typedef {import('../lib/report.js').RangePreset} RangePreset
 * @typedef {import('../lib/report.js').ReportFilters} ReportFilters
 * @typedef {import('../lib/time.js').Range} Range
 * @typedef {{preset: RangePreset, range: Range | null, filters: ReportFilters,
 *            tagsOpen: boolean}} ReportState `range`: the shown range when it isn't the
 *   preset's current one (shifted with ◀ ▶, or custom)
 * @typedef {{row: string, col: number}} CellPos `row`: task id, or `total`
 */

const STATE_KEY = 'tracker.report';
const MINUTE = 60_000;

/** @type {{value: RangePreset, label: string}[]} */
const PRESETS = [
  { value: 'week', label: 'reportRangeWeek' },
  { value: 'last-week', label: 'reportRangeLastWeek' },
  { value: 'month', label: 'reportRangeMonth' },
  { value: 'last-month', label: 'reportRangeLastMonth' },
  { value: 'custom', label: 'reportRangeCustom' },
];

/** Message of each report CSV column header. */
const CSV_HEADERS = {
  date: 'csvDate',
  project: 'csvProject',
  task: 'csvTask',
  billable: 'csvBillable',
  tags: 'csvTags',
  minutes: 'csvMinutes',
  hours: 'csvHours',
  rate: 'csvRate',
  amount: 'csvAmount',
};

/** @param {unknown} v @returns {ReportState} */
function readState(v) {
  /** @type {ReportState} */
  const fallback = {
    preset: 'week',
    range: null,
    filters: { projectId: null, billableOnly: false, tags: [] },
    tagsOpen: false,
  };
  if (typeof v !== 'object' || v === null) return fallback;
  const s = /** @type {any} */ (v);
  const preset = PRESETS.some((p) => p.value === s.preset) ? s.preset : 'week';
  const range =
    s.range && Number.isSafeInteger(s.range.start) && Number.isSafeInteger(s.range.end)
      ? customRange(s.range.start, s.range.end - 1)
      : null;
  return {
    preset,
    // A shifted week or month comes back as the current one; only a custom range is kept.
    range: preset === 'custom' ? range : null,
    filters: {
      projectId: typeof s.filters?.projectId === 'string' ? s.filters.projectId : null,
      billableOnly: s.filters?.billableOnly === true,
      tags: Array.isArray(s.filters?.tags)
        ? s.filters.tags
            .filter((/** @type {unknown} */ tag) => typeof tag === 'string')
            .slice(0, 50)
        : [],
    },
    tagsOpen: s.tagsOpen === true,
  };
}

/**
 * @param {{
 *   data: TrackerData,
 *   root: HTMLElement,
 *   notify: (message: {type: 'info' | 'warning' | 'error', message: string,
 *                      actions?: {label: string, onClick: () => void}[]}) => void,
 *   offerUndo: (message: string, undo: () => Promise<void>) => void,
 *   onError: (error: unknown) => void,
 * }} options
 */
export function createReport({ data, root, notify, offerUndo, onError }) {
  const locale = messenger.i18n.getUILanguage();
  /** @param {string} name */
  const ref = (name) => /** @type {HTMLElement} */ (root.querySelector(`[data-ref="${name}"]`));
  let state = readState(getLayout(STATE_KEY));
  /** Task rows added with Add Task… (until the range changes). */
  const extraTaskIds = new Set();
  /** @type {Report | null} */
  let report = null;
  let visible = false;
  /** Bumps on every load, so a slow load never overwrites a newer one. */
  let generation = 0;
  /** @type {CellPos} */
  let current = { row: '', col: 1 };
  /** @type {{pos: CellPos, input: HTMLInputElement, cancel: () => void} | null} */
  let editing = null;

  const save = () => setLayout(STATE_KEY, state);
  /** @param {number} ms */
  const duration = (ms) => formatDuration(ms, { format: data.settings.durationFormat });
  /** The range on screen. @returns {Range} */
  const range = () =>
    state.range ??
    (state.preset === 'custom'
      ? presetRange('week', { now: data.now(), weekStart: data.settings.weekStart })
      : presetRange(state.preset, { now: data.now(), weekStart: data.settings.weekStart }));

  // ---- Toolbar ----
  const exportButton = /** @type {HTMLButtonElement} */ (ref('report-export'));
  exportButton.prepend(icon('export'));
  const printButton = /** @type {HTMLButtonElement} */ (ref('report-print'));
  printButton.prepend(icon('print'));
  exportButton.addEventListener('click', exportCsv);
  printButton.addEventListener('click', () => window.print());

  const presetSelect = el('select', {
    class: 'field',
    attrs: { 'aria-label': t('reportRange') },
    on: {
      change: () => {
        const preset = /** @type {RangePreset} */ (presetSelect.value);
        state = {
          ...state,
          preset,
          range: preset === 'custom' ? range() : null,
        };
        rangeChanged();
      },
    },
  });
  for (const preset of PRESETS) {
    presetSelect.append(el('option', { value: preset.value, text: t(preset.label) }));
  }
  /** @param {-1 | 1} direction */
  const shift = (direction) => {
    state = { ...state, range: shiftRange(range(), state.preset, direction) };
    rangeChanged();
  };
  const previous = el(
    'button',
    {
      class: 'icon-button',
      type: 'button',
      title: t('reportPrevious'),
      attrs: { 'aria-label': t('reportPrevious') },
      on: { click: () => shift(-1) },
    },
    icon('nav-left'),
  );
  const next = el(
    'button',
    {
      class: 'icon-button',
      type: 'button',
      title: t('reportNext'),
      attrs: { 'aria-label': t('reportNext') },
      on: { click: () => shift(1) },
    },
    icon('nav-right'),
  );
  const fromInput = el('input', { class: 'field', type: 'date' });
  const toInput = el('input', { class: 'field', type: 'date' });
  // Labels wrap their fields: one line in the filter bar.
  const customFields = el(
    'span',
    { class: 'report-custom' },
    el('label', {}, el('span', { text: t('reportFrom') }), fromInput),
    el('label', {}, el('span', { text: t('reportTo') }), toInput),
  );
  const onCustom = () => {
    const from = fromInput.valueAsNumber;
    const to = toInput.valueAsNumber;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    // valueAsNumber is UTC midnight; the local day comes from the date parts.
    const local = (/** @type {string} */ value) => {
      const [y, m, d] = value.split('-').map(Number);
      return new Date(y, m - 1, d).getTime();
    };
    const custom = customRange(local(fromInput.value), local(toInput.value));
    if (!custom) {
      notify({ type: 'warning', message: t('reportRangeTooLong') });
      return;
    }
    state = { ...state, range: custom };
    rangeChanged();
  };
  fromInput.addEventListener('change', onCustom);
  toInput.addEventListener('change', onCustom);

  const projectSelect = el('select', {
    class: 'field report-project',
    attrs: { 'aria-label': t('reportProject') },
    on: {
      change: () => {
        state = {
          ...state,
          filters: { ...state.filters, projectId: projectSelect.value || null },
        };
        save();
        load();
      },
    },
  });
  const billableButton = el(
    'button',
    {
      class: 'button small toggle',
      type: 'button',
      on: {
        click: () => {
          state = {
            ...state,
            filters: { ...state.filters, billableOnly: !state.filters.billableOnly },
          };
          save();
          load();
        },
      },
    },
    el('span', { text: t('reportBillable') }),
  );
  const tagsButton = el(
    'button',
    {
      class: 'button small toggle',
      type: 'button',
      attrs: { 'aria-controls': 'report-tags' },
      on: {
        click: () => {
          const open = !state.tagsOpen;
          // Closing the tag bar drops its filter, so nothing stays hidden unseen.
          state = {
            ...state,
            tagsOpen: open,
            filters: { ...state.filters, tags: open ? state.filters.tags : [] },
          };
          save();
          load();
        },
      },
    },
    icon('tag'),
    el('span', { text: t('reportTags') }),
  );
  ref('report-filters').append(
    presetSelect,
    previous,
    next,
    customFields,
    el('span', { class: 'spacer' }),
    projectSelect,
    billableButton,
    tagsButton,
  );
  const tagBar = ref('report-tags');
  tagBar.id = 'report-tags';
  tagBar.setAttribute('aria-label', t('reportTagsLabel'));

  function rangeChanged() {
    extraTaskIds.clear();
    save();
    load();
  }

  function renderFilters() {
    addButton.disabled = ![...data.tasks.values()].some((task) => task.status === 'open');
    presetSelect.value = state.preset;
    customFields.hidden = state.preset !== 'custom';
    const shown = range();
    fromInput.value = dateInput(shown.start);
    toInput.value = dateInput(startOfDay(shown.end, -1));
    projectSelect.replaceChildren(el('option', { value: '', text: t('reportAllProjects') }));
    for (const project of data.projects) {
      projectSelect.append(
        el('option', { value: project.id, text: projectPathName(data.projects, project.id) }),
      );
    }
    if (state.filters.projectId && !data.project(state.filters.projectId)) {
      state = { ...state, filters: { ...state.filters, projectId: null } };
    }
    projectSelect.value = state.filters.projectId ?? '';
    billableButton.setAttribute('aria-pressed', String(state.filters.billableOnly));
    tagsButton.setAttribute('aria-pressed', String(state.tagsOpen));
    tagBar.hidden = !state.tagsOpen;
    const chosen = new Set(state.filters.tags.map((tag) => tag.toLocaleLowerCase()));
    tagBar.replaceChildren(
      ...tagsOf([...data.tasks.values()], locale).map((tag) =>
        el(
          'button',
          {
            class: 'button small toggle',
            type: 'button',
            attrs: { 'aria-pressed': String(chosen.has(tag.toLocaleLowerCase())) },
            on: {
              click: () => {
                const key = tag.toLocaleLowerCase();
                const tags = state.filters.tags.filter(
                  (other) => other.toLocaleLowerCase() !== key,
                );
                if (!chosen.has(key)) tags.push(tag);
                state = { ...state, filters: { ...state.filters, tags } };
                save();
                load();
              },
            },
          },
          icon('tag'),
          el('span', { text: tag }),
        ),
      ),
    );
  }

  // ---- Data ----
  async function load() {
    if (!visible) return;
    const shown = range();
    const mine = ++generation;
    // Load timing (tests/ui/perf-large.spec.js): tt-report-start → tt-report-ready.
    performance.mark('tt-report-start');
    try {
      const entries = await listEntriesInRange(data.db, shown.start, shown.end);
      if (mine !== generation) return;
      report = buildReport(
        { projects: data.projects, tasks: [...data.tasks.values()], entries },
        {
          range: shown,
          now: data.now(),
          filters: state.filters,
          rounding: { minutes: data.settings.roundingMin, mode: data.settings.roundingMode },
          extraTaskIds,
        },
      );
      render();
      performance.mark('tt-report-ready');
    } catch (error) {
      onError(error);
    }
  }

  // ---- Rendering ----
  const gridHost = ref('report-grid');
  const summaryHost = ref('report-summary');

  function render() {
    if (!report) return;
    renderFilters();
    ref('report-range').textContent = formatDateRange(range(), { locale });
    const { roundingMin, roundingMode } = data.settings;
    const note = ref('report-rounding');
    note.hidden = roundingMin === 0;
    note.textContent =
      roundingMin === 0
        ? ''
        : t(
            roundingMode === 'day' ? 'reportRoundingDay' : 'reportRoundingEntry',
            String(roundingMin),
          );
    ref('report-print-filters').textContent = printFilters();
    const focused = gridHost.contains(document.activeElement);
    if (editing) return; // the edit finishes first; the next change renders
    renderGrid(report);
    renderSummary(report);
    if (focused) focusCell(current);
  }

  function printFilters() {
    const parts = [];
    if (state.filters.projectId)
      parts.push(projectPathName(data.projects, state.filters.projectId));
    if (state.filters.billableOnly) parts.push(t('reportBillable'));
    parts.push(...state.filters.tags);
    return parts.length > 0 ? t('reportPrintFilters', parts.join(' · ')) : '';
  }

  /** Rows the keyboard moves through: task ids, then `total`. */
  /** @type {string[]} */
  let navRows = [];

  /** @param {Report} rep */
  function renderGrid(rep) {
    const today = startOfDay(data.now());
    const cols = rep.days.length + 2;
    const empty = rep.groups.length === 0;
    ref('report-empty').hidden = !empty;
    if (empty) {
      gridHost.replaceChildren();
      navRows = [];
      return;
    }
    const table = el('table', {
      class: 'timesheet',
      attrs: {
        role: 'grid',
        'aria-label': t('reportGridLabel'),
        'aria-describedby': 'report-grid-hint',
        'aria-colcount': cols,
      },
      style: { '--days': String(rep.days.length) },
    });
    const colgroup = el(
      'colgroup',
      {},
      el('col', { class: 'name-col' }),
      ...rep.days.map(() => el('col', { class: 'day-col' })),
      el('col', { class: 'total-col' }),
    );
    const head = el(
      'tr',
      {},
      el('th', { attrs: { scope: 'col', role: 'columnheader' }, text: t('reportTask') }),
      ...rep.days.map((day) =>
        el('th', {
          class: `num${day === today ? ' today' : ''}`,
          attrs: { scope: 'col', role: 'columnheader', 'data-align': 'end' },
          title: formatDay(day, { now: data.now(), locale }),
          text: formatWeekdayDay(day, { locale }),
        }),
      ),
      el('th', {
        class: 'num',
        attrs: { scope: 'col', role: 'columnheader', 'data-align': 'end' },
        text: t('reportTotal'),
      }),
    );
    const body = el('tbody');
    navRows = [];
    for (const group of rep.groups) {
      const groupTotal = group.rows.reduce((sum, row) => sum + row.total, 0);
      body.append(
        el(
          'tr',
          { class: 'group' },
          el('th', {
            attrs: { colspan: cols - 1, role: 'rowheader', scope: 'rowgroup' },
            text: group.name,
          }),
          el('td', {
            class: 'num',
            attrs: { role: 'gridcell', 'data-align': 'end' },
            text: duration(groupTotal),
          }),
        ),
      );
      for (const row of group.rows) {
        navRows.push(row.taskId);
        const tr = el('tr', { dataset: { task: row.taskId } });
        tr.append(
          el('th', {
            attrs: { role: 'rowheader', scope: 'row', tabindex: -1 },
            dataset: { col: '0' },
            text: row.name,
            title: row.name,
          }),
        );
        row.cells.forEach((ms, index) => {
          const locked = row.running[index];
          tr.append(
            el('td', {
              class: `num day${locked ? ' running' : ''}${rep.days[index] === today ? ' today' : ''}`,
              attrs: {
                role: 'gridcell',
                tabindex: -1,
                'data-align': 'end',
                'aria-readonly': locked ? 'true' : null,
                title: locked ? t('reportRunningCell') : null,
              },
              dataset: { col: String(index + 1) },
              text: ms > 0 ? duration(ms) : '',
            }),
          );
        });
        tr.append(
          el('td', {
            class: 'num total',
            attrs: { role: 'gridcell', tabindex: -1, 'data-align': 'end', 'aria-readonly': 'true' },
            dataset: { col: String(cols - 1) },
            text: duration(row.total),
          }),
        );
        body.append(tr);
      }
    }
    navRows.push('total');
    const foot = el(
      'tfoot',
      {},
      el(
        'tr',
        { dataset: { task: 'total' } },
        el('th', {
          attrs: { role: 'rowheader', scope: 'row', tabindex: -1 },
          dataset: { col: '0' },
          text: t('reportTotal'),
        }),
        ...rep.dayTotals.map((ms, index) =>
          el('td', {
            class: 'num',
            attrs: { role: 'gridcell', tabindex: -1, 'data-align': 'end', 'aria-readonly': 'true' },
            dataset: { col: String(index + 1) },
            text: ms > 0 ? duration(ms) : '',
          }),
        ),
        el('td', {
          class: 'num',
          attrs: { role: 'gridcell', tabindex: -1, 'data-align': 'end', 'aria-readonly': 'true' },
          dataset: { col: String(cols - 1) },
          text: duration(rep.total),
        }),
      ),
    );
    table.append(colgroup, el('thead', {}, head), body, foot);
    gridHost.replaceChildren(
      el('p', { id: 'report-grid-hint', class: 'visually-hidden', text: t('reportEditHint') }),
      table,
    );
    if (!navRows.includes(current.row)) current = { row: navRows[0], col: 1 };
    current.col = Math.min(current.col, cols - 1);
    cellAt(current)?.setAttribute('tabindex', '0');
  }

  /** @param {Report} rep */
  function renderSummary(rep) {
    summaryHost.hidden = rep.summary.length === 0;
    if (rep.summary.length === 0) {
      summaryHost.replaceChildren();
      return;
    }
    const numHead = (/** @type {string} */ label) =>
      el('th', { class: 'num', attrs: { scope: 'col', 'data-align': 'end' }, text: t(label) });
    const numCell = (/** @type {string} */ text) =>
      el('td', { class: 'num', attrs: { 'data-align': 'end' }, text });
    const money = (/** @type {number | null} */ value) => formatMoney(value, { locale });
    /** Zero is `–`, like the task list's empty cells. @param {number} ms */
    const time = (ms) => (ms > 0 ? duration(ms) : '–');
    summaryHost.replaceChildren(
      el('h2', { class: 'report-heading', id: 'report-summary-heading', text: t('reportSummary') }),
      el(
        'div',
        { class: 'tt-grid' },
        el(
          'table',
          { class: 'summary', attrs: { 'aria-labelledby': 'report-summary-heading' } },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { attrs: { scope: 'col' }, text: t('summaryProject') }),
              numHead('reportTotal'),
              numHead('summaryBillable'),
              numHead('summaryNonBillable'),
              numHead('summaryRate'),
              numHead('summaryAmount'),
            ),
          ),
          el(
            'tbody',
            {},
            ...rep.summary.map((row) =>
              el(
                'tr',
                { class: row.depth === 0 ? 'root' : '' },
                el('th', {
                  attrs: { scope: 'row' },
                  style: { '--depth': String(row.depth) },
                  text: row.name,
                }),
                numCell(time(row.total)),
                numCell(time(row.billable)),
                numCell(time(row.nonBillable)),
                numCell(money(row.rate)),
                numCell(money(row.amount)),
              ),
            ),
          ),
          el(
            'tfoot',
            {},
            el(
              'tr',
              {},
              el('th', { attrs: { scope: 'row' }, text: t('reportTotal') }),
              numCell(time(rep.totals.total)),
              numCell(time(rep.totals.billable)),
              numCell(time(rep.totals.nonBillable)),
              numCell(''),
              numCell(money(rep.totals.amount)),
            ),
          ),
        ),
      ),
    );
  }

  // ---- Grid keyboard and editing ----
  /** @param {CellPos} pos */
  function cellAt(pos) {
    const row = gridHost.querySelector(`tr[data-task="${CSS.escape(pos.row)}"]`);
    return /** @type {HTMLElement | null} */ (
      row?.querySelector(`[data-col="${pos.col}"]`) ?? null
    );
  }

  /** @param {CellPos} pos */
  function focusCell(pos) {
    const cell = cellAt(pos);
    if (!cell) return;
    for (const other of gridHost.querySelectorAll('[tabindex="0"]'))
      other.setAttribute('tabindex', '-1');
    cell.setAttribute('tabindex', '0');
    current = pos;
    cell.focus();
  }

  /** @param {HTMLElement} cell @returns {CellPos | null} */
  function posOf(cell) {
    const row = /** @type {HTMLElement | null} */ (cell.closest('tr[data-task]'));
    if (!row || cell.dataset.col === undefined) return null;
    return { row: /** @type {string} */ (row.dataset.task), col: Number(cell.dataset.col) };
  }

  /** @param {CellPos} pos */
  function editable(pos) {
    if (!report || pos.row === 'total' || pos.col < 1 || pos.col > report.days.length) return false;
    const row = report.groups.flatMap((g) => g.rows).find((r) => r.taskId === pos.row);
    return Boolean(row && !row.running[pos.col - 1]);
  }

  gridHost.addEventListener('focusin', (event) => {
    const cell = /** @type {HTMLElement} */ (event.target).closest('[data-col]');
    const pos = cell && posOf(/** @type {HTMLElement} */ (cell));
    if (pos && !editing) {
      for (const other of gridHost.querySelectorAll('[tabindex="0"]')) {
        if (other !== cell) other.setAttribute('tabindex', '-1');
      }
      /** @type {HTMLElement} */ (cell).setAttribute('tabindex', '0');
      current = pos;
    }
  });
  gridHost.addEventListener('dblclick', (event) => {
    const cell = /** @type {HTMLElement} */ (event.target).closest('[data-col]');
    const pos = cell && posOf(/** @type {HTMLElement} */ (cell));
    if (pos && editable(pos)) startEdit(pos);
  });
  gridHost.addEventListener('keydown', (event) => {
    if (editing || !report || event.altKey || event.metaKey) return;
    const lastCol = report.days.length + 1;
    const rowIndex = navRows.indexOf(current.row);
    /** @type {CellPos} */
    let target;
    switch (event.key) {
      case 'ArrowRight':
        target = { row: current.row, col: Math.min(lastCol, current.col + 1) };
        break;
      case 'ArrowLeft':
        target = { row: current.row, col: Math.max(0, current.col - 1) };
        break;
      case 'ArrowDown':
        target = { row: navRows[Math.min(navRows.length - 1, rowIndex + 1)], col: current.col };
        break;
      case 'ArrowUp':
        target = { row: navRows[Math.max(0, rowIndex - 1)], col: current.col };
        break;
      case 'Home':
        target = { row: event.ctrlKey ? navRows[0] : current.row, col: 0 };
        break;
      case 'End':
        target = { row: event.ctrlKey ? navRows[navRows.length - 1] : current.row, col: lastCol };
        break;
      case 'Enter':
      case 'F2':
        if (editable(current)) startEdit(current);
        event.preventDefault();
        return;
      case 'Delete':
      case 'Backspace':
        if (editable(current)) startEdit(current, '');
        event.preventDefault();
        return;
      default:
        // Typing a duration starts editing with it, like a spreadsheet.
        if (!event.ctrlKey && /^[\d.,:]$/u.test(event.key) && editable(current)) {
          startEdit(current, event.key);
          event.preventDefault();
        }
        return;
    }
    event.preventDefault();
    focusCell(target);
  });

  /**
   * Replaces the cell's text with a field holding its exact (unrounded) time.
   * @param {CellPos} pos
   * @param {string} [initial] text to start with instead of the current value
   */
  function startEdit(pos, initial) {
    const cell = cellAt(pos);
    const row = report?.groups.flatMap((g) => g.rows).find((r) => r.taskId === pos.row);
    if (!cell || !row || !report) return;
    const raw = row.raw[pos.col - 1];
    const input = el('input', {
      class: 'field cell-input num',
      type: 'text',
      value: initial ?? (raw > 0 ? formatClock(raw) : ''),
      attrs: {
        'aria-label': t(
          'reportCellLabel',
          row.name,
          formatDay(report.days[pos.col - 1], { now: data.now(), locale }),
        ),
        autocomplete: 'off',
      },
    });
    let done = false;
    // Hiding the pane (another sidebar row) drops the edit, so the grid never stays frozen.
    const cancel = () => {
      done = true;
      editing = null;
    };
    editing = { pos, input, cancel };
    cell.replaceChildren(input);
    input.focus();
    if (initial === undefined) input.select();
    /** @param {'enter' | 'blur' | 'escape'} how */
    const finish = async (how) => {
      if (done) return;
      done = true;
      if (how !== 'escape') {
        // Enter keeps the field open on an unreadable value; leaving the field drops it.
        const ok = await commitEdit(pos, row.taskId, row.name, raw, input.value, how === 'enter');
        if (!ok) {
          done = false;
          input.focus();
          return;
        }
      }
      if (editing?.input !== input) return; // cancelled meanwhile
      editing = null;
      render();
      // After a blur the focus went elsewhere on purpose: leave it there.
      if (how !== 'blur') focusCell(pos);
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish('enter');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish('escape');
      }
    });
    input.addEventListener('blur', () => {
      // A dialog (replace confirmation) takes focus while committing: not a blur commit.
      if (!done && !document.querySelector('dialog[open]')) finish('blur');
    });
  }

  /**
   * Writes a cell. Returns false to keep editing: an unreadable value when `keepOnError`;
   * otherwise (the field lost focus) an unreadable value is dropped.
   * @param {CellPos} pos
   * @param {string} taskId
   * @param {string} taskName
   * @param {number} raw the cell's exact time before the edit
   * @param {string} text
   * @param {boolean} keepOnError
   */
  async function commitEdit(pos, taskId, taskName, raw, text, keepOnError) {
    if (!report) return true;
    /** @type {number} */
    let minutes;
    try {
      minutes = parseDayTotal(text);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      notify({ type: 'warning', message: t('reportBadDuration') });
      return !keepOnError;
    }
    const ms = minutes * MINUTE;
    if (Math.floor(raw / MINUTE) === minutes) return true;
    const day = report.days[pos.col - 1];
    if (ms > startOfDay(day, 1) - day) {
      notify({ type: 'warning', message: t('reportBadDuration') });
      return !keepOnError;
    }
    try {
      let result;
      try {
        result = await setDayTotal(data.db, { taskId, day, ms });
      } catch (error) {
        if (!(error instanceof InvariantError) || error.code !== 'replace-needed') throw error;
        const count = Number(error.details.count);
        if (!(await confirmReplace({ count, taskName, day, ms }))) return true;
        result = await setDayTotal(data.db, { taskId, day, ms }, { replace: true });
      }
      if (result.ids.length > 0) {
        const { undo } = result;
        offerUndo(t('reportEdited'), () => undoDayTotal(data.db, undo).catch(onError));
      }
    } catch (error) {
      onError(error);
    }
    return true;
  }

  /**
   * @param {{count: number, taskName: string, day: number, ms: number}} change
   * @returns {Promise<boolean>}
   */
  async function confirmReplace({ count, taskName, day, ms }) {
    const dayText = formatDay(day, { now: data.now(), locale });
    const clear = ms === 0;
    const text = clear
      ? count === 1
        ? t('reportClearTextOne', taskName, dayText)
        : t('reportClearText', String(count), taskName, dayText)
      : count === 1
        ? t('reportReplaceTextOne', taskName, dayText, duration(ms))
        : t('reportReplaceText', String(count), taskName, dayText, duration(ms));
    const value = await TtDialog.show({
      heading: t(
        clear
          ? count === 1
            ? 'reportClearTitleOne'
            : 'reportClearTitle'
          : count === 1
            ? 'reportReplaceTitleOne'
            : 'reportReplaceTitle',
      ),
      body: text,
      buttons: [
        { label: t('dialogCancel'), value: 'cancel' },
        {
          label: t(clear ? 'reportClearButton' : 'reportReplaceButton'),
          value: 'ok',
          primary: true,
          destructive: clear,
        },
      ],
    });
    return value === 'ok';
  }

  // ---- Add a task row ----
  const addButton = /** @type {HTMLButtonElement} */ (ref('report-add-task'));
  addButton.prepend(icon('add'));
  addButton.addEventListener('click', async () => {
    const first = [...data.tasks.values()].find((task) => task.status === 'open');
    if (!first) return;
    const select = taskSelect({ projects: data.projects, tasks: data.tasks }, first.id);
    const value = await TtDialog.show({
      heading: t('reportAddTaskTitle'),
      body: labelled(t('reportTask'), select),
      buttons: [
        { label: t('dialogCancel'), value: 'cancel' },
        { label: t('reportAddTaskButton'), value: 'ok', primary: true },
      ],
    });
    if (value !== 'ok') return;
    extraTaskIds.add(select.value);
    current = { row: select.value, col: 1 };
    await load();
    focusCell(current);
  });

  // ---- Export ----
  function exportCsv() {
    if (!report) return;
    const headers = /** @type {Record<(typeof REPORT_CSV_COLUMNS)[number], string>} */ (
      Object.fromEntries(REPORT_CSV_COLUMNS.map((column) => [column, t(CSV_HEADERS[column])]))
    );
    const name = `time-tracker-report-${dayKey(range().start)}.csv`;
    download(
      reportCsv(report, { projects: data.projects, tasks: [...data.tasks.values()], headers }),
      name,
      'text/csv',
    );
    notify({ type: 'info', message: t('reportExported', name) });
  }

  return {
    get visible() {
      return visible;
    },
    /** @param {boolean} show */
    setVisible(show) {
      visible = show;
      root.hidden = !show;
      if (!show) editing?.cancel();
      if (show) load();
      else generation++;
    },
    /** Reload after a data change (entries, tasks, projects, settings) or a minute tick. */
    refresh() {
      if (visible) load();
    },
    focus() {
      if (navRows.length > 0) focusCell(current.row ? current : { row: navRows[0], col: 1 });
      else presetSelect.focus();
    },
  };
}
