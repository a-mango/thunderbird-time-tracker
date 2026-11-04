// Entry dialogs (tt-dialog): the entry editor with its overlap warning, and the split dialog.
// They only collect the user's answer; ui/entry-commands.js writes it through db/.
import { TtDialog } from './components/tt-dialog.js';
import { t } from './i18n.js';
import { el } from './render.js';
import { labelled, uid } from './task-dialogs.js';
import {
  combine,
  dateInput,
  endAfter,
  entryProblem,
  latestAt,
  timeInput,
} from '../lib/entry-form.js';
import { formatAwayRange, formatDuration, formatTimeRange } from '../lib/format.js';
import { LIMITS } from '../lib/limits.js';
import { parseEstimate } from '../lib/parse.js';
import { ancestorPath } from '../lib/sidebar.js';
import { dayKey } from '../lib/time.js';

/**
 * @typedef {import('../lib/types.js').Entry} Entry
 * @typedef {import('../lib/types.js').Project} Project
 * @typedef {import('../lib/types.js').Task} Task
 * @typedef {{taskId: string, start: number, end: number | null, note: string}} EntryDraft
 *   `end === null`: the running entry keeps running
 * @typedef {{projects: Project[], tasks: Map<string, Task>}} TaskContext
 */

const MINUTE = 60_000;

/** @type {Record<import('../lib/entry-form.js').EntryProblem, string>} */
const PROBLEM_MESSAGES = {
  'start-missing': 'entryStartMissing',
  'start-future': 'entryStartFuture',
  'end-missing': 'entryEndMissing',
  'end-before-start': 'entryEndBeforeStart',
  'end-future': 'entryEndFuture',
};

/**
 * A <select> of tasks grouped by project (tree order, full path as the group label): open
 * tasks, plus `current` even when it is done.
 * @param {TaskContext} context
 * @param {string} current
 * @param {{name?: string}} [options]
 */
export function taskSelect({ projects, tasks }, current, { name = 'task' } = {}) {
  const select = el('select', { class: 'field', id: uid('tt-task'), name });
  /** @type {Map<string, Task[]>} */
  const byProject = new Map();
  for (const task of tasks.values()) {
    if (task.status !== 'open' && task.id !== current) continue;
    const list = byProject.get(task.projectId) ?? [];
    list.push(task);
    byProject.set(task.projectId, list);
  }
  const byId = new Map(projects.map((project) => [project.id, project]));
  for (const project of projects) {
    const list = byProject.get(project.id);
    if (!list) continue;
    const path = ancestorPath(projects, project.id)
      .reverse()
      .map((id) => byId.get(id)?.name ?? '');
    const group = el('optgroup', { label: path.join(' › ') });
    for (const task of list.sort((a, b) => a.order - b.order)) {
      group.append(el('option', { value: task.id, text: task.name }));
    }
    select.append(group);
  }
  select.value = current;
  return select;
}

/**
 * Opens the entry editor. Date, start and end (or duration: either one drives the other; moving
 * the start keeps the duration), note and task. A running entry may leave the end empty to keep
 * running. When saving, `confirmSave` can still refuse (the overlap warning): the dialog then
 * opens again with the same values.
 * @param {{
 *   heading: string,
 *   draft: EntryDraft,
 *   running: boolean,
 *   context: TaskContext,
 *   now: () => number,
 *   confirmSave: (draft: EntryDraft) => Promise<boolean>,
 * }} options
 * @returns {Promise<EntryDraft | null>} null when cancelled
 */
export async function entryDialog({ heading, draft, running, context, now, confirmSave }) {
  let start = /** @type {number | null} */ (draft.start);
  let end = draft.end;

  const date = el('input', {
    class: 'field num',
    id: uid('tt-date'),
    type: 'date',
    required: true,
    value: dateInput(draft.start),
  });
  const startField = el('input', {
    class: 'field num',
    id: uid('tt-start'),
    type: 'time',
    required: true,
    value: timeInput(draft.start),
  });
  const endField = el('input', {
    class: 'field num',
    id: uid('tt-end'),
    type: 'time',
    required: !running,
    value: end === null ? '' : timeInput(end),
  });
  const duration = el('input', {
    class: 'field num',
    id: uid('tt-duration'),
    type: 'text',
    autocomplete: 'off',
    size: 8,
  });
  const nextDay = el('span', {
    class: 'dialog-hint entry-next-day',
    id: uid('tt-next-day'),
    text: t('entryNextDay'),
  });
  const note = el('input', {
    class: 'field',
    id: uid('tt-note'),
    type: 'text',
    maxLength: LIMITS.text,
    value: draft.note,
    autocomplete: 'off',
  });
  const task = taskSelect(context, draft.taskId);

  const showDuration = () => {
    duration.value =
      start !== null && end !== null && end > start ? formatDuration(end - start) : '';
  };
  const validate = () => {
    nextDay.hidden = start === null || end === null || dayKey(start) === dayKey(end);
    const problem = entryProblem({ start, end, running, now: now() });
    const message = problem ? t(PROBLEM_MESSAGES[problem]) : '';
    const onStart = problem === 'start-missing' || problem === 'start-future';
    startField.setCustomValidity(onStart ? message : '');
    endField.setCustomValidity(onStart ? '' : message);
  };
  /** The end on the start's day (or a running entry's empty end). */
  const endFromField = () => {
    if (endField.value === '') return null;
    return endAfter(endField.value, start ?? draft.start);
  };
  const onStartChange = () => {
    const kept = start !== null && end !== null ? end - start : null;
    start = combine(date.value, startField.value);
    if (start !== null && kept !== null) {
      end = start + kept;
      endField.value = timeInput(end);
    } else {
      end = endFromField();
    }
    showDuration();
    validate();
  };
  date.addEventListener('input', onStartChange);
  startField.addEventListener('input', onStartChange);
  endField.addEventListener('input', () => {
    end = endFromField();
    showDuration();
    validate();
  });
  duration.addEventListener('input', () => {
    duration.setCustomValidity('');
    if (duration.value.trim() === '' && running) {
      end = null;
      endField.value = '';
      validate();
      return;
    }
    try {
      const minutes = parseEstimate(duration.value);
      if (minutes === null || start === null) throw new Error('blank');
      end = start + minutes * MINUTE;
      endField.value = timeInput(end);
      validate();
    } catch {
      duration.setCustomValidity(t('entryDurationInvalid'));
    }
  });
  showDuration();
  validate();

  const body = el(
    'div',
    { class: 'entry-form' },
    labelled(t('entryDate'), date),
    el(
      'div',
      { class: 'entry-times' },
      labelled(t('entryStart'), startField),
      labelled(t('entryEnd'), endField, running ? t('entryEndRunningHint') : undefined),
      labelled(t('entryDuration'), duration),
    ),
    nextDay,
    labelled(t('entryNote'), note),
    labelled(t('entryTask'), task),
  );
  // The End field's own hint (running entry) comes first.
  endField.setAttribute(
    'aria-describedby',
    [endField.getAttribute('aria-describedby'), nextDay.id].filter(Boolean).join(' '),
  );
  for (;;) {
    const value = await TtDialog.show({
      heading,
      body,
      buttons: [
        { label: t('dialogCancel'), value: 'cancel' },
        { label: t('dialogSave'), value: 'ok', primary: true },
      ],
    });
    if (value !== 'ok' || start === null) return null;
    /** @type {EntryDraft} */
    const result = { taskId: task.value, start, end, note: note.value.trim() };
    if (await confirmSave(result)) return result;
  }
}

/**
 * The overlap warning: lists the overlapping entries; "Save Anyway" or back to the editor.
 * @param {Entry[]} overlaps
 * @param {{tasks: Map<string, Task>, locale: string}} context
 * @returns {Promise<boolean>} true to save anyway
 */
export async function confirmOverlap(overlaps, { tasks, locale }) {
  const list = el(
    'ul',
    { class: 'overlap-list' },
    ...overlaps.map((entry) =>
      el(
        'li',
        {},
        el('span', { text: tasks.get(entry.taskId)?.name ?? '' }),
        ' ',
        el('span', {
          class: 'num',
          text: formatTimeRange(entry.start, entry.end, { locale, nowLabel: t('entryNow') }),
        }),
      ),
    ),
  );
  const text =
    overlaps.length === 1 ? t('overlapTextOne') : t('overlapText', String(overlaps.length));
  const value = await TtDialog.show({
    heading: t('overlapTitle'),
    body: el('div', {}, el('p', { text }), list),
    buttons: [
      { label: t('overlapBack'), value: 'cancel' },
      { label: t('overlapSave'), value: 'ok', primary: true },
    ],
  });
  return value === 'ok';
}

/**
 * Asks where to split an entry: the running one at now or at a chosen time, a stopped one at a
 * time inside it; the second part can move to another task.
 * @param {{entry: Entry, context: TaskContext, now: () => number, locale: string}} options
 * @returns {Promise<{at: number, taskId: string} | null>} null when cancelled
 */
export async function splitDialog({ entry, context, now, locale }) {
  const running = entry.end === null;
  const name = uid('tt-split-when');
  const atNow = el('input', { type: 'radio', name, id: uid('tt-split-now'), checked: running });
  const atTime = el('input', { type: 'radio', name, id: uid('tt-split-at'), checked: !running });
  const end = entry.end ?? now();
  const time = el('input', {
    class: 'field num',
    id: uid('tt-split-time'),
    type: 'time',
    required: true,
    value: timeInput(running ? end : entry.start + (end - entry.start) / 2),
    attrs: { 'aria-label': t('splitTime') },
  });
  const task = taskSelect(context, entry.taskId);
  /** Split point from the inputs, or null when it is outside the entry. */
  const point = () => {
    if (running && atNow.checked) return now();
    // A stopped entry splits strictly before its end; the running one up to now.
    return latestAt(time.value, { after: entry.start, before: running ? now() : end - 1 });
  };
  const validate = () => {
    time.disabled = running && atNow.checked;
    time.setCustomValidity(point() === null ? t('splitOutside') : '');
  };
  for (const input of [atNow, atTime, time]) input.addEventListener('input', validate);
  validate();

  const range = formatTimeRange(entry.start, entry.end, { locale, nowLabel: t('entryNow') });
  const when = running
    ? el(
        'fieldset',
        { class: 'dialog-choices' },
        el('legend', { class: 'dialog-label', text: t('splitWhen') }),
        el(
          'div',
          { class: 'dialog-check' },
          atNow,
          el('label', { text: t('splitAtNow'), htmlFor: atNow.id }),
        ),
        el(
          'div',
          { class: 'dialog-check' },
          atTime,
          el('label', { text: t('splitAtTime'), htmlFor: atTime.id }),
          time,
        ),
      )
    : labelled(t('splitWhen'), time);
  if (!running) time.removeAttribute('aria-label');
  const body = el(
    'div',
    { class: 'entry-form' },
    el(
      'p',
      { class: 'split-range' },
      t('splitText'),
      ' ',
      el('span', { class: 'num', text: range }),
    ),
    when,
    labelled(t('splitTask'), task),
  );
  const value = await TtDialog.show({
    heading: t('splitTitle'),
    body,
    buttons: [
      { label: t('dialogCancel'), value: 'cancel' },
      { label: t('splitButton'), value: 'ok', primary: true },
    ],
  });
  const at = value === 'ok' ? point() : null;
  return at === null ? null : { at, taskId: task.value };
}

/**
 * Assign to… from the idle prompt: picks the task that gets the time away (any open task but
 * the running one).
 * @param {{context: TaskContext, runningTaskId: string, since: number, until: number,
 *   locale: string}} options
 * @returns {Promise<string | null>} the task id, `null` when cancelled
 */
export async function assignIdleDialog({ context, runningTaskId, since, until, locale }) {
  const tasks = new Map([...context.tasks].filter(([id]) => id !== runningTaskId));
  const task = taskSelect({ projects: context.projects, tasks }, '');
  const empty = task.options.length === 0;
  if (empty) task.append(el('option', { value: '', text: t('idleAssignNoTask') }));
  else task.selectedIndex = 0;
  task.disabled = empty;
  const body = el(
    'div',
    { class: 'entry-form' },
    el('p', { text: t('idleAssignText', formatAwayRange(since, until, { locale })) }),
    labelled(t('idleAssignTask'), task),
  );
  const value = await TtDialog.show({
    heading: t('idleAssignTitle'),
    body,
    buttons: [
      { label: t('dialogCancel'), value: 'cancel' },
      { label: t('idleAssignButton'), value: 'ok', primary: true },
    ],
  });
  return value === 'ok' && task.value ? task.value : null;
}
