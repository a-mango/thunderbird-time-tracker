// Task dialogs (tt-dialog): properties, Move To… and the reopen question. They only collect the
// user's answer; ui/task-commands.js writes it through db/.
import { TtDialog } from './components/tt-dialog.js';
import { t } from './i18n.js';
import { el } from './render.js';
import { formatEstimate } from '../lib/format.js';
import { LIMITS } from '../lib/limits.js';
import { parseEstimate } from '../lib/parse.js';
import { moveTargets } from '../lib/sidebar.js';
import { tagsOf } from '../lib/task-list.js';

/**
 * @typedef {import('../lib/types.js').Project} Project
 * @typedef {import('../lib/types.js').Task} Task
 * @typedef {{name: string, projectId: string, estimateMin: number | null, billable: boolean,
 *            done: boolean, tags: string[], notes: string}} TaskInput
 */

/** Indent for nested options: native <select> options can't be padded. */
const INDENT = ' ';

/** @param {string} prefix */
export const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;

/**
 * A <select> of projects in tree order. A task in an archived project keeps that project as
 * the first option, so saving doesn't move it.
 * @param {Project[]} projects
 * @param {string} selected
 */
function projectSelect(projects, selected) {
  const select = el('select', { class: 'field', id: uid('tt-project'), name: 'project' });
  const targets = moveTargets(projects, null);
  if (!targets.some((target) => target.id === selected)) {
    const current = projects.find((p) => p.id === selected);
    if (current) select.append(el('option', { value: current.id, text: current.name }));
  }
  for (const target of targets) {
    select.append(
      el('option', { value: target.id, text: `${INDENT.repeat(target.depth)}${target.label}` }),
    );
  }
  select.value = selected;
  return select;
}

/**
 * @param {string} labelText
 * @param {HTMLElement} field
 * @param {string} [hint]
 */
export function labelled(labelText, field, hint) {
  const hintEl = hint ? el('p', { class: 'dialog-hint', id: uid('tt-hint'), text: hint }) : null;
  if (hintEl) field.setAttribute('aria-describedby', hintEl.id);
  return el(
    'div',
    { class: 'dialog-field' },
    el('label', { class: 'dialog-label', text: labelText, htmlFor: field.id }),
    field,
    hintEl,
  );
}

/** @param {string} labelText @param {boolean} checked */
function checkbox(labelText, checked) {
  const input = el('input', { type: 'checkbox', id: uid('tt-check'), checked });
  return {
    input,
    row: el(
      'div',
      { class: 'dialog-check' },
      input,
      el('label', { text: labelText, htmlFor: input.id }),
    ),
  };
}

/** Comma-separated tags → trimmed, distinct (case-insensitive) list. @param {string} text */
export function splitTags(text) {
  /** @type {Map<string, string>} */
  const tags = new Map();
  for (const part of text.split(',')) {
    const tag = part.trim().slice(0, LIMITS.tag);
    if (tag && !tags.has(tag.toLocaleLowerCase())) tags.set(tag.toLocaleLowerCase(), tag);
  }
  return [...tags.values()].slice(0, LIMITS.tags);
}

/**
 * Edits a task's properties.
 * @param {Task} task
 * @param {{projects: Project[], tasks: Iterable<Task>}} context
 * @returns {Promise<TaskInput | null>} null when cancelled
 */
export async function taskDialog(task, { projects, tasks }) {
  const name = el('input', {
    class: 'field',
    id: uid('tt-name'),
    type: 'text',
    required: true,
    maxLength: LIMITS.name,
    value: task.name,
    autocomplete: 'off',
  });
  name.addEventListener('input', () => {
    name.setCustomValidity(name.value.trim() ? '' : t('taskNameRequired'));
  });
  const project = projectSelect(projects, task.projectId);
  const estimate = el('input', {
    class: 'field num',
    id: uid('tt-estimate'),
    type: 'text',
    value: task.estimateMin === null ? '' : formatEstimate(task.estimateMin),
    autocomplete: 'off',
    size: 10,
  });
  estimate.addEventListener('input', () => {
    try {
      parseEstimate(estimate.value);
      estimate.setCustomValidity('');
    } catch {
      estimate.setCustomValidity(t('taskEstimateInvalid'));
    }
  });
  const suggestions = el('datalist', { id: uid('tt-tags-list') });
  for (const tag of tagsOf(tasks, messenger.i18n.getUILanguage())) {
    suggestions.append(el('option', { value: tag }));
  }
  const tags = el('input', {
    class: 'field',
    id: uid('tt-tags'),
    type: 'text',
    value: task.tags.join(', '),
    autocomplete: 'off',
    attrs: { list: suggestions.id },
  });
  const notes = el('textarea', {
    class: 'field',
    id: uid('tt-notes'),
    rows: 4,
    maxLength: LIMITS.text,
    value: task.notes,
  });
  const billable = checkbox(t('taskBillable'), task.billable);
  const done = checkbox(t('taskDone'), task.status === 'done');
  const body = el(
    'div',
    { class: 'task-form' },
    labelled(t('taskName'), name),
    labelled(t('taskProject'), project),
    labelled(t('taskEstimate'), estimate, t('taskEstimateHint')),
    el('div', { class: 'dialog-checks' }, billable.row, done.row),
    labelled(t('taskTags'), tags, t('taskTagsHint')),
    suggestions,
    labelled(t('taskNotes'), notes),
  );
  const value = await TtDialog.show({
    heading: t('taskDialogEdit'),
    body,
    buttons: [
      { label: t('dialogCancel'), value: 'cancel' },
      { label: t('dialogSave'), value: 'ok', primary: true },
    ],
  });
  if (value !== 'ok') return null;
  return {
    name: name.value.trim(),
    projectId: project.value,
    estimateMin: parseEstimate(estimate.value),
    billable: billable.input.checked,
    done: done.input.checked,
    tags: splitTags(tags.value),
    notes: notes.value,
  };
}

/**
 * Asks which project to move `task` to.
 * @param {Task} task
 * @param {Project[]} projects
 * @returns {Promise<string | null>} the project id, null when cancelled
 */
export async function moveTaskDialog(task, projects) {
  const project = projectSelect(projects, task.projectId);
  const value = await TtDialog.show({
    heading: t('taskMoveTitle'),
    body: labelled(t('taskMoveText', task.name), project),
    buttons: [
      { label: t('dialogCancel'), value: 'cancel' },
      { label: t('moveButton'), value: 'ok', primary: true },
    ],
  });
  return value === 'ok' ? project.value : null;
}

/** Starting a done task: reopen it first? @param {Task} task */
export async function confirmReopen(task) {
  const value = await TtDialog.show({
    heading: t('reopenTitle'),
    body: t('reopenText', task.name),
    buttons: [
      { label: t('dialogCancel'), value: 'cancel' },
      { label: t('reopenButton'), value: 'ok', primary: true },
    ],
  });
  return value === 'ok';
}
